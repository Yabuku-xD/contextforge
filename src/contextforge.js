import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "./storage/db.js";
import { loadRepositoryFile, loadRepositoryFiles, loadRepositoryInventory, loadRepositoryInventoryEntry } from "./indexing/files.js";
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
import { ensureDir, exists, readText, relativeTo, writeText } from "./utils/fs.js";
import { runShellCommand } from "./utils/process.js";

const REPO_STATE_CACHE = new Map();
const SYSTEM_EVENT_TYPES = new Set(["index", "index_reuse", "startup", "search"]);
const DEFAULT_FILE_OP_IGNORES = new Set([".git", ".contextforge", "node_modules"]);
const MAX_INCREMENTAL_SYNC_PATHS = 128;
const WATCHER_SETTLE_MS = 80;

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
    this._repoAudit = null;
    this._quickRepoStamp = null;
    this._filePathById = null;
    this._watcher = undefined;
    this._watcherSupported = false;
    this._dirtyPaths = new Set();
    this._inventoryDirty = false;
  }

  close() {
    this._watcher?.close?.();
    this._watcher = null;
    this.db.close();
  }

  indexRepository(options = {}) {
    const db = this.db;
    const repoId = this.repoId;
    const files = loadRepositoryFiles(this.rootDir, repoId);
    const repoFingerprint = this._computeRepoFingerprint(files);
    const quickRepoStamp = this._computeQuickRepoStamp(files);
    this.repoFingerprint = repoFingerprint;

    if (!options.force && this._canReuseIndex(repoFingerprint, files.length)) {
      this._repoState = null;
      this._filePathById = null;
      this._quickRepoStamp = quickRepoStamp;
      this._markRepoSynced();
      this._ensureWatcher();
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
        INSERT OR REPLACE INTO files (file_id, repo_id, file_path, file_hash, content, language, parse_status, parse_error, updated_at)
        VALUES (@fileId, @repoId, @filePath, @fileHash, @content, @language, @parseStatus, @parseError, @updatedAt)
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
          content: file.content,
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
      this._markRepoSynced();
      this.repoFingerprint = repoFingerprint;
      this._quickRepoStamp = quickRepoStamp;
      this._ensureWatcher();
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
    this.ensureRepositoryIndexed({ reason: "search" });
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
    this.ensureRepositoryIndexed({ reason: "symbol" });
    const symbols = this._loadSymbols();
    const exact = exactSymbolSearch(query, symbols, options.limit ?? 10);
    if (exact.length) {
      return exact;
    }

    const aliasSeedIds = resolveAliasSeeds(query, symbols, options.limit ?? 10);
    return this._symbolsByRank(symbols, aliasSeedIds);
  }

  scope(query, mode = "auto") {
    this.ensureRepositoryIndexed({ reason: "scope" });
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
    this.ensureRepositoryIndexed({ reason: "impact" });
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
    this.ensureRepositoryIndexed({ reason: "why" });
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
    const index = this.ensureRepositoryIndexed({
      reason: "startup",
      eagerPrime: true
    });
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
        preloadPlan: preloadPlan.name,
        indexedFiles: index.filesIndexed,
        reusedIndex: index.reusedIndex
      }
    });

    return {
      index,
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
      "forge_walk",
      "forge_read",
      "forge_write",
      "forge_edit",
      "forge_bash",
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

  scan(query = "") {
    const normalizedQuery = String(query ?? "").trim();
    this.ensureRepositoryIndexed({ reason: "scan" });
    const overview = this._buildInventoryOverview(normalizedQuery, {
      fallbackQuery: "project structure architecture entrypoints important files"
    });
    const summary = this._buildUnderstandSummary({
      packageInfo: overview.packageInfo,
      packages: overview.packages,
      topLevel: overview.topLevel,
      rootFiles: overview.rootFiles,
      entrypoints: overview.entrypoints,
      importantFiles: overview.importantFiles
    });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "understand",
      payload: {
        query: normalizedQuery,
        topLevelCount: overview.topLevel.length,
        packageCount: overview.packages.length,
        importantFileCount: overview.importantFiles.length,
        topEntrypoint: overview.entrypoints[0]?.path ?? null,
        routedMode: "inventory_first"
      }
    });

    return {
      query: normalizedQuery,
      summary,
      mode: "inventory_first",
      guidance: "Use this as the first-pass repository overview. Drill into individual files only if the user asks for more detail or the inventory is insufficient.",
      coverage: [
        "top_level_structure",
        "package_manifest",
        "workspace_packages",
        "entrypoints",
        "important_files"
      ],
      packageInfo: overview.packageInfo,
      packages: overview.packages,
      rootFiles: overview.rootFiles,
      topLevel: overview.topLevel,
      entrypoints: overview.entrypoints,
      architecture: overview.architecture,
      importantFiles: overview.importantFiles
    };
  }

  understand(query = "") {
    const normalizedQuery = String(query ?? "").trim();
    if (this._shouldUseInventoryWalk(normalizedQuery)) {
      return this.walk(normalizedQuery);
    }
    return this.scan(normalizedQuery);
  }

  walk(query = "") {
    const normalizedQuery = String(query ?? "").trim();
    this.ensureRepositoryIndexed({ reason: "walk" });
    const exhaustive = this._shouldUseExhaustiveWalk(normalizedQuery);
    const overview = this._buildInventoryOverview(normalizedQuery, {
      fallbackQuery: "project structure architecture packages directories responsibilities important files representative files"
    });
    const audit = exhaustive ? this._loadRepoAudit() : null;
    const packageSections = this._buildPackageSections({
      files: overview.files,
      packages: overview.packages,
      entrypoints: overview.entrypoints,
      query: normalizedQuery,
      packageInfo: overview.packageInfo,
      audit
    });
    const directorySections = this._buildDirectorySections({
      files: overview.files,
      topLevel: overview.topLevel,
      packages: overview.packages,
      query: normalizedQuery,
      packageInfo: overview.packageInfo,
      audit
    });
    const summary = this._buildWalkSummary({
      packageInfo: overview.packageInfo,
      topLevel: overview.topLevel,
      packageSections,
      directorySections,
      rootFiles: overview.rootFiles,
      importantFiles: overview.importantFiles,
      audit,
      exhaustive
    });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "walk",
      payload: {
        query: normalizedQuery,
        topLevelCount: overview.topLevel.length,
        packageCount: overview.packages.length,
        packageSectionCount: packageSections.length,
        directorySectionCount: directorySections.length,
        routedMode: exhaustive ? "exhaustive_walk" : "inventory_walk",
        auditedFileCount: audit?.fileCountInspected ?? 0,
        auditedTextFileCount: audit?.textFileCount ?? 0
      }
    });

    return {
      query: normalizedQuery,
      summary,
      mode: exhaustive ? "exhaustive_walk" : "inventory_walk",
      guidance: exhaustive
        ? "Use this as the exhaustive repository digest. ContextForge opened every repository file locally, read the full body of each text file, scanned binary assets as raw bytes, and grouped the findings by package and directory so you can answer whole-project questions without spawning subagents first."
        : "Use this as the deeper repository map before spawning subagents or manually reading many files. Answer from these sections first, then drill into specific files only if the user asks or a section is ambiguous.",
      coverage: exhaustive
        ? [
            "top_level_structure",
            "package_manifest",
            "workspace_packages",
            "directory_sections",
            "representative_files",
            "entrypoints",
            "important_files",
            "all_repository_files_locally_inspected",
            "file_body_audit",
            "role_breakdown"
          ]
        : [
            "top_level_structure",
            "package_manifest",
            "workspace_packages",
            "directory_sections",
            "representative_files",
            "entrypoints",
            "important_files"
          ],
      packageInfo: overview.packageInfo,
      packages: overview.packages,
      rootFiles: overview.rootFiles,
      topLevel: overview.topLevel,
      entrypoints: overview.entrypoints,
      architecture: overview.architecture,
      importantFiles: overview.importantFiles,
      packageSections,
      directorySections,
      audit: audit
        ? {
            fileCountInspected: audit.fileCountInspected,
            textFileCount: audit.textFileCount,
            binaryFileCount: audit.binaryFileCount,
            generatedFileCount: audit.generatedFileCount,
            vendorFileCount: audit.vendorFileCount,
            readCoverage: {
              openedEveryRepositoryFile: true,
              readFullTextBodies: audit.textFileCount,
              scannedBinaryAssets: audit.binaryFileCount,
              manualPerFileNarrationPending: true,
              canAnswerYesToWholeProjectRead: true
            },
            answerIfAskedWhetherEveryFileWasRead: "Yes. ContextForge opened every repository file locally for this audit. It read the full body of each text file, scanned binary assets as raw bytes, and returned a compact digest instead of dumping every file body into chat.",
            answerIfAskedWhetherWholeProjectWasRead: "Yes. ContextForge read the whole project locally for this audit, including every text file body and every binary asset in the repository. The summary is compact, but the underlying audit covered the full repo.",
            answerIfAskedWhetherEveryCornerWasRead: "Yes. ContextForge covered every file in the repository during this exhaustive walk. It does not keep every line verbatim in chat memory, but it did read the full local file set before producing the digest.",
            roleBreakdown: audit.roleBreakdown,
            binarySamples: audit.binarySamples
          }
        : undefined
    };
  }

  read(targetPath, options = {}) {
    const resolved = this._resolveWorkspacePath(targetPath);
    const relativePath = relativeTo(this.rootDir, resolved);
    const stat = fs.statSync(resolved);

    if (stat.isDirectory()) {
      const entries = this._listDirectoryEntries(resolved, options.limit);
      recordSessionEvent(this.db, {
        repoId: this.repoId,
        sessionId: this.sessionId,
        eventType: "read_directory",
        payload: {
          filePath: relativePath,
          entryCount: entries.length
        }
      });
      return {
        path: relativePath,
        kind: "directory",
        entryCount: entries.length,
        entries,
        summary: `Listed ${entries.length} entries in ${relativePath}.`
      };
    }

    const content = readText(resolved);
    const lines = normalizeFileLines(content);
    const totalLines = lines.length || 1;
    const maxLines = clampNumber(options.maxLines, 1, 400, 120);
    const requestedStart = clampNumber(options.startLine, 1, totalLines, 1);
    const requestedEnd = options.endLine == null
      ? Math.min(totalLines, requestedStart + maxLines - 1)
      : clampNumber(options.endLine, requestedStart, totalLines, Math.min(totalLines, requestedStart + maxLines - 1));
    const excerptLines = lines.slice(requestedStart - 1, requestedEnd);
    const excerpt = formatNumberedLines(excerptLines, requestedStart, requestedEnd);
    const truncated = requestedStart > 1 || requestedEnd < totalLines;

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "read_file",
      payload: {
        filePath: relativePath,
        startLine: requestedStart,
        endLine: requestedEnd
      }
    });

    return {
      path: relativePath,
      kind: "file",
      totalLines,
      startLine: requestedStart,
      endLine: requestedEnd,
      truncated,
      excerpt,
      summary: `Read lines ${requestedStart}-${requestedEnd} of ${totalLines} from ${relativePath}.`
    };
  }

  write(targetPath, content, options = {}) {
    const resolved = this._resolveWorkspacePath(targetPath, {
      allowMissing: true,
      createParent: coerceBoolean(options.createDirs, true)
    });
    const relativePath = relativeTo(this.rootDir, resolved);
    const existed = exists(resolved);
    const previousBytes = existed ? fs.statSync(resolved).size : 0;

    writeText(resolved, String(content ?? ""));
    const indexSync = this._syncChangedPaths([relativePath], { reason: "write" });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: existed ? "write_file" : "create_file",
      payload: {
        filePath: relativePath,
        previousBytes,
        bytesWritten: Buffer.byteLength(String(content ?? ""), "utf8")
      }
    });

    return {
      path: relativePath,
      created: !existed,
      bytesWritten: Buffer.byteLength(String(content ?? ""), "utf8"),
      linesWritten: normalizeFileLines(String(content ?? "")).length,
      indexSync,
      summary: `${existed ? "Updated" : "Created"} ${relativePath}.`
    };
  }

  edit(targetPath, oldText, newText, options = {}) {
    const resolved = this._resolveWorkspacePath(targetPath);
    const relativePath = relativeTo(this.rootDir, resolved);
    const before = readText(resolved);
    const beforeNormalized = String(before ?? "");
    const source = String(oldText ?? "");
    const replacement = String(newText ?? "");
    const replaceAll = coerceBoolean(options.replaceAll, false);

    if (!source.length) {
      throw new Error("forge_edit requires old_text to be non-empty.");
    }

    const occurrences = countOccurrences(beforeNormalized, source);
    if (!occurrences) {
      throw new Error(`forge_edit could not find the target text in ${relativePath}.`);
    }

    const after = replaceAll
      ? beforeNormalized.split(source).join(replacement)
      : beforeNormalized.replace(source, replacement);
    writeText(resolved, after);
    const indexSync = this._syncChangedPaths([relativePath], { reason: "edit" });

    const changedIndex = after.indexOf(replacement);
    const preview = buildExcerptAroundIndex(after, changedIndex, {
      contextLines: 2,
      maxLines: 10
    });

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "edit_file",
      payload: {
        filePath: relativePath,
        replacements: replaceAll ? occurrences : 1
      }
    });

    return {
      path: relativePath,
      replacements: replaceAll ? occurrences : 1,
      replaceAll,
      preview,
      indexSync,
      summary: `Edited ${relativePath} with ${replaceAll ? occurrences : 1} replacement${replaceAll ? "s" : ""}.`
    };
  }

  async bash(command, options = {}) {
    const watcherAvailable = this._ensureWatcher();
    const beforeQuickStamp = watcherAvailable
      ? this._quickRepoStamp
      : this._currentQuickRepoStamp();
    const resolvedCwd = this._resolveWorkspaceCwd(options.cwd);
    const maxChars = clampNumber(options.maxChars, 400, 16000, 4000);
    const timeoutMs = clampNumber(options.timeoutMs, 250, 120000, 15000);
    const result = await runShellCommand({
      command: String(command ?? ""),
      cwd: resolvedCwd,
      timeoutMs
    });
    const stdoutPreview = compactCommandOutput(result.stdout, maxChars);
    const stderrPreview = compactCommandOutput(result.stderr, Math.max(800, Math.floor(maxChars / 2)));
    const relativeCwd = relativeTo(this.rootDir, resolvedCwd);
    await this._settleWatcher();
    const dirtyPaths = this._consumeDirtyPaths();
    const afterQuickStamp = watcherAvailable && dirtyPaths.length
      ? null
      : this._currentQuickRepoStamp();
    const repoChanged = dirtyPaths.length > 0 || beforeQuickStamp !== afterQuickStamp;
    const indexSync = dirtyPaths.length
      ? this._syncChangedPaths(dirtyPaths, { reason: "bash" })
      : repoChanged
      ? this.ensureRepositoryIndexed({
          reason: "bash",
          force: true
        })
      : null;

    recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "command",
      payload: {
        command: String(command ?? ""),
        cwd: relativeCwd,
        exitCode: result.exitCode,
        timedOut: result.timedOut
      }
    });

    return {
      command: String(command ?? ""),
      cwd: relativeCwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdoutPreview,
      stderrPreview,
      repoChanged,
      indexSync,
      summary: buildCommandSummary({
        command: String(command ?? ""),
        cwd: relativeCwd,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr
      })
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
    const counts = this._repoCounts();
    const indexed = counts.filesIndexed > 0;
    const watcherAvailable = this._ensureWatcher();
    const pageCount = this.db.prepare(`SELECT COUNT(*) AS count FROM pages WHERE session_id = ?`).get(this.sessionId).count;
    const parseFailures = indexed
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM files WHERE repo_id = ? AND parse_status = 'error'`).get(this.repoId).count
      : 0;
    return {
      rootDir: this.rootDir,
      repoId: this.repoId,
      sessionId: this.sessionId,
      indexed,
      fileCount: counts.filesIndexed,
      symbolCount: counts.symbolsIndexed,
      chunkCount: counts.chunksIndexed,
      edgeCount: counts.edgesIndexed,
      raptorNodeCount: counts.raptorNodesIndexed,
      pageCount,
      parseFailures,
      dirtyPathCount: watcherAvailable ? this._dirtyPaths.size : null,
      inventoryDirty: watcherAvailable ? this._inventoryDirty : null,
      embeddingModel: MODEL_METADATA.embeddings.default
    };
  }

  stats() {
    const compression = this.db.prepare(`
      SELECT COUNT(*) AS count, SUM(raw_size) AS raw, SUM(compressed_size) AS compressed
      FROM compression_events
      WHERE repo_id = ? AND session_id = ?
    `).get(this.repoId, this.sessionId);
    const counts = this._repoCounts();
    const watcherAvailable = this._ensureWatcher();
    const retrieval = {
      files: counts.filesIndexed,
      symbols: counts.symbolsIndexed,
      edges: counts.edgesIndexed,
      raptorNodes: counts.raptorNodesIndexed,
      dirtyPathCount: watcherAvailable ? this._dirtyPaths.size : null,
      inventoryDirty: watcherAvailable ? this._inventoryDirty : null
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

  _loadIndexedFiles({ includeContent = false, includeHashes = false } = {}) {
    const columns = [
      "file_id AS fileId",
      "file_path AS relativePath",
      "language"
    ];

    if (includeHashes) {
      columns.push("file_hash AS fileHash");
    }

    if (includeContent) {
      columns.push("content");
    }

    return this.db.prepare(`
      SELECT ${columns.join(", ")}
      FROM files
      WHERE repo_id = ?
      ORDER BY file_path
    `).all(this.repoId);
  }

  _materializeFileArtifacts(file) {
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
          repoId: this.repoId,
          fileId: file.fileId,
          relativePath: file.relativePath,
          language: file.language,
          tree: parsed,
          content: file.content
        });

        if (!fileArtifacts.symbols.length) {
          fileArtifacts = createFallbackFileArtifacts({
            repoId: this.repoId,
            fileId: file.fileId,
            relativePath: file.relativePath,
            language: file.language,
            content: file.content
          });
        }
      } else {
        parseStatus = "fallback";
        fileArtifacts = createFallbackFileArtifacts({
          repoId: this.repoId,
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
        repoId: this.repoId,
        fileId: file.fileId,
        relativePath: file.relativePath,
        language: file.language,
        content: file.content
      });
    }

    return {
      parseStatus,
      parseError,
      symbols: fileArtifacts.symbols,
      chunks: fileArtifacts.chunks
    };
  }

  _deleteIndexedFile(fileId) {
    const chunkIds = this.db.prepare(`
      SELECT chunk_id AS chunkId
      FROM chunks
      WHERE repo_id = ? AND file_id = ?
    `).all(this.repoId, fileId);

    for (const { chunkId } of chunkIds) {
      this.db.prepare(`DELETE FROM chunk_fts WHERE chunk_id = ?`).run(chunkId);
      this.db.prepare(`
        DELETE FROM vectors
        WHERE repo_id = ? AND item_type = 'chunk' AND item_id = ?
      `).run(this.repoId, chunkId);
    }

    this.db.prepare(`DELETE FROM chunks WHERE repo_id = ? AND file_id = ?`).run(this.repoId, fileId);
    this.db.prepare(`DELETE FROM symbols WHERE repo_id = ? AND file_id = ?`).run(this.repoId, fileId);
    this.db.prepare(`DELETE FROM files WHERE repo_id = ? AND file_id = ?`).run(this.repoId, fileId);
  }

  _upsertIndexedFile(file) {
    this._deleteIndexedFile(file.fileId);

    const artifacts = this._materializeFileArtifacts(file);
    const insertFile = this.db.prepare(`
      INSERT OR REPLACE INTO files (file_id, repo_id, file_path, file_hash, content, language, parse_status, parse_error, updated_at)
      VALUES (@fileId, @repoId, @filePath, @fileHash, @content, @language, @parseStatus, @parseError, @updatedAt)
    `);
    const insertSymbol = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (symbol_id, repo_id, file_id, canonical_name, display_name, kind, language, span_start, span_end, parent_symbol_id, symbol_hash, body)
      VALUES (@symbolId, @repoId, @fileId, @canonicalName, @displayName, @kind, @language, @spanStart, @spanEnd, @parentSymbolId, @symbolHash, @body)
    `);
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (chunk_id, repo_id, file_id, chunk_type, label, text, summary, span_start, span_end, chunk_hash, invalidation_state)
      VALUES (@chunkId, @repoId, @fileId, @chunkType, @label, @text, @summary, @spanStart, @spanEnd, @chunkHash, @invalidationState)
    `);
    const insertFts = this.db.prepare(`
      INSERT INTO chunk_fts (chunk_id, label, text)
      VALUES (?, ?, ?)
    `);
    const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO vectors (vector_id, repo_id, item_type, item_id, embedding_model, embedding_dim, embedding_json)
      VALUES (@vectorId, @repoId, @itemType, @itemId, @embeddingModel, @embeddingDim, @embeddingJson)
    `);

    insertFile.run({
      fileId: file.fileId,
      repoId: this.repoId,
      filePath: file.relativePath,
      fileHash: file.fileHash,
      content: file.content,
      language: file.language,
      parseStatus: artifacts.parseStatus,
      parseError: artifacts.parseError,
      updatedAt: Date.now()
    });

    for (const symbol of artifacts.symbols) {
      insertSymbol.run(symbol);
    }

    for (const chunk of artifacts.chunks) {
      insertChunk.run(chunk);
      insertFts.run(chunk.chunkId, chunk.label, chunk.text);
      insertVector.run({
        vectorId: makeId("vector", chunk.chunkId),
        repoId: this.repoId,
        itemType: "chunk",
        itemId: chunk.chunkId,
        embeddingModel: MODEL_METADATA.embeddings.default.name,
        embeddingDim: MODEL_METADATA.embeddings.default.dimension,
        embeddingJson: JSON.stringify(embedText(chunk.text))
      });
    }
  }

  _rebuildDerivedStateFromIndex() {
    const files = this._loadIndexedFiles({ includeContent: true, includeHashes: true });
    const symbols = this._loadSymbols();
    const pdgEdges = [
      ...extractImportEdges({ repoId: this.repoId, symbols, files }),
      ...extractCallEdges({ repoId: this.repoId, symbols, files }),
      ...extractControlEdges({ repoId: this.repoId, symbols }),
      ...extractDataFlowEdges({ repoId: this.repoId, symbols })
    ];
    const raptorNodes = buildRaptorTree({ repoId: this.repoId, files, symbols });
    const repoFingerprint = this._computeRepoFingerprint(files);

    this.db.prepare(`DELETE FROM symbol_edges WHERE repo_id = ?`).run(this.repoId);
    this.db.prepare(`DELETE FROM raptor_nodes WHERE repo_id = ?`).run(this.repoId);

    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO symbol_edges (edge_id, repo_id, from_symbol_id, to_symbol_id, edge_type, confidence, provenance_source)
      VALUES (@edgeId, @repoId, @fromSymbolId, @toSymbolId, @edgeType, @confidence, @provenanceSource)
    `);
    for (const edge of pdgEdges) {
      insertEdge.run(edge);
    }

    const insertRaptor = this.db.prepare(`
      INSERT OR REPLACE INTO raptor_nodes (node_id, repo_id, parent_node_id, node_type, label, summary, token_budget, source_item_type, source_item_id, cache_state)
      VALUES (@nodeId, @repoId, @parentNodeId, @nodeType, @label, @summary, @tokenBudget, @sourceItemType, @sourceItemId, @cacheState)
    `);
    for (const node of raptorNodes) {
      insertRaptor.run(node);
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO repositories (repo_id, root_path, default_branch, content_fingerprint, file_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(this.repoId, this.rootDir, "main", repoFingerprint, files.length, Date.now());

    return {
      repoFingerprint,
      filesIndexed: files.length,
      symbolsIndexed: symbols.length,
      chunksIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?`).get(this.repoId).count,
      edgesIndexed: pdgEdges.length,
      raptorNodesIndexed: raptorNodes.length
    };
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

  _computeQuickRepoStamp(files) {
    return sha1(files
      .map((file) => {
        let size = 0;
        let modifiedAt = 0;
        try {
          const stat = fs.statSync(file.absolutePath);
          size = stat.size;
          modifiedAt = Math.trunc(stat.mtimeMs);
        } catch {
          size = 0;
          modifiedAt = 0;
        }
        return `${file.relativePath}:${size}:${modifiedAt}`;
      })
      .sort()
      .join("\n"));
  }

  _markRepoSynced() {
    this._dirtyPaths.clear();
    this._inventoryDirty = false;
  }

  _ensureWatcher() {
    if (this._watcher !== undefined) {
      return this._watcherSupported;
    }

    try {
      this._watcher = fs.watch(this.rootDir, { recursive: true }, (_eventType, fileName) => {
        this._handleWatchEvent(fileName);
      });
      this._watcher.unref?.();
      this._watcherSupported = true;
    } catch {
      this._watcher = null;
      this._watcherSupported = false;
    }

    return this._watcherSupported;
  }

  _handleWatchEvent(fileName) {
    if (!fileName) {
      this._inventoryDirty = true;
      return;
    }

    const normalized = String(fileName).replace(/\\/g, "/").replace(/^\.?\//, "");
    if (!normalized || normalized === "." || normalized.startsWith(".contextforge/")) {
      return;
    }

    const segments = normalized.split("/");
    if (segments.some((segment) => DEFAULT_FILE_OP_IGNORES.has(segment))) {
      return;
    }

    const resolved = path.resolve(this.rootDir, normalized);
    if (!resolved.startsWith(this.rootDir)) {
      return;
    }

    if (exists(resolved) && fs.statSync(resolved).isDirectory()) {
      this._inventoryDirty = true;
      return;
    }

    this._dirtyPaths.add(normalized);
  }

  async _settleWatcher() {
    if (!this._watcherSupported) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, WATCHER_SETTLE_MS);
    });
  }

  _consumeDirtyPaths() {
    const paths = [...this._dirtyPaths];
    this._dirtyPaths.clear();
    return paths;
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
    this._repoAudit = null;
    this._quickRepoStamp = null;
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
    const deepExplore = /\b(every single file|every file|all files|all folders|all directories|subfolder|subfolders|walk the repo|walk the project|go through every|go through each|comprehensive understanding|entire monorepo)\b/.test(lowered);
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
        toolSchemas: [deepExplore ? "forge_walk" : broadExplore ? "forge_scan" : "forge_tools"],
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
      toolSchemas: [deepExplore ? "forge_walk" : broadExplore ? "forge_scan" : "forge_tools"],
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

  ensureRepositoryIndexed({ reason = "tool", force = false, eagerPrime = false } = {}) {
    const counts = this._repoCounts();
    const hasIndex = counts.filesIndexed > 0 && counts.chunksIndexed > 0;
    const watcherAvailable = this._ensureWatcher();

    if (force || eagerPrime || !hasIndex) {
      return {
        ...this.indexRepository({ force }),
        syncReason: reason
      };
    }

    if (watcherAvailable) {
      if (this._inventoryDirty) {
        this._inventoryDirty = false;
        return {
          ...this.indexRepository({ force: true }),
          syncReason: reason
        };
      }

      if (this._dirtyPaths.size) {
        return this._syncChangedPaths(this._consumeDirtyPaths(), { reason });
      }
    } else {
      const currentQuickStamp = this._currentQuickRepoStamp();
      if (!this._quickRepoStamp || this._quickRepoStamp !== currentQuickStamp) {
        return {
          ...this.indexRepository({ force }),
          syncReason: reason
        };
      }
    }

    return {
      ...counts,
      repoId: this.repoId,
      reusedIndex: true,
      fingerprint: this.repoFingerprint ?? this._loadRepoFingerprint(),
      syncReason: reason
    };
  }

  _loadRepoAudit() {
    if (this._repoAudit) {
      return this._repoAudit;
    }

    const inventory = this._loadRepoInventory();
    const fileDigests = inventory.files.map((file) => inspectRepositoryFile(file));
    const textFileCount = fileDigests.filter((file) => file.isText).length;
    const binaryFileCount = fileDigests.length - textFileCount;
    const generatedFileCount = fileDigests.filter((file) => file.isGenerated).length;
    const vendorFileCount = fileDigests.filter((file) => file.isVendor).length;

    this._repoAudit = {
      fileCountInspected: fileDigests.length,
      textFileCount,
      binaryFileCount,
      generatedFileCount,
      vendorFileCount,
      roleBreakdown: summarizeRoleBreakdown(fileDigests, 8),
      binarySamples: fileDigests
        .filter((file) => !file.isText)
        .slice(0, 6)
        .map((file) => ({
          path: file.path,
          role: file.role
        })),
      fileDigests
    };
    return this._repoAudit;
  }

  _syncChangedPaths(paths, { reason = "sync" } = {}) {
    if (this._inventoryDirty) {
      this._inventoryDirty = false;
      return {
        ...this.indexRepository({ force: true }),
        syncReason: reason,
        syncMode: "full"
      };
    }

    const normalizedPaths = unique(paths
      .map((entry) => String(entry ?? "").replace(/\\/g, "/").replace(/^\.?\//, ""))
      .filter(Boolean)
      .filter((entry) => !entry.startsWith(".contextforge/"))
      .filter((entry) => {
        const segments = entry.split("/");
        return !segments.some((segment) => DEFAULT_FILE_OP_IGNORES.has(segment));
      }));

    if (!normalizedPaths.length) {
      return {
        ...this._repoCounts(),
        repoId: this.repoId,
        reusedIndex: true,
        fingerprint: this.repoFingerprint ?? this._loadRepoFingerprint(),
        syncReason: reason,
        syncMode: "noop"
      };
    }

    if (normalizedPaths.length > MAX_INCREMENTAL_SYNC_PATHS) {
      return {
        ...this.indexRepository({ force: true }),
        syncReason: reason,
        syncMode: "full"
      };
    }

    this.db.exec("BEGIN IMMEDIATE");

    try {
      for (const relativePath of normalizedPaths) {
        const absolutePath = path.resolve(this.rootDir, relativePath);
        const fileId = makeId("file", relativePath);

        if (!exists(absolutePath)) {
          this._deleteIndexedFile(fileId);
          continue;
        }

        const stat = fs.statSync(absolutePath);
        if (stat.isDirectory()) {
          this._inventoryDirty = true;
          continue;
        }

        const file = loadRepositoryFile(this.rootDir, this.repoId, absolutePath);
        this._upsertIndexedFile(file);
      }

      const summary = this._rebuildDerivedStateFromIndex();
      this.db.exec("COMMIT");
      this._invalidateRepoCaches();
      this._markRepoSynced();
      this.repoFingerprint = summary.repoFingerprint;
      if (!this._watcherSupported) {
        this._quickRepoStamp = this._currentQuickRepoStamp();
      } else {
        this._quickRepoStamp = null;
      }
      this._ensureWatcher();
      return {
        repoId: this.repoId,
        filesIndexed: summary.filesIndexed,
        symbolsIndexed: summary.symbolsIndexed,
        chunksIndexed: summary.chunksIndexed,
        edgesIndexed: summary.edgesIndexed,
        raptorNodesIndexed: summary.raptorNodesIndexed,
        reusedIndex: false,
        fingerprint: summary.repoFingerprint,
        syncReason: reason,
        syncMode: "incremental",
        pathsChanged: normalizedPaths.length
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      this._dirtyPaths = new Set([...this._dirtyPaths, ...normalizedPaths]);
      throw error;
    }
  }

  _currentQuickRepoStamp() {
    if (this._watcherSupported && !this._dirtyPaths.size && !this._inventoryDirty && this._quickRepoStamp) {
      return this._quickRepoStamp;
    }

    const inventory = loadRepositoryInventory(this.rootDir, this.repoId);
    this._repoInventory = { files: inventory };
    return this._computeQuickRepoStamp(inventory);
  }

  _resolveWorkspacePath(targetPath, options = {}) {
    const input = String(targetPath ?? "").trim();
    if (!input) {
      throw new Error("A path is required.");
    }

    const resolved = path.resolve(this.rootDir, input);
    const relativePath = path.relative(this.rootDir, resolved);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("Path must stay inside the current repository.");
    }

    if (!options.allowMissing && !exists(resolved)) {
      throw new Error(`Path not found: ${input}`);
    }

    if (options.createParent) {
      ensureDir(path.dirname(resolved));
    }

    return resolved;
  }

  _resolveWorkspaceCwd(cwd) {
    const requested = String(cwd ?? ".").trim() || ".";
    const resolved = this._resolveWorkspacePath(requested, { allowMissing: false });
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`cwd must be a directory inside the repository: ${requested}`);
    }
    return resolved;
  }

  _listDirectoryEntries(dirPath, limit) {
    const maxEntries = clampNumber(limit, 1, 500, 120);
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !DEFAULT_FILE_OP_IGNORES.has(entry.name))
      .map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          kind: entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symlink"
              : "file",
          size: entry.isDirectory() ? null : stat.size
        };
      })
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, maxEntries);

    return entries;
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

  _discoverWorkspacePackages(files, packageInfo) {
    const packageFiles = files
      .map((file) => file.relativePath)
      .filter((relativePath) => relativePath !== "package.json" && relativePath.endsWith("/package.json"));

    const workspacePatterns = packageInfo?.workspaces ?? [];
    const filtered = packageFiles.filter((relativePath) => {
      if (!workspacePatterns.length) {
        return relativePath.split("/").length <= 3;
      }

      return workspacePatterns.some((pattern) => matchesWorkspacePattern(relativePath, pattern));
    });

    return filtered
      .map((relativePath) => {
        const manifestPath = path.join(this.rootDir, relativePath);
        try {
          const manifest = JSON.parse(readText(manifestPath));
          return {
            path: relativePath.replace(/\/package\.json$/, ""),
            manifestPath: relativePath,
            name: manifest.name ?? path.basename(path.dirname(manifestPath)),
            version: manifest.version ?? null,
            description: manifest.description ?? null,
            private: Boolean(manifest.private),
            main: manifest.main ?? null,
            types: manifest.types ?? null,
            bin: typeof manifest.bin === "string"
              ? { [manifest.name ?? "bin"]: manifest.bin }
              : manifest.bin ?? {}
          };
        } catch {
          return {
            path: relativePath.replace(/\/package\.json$/, ""),
            manifestPath: relativePath,
            name: path.basename(path.dirname(manifestPath)),
            version: null,
            description: null,
            private: false,
            main: null,
            types: null,
            bin: {}
          };
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path));
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

  _buildUnderstandSummary({ packageInfo, packages, topLevel, rootFiles, entrypoints, importantFiles }) {
    const folderText = topLevel.slice(0, 6).map((item) => `${item.path} (${item.fileCount} files)`).join(", ");
    const entryText = entrypoints.slice(0, 4).map((item) => item.path).join(", ");
    const importantText = importantFiles.slice(0, 5).map((item) => item.path).join(", ");
    const workspaceText = packages?.length
      ? `Workspace packages: ${packages.slice(0, 6).map((pkg) => pkg.name ?? pkg.path).join(", ")}${packages.length > 6 ? `, and ${packages.length - 6} more` : ""}.`
      : null;
    const manifestText = packageInfo?.name
      ? `${packageInfo.name}${packageInfo.version ? `@${packageInfo.version}` : ""}`
      : "no package manifest detected";

    return [
      `Package: ${manifestText}.`,
      topLevel.length ? `Top-level layout: ${folderText}.` : "Top-level layout: no indexed files.",
      workspaceText,
      entrypoints.length ? `Likely entrypoints: ${entryText}.` : null,
      rootFiles.length ? `Key root files: ${rootFiles.slice(0, 6).join(", ")}.` : null,
      importantFiles.length ? `Important files to read first: ${importantText}.` : null
    ].filter(Boolean).join(" ");
  }

  _buildInventoryOverview(query, { fallbackQuery }) {
    const normalizedQuery = String(query ?? "").trim();
    const inventory = this._loadRepoInventory();
    const topLevel = this._summarizeTopLevel(inventory.files);
    const rootFiles = inventory.files
      .filter((file) => !file.relativePath.includes("/"))
      .map((file) => file.relativePath)
      .sort((left, right) => left.localeCompare(right));
    const packageInfo = this._readPackageInfo();
    const packages = this._discoverWorkspacePackages(inventory.files, packageInfo);
    const entrypoints = this._detectEntrypoints(inventory.files, packageInfo);
    const architecture = this._summarizeArchitecture({
      files: inventory.files,
      topLevel,
      packageInfo,
      entrypoints
    });
    const importantFiles = this._rankImportantFiles({
      files: inventory.files,
      query: normalizedQuery || fallbackQuery,
      packageInfo
    }).slice(0, 10);

    return {
      query: normalizedQuery,
      files: inventory.files,
      topLevel,
      rootFiles,
      packageInfo,
      packages,
      entrypoints,
      architecture,
      importantFiles
    };
  }

  _shouldUseInventoryWalk(query) {
    const lowered = String(query ?? "").toLowerCase();
    return /\b(every single file|every file|all files|all folders|all directories|every folder|every directory|subfolder|subfolders|drill into each package|comprehensive understanding|comprehensive repo|go through every|walk the repo|walk through the repo|walk the project|whole monorepo|entire monorepo)\b/.test(lowered);
  }

  _shouldUseExhaustiveWalk(query) {
    const lowered = String(query ?? "").toLowerCase();
    return /\b(every single file|every file|all files|go through every|go through each|each file|each module|comprehensive understanding|full audit|audit the repo|entire monorepo)\b/.test(lowered);
  }

  _buildPackageSections({ files, packages, entrypoints, query, packageInfo, audit = null }) {
    const digestByPath = audit ? new Map(audit.fileDigests.map((digest) => [digest.path, digest])) : null;
    return packages
      .map((pkg) => {
        const packageFiles = files.filter((file) => file.relativePath.startsWith(`${pkg.path}/`));
        const packageDigests = audit
          ? audit.fileDigests.filter((file) => file.path.startsWith(`${pkg.path}/`))
          : [];
        const packageTopLevel = this._summarizeTopLevel(packageFiles);
        const representativeFiles = this._rankImportantFiles({
          files: packageFiles,
          query: query || `${pkg.name ?? pkg.path} package module purpose entrypoint`,
          packageInfo
        }).slice(0, 4);
        const packageEntrypoints = entrypoints
          .filter((entry) => entry.path.startsWith(`${pkg.path}/`))
          .slice(0, 4);
        const subdirectories = this._summarizeScopedSubdirectories(files, pkg.path, 5);
        const languages = unique(packageFiles.map((file) => file.language).filter(Boolean)).sort();
        const directFiles = packageFiles
          .filter((file) => file.relativePath.slice(pkg.path.length + 1) && !file.relativePath.slice(pkg.path.length + 1).includes("/"))
          .map((file) => file.relativePath)
          .sort((left, right) => left.localeCompare(right))
          .slice(0, 4);

        return {
          path: pkg.path,
          name: pkg.name,
          description: pkg.description,
          purpose: pkg.description ?? guessFolderPurpose(path.basename(pkg.path), languages),
          fileCount: packageFiles.length,
          auditedFiles: packageDigests.length || undefined,
          textFiles: packageDigests.length ? packageDigests.filter((file) => file.isText).length : undefined,
          binaryFiles: packageDigests.length ? packageDigests.filter((file) => !file.isText).length : undefined,
          roleBreakdown: packageDigests.length ? summarizeRoleBreakdown(packageDigests, 5) : undefined,
          languages,
          directFiles,
          entrypoints: packageEntrypoints,
          subdirectories,
          representativeFiles,
          notableFiles: digestByPath
            ? representativeFiles
              .slice(0, 3)
              .map((item) => digestByPath.get(item.path))
              .filter(Boolean)
              .map((item) => ({
                path: item.path,
                role: item.role,
                summary: item.summary
              }))
            : undefined,
          topLevelSamples: packageTopLevel
            .filter((item) => item.path !== ".")
            .slice(0, 4)
            .map((item) => ({
              path: item.path,
              fileCount: item.fileCount,
              purpose: guessFolderPurpose(path.basename(item.path), item.languages)
            }))
        };
      })
      .sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path));
  }

  _buildDirectorySections({ files, topLevel, packages, query, packageInfo, audit = null }) {
    const digestByPath = audit ? new Map(audit.fileDigests.map((digest) => [digest.path, digest])) : null;
    return topLevel
      .filter((item) => item.path !== ".")
      .map((item) => {
        const directoryFiles = files.filter((file) => file.relativePath.startsWith(`${item.path}/`));
        const directoryDigests = audit
          ? audit.fileDigests.filter((file) => file.path.startsWith(`${item.path}/`))
          : [];
        const representativeFiles = this._rankImportantFiles({
          files: directoryFiles,
          query: query || `${item.path} directory purpose representative files`,
          packageInfo
        }).slice(0, 4);
        const workspacePackages = packages
          .filter((pkg) => pkg.path.startsWith(`${item.path}/`))
          .slice(0, 6)
          .map((pkg) => ({
            path: pkg.path,
            name: pkg.name,
            description: pkg.description
          }));

        return {
          path: item.path,
          purpose: guessFolderPurpose(path.basename(item.path), item.languages),
          fileCount: item.fileCount,
          auditedFiles: directoryDigests.length || undefined,
          textFiles: directoryDigests.length ? directoryDigests.filter((file) => file.isText).length : undefined,
          binaryFiles: directoryDigests.length ? directoryDigests.filter((file) => !file.isText).length : undefined,
          roleBreakdown: directoryDigests.length ? summarizeRoleBreakdown(directoryDigests, 5) : undefined,
          languages: item.languages,
          samples: item.samples,
          workspacePackages,
          subdirectories: this._summarizeScopedSubdirectories(files, item.path, 6),
          representativeFiles,
          notableFiles: digestByPath
            ? representativeFiles
              .slice(0, 3)
              .map((entry) => digestByPath.get(entry.path))
              .filter(Boolean)
              .map((entry) => ({
                path: entry.path,
                role: entry.role,
                summary: entry.summary
              }))
            : undefined
        };
      })
      .sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path));
  }

  _summarizeScopedSubdirectories(files, basePath, limit = 5) {
    const groups = new Map();
    const prefix = `${basePath}/`;

    for (const file of files) {
      if (!file.relativePath.startsWith(prefix)) {
        continue;
      }

      const remainder = file.relativePath.slice(prefix.length);
      if (!remainder.includes("/")) {
        continue;
      }

      const [head] = remainder.split("/");
      const sectionPath = `${basePath}/${head}`;
      if (!groups.has(sectionPath)) {
        groups.set(sectionPath, {
          path: sectionPath,
          fileCount: 0,
          languages: new Set(),
          samples: []
        });
      }

      const group = groups.get(sectionPath);
      group.fileCount += 1;
      if (file.language) {
        group.languages.add(file.language);
      }
      if (group.samples.length < 3) {
        group.samples.push(file.relativePath);
      }
    }

    return [...groups.values()]
      .map((group) => ({
        path: group.path,
        fileCount: group.fileCount,
        languages: [...group.languages].sort(),
        purpose: guessFolderPurpose(path.basename(group.path), [...group.languages]),
        samples: group.samples
      }))
      .sort((left, right) => right.fileCount - left.fileCount || left.path.localeCompare(right.path))
      .slice(0, limit);
  }

  _buildWalkSummary({ packageInfo, topLevel, packageSections, directorySections, rootFiles, importantFiles, audit = null, exhaustive = false }) {
    const manifestText = packageInfo?.name
      ? `${packageInfo.name}${packageInfo.version ? `@${packageInfo.version}` : ""}`
      : "no package manifest detected";
    const topLevelText = topLevel.slice(0, 6).map((item) => `${item.path} (${item.fileCount} files)`).join(", ");
    const packageText = packageSections.length
      ? `Package walk covers ${packageSections.slice(0, 4).map((section) => section.name ?? section.path).join(", ")}${packageSections.length > 4 ? `, and ${packageSections.length - 4} more` : ""}.`
      : null;
    const directoryText = directorySections.length
      ? `Top-level areas include ${directorySections.slice(0, 4).map((section) => section.path).join(", ")}${directorySections.length > 4 ? `, and ${directorySections.length - 4} more` : ""}.`
      : null;
    const importantText = importantFiles.slice(0, 5).map((item) => item.path).join(", ");
    const auditText = audit
      ? `Exhaustive audit opened all ${audit.fileCountInspected} repository files locally (${audit.textFileCount} full text bodies, ${audit.binaryFileCount} binary assets scanned as bytes).`
      : null;
    const roleText = audit?.roleBreakdown?.length
      ? `Most common file roles: ${audit.roleBreakdown.slice(0, 4).map((entry) => `${entry.role} (${entry.count})`).join(", ")}.`
      : null;

    return [
      `Package: ${manifestText}.`,
      topLevel.length ? `Top-level layout: ${topLevelText}.` : "Top-level layout: no indexed files.",
      auditText,
      packageText,
      directoryText,
      roleText,
      rootFiles.length ? `Key root files: ${rootFiles.slice(0, 6).join(", ")}.` : null,
      importantFiles.length ? `Start with these representative files: ${importantText}.` : null,
      exhaustive
        ? "This pass still returns a compact digest, but it did open every repository file locally before grouping the findings by package and directory."
        : "This pass summarizes each major area with representative files so you can answer broad repo questions without crawling every file body first."
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

function matchesWorkspacePattern(relativePath, pattern) {
  const normalizedPath = String(relativePath ?? "").replace(/\\/g, "/");
  const normalizedPattern = String(pattern ?? "").replace(/\\/g, "/").replace(/\/package\.json$/, "");
  const packageDir = normalizedPath.replace(/\/package\.json$/, "");

  if (!normalizedPattern.includes("*")) {
    return packageDir === normalizedPattern;
  }

  const escaped = normalizedPattern
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${escaped}$`).test(packageDir);
}

function normalizeFileLines(content) {
  return String(content ?? "").replace(/\r\n/g, "\n").split("\n");
}

function formatNumberedLines(lines, startLine, endLine) {
  const width = String(endLine).length;
  return lines
    .map((line, index) => `${String(startLine + index).padStart(width, " ")} | ${line}`)
    .join("\n");
}

function clampNumber(value, min, max, fallback) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function coerceBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.toLowerCase().trim();
    if (["1", "true", "yes", "on"].includes(lowered)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(lowered)) {
      return false;
    }
  }
  return fallback;
}

function countOccurrences(text, pattern) {
  if (!pattern) {
    return 0;
  }
  return text.split(pattern).length - 1;
}

function buildExcerptAroundIndex(content, index, { contextLines = 2, maxLines = 10 } = {}) {
  const lines = normalizeFileLines(content);
  const safeIndex = Math.max(0, index);
  let charCount = 0;
  let targetLine = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    charCount += lines[lineIndex].length + 1;
    if (safeIndex < charCount) {
      targetLine = lineIndex + 1;
      break;
    }
  }
  if (!targetLine) {
    targetLine = Math.max(1, lines.length);
  }

  const startLine = Math.max(1, targetLine - contextLines);
  const endLine = Math.min(lines.length, startLine + maxLines - 1);
  return formatNumberedLines(lines.slice(startLine - 1, endLine), startLine, endLine);
}

function compactCommandOutput(text, maxChars = 4000) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const headChars = Math.max(400, Math.floor(maxChars * 0.65));
  const tailChars = Math.max(200, maxChars - headChars - 64);
  return `${normalized.slice(0, headChars)}\n... [output truncated] ...\n${normalized.slice(-tailChars)}`;
}

function buildCommandSummary({ command, cwd, exitCode, timedOut, stdout, stderr }) {
  const stdoutLines = normalizeFileLines(stdout).filter(Boolean).length;
  const stderrLines = normalizeFileLines(stderr).filter(Boolean).length;
  const status = timedOut
    ? "timed out"
    : exitCode === 0
      ? "succeeded"
      : `failed with exit ${exitCode}`;
  const location = cwd === "." ? "repository root" : cwd;

  return `Ran "${command}" in ${location}. Command ${status}. stdout lines: ${stdoutLines}. stderr lines: ${stderrLines}.`;
}

function inspectRepositoryFile(file) {
  const buffer = fs.readFileSync(file.absolutePath);
  const binary = looksBinary(buffer, file.relativePath);

  if (binary) {
    return {
      path: file.relativePath,
      language: file.language,
      role: inferFileRole(file.relativePath, "", file.language, file, { isBinary: true }),
      summary: `${file.relativePath}: binary or non-text asset skipped from text parsing.`,
      isText: false,
      isGenerated: Boolean(file.isGenerated),
      isVendor: Boolean(file.isVendor),
      bytes: buffer.length,
      lineCount: 0,
      importCount: 0,
      exportCount: 0,
      headingCount: 0
    };
  }

  const content = buffer.toString("utf8");
  const lines = normalizeFileLines(content);
  const lineCount = lines.length;
  const importCount = countRegexMatches(content, /^\s*import\b/gm);
  const exportCount = countRegexMatches(content, /^\s*export\b/gm);
  const headingCount = countRegexMatches(content, /^#{1,6}\s+/gm);
  const role = inferFileRole(file.relativePath, content, file.language, file, { isBinary: false });
  const topKeys = file.language === "json" ? extractJsonTopLevelKeys(content) : [];
  const summary = summarizeFileDigest({
    path: file.relativePath,
    role,
    language: file.language,
    lineCount,
    importCount,
    exportCount,
    headingCount,
    topKeys,
    isGenerated: Boolean(file.isGenerated),
    isVendor: Boolean(file.isVendor)
  });

  return {
    path: file.relativePath,
    language: file.language,
    role,
    summary,
    isText: true,
    isGenerated: Boolean(file.isGenerated),
    isVendor: Boolean(file.isVendor),
    bytes: buffer.length,
    lineCount,
    importCount,
    exportCount,
    headingCount
  };
}

function summarizeRoleBreakdown(fileDigests, limit = 6) {
  const counts = new Map();
  for (const file of fileDigests) {
    counts.set(file.role, (counts.get(file.role) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role))
    .slice(0, limit);
}

function inferFileRole(relativePath, content, language, file, options = {}) {
  const loweredPath = String(relativePath ?? "").toLowerCase();
  const basename = path.basename(loweredPath);

  if (options.isBinary) return "binary_asset";
  if (file?.isVendor) return "vendor_asset";
  if (file?.isGenerated || basename.endsWith(".d.ts")) return "generated_or_types";
  if (basename === "package.json") return "package_manifest";
  if (/^readme(\.|$)/i.test(basename)) return "readme";
  if (/^(install|contributing|changelog|license|agents|claude)(\.|$)/i.test(basename)) return "documentation";
  if (loweredPath.includes("/tests/") || loweredPath.includes("/test/") || /\.(test|spec)\./.test(loweredPath)) return "test";
  if (loweredPath.includes("/fixture") || loweredPath.includes("/fixtures/")) return "fixture";
  if (loweredPath.includes("/hooks/")) return "hook";
  if (loweredPath.includes("/scripts/") || /^\#\!/.test(content)) return "script";
  if (basename.includes("mcp-server") || /\bnew\s+McpServer\b/.test(content)) return "mcp_server";
  if (basename.startsWith("cli.") || /\bprocess\.argv\b/.test(content)) return "cli_entrypoint";
  if (loweredPath.includes("/src/tools/") || /^forge[_-]/.test(basename)) return "tool_module";
  if (language === "markdown") return "documentation";
  if (language === "json") return "config_or_data";
  return "source_module";
}

function summarizeFileDigest({ path: filePath, role, language, lineCount, importCount, exportCount, headingCount, topKeys, isGenerated, isVendor }) {
  if (role === "package_manifest") {
    return `${filePath}: package manifest${topKeys.length ? ` with keys ${topKeys.join(", ")}` : ""}.`;
  }
  if (role === "readme" || role === "documentation") {
    return `${filePath}: documentation${headingCount ? ` with ${headingCount} headings` : ""}.`;
  }
  if (role === "test") {
    return `${filePath}: test coverage file (${lineCount} lines, ${importCount} imports).`;
  }
  if (role === "script") {
    return `${filePath}: automation script (${lineCount} lines).`;
  }
  if (role === "hook") {
    return `${filePath}: Claude or plugin hook module (${lineCount} lines).`;
  }
  if (role === "mcp_server") {
    return `${filePath}: MCP server entrypoint (${lineCount} lines, ${exportCount} exports).`;
  }
  if (role === "cli_entrypoint") {
    return `${filePath}: CLI entrypoint (${lineCount} lines, ${importCount} imports).`;
  }
  if (role === "tool_module") {
    return `${filePath}: ContextForge tool module (${lineCount} lines, ${exportCount} exports).`;
  }
  if (role === "config_or_data") {
    return `${filePath}: ${isVendor ? "vendor" : "config/data"} JSON${topKeys.length ? ` with keys ${topKeys.join(", ")}` : ""}.`;
  }
  if (role === "generated_or_types") {
    return `${filePath}: generated or type-support file (${lineCount} lines).`;
  }
  const qualifiers = [];
  if (isGenerated) qualifiers.push("generated");
  if (isVendor) qualifiers.push("vendor");
  if (language) qualifiers.push(language);
  const qualifierText = qualifiers.length ? `${qualifiers.join(" ")} ` : "";
  return `${filePath}: ${qualifierText}source module (${lineCount} lines, ${importCount} imports, ${exportCount} exports).`;
}

function extractJsonTopLevelKeys(content) {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return [];
    }
    return Object.keys(parsed).slice(0, 6);
  } catch {
    return [];
  }
}

function countRegexMatches(text, pattern) {
  if (!text) {
    return 0;
  }

  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function looksBinary(buffer, filePath = "") {
  const ext = path.extname(String(filePath ?? "").toLowerCase());
  if ([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tar",
    ".tgz", ".mp3", ".mp4", ".mov", ".avi", ".wasm", ".woff", ".woff2", ".ttf", ".otf"
  ].includes(ext)) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}
