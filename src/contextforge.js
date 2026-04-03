import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "./storage/db.js";
import { loadRepositoryFiles, loadRepositoryInventory } from "./indexing/files.js";
import { parseSource } from "./indexing/tree-sitter.js";
import { extractSymbols } from "./indexing/symbols.js";
import { createFallbackFileArtifacts } from "./indexing/parser-fallback.js";
import { makeId } from "./indexing/canonicalize.js";
import { buildRaptorTree } from "./retrieval/raptor/tree.js";
import { extractImportEdges } from "./pdg/import-graph.js";
import { extractCallEdges } from "./pdg/call-graph.js";
import { extractControlEdges } from "./pdg/js-ts-control.js";
import { extractDataFlowEdges } from "./pdg/js-ts-dataflow.js";
import { computeImpact } from "./pdg/impact.js";
import { embedText } from "./retrieval/vectors.js";
import { hybridSearch, planRaptorStrategy } from "./retrieval/hybrid.js";
import { exactSymbolSearch } from "./retrieval/exact.js";
import { resolveAliasSeeds } from "./graph/alias-resolution.js";
import { buildRepoGraph } from "./graph/repo-graph.js";
import { personalizedPageRank } from "./graph/pagerank.js";
import { recordSessionEvent, listSessionEvents } from "./session/events.js";
import { buildResumeSummary } from "./session/resume.js";
import { classifyContent } from "./router/classify-content.js";
import { decideRoute } from "./router/bypass-policy.js";
import { safeCompress } from "./compression/safe-compress.js";
import { createPage, touchPage } from "./pager/pages.js";
import { noteFault, retrievalHandle } from "./pager/page-faults.js";
import { chooseEvictions } from "./pager/eviction.js";
import { maybePinPage } from "./pager/pinning.js";
import { pressureZone } from "./pager/pressure-zones.js";
import { recommendPrefetchPages } from "./pager/prefetch.js";
import { cacheLayout } from "./pager/cache-layout.js";
import { classifyStartup } from "./pager/classify-startup.js";
import { sha1 } from "./utils/hash.js";
import { tokenize, unique } from "./utils/text.js";
import { MODEL_METADATA } from "./storage/model-metadata.js";
import { purgeOldSessionEvents } from "./session/retention.js";
import { clearActiveSession } from "./session/runtime.js";
import { readText } from "./utils/fs.js";

const REPO_STATE_CACHE = new Map();
const SYSTEM_EVENT_TYPES = new Set(["index", "index_reuse", "startup", "search"]);

export class ContextForge {
  constructor(rootDir, options = {}) {
    this.rootDir = path.resolve(rootDir);
    this.db = openDatabase(this.rootDir);
    this.repoId = sha1(this.rootDir);
    this.sessionId = options.sessionId ?? makeId("session", `${Date.now()}:${randomUUID()}`);
    this.coreInstructions = options.coreInstructions ?? "Use exact lookup before broad reads. Compress only safe artifact classes.";
    this.startupBrief = options.startupBrief ?? "Use exact lookup. Load only what is needed. Fault in the rest.";
    this.repoFingerprint = null;
    this._repoState = null;
    this._repoInventory = null;
    this._filePathById = null;
  }

  close() {
    this.db.close();
  }

  indexRepository(options = {}) {
    const db = this.db;
    const repoId = this.repoId;
    const files = loadRepositoryFiles(this.rootDir, repoId);
    const repoFingerprint = this._computeRepoFingerprint(files);
    this.repoFingerprint = repoFingerprint;

    if (!options.force && this._canReuseIndex(repoFingerprint, files.length)) {
      this._repoState = null;
      this._filePathById = null;
      recordSessionEvent(db, {
        repoId,
        sessionId: this.sessionId,
        eventType: "index_reuse",
        payload: {
          fileCount: files.length,
          fingerprint: repoFingerprint
        }
      });
      return {
        ...this._repoCounts(),
        repoId,
        reusedIndex: true,
        fingerprint: repoFingerprint
      };
    }

    db.exec("BEGIN IMMEDIATE");

    try {
      this._clearRepoData();
      db.prepare(`
        INSERT OR REPLACE INTO repositories (repo_id, root_path, default_branch, content_fingerprint, file_count, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(repoId, this.rootDir, "main", repoFingerprint, files.length, Date.now());

      const allSymbols = [];
      const allChunks = [];

      const insertFile = db.prepare(`
        INSERT OR REPLACE INTO files (file_id, repo_id, file_path, file_hash, language, parse_status, parse_error, updated_at)
        VALUES (@fileId, @repoId, @filePath, @fileHash, @language, @parseStatus, @parseError, @updatedAt)
      `);
      const insertSymbol = db.prepare(`
        INSERT OR REPLACE INTO symbols (symbol_id, repo_id, file_id, canonical_name, display_name, kind, language, span_start, span_end, parent_symbol_id, symbol_hash, body)
        VALUES (@symbolId, @repoId, @fileId, @canonicalName, @displayName, @kind, @language, @spanStart, @spanEnd, @parentSymbolId, @symbolHash, @body)
      `);
      const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO chunks (chunk_id, repo_id, file_id, chunk_type, label, text, summary, span_start, span_end, chunk_hash, invalidation_state)
        VALUES (@chunkId, @repoId, @fileId, @chunkType, @label, @text, @summary, @spanStart, @spanEnd, @chunkHash, @invalidationState)
      `);
      const insertFts = db.prepare(`
        INSERT INTO chunk_fts (chunk_id, label, text)
        VALUES (?, ?, ?)
      `);
      const insertVector = db.prepare(`
        INSERT OR REPLACE INTO vectors (vector_id, repo_id, item_type, item_id, embedding_model, embedding_dim, embedding_json)
        VALUES (@vectorId, @repoId, @itemType, @itemId, @embeddingModel, @embeddingDim, @embeddingJson)
      `);

      for (const file of files) {
        let parsed = null;
        let fileArtifacts;
        let parseStatus = "parsed";
        let parseError = null;

        try {
          parsed = parseSource({
            language: file.language,
            filePath: file.absolutePath,
            content: file.content
          });

          if (parsed) {
            fileArtifacts = extractSymbols({
              repoId,
              fileId: file.fileId,
              relativePath: file.relativePath,
              language: file.language,
              tree: parsed,
              content: file.content
            });

            if (!fileArtifacts.symbols.length) {
              fileArtifacts = createFallbackFileArtifacts({
                repoId,
                fileId: file.fileId,
                relativePath: file.relativePath,
                language: file.language,
                content: file.content
              });
            }
          } else {
            parseStatus = "fallback";
            fileArtifacts = createFallbackFileArtifacts({
              repoId,
              fileId: file.fileId,
              relativePath: file.relativePath,
              language: file.language,
              content: file.content
            });
          }
        } catch (error) {
          parseStatus = "fallback";
          parseError = error.message;
          fileArtifacts = createFallbackFileArtifacts({
            repoId,
            fileId: file.fileId,
            relativePath: file.relativePath,
            language: file.language,
            content: file.content
          });
        }

        insertFile.run({
          fileId: file.fileId,
          repoId,
          filePath: file.relativePath,
          fileHash: file.fileHash,
          language: file.language,
          parseStatus,
          parseError,
          updatedAt: Date.now()
        });

        for (const symbol of fileArtifacts.symbols) {
          insertSymbol.run(symbol);
          allSymbols.push(symbol);
        }

        for (const chunk of fileArtifacts.chunks) {
          insertChunk.run(chunk);
          insertFts.run(chunk.chunkId, chunk.label, chunk.text);
          insertVector.run({
            vectorId: makeId("vector", chunk.chunkId),
            repoId,
            itemType: "chunk",
            itemId: chunk.chunkId,
            embeddingModel: MODEL_METADATA.embeddings.default.name,
            embeddingDim: MODEL_METADATA.embeddings.default.dimension,
            embeddingJson: JSON.stringify(embedText(chunk.text))
          });
          allChunks.push(chunk);
        }
      }

      const pdgEdges = [
        ...extractImportEdges({ repoId, symbols: allSymbols, files }),
        ...extractCallEdges({ repoId, symbols: allSymbols, files }),
        ...extractControlEdges({ repoId, symbols: allSymbols }),
        ...extractDataFlowEdges({ repoId, symbols: allSymbols })
      ];

      const insertEdge = db.prepare(`
        INSERT OR REPLACE INTO symbol_edges (edge_id, repo_id, from_symbol_id, to_symbol_id, edge_type, confidence, provenance_source)
        VALUES (@edgeId, @repoId, @fromSymbolId, @toSymbolId, @edgeType, @confidence, @provenanceSource)
      `);
      for (const edge of pdgEdges) {
        insertEdge.run(edge);
      }

      const raptorNodes = buildRaptorTree({ repoId, files, symbols: allSymbols });
      const insertRaptor = db.prepare(`
        INSERT OR REPLACE INTO raptor_nodes (node_id, repo_id, parent_node_id, node_type, label, summary, token_budget, source_item_type, source_item_id, cache_state)
        VALUES (@nodeId, @repoId, @parentNodeId, @nodeType, @label, @summary, @tokenBudget, @sourceItemType, @sourceItemId, @cacheState)
      `);
      for (const node of raptorNodes) {
        insertRaptor.run(node);
      }

      recordSessionEvent(db, {
        repoId,
        sessionId: this.sessionId,
        eventType: "index",
        payload: {
          fileCount: files.length,
          symbolCount: allSymbols.length,
          chunkCount: allChunks.length,
          fingerprint: repoFingerprint
        }
      });

      db.exec("COMMIT");
      this._invalidateRepoCaches();
      return {
        repoId,
        filesIndexed: files.length,
        symbolsIndexed: allSymbols.length,
        chunksIndexed: allChunks.length,
        edgesIndexed: pdgEdges.length,
        raptorNodesIndexed: raptorNodes.length,
        reusedIndex: false,
        fingerprint: repoFingerprint
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  search(query, options = {}) {
    const state = this._loadRepoState();
    const results = hybridSearch({
      db: this.db,
      query,
      symbols: state.symbols,
      chunks: state.chunks,
      raptorNodes: state.raptorNodes,
      repoGraph: state.repoGraph,
      limit: options.limit ?? 10
    });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "search",
      payload: {
        query,
        resultCount: results.length,
        topLabel: results[0]?.label ?? null,
        topFileId: results[0]?.fileId ?? null,
        topFilePath: this._relativePathForFile(results[0]?.fileId)
      }
    });

    return results;
  }

  symbol(query, options = {}) {
    const symbols = this._loadSymbols();
    const exact = exactSymbolSearch(query, symbols, options.limit ?? 10);
    if (exact.length) {
      return exact;
    }

    const aliasSeedIds = resolveAliasSeeds(query, symbols, options.limit ?? 10);
    return this._symbolsByRank(symbols, aliasSeedIds);
  }

  scope(query, mode = "auto") {
    const state = this._loadRepoState();
    const resolvedMode = mode === "auto" ? this.planRaptor(query).strategy : mode;
    if (resolvedMode === "traversal") {
      return hybridSearch({
        db: this.db,
        query,
        symbols: [],
        chunks: [],
        raptorNodes: state.raptorNodes,
        repoGraph: state.repoGraph,
        limit: 10,
        useGraph: false
      }).filter((result) => result.sources?.includes("raptor_traversal"));
    }

    return hybridSearch({
      db: this.db,
      query,
      symbols: [],
      chunks: [],
      raptorNodes: state.raptorNodes,
      repoGraph: state.repoGraph,
      limit: 10,
      useGraph: false
    }).filter((result) => result.sources?.includes("raptor_collapsed"));
  }

  planRaptor(query) {
    return planRaptorStrategy(query);
  }

  impact(query) {
    const symbols = this._loadSymbols();
    const seed = exactSymbolSearch(query, symbols, 1)[0];
    if (!seed) {
      return [];
    }

    const edges = this._loadEdges();
    const impactedIds = computeImpact(seed.symbolId, edges);
    return this._rankImpactResults(symbols, seed.symbolId, impactedIds);
  }

  why(query) {
    const normalizedQuery = String(query ?? "").trim();
    const state = this._loadRepoState();
    const seeds = this._buildWhySeeds(state, normalizedQuery).slice(0, 3);
    const graphRanking = this._rankWhyGraph(state.repoGraph, seeds).slice(0, 6);
    const session = this._rankSessionEvidence(normalizedQuery, seeds).slice(0, 3);

    return {
      seeds,
      graph: graphRanking,
      session,
      summary: this._buildWhySummary({ query: normalizedQuery, seeds, graph: graphRanking, session })
    };
  }

  session(query = "") {
    const lowered = String(query ?? "").toLowerCase();
    return listSessionEvents(this.db, this.sessionId, this.repoId)
      .filter((event) => !SYSTEM_EVENT_TYPES.has(event.eventType))
      .filter((event) =>
        !lowered || JSON.stringify(event.payload).toLowerCase().includes(lowered) || event.eventType.toLowerCase().includes(lowered));
  }

  resume() {
    return buildResumeSummary(this.db, { repoId: this.repoId, sessionId: this.sessionId });
  }

  async processArtifact(content, metadata = {}) {
    const contentType = classifyContent(content, metadata);
    const route = decideRoute(contentType);

    if (route === "exact") {
      return {
        contentType,
        route,
        output: String(content ?? "")
      };
    }

    if (route === "lossy_safe_with_invariant_check") {
      const compressed = await safeCompress(content, {
        contentType,
        preferModel: metadata.preferModel ?? process.env.CONTEXTFORGE_USE_LLMLINGUA === "1"
      });
      this.db.prepare(`
        INSERT OR REPLACE INTO compression_events (event_id, repo_id, session_id, route_class, content_type, compressor, raw_size, compressed_size, invariant_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        makeId("compression", `${Date.now()}:${contentType}`),
        this.repoId,
        this.sessionId,
        route,
        contentType,
        compressed.usedFallback ? MODEL_METADATA.compression.default.name : "@atjsh/llmlingua-2",
        compressed.rawSize,
        compressed.compressedSize,
        compressed.fidelity.ok ? "pass" : "fail",
        Date.now()
      );

      return {
        contentType,
        route,
        output: compressed.compressed,
        fidelity: compressed.fidelity
      };
    }

    return {
      contentType,
      route,
      output: String(content ?? "")
    };
  }

  startup(message) {
    const task = classifyStartup(message);
    const preloadPlan = this._startupPreloadPlan(message, task);
    const pages = [
      createPage({
        sessionId: this.sessionId,
        pageType: "core_instructions",
        sourceItemType: "instruction",
        sourceItemId: "core",
        sizeEstimate: this.startupBrief.length
      })
    ];

    if (preloadPlan.toolSchemas.length) {
      pages.push(createPage({
        sessionId: this.sessionId,
        pageType: "tool_schema",
        sourceItemType: "tool",
        sourceItemId: preloadPlan.toolSchemas[0],
        sizeEstimate: preloadPlan.toolBudget
      }));
    }

    for (const preload of preloadPlan.preloads) {
      pages.push(createPage({
        sessionId: this.sessionId,
        pageType: preload.pageType,
        sourceItemType: preload.sourceItemType,
        sourceItemId: preload.sourceItemId,
        sizeEstimate: preload.sizeEstimate
      }));
    }

    const insertPage = this.db.prepare(`
      INSERT OR REPLACE INTO pages (page_id, session_id, page_type, source_item_type, source_item_id, size_estimate, pin_state, fault_count, last_used_at, eviction_score)
      VALUES (@pageId, @sessionId, @pageType, @sourceItemType, @sourceItemId, @sizeEstimate, @pinState, @faultCount, @lastUsedAt, @evictionScore)
    `);
    for (const page of pages) {
      insertPage.run(page);
    }

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "startup",
      payload: {
        message,
        taskLabel: task.label,
        loadStrategy: task.loadStrategy,
        preloadPlan: preloadPlan.name
      }
    });

    return {
      task,
      layout: cacheLayout({
        coreInstructions: this.startupBrief,
        modules: preloadPlan.preloads
          .filter((preload) => preload.sourceItemType === "module")
          .map((preload) => preload.sourceItemId),
        toolSchemas: preloadPlan.toolSchemas
      }),
      pages
    };
  }

  listTools() {
    return [
      "forge_tools",
      "forge_start",
      "forge_scan",
      "forge_understand",
      "forge_search",
      "forge_symbol",
      "forge_scope",
      "forge_impact",
      "forge_why",
      "forge_session",
      "forge_resume",
      "forge_stats",
      "forge_doctor"
    ];
  }

  understand(query = "") {
    const normalizedQuery = String(query ?? "").trim();
    const inventory = this._loadRepoInventory();
    const topLevel = this._summarizeTopLevel(inventory.files);
    const rootFiles = inventory.files
      .filter((file) => !file.relativePath.includes("/"))
      .map((file) => file.relativePath)
      .sort((left, right) => left.localeCompare(right));
    const packageInfo = this._readPackageInfo();
    const entrypoints = this._detectEntrypoints(inventory.files, packageInfo);
    const architecture = this._summarizeArchitecture({
      files: inventory.files,
      topLevel,
      packageInfo,
      entrypoints
    });
    const importantFiles = this._rankImportantFiles({
      files: inventory.files,
      query: normalizedQuery || "project structure architecture entrypoints important files",
      packageInfo
    }).slice(0, 10);
    const summary = this._buildUnderstandSummary({
      packageInfo,
      topLevel,
      rootFiles,
      entrypoints,
      importantFiles
    });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "understand",
      payload: {
        query: normalizedQuery,
        topLevelCount: topLevel.length,
        importantFileCount: importantFiles.length,
        topEntrypoint: entrypoints[0]?.path ?? null
      }
    });

    return {
      query: normalizedQuery,
      summary,
      mode: "inventory_first",
      packageInfo,
      rootFiles,
      topLevel,
      entrypoints,
      architecture,
      importantFiles
    };
  }

  pageState(maxBudget = 1200) {
    const pages = this.db.prepare(`
      SELECT page_id AS pageId, session_id AS sessionId, page_type AS pageType, source_item_type AS sourceItemType,
             source_item_id AS sourceItemId, size_estimate AS sizeEstimate, pin_state AS pinState,
             fault_count AS faultCount, last_used_at AS lastUsedAt, eviction_score AS evictionScore
      FROM pages
      WHERE session_id = ?
    `).all(this.sessionId);
    const usedBudget = pages.reduce((sum, page) => sum + page.sizeEstimate, 0);
    const zone = pressureZone(maxBudget, usedBudget);
    const context = this._pageContext();
    return {
      pages,
      usedBudget,
      maxBudget,
      zone,
      evictions: chooseEvictions(pages, zone, context)
    };
  }

  notePageFault(pageId, reason = "repeat_fault") {
    const page = this.db.prepare(`
      SELECT page_id AS pageId, session_id AS sessionId, page_type AS pageType, source_item_type AS sourceItemType,
             source_item_id AS sourceItemId, size_estimate AS sizeEstimate, pin_state AS pinState,
             fault_count AS faultCount, last_used_at AS lastUsedAt, eviction_score AS evictionScore
      FROM pages WHERE page_id = ?
    `).get(pageId);
    if (!page) {
      return null;
    }

    const touched = maybePinPage(noteFault(touchPage(page)), reason, this._pageContext());
    this.db.prepare(`
      INSERT OR REPLACE INTO pages (page_id, session_id, page_type, source_item_type, source_item_id, size_estimate, pin_state, fault_count, last_used_at, eviction_score)
      VALUES (@pageId, @sessionId, @pageType, @sourceItemType, @sourceItemId, @sizeEstimate, @pinState, @faultCount, @lastUsedAt, @evictionScore)
    `).run(touched);
    return touched;
  }

  prefetchSuggestions() {
    const recentEvents = listSessionEvents(this.db, this.sessionId, this.repoId);
    return recommendPrefetchPages({ recentEvents });
  }

  purge({ maxAgeMs, includePages = true } = {}) {
    purgeOldSessionEvents(this.db, maxAgeMs);
    this.db.prepare(`DELETE FROM compression_events WHERE repo_id = ? AND session_id = ?`).run(this.repoId, this.sessionId);
    if (includePages) {
      this.db.prepare(`DELETE FROM pages WHERE session_id = ?`).run(this.sessionId);
    }
    clearActiveSession(this.rootDir, this.sessionId);
    return {
      sessionId: this.sessionId,
      purged: true,
      maxAgeMs: maxAgeMs ?? null,
      includePages
    };
  }

  doctor() {
    const fileCount = this.db.prepare(`SELECT COUNT(*) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count;
    const symbolCount = this.db.prepare(`SELECT COUNT(*) AS count FROM symbols WHERE repo_id = ?`).get(this.repoId).count;
    const chunkCount = this.db.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?`).get(this.repoId).count;
    const pageCount = this.db.prepare(`SELECT COUNT(*) AS count FROM pages WHERE session_id = ?`).get(this.sessionId).count;
    const parseFailures = this.db.prepare(`SELECT COUNT(*) AS count FROM files WHERE repo_id = ? AND parse_status = 'error'`).get(this.repoId).count;
    return {
      rootDir: this.rootDir,
      repoId: this.repoId,
      sessionId: this.sessionId,
      fileCount,
      symbolCount,
      chunkCount,
      pageCount,
      parseFailures,
      embeddingModel: MODEL_METADATA.embeddings.default
    };
  }

  stats() {
    const compression = this.db.prepare(`
      SELECT COUNT(*) AS count, SUM(raw_size) AS raw, SUM(compressed_size) AS compressed
      FROM compression_events
      WHERE repo_id = ? AND session_id = ?
    `).get(this.repoId, this.sessionId);
    const retrieval = {
      symbols: this.db.prepare(`SELECT COUNT(*) AS count FROM symbols WHERE repo_id = ?`).get(this.repoId).count,
      edges: this.db.prepare(`SELECT COUNT(*) AS count FROM symbol_edges WHERE repo_id = ?`).get(this.repoId).count,
      raptorNodes: this.db.prepare(`SELECT COUNT(*) AS count FROM raptor_nodes WHERE repo_id = ?`).get(this.repoId).count
    };
    const session = {
      events: this.db.prepare(`SELECT COUNT(*) AS count FROM session_events WHERE repo_id = ? AND session_id = ?`).get(this.repoId, this.sessionId).count,
      edges: this.db.prepare(`SELECT COUNT(*) AS count FROM session_edges WHERE repo_id = ?`).get(this.repoId).count
    };
    return { compression, retrieval, session, pager: this.pageState() };
  }

  _clearRepoData() {
    const db = this.db;
    for (const table of ["files", "symbols", "symbol_edges", "chunks", "vectors", "raptor_nodes"]) {
      db.prepare(`DELETE FROM ${table} WHERE repo_id = ?`).run(this.repoId);
    }
    db.exec("DELETE FROM chunk_fts");
  }

  _loadRepoState() {
    const fingerprint = this.repoFingerprint ?? this._loadRepoFingerprint();
    const cacheKey = `${this.repoId}:${fingerprint ?? "unknown"}`;
    if (this._repoState?.cacheKey === cacheKey) {
      return this._repoState.value;
    }

    if (REPO_STATE_CACHE.has(cacheKey)) {
      const cached = REPO_STATE_CACHE.get(cacheKey);
      this._repoState = { cacheKey, value: cached };
      this._filePathById = new Map(cached.files.map((file) => [file.fileId, file.relativePath]));
      return cached;
    }

    const files = this.db.prepare(`
      SELECT file_id AS fileId, file_path AS relativePath, language
      FROM files WHERE repo_id = ?
    `).all(this.repoId);
    const symbols = this._loadSymbols();
    const chunks = this.db.prepare(`
      SELECT c.chunk_id AS chunkId, c.file_id AS fileId, c.chunk_type AS chunkType, c.label, c.text, c.summary,
             c.span_start AS spanStart, c.span_end AS spanEnd, v.embedding_json AS embeddingJson
      FROM chunks c
      LEFT JOIN vectors v
        ON v.repo_id = c.repo_id
       AND v.item_type = 'chunk'
       AND v.item_id = c.chunk_id
      WHERE c.repo_id = ?
    `).all(this.repoId).map((chunk) => ({
      ...chunk,
      embedding: chunk.embeddingJson ? JSON.parse(chunk.embeddingJson) : null
    }));
    const edges = this._loadEdges();
    const raptorNodes = this.db.prepare(`
      SELECT node_id AS nodeId, parent_node_id AS parentNodeId, node_type AS nodeType, label, summary,
             source_item_type AS sourceItemType, source_item_id AS sourceItemId, cache_state AS cacheState, token_budget AS tokenBudget
      FROM raptor_nodes WHERE repo_id = ?
    `).all(this.repoId);
    const repoGraph = buildRepoGraph({ repoId: this.repoId, files, symbols, pdgEdges: edges, raptorNodes });
    const value = { files, symbols, chunks, edges, raptorNodes, repoGraph };
    REPO_STATE_CACHE.set(cacheKey, value);
    this._repoState = { cacheKey, value };
    this._filePathById = new Map(files.map((file) => [file.fileId, file.relativePath]));
    return value;
  }

  _loadSymbols() {
    return this.db.prepare(`
      SELECT symbol_id AS symbolId, file_id AS fileId, canonical_name AS canonicalName, display_name AS displayName,
             kind, language, span_start AS spanStart, span_end AS spanEnd, parent_symbol_id AS parentSymbolId, symbol_hash AS symbolHash, body
      FROM symbols WHERE repo_id = ?
    `).all(this.repoId);
  }

  _loadEdges() {
    return this.db.prepare(`
      SELECT edge_id AS edgeId, from_symbol_id AS fromSymbolId, to_symbol_id AS toSymbolId,
             edge_type AS edgeType, confidence, provenance_source AS provenanceSource
      FROM symbol_edges WHERE repo_id = ?
    `).all(this.repoId);
  }

  _loadFiles() {
    return this.db.prepare(`
      SELECT file_id AS fileId, file_path AS relativePath, language
      FROM files WHERE repo_id = ?
    `).all(this.repoId);
  }

  _buildWhySeeds(state, query) {
    if (!query) {
      return [];
    }

    const nodeIndex = new Map(state.repoGraph.nodes.map((node) => [node.id, node]));
    const seeds = [];
    const seen = new Set();
    const addSeed = ({ id, label, type, source, score = 0 }) => {
      if (!id || seen.has(id) || !nodeIndex.has(id)) {
        return;
      }

      const node = nodeIndex.get(id);
      seeds.push({
        id,
        label: label ?? node?.label ?? id,
        type: type ?? node?.type ?? "unknown",
        source,
        score
      });
      seen.add(id);
    };

    for (const item of exactSymbolSearch(query, state.symbols, 3)) {
      addSeed({
        id: item.symbolId,
        label: item.canonicalName,
        type: "symbol",
        source: "exact_symbol",
        score: item.score
      });
    }

    for (const symbolId of resolveAliasSeeds(query, state.symbols, 3)) {
      const symbol = state.symbols.find((entry) => entry.symbolId === symbolId);
      addSeed({
        id: symbol?.symbolId,
        label: symbol?.canonicalName,
        type: "symbol",
        source: "alias_symbol",
        score: 0.7
      });
    }

    const broadResults = hybridSearch({
      db: this.db,
      query,
      symbols: state.symbols,
      chunks: state.chunks,
      raptorNodes: state.raptorNodes,
      repoGraph: state.repoGraph,
      limit: 5,
      useGraph: false
    });

    for (const item of broadResults) {
      const candidateId = item.symbolId ?? item.fileId ?? (nodeIndex.has(item.id) ? item.id : null);
      addSeed({
        id: candidateId,
        label: item.label,
        type: nodeIndex.get(candidateId)?.type,
        source: item.kind ?? item.sources?.[0] ?? "hybrid",
        score: item.score
      });
    }

    return seeds
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, 5)
      .map((seed) => ({
        id: seed.id,
        label: seed.label,
        type: seed.type,
        source: seed.source,
        score: Number((seed.score ?? 0).toFixed(3))
      }));
  }

  _rankWhyGraph(repoGraph, seeds) {
    if (!seeds.length) {
      return [];
    }

    const nodeIndex = new Map(repoGraph.nodes.map((node) => [node.id, node]));
    const seedIds = seeds.map((seed) => seed.id);
    return personalizedPageRank({
      nodes: repoGraph.nodes,
      edges: repoGraph.edges,
      seeds: seedIds
    })
      .filter((entry) => (entry.score ?? 0) > 0)
      .slice(0, 8)
      .map((entry) => ({
        id: entry.id,
        score: Number((entry.score ?? 0).toFixed(3)),
        label: nodeIndex.get(entry.id)?.label ?? entry.id,
        type: nodeIndex.get(entry.id)?.type ?? "unknown"
      }))
      .sort((left, right) => {
        const leftPriority = whyNodePriority(left);
        const rightPriority = whyNodePriority(right);
        if (rightPriority !== leftPriority) {
          return rightPriority - leftPriority;
        }

        return (right.score ?? 0) - (left.score ?? 0);
      });
  }

  _rankSessionEvidence(query, seeds) {
    const events = listSessionEvents(this.db, this.sessionId, this.repoId)
      .filter((event) => !SYSTEM_EVENT_TYPES.has(event.eventType));
    if (!events.length) {
      return [];
    }

    const queryTokens = tokenize(query);
    const seedHints = unique(seeds.flatMap((seed) => {
      const label = String(seed.label ?? "").toLowerCase();
      return [
        label,
        label.split("::").pop(),
        label.split("/").pop()
      ].filter(Boolean);
    }));
    const seedFiles = unique(seeds
      .map((seed) => seed.label?.includes("::") ? seed.label.split("::")[0] : null)
      .filter(Boolean));
    const seedSymbols = unique(seeds
      .map((seed) => seed.label?.split("::").pop())
      .filter(Boolean));

    return events
      .map((event) => {
        const payload = event.payload ?? {};
        const payloadText = JSON.stringify(payload);
        const haystack = `${event.eventType} ${payloadText}`.toLowerCase();
        const eventTokens = new Set(tokenize(haystack));
        let score = 0;

        for (const token of queryTokens) {
          if ([...eventTokens].some((candidate) => candidate.includes(token) || token.includes(candidate))) {
            score += 1;
          }
        }

        for (const hint of seedHints) {
          if (haystack.includes(hint)) {
            score += 2;
          }
        }

        if (payload.filePath && seedFiles.includes(payload.filePath)) {
          score += 4;
        }

        if (payload.symbolId && seedSymbols.some((symbol) => payload.symbolId.toLowerCase().includes(String(symbol).toLowerCase()))) {
          score += 4;
        }

        if (event.eventType === "failure") {
          score += 1.5;
        }

        if (event.eventType === "edit" && payload.filePath && seedFiles.includes(payload.filePath)) {
          score += 1.5;
        }

        return {
          eventId: event.eventId,
          eventType: event.eventType,
          createdAt: event.createdAt,
          payload: this._compactSessionPayload(payload),
          score: Number(score.toFixed(3))
        };
      })
      .filter((event) => event.score > 0)
      .sort((left, right) => right.score - left.score || right.createdAt - left.createdAt)
      .slice(0, 5);
  }

  _pageContext() {
    const recentEvents = listSessionEvents(this.db, this.sessionId, this.repoId).slice(-12);
    return {
      activeFiles: unique(recentEvents.map((event) => event.payload?.filePath).filter(Boolean)),
      activeSymbols: unique(recentEvents.map((event) => event.payload?.symbolId).filter(Boolean)),
      failureFiles: unique(recentEvents.filter((event) => event.eventType === "failure").map((event) => event.payload?.filePath).filter(Boolean)),
      failureSymbols: unique(recentEvents.filter((event) => event.eventType === "failure").map((event) => event.payload?.symbolId).filter(Boolean)),
      hotTools: unique(recentEvents.flatMap((event) =>
        event.eventType === "startup" && event.payload?.loadStrategy !== "minimal" ? ["forge_tools"] : []))
    };
  }

  _relativePathForFile(fileId) {
    if (!fileId) {
      return null;
    }

    if (!this._filePathById) {
      this._filePathById = new Map(this._loadFiles().map((entry) => [entry.fileId, entry.relativePath]));
    }

    return this._filePathById.get(fileId) ?? null;
  }

  _symbolsByRank(symbols, rankedIds) {
    const byId = new Map(symbols.map((symbol) => [symbol.symbolId, symbol]));
    return rankedIds.map((symbolId) => byId.get(symbolId)).filter(Boolean);
  }

  _rankImpactResults(symbols, seedSymbolId, rankedIds) {
    const byId = new Map(symbols.map((symbol) => [symbol.symbolId, symbol]));
    const seed = byId.get(seedSymbolId);

    return rankedIds
      .map((symbolId, index) => ({
        symbol: byId.get(symbolId),
        index
      }))
      .filter((entry) => entry.symbol)
      .sort((left, right) => compareImpactEntries(left, right, seedSymbolId, seed))
      .map((entry) => entry.symbol);
  }

  _computeRepoFingerprint(files) {
    return sha1(files
      .map((file) => `${file.relativePath}:${file.fileHash}`)
      .sort()
      .join("\n"));
  }

  _canReuseIndex(repoFingerprint, fileCount) {
    const row = this.db.prepare(`
      SELECT content_fingerprint AS contentFingerprint, file_count AS fileCount
      FROM repositories
      WHERE repo_id = ?
    `).get(this.repoId);

    if (!row || row.contentFingerprint !== repoFingerprint || row.fileCount !== fileCount) {
      return false;
    }

    const counts = this._repoCounts();
    return counts.filesIndexed === fileCount && counts.symbolsIndexed > 0 && counts.chunksIndexed > 0;
  }

  _repoCounts() {
    return {
      filesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
      symbolsIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM symbols WHERE repo_id = ?`).get(this.repoId).count,
      chunksIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?`).get(this.repoId).count,
      edgesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM symbol_edges WHERE repo_id = ?`).get(this.repoId).count,
      raptorNodesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM raptor_nodes WHERE repo_id = ?`).get(this.repoId).count
    };
  }

  _invalidateRepoCaches() {
    this._repoState = null;
    this._repoInventory = null;
    this._filePathById = null;
    for (const key of REPO_STATE_CACHE.keys()) {
      if (key.startsWith(`${this.repoId}:`)) {
        REPO_STATE_CACHE.delete(key);
      }
    }
  }

  _loadRepoFingerprint() {
    const row = this.db.prepare(`
      SELECT content_fingerprint AS contentFingerprint
      FROM repositories
      WHERE repo_id = ?
    `).get(this.repoId);
    this.repoFingerprint = row?.contentFingerprint ?? null;
    return this.repoFingerprint;
  }

  _startupPreloadPlan(message, task) {
    const lowered = String(message ?? "").toLowerCase();
    const broadExplore = /\b(project structure|repo structure|whole project|entire repo|entire repository|full codebase|all files|every file|every single file|comprehensive|monorepo|package|packages|folder|folders|subfolder|subfolders|directory|directories|overview|understand)\b/.test(lowered);
    if (task.loadStrategy === "minimal") {
      return {
        name: "minimal_brief",
        toolSchemas: [],
        toolBudget: 0,
        preloads: []
      };
    }

    if (task.loadStrategy === "light") {
      return {
        name: broadExplore ? "light_understand_bundle" : "light_tool_bundle",
        toolSchemas: [broadExplore ? "forge_scan" : "forge_tools"],
        toolBudget: 120,
        preloads: broadExplore
          ? [{
              pageType: "overview_pack",
              sourceItemType: "module",
              sourceItemId: "repo_map",
              sizeEstimate: 72
            }]
          : lowered.includes("search") || lowered.includes("find")
          ? [{
              pageType: "retrieval_pack",
              sourceItemType: "module",
              sourceItemId: "search_hints",
              sizeEstimate: 44
            }]
          : []
      };
    }

    const needsSession = /\bsame bug\b|\bundo\b|\byesterday\b|\bsession\b|\bdecision\b|\bwhy\b|\bwhat changed\b/.test(lowered);
    return {
      name: needsSession ? "full_session_pack" : broadExplore ? "full_understand_pack" : "full_repo_pack",
      toolSchemas: [broadExplore ? "forge_scan" : "forge_tools"],
      toolBudget: 108,
      preloads: needsSession
        ? [{
            pageType: "session_memory",
            sourceItemType: "module",
            sourceItemId: "session_hints",
            sizeEstimate: 72
          }]
        : broadExplore
          ? [{
              pageType: "overview_pack",
              sourceItemType: "module",
              sourceItemId: "repo_map",
              sizeEstimate: 84
            }]
        : [{
            pageType: "retrieval_pack",
            sourceItemType: "module",
            sourceItemId: "repo_hints",
            sizeEstimate: 76
          }]
    };
  }

  _summarizeTopLevel(files) {
    const groups = new Map();
    for (const file of files) {
      const [head] = file.relativePath.split("/");
      const key = file.relativePath.includes("/") ? head : ".";
      if (!groups.has(key)) {
        groups.set(key, {
          name: key === "." ? "root" : key,
          path: key === "." ? "." : key,
          fileCount: 0,
          languages: new Set(),
          samples: []
        });
      }

      const group = groups.get(key);
      group.fileCount += 1;
      if (file.language) {
        group.languages.add(file.language);
      }
      if (group.samples.length < 4) {
        group.samples.push(file.relativePath);
      }
    }

    return [...groups.values()]
      .map((group) => ({
        name: group.name,
        path: group.path,
        fileCount: group.fileCount,
        languages: [...group.languages].sort(),
        samples: group.samples
      }))
      .sort((left, right) => {
        if (left.path === ".") return -1;
        if (right.path === ".") return 1;
        return right.fileCount - left.fileCount || left.path.localeCompare(right.path);
      });
  }

  _loadRepoInventory() {
    if (this._repoInventory) {
      return this._repoInventory;
    }

    const files = loadRepositoryInventory(this.rootDir, this.repoId);
    this._repoInventory = { files };
    return this._repoInventory;
  }

  _readPackageInfo() {
    const packagePath = path.join(this.rootDir, "package.json");
    try {
      const manifest = JSON.parse(readText(packagePath));
      return {
        name: manifest.name ?? null,
        version: manifest.version ?? null,
        type: manifest.type ?? null,
        main: manifest.main ?? null,
        module: manifest.module ?? null,
        bin: typeof manifest.bin === "string"
          ? { [manifest.name ?? "bin"]: manifest.bin }
          : manifest.bin ?? {},
        scripts: Object.keys(manifest.scripts ?? {}).sort(),
        workspaces: Array.isArray(manifest.workspaces)
          ? manifest.workspaces
          : Array.isArray(manifest.workspaces?.packages)
            ? manifest.workspaces.packages
            : []
      };
    } catch {
      return null;
    }
  }

  _detectEntrypoints(files, packageInfo) {
    const entries = [];
    const seen = new Set();
    const add = (pathValue, reason, score = 0) => {
      if (!pathValue || seen.has(pathValue)) {
        return;
      }
      const match = files.find((file) => file.relativePath === pathValue) ??
        files.find((file) => file.relativePath.endsWith(`/${pathValue}`));
      if (!match) {
        return;
      }

      entries.push({
        path: match.relativePath,
        reason,
        score
      });
      seen.add(match.relativePath);
    };

    if (packageInfo?.main) add(packageInfo.main, "package.main", 10);
    if (packageInfo?.module) add(packageInfo.module, "package.module", 9);
    for (const [name, target] of Object.entries(packageInfo?.bin ?? {})) {
      add(target, `package.bin:${name}`, 10);
    }

    for (const file of files) {
      const basename = path.basename(file.relativePath).toLowerCase();
      if (/^(index|main|app|server|cli)\./.test(basename)) {
        add(file.relativePath, "conventional_entrypoint", 6);
      }
      if (basename.includes("mcp-server")) {
        add(file.relativePath, "mcp_server", 9);
      }
    }

    return entries
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 10);
  }

  _rankImportantFiles({ files, query, packageInfo, state = null }) {
    const symbolCounts = new Map();
    const edgeCounts = new Map();

    if (state) {
      for (const symbol of state.symbols) {
        symbolCounts.set(symbol.fileId, (symbolCounts.get(symbol.fileId) ?? 0) + 1);
      }

      const symbolToFile = new Map(state.symbols.map((symbol) => [symbol.symbolId, symbol.fileId]));
      for (const edge of state.edges) {
        const fromFileId = symbolToFile.get(edge.fromSymbolId);
        const toFileId = symbolToFile.get(edge.toSymbolId);
        if (fromFileId) edgeCounts.set(fromFileId, (edgeCounts.get(fromFileId) ?? 0) + 1);
        if (toFileId) edgeCounts.set(toFileId, (edgeCounts.get(toFileId) ?? 0) + 1);
      }
    }

    const packageTargets = new Set([
      packageInfo?.main,
      packageInfo?.module,
      ...Object.values(packageInfo?.bin ?? {})
    ].filter(Boolean));

    return files
      .map((file) => {
        const reasons = [];
        let score = 0;
        const basename = path.basename(file.relativePath).toLowerCase();
        const tokens = new Set(tokenize(file.relativePath));
        const queryTokens = tokenize(query);
        const symbolCount = symbolCounts.get(file.fileId) ?? 0;
        const edgeCount = edgeCounts.get(file.fileId) ?? 0;

        for (const token of queryTokens) {
          if ([...tokens].some((candidate) => candidate.includes(token) || token.includes(candidate))) {
            score += 1.2;
          }
        }

        if (!file.relativePath.includes("/")) {
          score += 2;
          reasons.push("root_file");
        }
        if (file.relativePath === "package.json") {
          score += 10;
          reasons.push("manifest");
        }
        if (/^readme(\.|$)/i.test(basename)) {
          score += 8;
          reasons.push("documentation");
        }
        if (/^install(\.|$)/i.test(basename)) {
          score += 5;
          reasons.push("setup_guide");
        }
        if (/^(design|architecture|overview)(\.|$)/i.test(basename)) {
          score += 4;
          reasons.push("design_doc");
        }
        if (basename.includes("mcp-server")) {
          score += 8;
          reasons.push("mcp_entrypoint");
        }
        if (file.relativePath.startsWith("src/")) {
          score += 2.5;
          reasons.push("source_code");
        }
        if (file.relativePath.startsWith("hooks/")) {
          score += 2;
          reasons.push("integration_hook");
        }
        if (packageInfo?.name && basename.includes(packageInfo.name.toLowerCase())) {
          score += 7;
          reasons.push("core_named_module");
        }
        if (/^(index|main|app|server|cli)\./.test(basename)) {
          score += 4;
          reasons.push("entrypoint_name");
        }
        if (packageTargets.has(file.relativePath)) {
          score += 9;
          reasons.push("package_entrypoint");
        }

        score += symbolCount * 0.45;
        score += edgeCount * 0.12;
        if (symbolCount) reasons.push(`symbols:${symbolCount}`);
        if (edgeCount) reasons.push(`graph_edges:${edgeCount}`);

        return {
          path: file.relativePath,
          score: Number(score.toFixed(3)),
          reasons: unique(reasons)
        };
      })
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  }

  _summarizeArchitecture({ files, topLevel, packageInfo, entrypoints }) {
    const rootGroups = topLevel
      .filter((item) => item.path !== ".")
      .slice(0, 10)
      .map((item) => ({
        label: item.path,
        score: item.fileCount,
        summary: `${item.path}: ${guessFolderPurpose(item.path, item.languages)}`
      }));

    const entryGroups = entrypoints.slice(0, 4).map((item) => ({
      label: item.path,
      score: item.score,
      summary: `${item.path}: likely entrypoint via ${item.reason}`
    }));

    const workspaceGroups = (packageInfo?.workspaces ?? []).slice(0, 6).map((pattern) => ({
      label: pattern,
      score: 4,
      summary: `${pattern}: declared workspace/package area`
    }));

    const fallbackRoot = rootGroups.length
      ? rootGroups
      : [{
          label: "root",
          score: files.length,
          summary: `root: ${files.length} files discovered`
        }];

    return [...entryGroups, ...workspaceGroups, ...fallbackRoot].slice(0, 12);
  }

  _buildUnderstandSummary({ packageInfo, topLevel, rootFiles, entrypoints, importantFiles }) {
    const folderText = topLevel.slice(0, 6).map((item) => `${item.path} (${item.fileCount} files)`).join(", ");
    const entryText = entrypoints.slice(0, 4).map((item) => item.path).join(", ");
    const importantText = importantFiles.slice(0, 5).map((item) => item.path).join(", ");
    const packageText = packageInfo?.name
      ? `${packageInfo.name}${packageInfo.version ? `@${packageInfo.version}` : ""}`
      : "no package manifest detected";

    return [
      `Package: ${packageText}.`,
      topLevel.length ? `Top-level layout: ${folderText}.` : "Top-level layout: no indexed files.",
      entrypoints.length ? `Likely entrypoints: ${entryText}.` : null,
      rootFiles.length ? `Key root files: ${rootFiles.slice(0, 6).join(", ")}.` : null,
      importantFiles.length ? `Important files to read first: ${importantText}.` : null
    ].filter(Boolean).join(" ");
  }

  _compactSessionPayload(payload) {
    const compact = {};
    for (const key of ["filePath", "symbolId", "message", "decision", "note", "query", "toolName"]) {
      if (payload?.[key] != null) {
        compact[key] = payload[key];
      }
    }

    if (!Object.keys(compact).length && payload) {
      const firstKeys = Object.keys(payload).slice(0, 2);
      for (const key of firstKeys) {
        compact[key] = payload[key];
      }
    }

    return compact;
  }

  _buildWhySummary({ query, seeds, graph, session }) {
    const seedLine = seeds.length
      ? `Seeds: ${seeds.map((seed) => seed.label).slice(0, 2).join(", ")}.`
      : "Seeds: none.";
    const graphLine = graph.length
      ? `Graph: ${graph.map((entry) => entry.label).slice(0, 2).join(", ")}.`
      : "Graph: none.";
    const sessionLine = session.length
      ? `Session: ${session.map((event) => event.eventType).join(", ")}.`
      : "Session: none.";
    return `Why for "${query}": ${seedLine} ${graphLine} ${sessionLine}`;
  }
}

export function createContextForge(rootDir, options = {}) {
  return new ContextForge(rootDir, options);
}

export function pageHint(label, toolHint) {
  return retrievalHandle({ label, toolHint });
}

function compareImpactEntries(left, right, seedSymbolId, seed) {
  const scoreDelta = impactPriority(right.symbol, right.index, seedSymbolId, seed) -
    impactPriority(left.symbol, left.index, seedSymbolId, seed);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return left.index - right.index;
}

function impactPriority(symbol, index, seedSymbolId, seed) {
  let priority = -index;

  if (symbol.symbolId !== seedSymbolId) {
    priority += 100;
  }

  if (seed && symbol.fileId !== seed.fileId) {
    priority += 30;
  }

  if (symbol.kind === "function" || symbol.kind === "method") {
    priority += 12;
  }

  priority -= symbolDepth(symbol) * 4;
  return priority;
}

function symbolDepth(symbol) {
  return String(symbol?.canonicalName ?? "")
    .split("::")
    .filter(Boolean)
    .length;
}

function whyNodePriority(node) {
  let priority = node.score ?? 0;

  if (node.type === "symbol") {
    priority += 1;
  }

  if (node.type === "file") {
    priority += 0.2;
  }

  return priority;
}

function guessFolderPurpose(folderName, languages = []) {
  const lowered = String(folderName ?? "").toLowerCase();
  if (lowered === "src") return "primary application and library source code";
  if (lowered === "tests" || lowered === "test") return "test coverage, fixtures, and validation flows";
  if (lowered === "hooks") return "Claude Code integration hooks and routing guidance";
  if (lowered === "benchmark" || lowered === "benchmarks") return "evaluation fixtures, comparison tracks, and release gates";
  if (lowered === "scripts") return "automation scripts and maintenance tasks";
  if (lowered === "docs" || lowered === "doc") return "documentation and reference material";
  if (lowered === ".claude") return "Claude Code local integration metadata";
  if (lowered === ".github") return "GitHub automation and repository workflows";
  if (lowered === "examples" || lowered === "example") return "sample usage and starter projects";
  if (languages.includes("markdown")) return "documentation-heavy area";
  if (languages.includes("javascript") || languages.includes("typescript")) return "code-heavy module area";
  return "project area grouped by responsibility";
}
