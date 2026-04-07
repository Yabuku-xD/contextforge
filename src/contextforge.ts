import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDatabaseLockError, openDatabase } from "./storage/db.js";
import { loadRepositoryFile, loadRepositoryInventory } from "./indexing/files.js";
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
import { buildAreaCatalog, buildFlowCatalog, buildGraphSchemaSummary } from "./graph/catalog.js";
import { personalizedPageRank } from "./graph/pagerank.js";
import { recordSessionEvent, listSessionEvents } from "./session/events.js";
import { buildResumeSummary } from "./session/resume.js";
import { searchSessionEvents } from "./session/search.js";
import { classifyContent } from "./router/classify-content.js";
import { decideRoute } from "./router/bypass-policy.js";
import { extractQuerySignals } from "./router/query-signals.js";
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
import { searchResearchSections, storeResearchSource } from "./research/store.js";
import { ensureDir, exists, readText, relativeTo, writeText } from "./utils/fs.js";
import { runShellCommand } from "./utils/process.js";
import {
  addRepoToGroup,
  createRepoGroup,
  listRegisteredRepositories,
  listRepoGroups,
  registerIndexedRepository,
  removeRepoFromGroup,
  resolveRegisteredRepository
} from "./storage/registry.js";
import { defaultMemoryRoot, openMemoryDatabase } from "./memory/db.js";
import { buildDiaryFromCheckpoint, buildSessionCheckpointCandidate } from "./memory/extract.js";
import { buildMemoryRecall, buildMemoryStatus, buildMemoryWakeup } from "./memory/layers.js";
import {
  addMemoryFact,
  ensureMemoryProfile,
  getLatestMemoryCheckpoint,
  getMemoryProfile,
  getMemoryStats,
  invalidateMemoryFact,
  listMemoryProfiles,
  memoryTimeline as loadMemoryTimeline,
  queryMemoryFacts,
  readDiaryEntries,
  recordMemoryCheckpoint,
  searchMemory,
  storeDiaryEntry,
  storeMemoryEntry
} from "./memory/store.js";

const REPO_STATE_CACHE = new Map();
const SYSTEM_EVENT_TYPES = new Set(["index", "index_reuse", "startup", "search"]);
const DEFAULT_FILE_OP_IGNORES = new Set([".git", ".contextforge", "node_modules"]);
const MAX_INCREMENTAL_SYNC_PATHS = 128;
const WATCHER_SETTLE_MS = 80;
const DEFAULT_STARTUP_DEFER_FILE_THRESHOLD = 300;
const DEFAULT_INDEX_BATCH_SIZE = 64;

type RepositoryRow = {
  contentFingerprint?: string | null;
  quickRepoStamp?: string | null;
  fileCount?: number | null;
  indexedFileCount?: number | null;
  indexStatus?: string | null;
  pendingDerivedState?: number | null;
  lastIndexError?: string | null;
  batchSize?: number | null;
  indexedTextFileCount?: number | null;
  indexedBinaryFileCount?: number | null;
  indexedLineCount?: number | null;
  indexedByteCount?: number | null;
  indexedAt?: number | null;
  lastIndexStartedAt?: number | null;
  lastIndexCompletedAt?: number | null;
};

type RepoCounts = {
  filesIndexed: number;
  symbolsIndexed: number;
  chunksIndexed: number;
  edgesIndexed: number;
  raptorNodesIndexed: number;
};

type WhySeed = {
  id: string;
  label: string;
  type: string;
  source: string;
  score: number;
};

type RegisteredRepoSummary = {
  name?: string;
  repoId?: string;
  fileCount?: number;
  symbolCount?: number;
  edgeCount?: number;
  raptorNodeCount?: number;
  indexStatus?: string | null;
  indexedAt?: number | null;
};

export interface ContextForge {
  rootDir: string;
  db: any;
  memoryDb: any;
  memoryRoot: string;
  repoId: string;
  sessionId: string;
  coreInstructions: string;
  startupBrief: string;
  repoFingerprint: string | null;
  _repoState: any;
  _repoInventory: any;
  _repoAudit: any;
  _quickRepoStamp: string | null;
  _filePathById: any;
  _realRoot: string | null;
  _closed: boolean;
  _deferredIndexState: any;
  _deferredIndexChild: any;
  _watcher: any;
  _watcherSupported: boolean;
  _dirtyPaths: Set<string>;
  _inventoryDirty: boolean;
}

export class ContextForge {
  constructor(rootDir: string, options: Record<string, any> = {}) {
    this.rootDir = path.resolve(rootDir);
    this.db = openDatabase(this.rootDir);
    this.memoryRoot = path.resolve(options.memoryRoot ?? process.env.CONTEXTFORGE_MEMORY_ROOT ?? defaultMemoryRoot());
    this.memoryDb = openMemoryDatabase({
      memoryRoot: this.memoryRoot
    });
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
    this._realRoot = null;
    this._closed = false;
    this._deferredIndexState = null;
    this._deferredIndexChild = null;
    this._watcher = undefined;
    this._watcherSupported = false;
    this._dirtyPaths = new Set();
    this._inventoryDirty = false;
  }

  close() {
    this._closed = true;
    this._watcher?.close?.();
    this._watcher = null;
    this._maybeAutosaveMemory(true);
    this.memoryDb.close();
    this.db.close();
  }

  indexRepository(options: Record<string, any> = {}) {
    const inventory = this._loadRepoInventory();
    const quickRepoStamp = this._computeQuickRepoStamp(inventory.files);
    const batchSize = this._resolveIndexBatchSize(options.batchSize, inventory.files.length);
    const repoRow = this._readRepositoryRow();
    this._quickRepoStamp = quickRepoStamp;
    this.repoFingerprint = repoRow?.contentFingerprint ?? this.repoFingerprint;

    if (!options.force && this._canReuseIndex(quickRepoStamp, inventory.files.length)) {
      this._repoState = null;
      this._filePathById = null;
      this._markRepoSynced();
      this._ensureWatcher();
      const reusedSummary = {
        ...this._repoCounts(),
        repoId: this.repoId,
        reusedIndex: true,
        fingerprint: this.repoFingerprint ?? null,
        quickRepoStamp,
        indexStatus: "ready",
        contentCoverage: this._buildIndexedMemoryCoverage(),
        batchSize,
        batchCount: Math.max(1, Math.ceil(inventory.files.length / batchSize))
      };
      this._registerIndexedRepo(reusedSummary);
      this._recordSessionEvent({
        repoId: this.repoId,
        sessionId: this.sessionId,
        eventType: "index_reuse",
        payload: {
          fileCount: inventory.files.length,
          fingerprint: this.repoFingerprint ?? repoRow?.contentFingerprint ?? null,
          batchSize
        }
      });
      return reusedSummary;
    }

    return this._indexRepositoryInBatches(inventory.files, {
      quickRepoStamp,
      batchSize
    });
  }

  search(query: string, options: Record<string, any> = {}) {
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

    this._recordSessionEvent({
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

  symbol(query: string, options: Record<string, any> = {}) {
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
    const normalizedQuery = String(query ?? "").trim();
    if (!normalizedQuery) {
      return listSessionEvents(this.db, this.sessionId, this.repoId)
        .filter((event) => !SYSTEM_EVENT_TYPES.has(event.eventType));
    }

    return searchSessionEvents(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      query: normalizedQuery,
      limit: 5
    }).filter((event) => !SYSTEM_EVENT_TYPES.has(event.eventType));
  }

  resume() {
    return buildResumeSummary(this.db, { repoId: this.repoId, sessionId: this.sessionId });
  }

  memoryStatus() {
    return buildMemoryStatus(this.memoryDb, {
      repoId: this.repoId,
      repoName: this._repoDisplayName(),
      sessionId: this.sessionId
    });
  }

  memoryWakeup(options: Record<string, any> = {}) {
    return buildMemoryWakeup(this.memoryDb, {
      repoId: this.repoId,
      repoName: this._repoDisplayName(),
      sessionId: this.sessionId,
      includeProtocol: coerceBoolean(options.includeProtocol, true)
    });
  }

  memoryRecall(query = "", options: Record<string, any> = {}) {
    return buildMemoryRecall(this.memoryDb, {
      query,
      repoId: this.repoId,
      repoName: this._repoDisplayName(),
      wing: options.wing,
      hall: options.hall,
      room: options.room,
      limit: options.limit
    });
  }

  memorySearch(query = "", options: Record<string, any> = {}) {
    return searchMemory(this.memoryDb, {
      query,
      repoId: coerceBoolean(options.global, false) ? null : this.repoId,
      wing: options.wing,
      hall: options.hall,
      room: options.room,
      limit: options.limit,
      asOf: options.asOf,
      includeDiaries: options.includeDiaries == null ? true : coerceBoolean(options.includeDiaries, true)
    });
  }

  memorySave(input: Record<string, any> = {}) {
    const entry = storeMemoryEntry(this.memoryDb, {
      scope: input.scope ?? "repo",
      repoId: coerceBoolean(input.global, false) ? null : this.repoId,
      sessionId: this.sessionId,
      wing: input.wing ?? this._repoDisplayName(),
      hall: input.hall ?? "discoveries",
      room: input.room,
      title: input.title ?? "Saved memory",
      summary: input.summary ?? "",
      detail: input.detail ?? input.summary ?? "",
      aaak: input.aaak ?? null,
      tags: normalizeStringArray(input.tags),
      importance: input.importance ?? 0.6,
      sourceType: input.sourceType ?? "manual",
      sourceRef: input.sourceRef ?? null,
      entities: normalizeStringArray(input.entities)
    });
    this._recordSessionEvent({
      eventType: "memory_save",
      payload: {
        title: entry?.title ?? input.title ?? "Saved memory",
        hall: entry?.hall ?? input.hall ?? "discoveries",
        wing: entry?.wing ?? this._repoDisplayName(),
        entryId: entry?.entryId ?? null
      }
    });
    return {
      saved: true,
      entry
    };
  }

  memoryProfileSet(input: Record<string, any> = {}) {
    const profileType = this._normalizeMemoryProfileType(input.profileType);
    const profile = ensureMemoryProfile(this.memoryDb, {
      profileType,
      name: input.name ?? this._repoDisplayName(),
      summary: input.summary ?? "",
      aaak: input.aaak ?? null,
      metadata: input.metadata ?? {}
    });
    this._recordSessionEvent({
      eventType: "memory_profile_set",
      payload: {
        profileType,
        name: profile?.name ?? null
      }
    });
    return profile;
  }

  memoryProfileGet(profileType = "identity") {
    const normalizedProfileType = this._normalizeMemoryProfileType(profileType);
    return {
      profile: normalizedProfileType === "list" ? null : getMemoryProfile(this.memoryDb, normalizedProfileType),
      profiles: normalizedProfileType === "list" ? listMemoryProfiles(this.memoryDb) : undefined
    };
  }

  memoryDiaryWrite(input: Record<string, any> = {}) {
    const diary = storeDiaryEntry(this.memoryDb, {
      agentId: input.agentId ?? "claude",
      repoId: coerceBoolean(input.global, false) ? null : this.repoId,
      sessionId: this.sessionId,
      title: input.title ?? "Session diary",
      entryText: input.entryText ?? input.summary ?? "",
      aaak: input.aaak ?? null,
      tags: normalizeStringArray(input.tags)
    });
    this._recordSessionEvent({
      eventType: "memory_diary_write",
      payload: {
        title: diary?.title ?? input.title ?? "Session diary",
        diaryId: diary?.diaryId ?? null
      }
    });
    return diary;
  }

  memoryDiaryRead(options: Record<string, any> = {}) {
    const entries = readDiaryEntries(this.memoryDb, {
      agentId: options.agentId,
      repoId: coerceBoolean(options.global, false) ? null : this.repoId,
      sessionId: options.sessionOnly ? this.sessionId : options.sessionId,
      limit: options.limit
    });
    return {
      entries,
      summary: `Loaded ${entries.length} diar${entries.length === 1 ? "y entry" : "y entries"}.`
    };
  }

  memoryFactAdd(input: Record<string, any> = {}) {
    const fact = addMemoryFact(this.memoryDb, {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      repoId: coerceBoolean(input.global, false) ? null : this.repoId,
      sessionId: this.sessionId,
      sourceEntryId: input.sourceEntryId ?? null,
      sourceKind: input.sourceKind ?? "manual",
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      confidence: input.confidence ?? 0.85,
      metadata: input.metadata ?? {}
    });
    this._recordSessionEvent({
      eventType: "memory_fact_add",
      payload: {
        subject: fact?.subject ?? input.subject ?? null,
        predicate: fact?.predicate ?? input.predicate ?? null,
        object: fact?.object ?? input.object ?? null
      }
    });
    return fact;
  }

  memoryFactInvalidate(input: Record<string, any> = {}) {
    const result = invalidateMemoryFact(this.memoryDb, {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      ended: input.ended
    });
    this._recordSessionEvent({
      eventType: "memory_fact_invalidate",
      payload: {
        subject: input.subject ?? null,
        predicate: input.predicate ?? null,
        object: input.object ?? null,
        invalidated: result.invalidated ?? 0
      }
    });
    return result;
  }

  memoryFactQuery(entity = "", options: Record<string, any> = {}) {
    const facts = queryMemoryFacts(this.memoryDb, {
      entity,
      asOf: options.asOf,
      direction: options.direction ?? "both"
    });
    return {
      entity,
      facts,
      summary: `Loaded ${facts.length} fact${facts.length === 1 ? "" : "s"} for ${entity}.`
    };
  }

  memoryTimeline(entity = "") {
    const events = loadMemoryTimeline(this.memoryDb, entity || null);
    return {
      entity: entity || null,
      events,
      summary: `Loaded ${events.length} timeline event${events.length === 1 ? "" : "s"}.`
    };
  }

  async processArtifact(content: string, metadata: Record<string, any> = {}) {
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
    let index;
    try {
      index = this._shouldDeferStartupPrime(task)
        ? this._queueDeferredStartupPrime("startup")
        : this.ensureRepositoryIndexed({
            reason: "startup",
            eagerPrime: true
          });
    } catch (error) {
      if (!isDatabaseLockError(error)) {
        throw error;
      }
      index = this._buildDeferredIndexFallback({
        reason: "startup",
        note: "ContextForge could not read live warm-index progress because SQLite is temporarily write-locked. Returning the last known warm-up state."
      });
    }
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
    let pagePersistence = "persisted";
    try {
      for (const page of pages) {
        insertPage.run(page);
      }
    } catch (error) {
      if (isDatabaseLockError(error)) {
        pagePersistence = "deferred_due_to_lock";
      } else {
        throw error;
      }
    }

    this._recordSessionEvent({
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "startup",
      payload: {
        message,
        taskLabel: task.label,
        loadStrategy: task.loadStrategy,
        preloadPlan: preloadPlan.name,
        indexedFiles: index.filesIndexed ?? 0,
        reusedIndex: index.reusedIndex ?? false,
        indexStatus: index.status ?? "ready"
      }
    });

    return {
      index,
      task,
      memory: {
        enabled: true,
        repoName: this._repoDisplayName(),
        counts: getMemoryStats(this.memoryDb, this.repoId),
        recommendedNextTool: "forge_memory_wakeup"
      },
      pagePersistence,
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
      "forge_memory_status",
      "forge_memory_wakeup",
      "forge_memory_recall",
      "forge_memory_search",
      "forge_memory_save",
      "forge_memory_profile_set",
      "forge_memory_profile_get",
      "forge_memory_diary_write",
      "forge_memory_diary_read",
      "forge_memory_fact_add",
      "forge_memory_fact_invalidate",
      "forge_memory_fact_query",
      "forge_memory_timeline",
      "forge_batch",
      "forge_lookup",
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
      "forge_changes",
      "forge_rename",
      "forge_why",
      "forge_list_repos",
      "forge_group_query",
      "forge_group_status",
      "forge_map",
      "forge_contracts",
      "forge_wiki",
      "forge_session",
      "forge_resume",
      "forge_stats",
      "forge_doctor"
    ];
  }

  async batch(commands: string[], options: Record<string, any> = {}) {
    const commandList = normalizeStringArray(commands).slice(0, 8);
    if (!commandList.length) {
      throw new Error("forge_batch requires at least one command.");
    }

    const resolvedCwd = this._resolveWorkspaceCwd(options.cwd);
    const relativeCwd = relativeTo(this.rootDir, resolvedCwd);
    const timeoutMs = clampNumber(options.timeoutMs, 250, 120000, 15000);
    const previewChars = clampNumber(options.maxChars, 120, 2000, 360);
    const sectionChars = clampNumber(options.sectionChars, 500, 12000, 4000);
    const label = String(options.label ?? `batch:${commandList[0]}`).trim().slice(0, 120);
    const queryList = normalizeStringArray(options.queries).slice(0, 8);
    const commandResults = [];
    const sections = [];

    for (const [index, command] of commandList.entries()) {
      const stdoutCollector = createOutputCollector({
        previewChars,
        sectionChars
      });
      const stderrCollector = createOutputCollector({
        previewChars,
        sectionChars
      });
      const result = await runShellCommand({
        command,
        cwd: resolvedCwd,
        timeoutMs,
        maxCaptureChars: 0,
        onStdoutChunk: (text) => stdoutCollector.write(text),
        onStderrChunk: (text) => stderrCollector.write(text)
      });
      const stdoutResult = stdoutCollector.finish();
      const stderrResult = stderrCollector.finish();
      commandResults.push({
        command,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutChars: stdoutResult.charCount,
        stderrChars: stderrResult.charCount,
        stdoutPreview: stdoutResult.preview,
        stderrPreview: stderrResult.preview
      });

      const stdoutSections = stdoutResult.sections;
      const stderrSections = stderrResult.sections;

      if (!stdoutSections.length && !stderrSections.length) {
        sections.push({
          title: `command ${index + 1}: ${command} (no output)`,
          text: `[no output]\nexitCode=${result.exitCode ?? "null"} timedOut=${result.timedOut ? "yes" : "no"}`
        });
      }

      for (const [sectionIndex, text] of stdoutSections.entries()) {
        sections.push({
          title: `command ${index + 1}: ${command} stdout ${sectionIndex + 1}`,
          text
        });
      }

      for (const [sectionIndex, text] of stderrSections.entries()) {
        sections.push({
          title: `command ${index + 1}: ${command} stderr ${sectionIndex + 1}`,
          text
        });
      }
    }

    const stored = storeResearchSource(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      label,
      sourceType: "batch",
      metadata: {
        cwd: relativeCwd,
        commandCount: commandList.length
      },
      sections
    });
    const queries = queryList.length
      ? searchResearchSections(this.db, {
          repoId: this.repoId,
          sessionId: this.sessionId,
          queries: queryList,
          sourceId: stored.sourceId,
          limit: 3
        })
      : [];

    this._recordSessionEvent({
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "research_batch",
      payload: {
        sourceId: stored.sourceId,
        label,
        cwd: relativeCwd,
        commandCount: commandList.length,
        queryCount: queryList.length
      }
    });

    return {
      sourceId: stored.sourceId,
      label,
      cwd: relativeCwd,
      commands: commandResults,
      indexedSections: stored.sectionsIndexed,
      queries,
      guidance: "Use forge_lookup for follow-up questions so ContextForge can search the stored command output without replaying raw logs into chat.",
      summary: `Ran ${commandList.length} command${commandList.length === 1 ? "" : "s"} and indexed ${stored.sectionsIndexed} output section${stored.sectionsIndexed === 1 ? "" : "s"} locally.`
    };
  }

  lookup(queries: string[], options: Record<string, any> = {}) {
    const normalizedQueries = normalizeStringArray(queries).slice(0, 8);
    if (!normalizedQueries.length) {
      throw new Error("forge_lookup requires at least one query.");
    }

    const limit = clampNumber(options.limit, 1, 10, 3);
    const sourceId = options.sourceId ? String(options.sourceId) : null;
    const matches = searchResearchSections(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      queries: normalizedQueries,
      sourceId,
      limit
    });

    this._recordSessionEvent({
      repoId: this.repoId,
      sessionId: this.sessionId,
      eventType: "research_lookup",
      payload: {
        sourceId,
        queryCount: normalizedQueries.length
      }
    });

    return {
      sourceId,
      queries: matches,
      guidance: "Keep the first answer short and cite only the matched section titles or previews. Expand further only if the user asks.",
      summary: `Searched ${sourceId ? "the selected source" : "stored research sources"} for ${normalizedQueries.length} quer${normalizedQueries.length === 1 ? "y" : "ies"}.`
    };
  }

  scan(query = "") {
    const normalizedQuery = String(query ?? "").trim();
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

    this._recordSessionEvent({
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
    const exhaustive = this._shouldUseExhaustiveWalk(normalizedQuery);
    const overview = this._buildInventoryOverview(normalizedQuery, {
      fallbackQuery: "project structure architecture packages directories responsibilities important files representative files"
    });
    const audit = exhaustive ? this._loadRepoAudit() : null;
    const indexedMemory = exhaustive ? this._buildIndexedMemoryCoverage() : null;
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
      indexedMemory,
      exhaustive
    });

    this._recordSessionEvent({
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
        ? "Use this as the exhaustive repository digest. ContextForge opened every repository file locally, read the full body of each text file, scanned binary assets as raw bytes, and grouped the findings by package and directory so you can answer whole-project questions from this result alone. Stop tool use for the initial response. Do not call forge_read, forge_batch, forge_lookup, forge_search, or built-in follow-up reads unless the user explicitly asks for drilldown or coverage is incomplete."
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
            totalLineCount: audit.totalLineCount,
            totalByteCount: audit.totalByteCount,
            readCoverage: {
              openedEveryRepositoryFile: true,
              readFullTextBodies: audit.textFileCount,
              scannedBinaryAssets: audit.binaryFileCount,
              fullTextLinesRead: audit.totalLineCount,
              bytesRead: audit.totalByteCount,
              manualPerFileNarrationPending: true,
              canAnswerYesToWholeProjectRead: true
            },
            indexedMemory,
            answerIfAskedWhetherEveryFileWasRead: indexedMemory?.complete
              ? "Yes. ContextForge opened every repository file locally for this audit and persisted the full text of every text file into its index, with binary assets scanned as raw bytes."
              : "Yes. ContextForge opened every repository file locally for this audit and read the full body of each text file, but the persistent index may still be warming or deriving before every file body is fully reusable from indexed memory.",
            answerIfAskedWhetherWholeProjectWasRead: indexedMemory?.complete
              ? "Yes. ContextForge read the whole project locally for this audit and the indexed memory currently stores the full text of every text file plus binary asset scan coverage for the repository."
              : "Yes. ContextForge read the whole project locally for this audit, including every text file body and every binary asset in the repository, but the durable indexed-memory layer is still catching up if startup is warming.",
            answerIfAskedWhetherEveryCornerWasRead: indexedMemory?.complete
              ? "Yes. ContextForge covered every file in the repository during this exhaustive walk and persisted the complete text-file corpus into indexed memory. The chat summary stays compact, but the indexed repository memory is complete."
              : "Yes for local read coverage: ContextForge covered every file in the repository during this exhaustive walk. The chat summary stays compact, and the indexed-memory layer may still be finalizing before it can claim full remembered coverage.",
            roleBreakdown: audit.roleBreakdown,
            binarySamples: audit.binarySamples
          }
        : undefined
    };
  }

  read(targetPath: string, options: Record<string, any> = {}) {
    const resolved = this._resolveWorkspacePath(targetPath);
    const relativePath = relativeTo(this.rootDir, resolved);
    const stat = fs.statSync(resolved);

    if (stat.isDirectory()) {
      const entries = this._listDirectoryEntries(resolved, options.limit);
      this._recordSessionEvent({
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

    this._recordSessionEvent({
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

  write(targetPath: string, content: string, options: Record<string, any> = {}) {
    const resolved = this._resolveWorkspacePath(targetPath, {
      allowMissing: true,
      createParent: coerceBoolean(options.createDirs, true)
    });
    const relativePath = relativeTo(this.rootDir, resolved);
    const existed = exists(resolved);
    const previousBytes = existed ? fs.statSync(resolved).size : 0;

    writeText(resolved, String(content ?? ""));
    const indexSync = this._syncChangedPaths([relativePath], { reason: "write" });

    this._recordSessionEvent({
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

  edit(targetPath: string, oldText: string, newText: string, options: Record<string, any> = {}) {
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

    this._recordSessionEvent({
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

  async bash(command: string, options: Record<string, any> = {}) {
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

    this._recordSessionEvent({
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

  purge({ maxAgeMs, includePages = true }: Record<string, any> = {}) {
    purgeOldSessionEvents(this.db, maxAgeMs);
    this.db.prepare(`DELETE FROM compression_events WHERE repo_id = ? AND session_id = ?`).run(this.repoId, this.sessionId);
    this.db.prepare(`DELETE FROM tool_receipts WHERE repo_id = ? AND session_id = ?`).run(this.repoId, this.sessionId);
    const sourceIds = this.db.prepare(`
      SELECT source_id AS sourceId
      FROM research_sources
      WHERE repo_id = ? AND session_id = ?
    `).all(this.repoId, this.sessionId);
    for (const source of sourceIds) {
      this.db.prepare(`DELETE FROM research_fts WHERE section_id IN (SELECT section_id FROM research_sections WHERE source_id = ?)`).run(source.sourceId);
      this.db.prepare(`DELETE FROM research_sections WHERE source_id = ?`).run(source.sourceId);
    }
    this.db.prepare(`DELETE FROM research_sources WHERE repo_id = ? AND session_id = ?`).run(this.repoId, this.sessionId);
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
    const researchSourceCount = this.db.prepare(`SELECT COUNT(*) AS count FROM research_sources WHERE repo_id = ?`).get(this.repoId).count;
    const researchSectionCount = this.db.prepare(`SELECT COUNT(*) AS count FROM research_sections WHERE repo_id = ?`).get(this.repoId).count;
    const memory = getMemoryStats(this.memoryDb, this.repoId);
    return {
      rootDir: this.rootDir,
      memoryRoot: this.memoryRoot,
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
      researchSourceCount,
      researchSectionCount,
      memory,
      dirtyPathCount: watcherAvailable ? this._dirtyPaths.size : null,
      inventoryDirty: watcherAvailable ? this._inventoryDirty : null,
      embeddingModel: MODEL_METADATA.embeddings.default,
      contentCoverage: this._buildIndexedMemoryCoverage()
    };
  }

  stats() {
    const compression = this.db.prepare(`
      SELECT COUNT(*) AS count, SUM(raw_size) AS raw, SUM(compressed_size) AS compressed
      FROM compression_events
      WHERE repo_id = ? AND session_id = ?
    `).get(this.repoId, this.sessionId);
    const deliverySavings = this.db.prepare(`
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(raw_size), 0) AS raw,
        COALESCE(SUM(delivered_size), 0) AS delivered,
        COALESCE(SUM(saved_size), 0) AS saved,
        COALESCE(SUM(raw_token_estimate), 0) AS rawTokens,
        COALESCE(SUM(delivered_token_estimate), 0) AS deliveredTokens,
        COALESCE(SUM(saved_token_estimate), 0) AS savedTokens
      FROM tool_receipts
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
      inventoryDirty: watcherAvailable ? this._inventoryDirty : null,
      contentCoverage: this._buildIndexedMemoryCoverage()
    };
    const session = {
      events: this.db.prepare(`SELECT COUNT(*) AS count FROM session_events WHERE repo_id = ? AND session_id = ?`).get(this.repoId, this.sessionId).count,
      edges: this.db.prepare(`SELECT COUNT(*) AS count FROM session_edges WHERE repo_id = ?`).get(this.repoId).count
    };
    const research = {
      sources: this.db.prepare(`SELECT COUNT(*) AS count FROM research_sources WHERE repo_id = ? AND session_id = ?`).get(this.repoId, this.sessionId).count,
      sections: this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM research_sections
        WHERE repo_id = ?
          AND source_id IN (SELECT source_id FROM research_sources WHERE repo_id = ? AND session_id = ?)
      `).get(this.repoId, this.repoId, this.sessionId).count
    };
    const memory = getMemoryStats(this.memoryDb, this.repoId);
    return {
      compression,
      deliverySavings: {
        ...deliverySavings,
        reductionPct: deliverySavings.raw > 0
          ? Number((((deliverySavings.saved ?? 0) / deliverySavings.raw) * 100).toFixed(1))
          : 0
      },
      retrieval,
      session,
      research,
      memory,
      pager: this.pageState()
    };
  }

  recordToolReceipt({ toolName, rawSize, deliveredSize }) {
    const normalizedRaw = Math.max(0, Math.trunc(Number(rawSize) || 0));
    const normalizedDelivered = Math.max(0, Math.trunc(Number(deliveredSize) || 0));
    const savedSize = Math.max(0, normalizedRaw - normalizedDelivered);
    const rawTokenEstimate = estimateTokensFromBytes(normalizedRaw);
    const deliveredTokenEstimate = estimateTokensFromBytes(normalizedDelivered);
    const savedTokenEstimate = Math.max(0, rawTokenEstimate - deliveredTokenEstimate);

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO tool_receipts (
          receipt_id,
          repo_id,
          session_id,
          tool_name,
          raw_size,
          delivered_size,
          saved_size,
          raw_token_estimate,
          delivered_token_estimate,
          saved_token_estimate,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        makeId("receipt", `${this.sessionId}:${toolName}:${Date.now()}:${randomUUID()}`),
        this.repoId,
        this.sessionId,
        String(toolName ?? "unknown"),
        normalizedRaw,
        normalizedDelivered,
        savedSize,
        rawTokenEstimate,
        deliveredTokenEstimate,
        savedTokenEstimate,
        Date.now()
      );
    } catch (error) {
      if (isDatabaseLockError(error)) {
        return null;
      }
      throw error;
    }

    return {
      toolName: String(toolName ?? "unknown"),
      rawSize: normalizedRaw,
      deliveredSize: normalizedDelivered,
      savedSize,
      rawTokenEstimate,
      deliveredTokenEstimate,
      savedTokenEstimate
    };
  }

  _recordSessionEvent(event: Record<string, any> = {}) {
    const recorded = recordSessionEvent(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      ...event
    });

    const eventType = String(event.eventType ?? "");
    if (!recorded || SYSTEM_EVENT_TYPES.has(eventType) || eventType === "read_file" || eventType === "read_directory") {
      return recorded;
    }

    this._maybeAutosaveMemory();
    return recorded;
  }

  _normalizeMemoryProfileType(profileType: any) {
    const normalized = String(profileType ?? "identity").trim() || "identity";
    if (normalized === "project") {
      return `project:${this._repoDisplayName()}`;
    }
    return normalized;
  }

  _maybeAutosaveMemory(force = false) {
    try {
      const latest = getLatestMemoryCheckpoint(this.memoryDb, {
        repoId: this.repoId,
        sessionId: this.sessionId,
        kind: "autosave"
      });
      const candidate = buildSessionCheckpointCandidate(listSessionEvents(this.db, this.sessionId, this.repoId), {
        repoId: this.repoId,
        repoName: this._repoDisplayName(),
        sessionId: this.sessionId,
        lastCheckpointAt: latest?.lastEventAt ?? 0,
        force
      });
      if (!candidate) {
        return null;
      }

      const entry = storeMemoryEntry(this.memoryDb, candidate);
      const diary = storeDiaryEntry(this.memoryDb, buildDiaryFromCheckpoint(candidate));
      const checkpoint = recordMemoryCheckpoint(this.memoryDb, {
        repoId: this.repoId,
        sessionId: this.sessionId,
        kind: "autosave",
        lastEventId: candidate.lastEventId,
        lastEventAt: candidate.lastEventAt,
        entryId: entry?.entryId ?? null
      });

      return {
        entryId: entry?.entryId ?? null,
        diaryId: diary?.diaryId ?? null,
        checkpointId: checkpoint.checkpointId,
        eventCount: candidate.eventCount
      };
    } catch {
      return null;
    }
  }

  areas(query = "") {
    this.ensureRepositoryIndexed({ reason: "areas" });
    const state = this._loadRepoState();
    const overview = this._buildInventoryOverview(query, {
      fallbackQuery: "repo areas packages directories modules responsibilities"
    });
    const areas = buildAreaCatalog({
      topLevel: overview.topLevel,
      packages: overview.packages,
      files: overview.files,
      symbols: state.symbols,
      edges: state.edges,
      entrypoints: overview.entrypoints
    });

    return {
      repoId: this.repoId,
      areaCount: areas.length,
      indexedMemory: this._buildIndexedMemoryCoverage(),
      areas,
      summary: `Derived ${areas.length} repository area${areas.length === 1 ? "" : "s"} from the current index.`
    };
  }

  flows(query = "") {
    this.ensureRepositoryIndexed({ reason: "flows" });
    const state = this._loadRepoState();
    const overview = this._buildInventoryOverview(query, {
      fallbackQuery: "repo flows entrypoints execution paths"
    });
    const flows = buildFlowCatalog({
      files: overview.files,
      symbols: state.symbols,
      edges: state.edges,
      entrypoints: overview.entrypoints
    });

    return {
      repoId: this.repoId,
      flowCount: flows.length,
      indexedMemory: this._buildIndexedMemoryCoverage(),
      flows,
      summary: `Derived ${flows.length} execution flow${flows.length === 1 ? "" : "s"} from repository entrypoints.`
    };
  }

  graphSchema() {
    this.ensureRepositoryIndexed({ reason: "graph_schema" });
    const state = this._loadRepoState();
    const overview = this._buildInventoryOverview("", {
      fallbackQuery: "repo areas packages directories modules responsibilities"
    });
    const areas = buildAreaCatalog({
      topLevel: overview.topLevel,
      packages: overview.packages,
      files: overview.files,
      symbols: state.symbols,
      edges: state.edges,
      entrypoints: overview.entrypoints
    });
    const flows = buildFlowCatalog({
      files: overview.files,
      symbols: state.symbols,
      edges: state.edges,
      entrypoints: overview.entrypoints
    });
    const schema = buildGraphSchemaSummary({
      files: state.files,
      symbols: state.symbols,
      edges: state.edges,
      areas,
      flows
    });

    return {
      repoId: this.repoId,
      ...schema,
      indexedMemory: this._buildIndexedMemoryCoverage()
    };
  }

  changes(options: Record<string, any> = {}) {
    this.ensureRepositoryIndexed({ reason: "changes" });
    const scope = normalizeChangeScope(options.scope);
    const baseRef = options.baseRef ? String(options.baseRef) : null;
    const repoChanges = collectGitChanges(this.rootDir, scope, baseRef);
    const symbols = this._loadSymbols();
    const state = this._loadRepoState();
    const symbolIndex = new Map(symbols.map((symbol) => [symbol.symbolId, symbol]));
    const results = repoChanges.files.map((file) => {
      const matchingSymbols = symbols
        .filter((symbol) => this._relativePathForFile(symbol.fileId) === file.path)
        .filter((symbol) => !file.changedLines.length || intersectsAnyLineRange(symbol, file.changedLines));
      const impacted = unique(matchingSymbols.flatMap((symbol) =>
        computeImpact(symbol.symbolId, state.edges).slice(0, 8)
      ));
      const impactedSymbols = impacted
        .map((symbolId) => symbolIndex.get(symbolId))
        .filter((symbol): symbol is any => Boolean(symbol))
        .slice(0, 8)
        .map((symbol: any) => ({
          symbolId: symbol.symbolId,
          canonicalName: symbol.canonicalName,
          displayName: symbol.displayName,
          filePath: this._relativePathForFile(symbol.fileId)
        }));

      return {
        path: file.path,
        changeType: file.changeType,
        changedLines: file.changedLines,
        matchedSymbols: matchingSymbols.map((symbol) => ({
          symbolId: symbol.symbolId,
          canonicalName: symbol.canonicalName,
          displayName: symbol.displayName,
          startLine: symbol.startLine,
          endLine: symbol.endLine
        })),
        impactedSymbols
      };
    });

    return {
      scope,
      baseRef,
      changedFileCount: results.length,
      files: results,
      summary: `Detected ${results.length} changed file${results.length === 1 ? "" : "s"} and mapped them to indexed symbols and impact candidates.`
    };
  }

  rename(symbolQuery: string, newName: string, options: Record<string, any> = {}) {
    this.ensureRepositoryIndexed({ reason: "rename" });
    const normalizedQuery = String(symbolQuery ?? "").trim();
    const normalizedNewName = String(newName ?? "").trim();
    if (!normalizedQuery || !normalizedNewName) {
      throw new Error("forge_rename requires both symbolQuery and newName.");
    }

    const symbols = this._loadSymbols();
    const symbolById = new Map<string, any>(symbols.map((symbol) => [symbol.symbolId, symbol]));
    const [seed] = exactSymbolSearch(normalizedQuery, symbols, 1);
    if (!seed) {
      throw new Error(`Could not find a symbol matching "${normalizedQuery}".`);
    }

    const dryRun = coerceBoolean(options.dryRun, true);
    const wordBoundary = new RegExp(`\\b${escapeRegExp(seed.displayName)}\\b`, "g");
    const connectedFiles = new Set<string>();
    for (const edge of this._loadEdges()) {
      if (edge.fromSymbolId !== seed.symbolId && edge.toSymbolId !== seed.symbolId) {
        continue;
      }
      const relatedId = edge.fromSymbolId === seed.symbolId ? edge.toSymbolId : edge.fromSymbolId;
      const symbol = symbolById.get(relatedId);
      if (symbol) {
        connectedFiles.add(symbol.fileId);
      }
    }
    connectedFiles.add(seed.fileId);

    const conflictingSymbolsByFile = new Map<string, any[]>();
    for (const symbol of symbols) {
      if (symbol.displayName !== seed.displayName || symbol.symbolId === seed.symbolId) {
        continue;
      }
      if (!conflictingSymbolsByFile.has(symbol.fileId)) {
        conflictingSymbolsByFile.set(symbol.fileId, []);
      }
      conflictingSymbolsByFile.get(symbol.fileId).push(symbol);
    }

    if ((conflictingSymbolsByFile.get(seed.fileId) ?? []).length) {
      throw new Error(`Cannot safely rename "${seed.displayName}" because ${this._relativePathForFile(seed.fileId)} contains multiple symbols with that name.`);
    }

    const edits: any[] = [];
    const changedPaths: string[] = [];
    const skippedFiles: any[] = [];
    for (const file of this._loadIndexedFiles({ includeContent: true })) {
      if (file.contentKind !== "text" || !file.contentLoaded || !file.content) {
        continue;
      }
      if (!connectedFiles.has(file.fileId)) {
        continue;
      }
      const conflicts = conflictingSymbolsByFile.get(file.fileId) ?? [];
      if (conflicts.length) {
        skippedFiles.push({
          path: file.relativePath,
          reason: "conflicting_same_name_symbol",
          conflictingSymbols: conflicts.slice(0, 4).map((symbol: any) => ({
            symbolId: symbol.symbolId,
            canonicalName: symbol.canonicalName,
            displayName: symbol.displayName
          }))
        });
        continue;
      }
      const matches = [...file.content.matchAll(wordBoundary)];
      if (!matches.length) {
        continue;
      }
      const filePath = file.relativePath;
      const confidence = file.fileId === seed.fileId || connectedFiles.has(file.fileId) ? "graph" : "text_search";
      edits.push({
        path: filePath,
        replacements: matches.length,
        confidence,
        preview: buildExcerptAroundIndex(
          file.content.replace(wordBoundary, normalizedNewName),
          matches[0]?.index ?? 0,
          { contextLines: 1, maxLines: 6 }
        )
      });

      if (!dryRun) {
        const resolved = this._resolveWorkspacePath(filePath);
        writeText(resolved, file.content.replace(wordBoundary, normalizedNewName));
        changedPaths.push(filePath);
      }
    }

    const indexSync = dryRun || !changedPaths.length
      ? null
      : this._syncChangedPaths(changedPaths, { reason: "rename" });

    return {
      symbol: {
        symbolId: seed.symbolId,
        canonicalName: seed.canonicalName,
        displayName: seed.displayName,
        filePath: this._relativePathForFile(seed.fileId)
      },
      newName: normalizedNewName,
      dryRun,
      editCount: edits.length,
      edits,
      skippedFiles,
      indexSync,
      summary: `${dryRun ? "Planned" : "Applied"} coordinated rename for ${seed.displayName} across ${edits.length} safe file${edits.length === 1 ? "" : "s"}${skippedFiles.length ? ` while skipping ${skippedFiles.length} ambiguous file${skippedFiles.length === 1 ? "" : "s"}` : ""}.`
    };
  }

  listRepos() {
    const repos = listRegisteredRepositories();
    return {
      repos: repos.map((repo) => this._publicRegisteredRepo(repo)),
      summary: `ContextForge knows about ${repos.length} indexed repositor${repos.length === 1 ? "y" : "ies"}.`
    };
  }

  groupCreate(name) {
    const group = createRepoGroup(name);
    return {
      group: this._publicRepoGroup(group),
      summary: `Created or reused repo group ${group.name}.`
    };
  }

  groupAdd(name, repoRef) {
    const group = addRepoToGroup(name, repoRef);
    return {
      group: this._publicRepoGroup(group),
      summary: `Group ${group.name} now tracks ${group.repos.length} repositor${group.repos.length === 1 ? "y" : "ies"}.`
    };
  }

  groupRemove(name, repoRef) {
    const group = removeRepoFromGroup(name, repoRef);
    return {
      group: this._publicRepoGroup(group),
      summary: `Group ${group.name} now tracks ${group.repos.length} repositor${group.repos.length === 1 ? "y" : "ies"}.`
    };
  }

  groupList(name = null) {
    const groups = listRepoGroups(name ?? null);
    return {
      groups: Array.isArray(groups)
        ? groups.map((group) => this._publicRepoGroup(group))
        : groups
        ? this._publicRepoGroup(groups)
        : null,
      summary: Array.isArray(groups)
        ? `Found ${groups.length} repo group${groups.length === 1 ? "" : "s"}.`
        : groups
        ? `Loaded repo group ${groups.name}.`
        : `No repo group found for ${name}.`
    };
  }

  groupQuery(name: string, query: string, options: Record<string, any> = {}) {
    const group = listRepoGroups(name);
    if (!group) {
      throw new Error(`Unknown repo group: ${name}`);
    }
    const limit = clampNumber(options.limit, 1, 10, 4);
    const results = [];

    for (const repo of group.repos ?? []) {
      const resolvedRepo = resolveRegisteredRepository(repo.repoId) ?? resolveRegisteredRepository(repo.name);
      if (!resolvedRepo?.rootPath) {
        results.push({
          repo: this._publicRegisteredRepo(repo),
          matches: [],
          unavailable: true
        });
        continue;
      }
      const nested = createContextForge(resolvedRepo.rootPath, {
        sessionId: this.sessionId,
        memoryRoot: this.memoryRoot
      });
      try {
        const matches = nested.search(query, { limit });
        results.push({
          repo: this._publicRegisteredRepo(resolvedRepo),
          matches
        });
      } finally {
        nested.close();
      }
    }

    return {
      group: group.name,
      repoCount: (group.repos ?? []).length,
      query,
      results,
      summary: `Searched ${group.name} across ${(group.repos ?? []).length} repositor${(group.repos ?? []).length === 1 ? "y" : "ies"}.`
    };
  }

  groupStatus(name) {
    const group = listRepoGroups(name);
    if (!group) {
      throw new Error(`Unknown repo group: ${name}`);
    }

    const repos = (group.repos ?? []).map((repo) => {
      const resolvedRepo = resolveRegisteredRepository(repo.repoId) ?? resolveRegisteredRepository(repo.name);
      if (!resolvedRepo?.rootPath) {
        return {
          ...this._publicRegisteredRepo(repo),
          indexStatus: "unavailable",
          indexedFileCount: 0,
          fileCount: 0,
          contentCoverage: {
            complete: false,
            status: "unavailable"
          }
        };
      }
      const nested = createContextForge(resolvedRepo.rootPath, {
        sessionId: this.sessionId,
        memoryRoot: this.memoryRoot
      });
      try {
        const row = nested._readRepositoryRow();
        const counts = nested._repoCounts();
        return {
          ...this._publicRegisteredRepo(resolvedRepo),
          indexStatus: row?.indexStatus ?? "idle",
          indexedFileCount: row?.indexedFileCount ?? counts.filesIndexed,
          fileCount: row?.fileCount ?? counts.filesIndexed,
          contentCoverage: nested._buildIndexedMemoryCoverage(row)
        };
      } finally {
        nested.close();
      }
    });

    return {
      group: group.name,
      repos,
      summary: `Loaded status for ${repos.length} repositor${repos.length === 1 ? "y" : "ies"} in ${group.name}.`
    };
  }

  map(query = "", options: Record<string, any> = {}) {
    const overview = this.scan(query);
    const areas = this.areas(query);
    const flows = this.flows(query);
    const persist = coerceBoolean(options.persist, true);
    const markdown = this._buildMapArtifact({
      overview,
      areas: areas.areas,
      flows: flows.flows
    });
    const artifactPath = persist ? this._persistGeneratedArtifact("map.md", markdown) : null;
    return {
      path: artifactPath,
      persisted: persist,
      markdown,
      summary: persist
        ? `Generated repository map at ${artifactPath}.`
        : "Rendered repository map without writing a generated artifact."
    };
  }

  wiki(query = "", options: Record<string, any> = {}) {
    const overview = this.scan(query);
    const areas = this.areas(query);
    const flows = this.flows(query);
    const persist = coerceBoolean(options.persist, true);
    const contracts = this.contracts(query, { persist: false });
    const markdown = this._buildWikiArtifact({
      overview,
      areas: areas.areas,
      flows: flows.flows,
      contracts: contracts.contracts
    });
    const artifactPath = persist ? this._persistGeneratedArtifact("wiki.md", markdown) : null;
    return {
      path: artifactPath,
      persisted: persist,
      markdown,
      summary: persist
        ? `Generated repository wiki at ${artifactPath}.`
        : "Rendered repository wiki without writing a generated artifact."
    };
  }

  contracts(query = "", options: Record<string, any> = {}) {
    this.ensureRepositoryIndexed({ reason: "contracts" });
    const state = this._loadRepoState();
    const overview = this._buildInventoryOverview(query, {
      fallbackQuery: "integration contracts package boundaries imports calls"
    });
    const persist = coerceBoolean(options.persist, true);
    const contracts = summarizeContracts({
      files: overview.files,
      symbols: state.symbols,
      edges: state.edges
    });
    const markdown = this._buildContractsArtifact(contracts);
    const artifactPath = persist ? this._persistGeneratedArtifact("contracts.md", markdown) : null;
    return {
      path: artifactPath,
      contracts,
      persisted: persist,
      markdown,
      summary: persist
        ? `Generated ${contracts.length} cross-area contract${contracts.length === 1 ? "" : "s"} at ${artifactPath}.`
        : `Rendered ${contracts.length} cross-area contract${contracts.length === 1 ? "" : "s"} without writing a generated artifact.`
    };
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
             kind, language, span_start AS spanStart, span_end AS spanEnd, start_line AS startLine, end_line AS endLine,
             parent_symbol_id AS parentSymbolId, symbol_hash AS symbolHash, body
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
      "language",
      "content_kind AS contentKind",
      "content_loaded AS contentLoaded",
      "byte_count AS byteCount",
      "line_count AS lineCount"
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
    if (file.contentKind === "binary") {
      return {
        parseStatus: "binary",
        parseError: null,
        symbols: [],
        chunks: []
      };
    }

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
      INSERT OR REPLACE INTO files (file_id, repo_id, file_path, file_hash, content, content_kind, content_loaded, byte_count, line_count, language, parse_status, parse_error, updated_at)
      VALUES (@fileId, @repoId, @filePath, @fileHash, @content, @contentKind, @contentLoaded, @byteCount, @lineCount, @language, @parseStatus, @parseError, @updatedAt)
    `);
    const insertSymbol = this.db.prepare(`
      INSERT OR REPLACE INTO symbols (symbol_id, repo_id, file_id, canonical_name, display_name, kind, language, span_start, span_end, start_line, end_line, parent_symbol_id, symbol_hash, body)
      VALUES (@symbolId, @repoId, @fileId, @canonicalName, @displayName, @kind, @language, @spanStart, @spanEnd, @startLine, @endLine, @parentSymbolId, @symbolHash, @body)
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
      contentKind: file.contentKind ?? "text",
      contentLoaded: file.contentLoaded ? 1 : 0,
      byteCount: file.byteCount ?? Buffer.byteLength(String(file.content ?? ""), "utf8"),
      lineCount: file.lineCount ?? normalizeFileLines(String(file.content ?? "")).length,
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

  _rebuildDerivedStateFromIndex(options: Record<string, any> = {}) {
    const files = this._loadIndexedFiles({ includeContent: true, includeHashes: true });
    const symbols = this._loadSymbols();
    const pdgEdges = [
      ...extractImportEdges({ repoId: this.repoId, symbols, files }),
      ...extractCallEdges({ repoId: this.repoId, symbols, files }),
      ...extractControlEdges({ repoId: this.repoId, symbols }),
      ...extractDataFlowEdges({ repoId: this.repoId, symbols })
    ];
    const raptorNodes = buildRaptorTree({ repoId: this.repoId, files, symbols });
    const structuralGraph = buildRepoGraph({
      repoId: this.repoId,
      files,
      symbols,
      pdgEdges,
      raptorNodes
    });
    const allEdges = structuralGraph.edges;
    const repoFingerprint = this._computeRepoFingerprint(files);
    const memoryMetrics = this._buildIndexedMemoryCoverage();

    this.db.prepare(`DELETE FROM symbol_edges WHERE repo_id = ?`).run(this.repoId);
    this.db.prepare(`DELETE FROM raptor_nodes WHERE repo_id = ?`).run(this.repoId);

    const insertEdge = this.db.prepare(`
      INSERT OR REPLACE INTO symbol_edges (edge_id, repo_id, from_symbol_id, to_symbol_id, edge_type, confidence, provenance_source)
      VALUES (@edgeId, @repoId, @fromSymbolId, @toSymbolId, @edgeType, @confidence, @provenanceSource)
    `);
    for (const edge of allEdges) {
      insertEdge.run(edge);
    }

    const insertRaptor = this.db.prepare(`
      INSERT OR REPLACE INTO raptor_nodes (node_id, repo_id, parent_node_id, node_type, label, summary, token_budget, source_item_type, source_item_id, cache_state)
      VALUES (@nodeId, @repoId, @parentNodeId, @nodeType, @label, @summary, @tokenBudget, @sourceItemType, @sourceItemId, @cacheState)
    `);
    for (const node of raptorNodes) {
      insertRaptor.run(node);
    }

    const completedAt = Date.now();
    this._writeRepositoryRow({
      contentFingerprint: repoFingerprint,
      quickRepoStamp: options.quickRepoStamp ?? this._quickRepoStamp ?? null,
      fileCount: files.length,
      indexedFileCount: files.length,
      indexStatus: "ready",
      pendingDerivedState: 0,
      lastIndexError: null,
      batchSize: options.batchSize ?? this._readRepositoryRow()?.batchSize ?? null,
      indexedTextFileCount: memoryMetrics.textFilesIndexed,
      indexedBinaryFileCount: memoryMetrics.binaryFilesIndexed,
      indexedLineCount: memoryMetrics.indexedLineCount,
      indexedByteCount: memoryMetrics.indexedByteCount,
      indexedAt: completedAt,
      lastIndexStartedAt: options.startedAt ?? this._readRepositoryRow()?.lastIndexStartedAt ?? completedAt,
      lastIndexCompletedAt: completedAt
    });
    const contentCoverage = this._buildIndexedMemoryCoverage();
    const summary = {
      repoFingerprint,
      filesIndexed: files.length,
      symbolsIndexed: symbols.length,
      chunksIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?`).get(this.repoId).count,
      edgesIndexed: allEdges.length,
      raptorNodesIndexed: raptorNodes.length,
      contentCoverage
    };
    this._registerIndexedRepo(summary);

    return summary;
  }

  _buildWhySeeds(state: any, query: string): WhySeed[] {
    if (!query) {
      return [];
    }

    const nodeIndex = new Map<string, any>(state.repoGraph.nodes.map((node: any) => [node.id, node]));
    const seeds: WhySeed[] = [];
    const seen = new Set<string>();
    const addSeed = ({ id, label, type, source, score = 0 }: { id?: string | null; label?: string | null; type?: string | null; source?: string | null; score?: number }) => {
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
      const candidateId = item.symbolId ?? item.fileId ?? (item.id && nodeIndex.has(item.id) ? item.id : null);
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

  _rankWhyGraph(repoGraph: any, seeds: WhySeed[]) {
    if (!seeds.length) {
      return [];
    }

    const nodeIndex = new Map<string, any>(repoGraph.nodes.map((node: any) => [node.id, node]));
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

    return searchSessionEvents(this.db, {
      repoId: this.repoId,
      sessionId: this.sessionId,
      query,
      limit: 5,
      seedFiles,
      seedSymbols,
      seedHints
    }).filter((event) => !SYSTEM_EVENT_TYPES.has(event.eventType));
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

  _consumeDirtyPaths(): string[] {
    const paths = [...this._dirtyPaths];
    this._dirtyPaths.clear();
    return paths;
  }

  _resolveIndexBatchSize(requestedBatchSize, fileCount = 0) {
    const raw = Number.parseInt(requestedBatchSize ?? process.env.CONTEXTFORGE_INDEX_BATCH_SIZE ?? "", 10);
    const normalized = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INDEX_BATCH_SIZE;
    const clamped = Math.max(1, Math.min(512, normalized));
    if (!fileCount) {
      return clamped;
    }
    return Math.max(1, Math.min(clamped, fileCount));
  }

  _readRepositoryRow(): RepositoryRow | null {
    return this.db.prepare(`
      SELECT
        content_fingerprint AS contentFingerprint,
        quick_repo_stamp AS quickRepoStamp,
        file_count AS fileCount,
        indexed_file_count AS indexedFileCount,
        index_status AS indexStatus,
        pending_derived_state AS pendingDerivedState,
        last_index_error AS lastIndexError,
        batch_size AS batchSize,
        indexed_text_file_count AS indexedTextFileCount,
        indexed_binary_file_count AS indexedBinaryFileCount,
        indexed_line_count AS indexedLineCount,
        indexed_byte_count AS indexedByteCount,
        indexed_at AS indexedAt,
        last_index_started_at AS lastIndexStartedAt,
        last_index_completed_at AS lastIndexCompletedAt
      FROM repositories
      WHERE repo_id = ?
    `).get(this.repoId) ?? null;
  }

  _writeRepositoryRow(fields: Partial<RepositoryRow> = {}) {
    const current: RepositoryRow = this._readRepositoryRow() ?? {};
    const payload = {
      repoId: this.repoId,
      rootPath: this.rootDir,
      defaultBranch: "main",
      contentFingerprint: fields.contentFingerprint ?? current.contentFingerprint ?? null,
      quickRepoStamp: fields.quickRepoStamp ?? current.quickRepoStamp ?? null,
      fileCount: fields.fileCount ?? current.fileCount ?? 0,
      indexedFileCount: fields.indexedFileCount ?? current.indexedFileCount ?? 0,
      indexStatus: fields.indexStatus ?? current.indexStatus ?? "idle",
      pendingDerivedState: Number(fields.pendingDerivedState ?? current.pendingDerivedState ?? 0),
      lastIndexError: fields.lastIndexError ?? current.lastIndexError ?? null,
      batchSize: fields.batchSize ?? current.batchSize ?? null,
      indexedTextFileCount: fields.indexedTextFileCount ?? current.indexedTextFileCount ?? 0,
      indexedBinaryFileCount: fields.indexedBinaryFileCount ?? current.indexedBinaryFileCount ?? 0,
      indexedLineCount: fields.indexedLineCount ?? current.indexedLineCount ?? 0,
      indexedByteCount: fields.indexedByteCount ?? current.indexedByteCount ?? 0,
      indexedAt: fields.indexedAt ?? current.indexedAt ?? null,
      lastIndexStartedAt: fields.lastIndexStartedAt ?? current.lastIndexStartedAt ?? null,
      lastIndexCompletedAt: fields.lastIndexCompletedAt ?? current.lastIndexCompletedAt ?? null
    };

    this.db.prepare(`
      INSERT INTO repositories (
        repo_id,
        root_path,
        default_branch,
        content_fingerprint,
        quick_repo_stamp,
        file_count,
        indexed_file_count,
        index_status,
        pending_derived_state,
        last_index_error,
        batch_size,
        indexed_text_file_count,
        indexed_binary_file_count,
        indexed_line_count,
        indexed_byte_count,
        indexed_at,
        last_index_started_at,
        last_index_completed_at
      )
      VALUES (
        @repoId,
        @rootPath,
        @defaultBranch,
        @contentFingerprint,
        @quickRepoStamp,
        @fileCount,
        @indexedFileCount,
        @indexStatus,
        @pendingDerivedState,
        @lastIndexError,
        @batchSize,
        @indexedTextFileCount,
        @indexedBinaryFileCount,
        @indexedLineCount,
        @indexedByteCount,
        @indexedAt,
        @lastIndexStartedAt,
        @lastIndexCompletedAt
      )
      ON CONFLICT(repo_id) DO UPDATE SET
        root_path = excluded.root_path,
        default_branch = excluded.default_branch,
        content_fingerprint = excluded.content_fingerprint,
        quick_repo_stamp = excluded.quick_repo_stamp,
        file_count = excluded.file_count,
        indexed_file_count = excluded.indexed_file_count,
        index_status = excluded.index_status,
        pending_derived_state = excluded.pending_derived_state,
        last_index_error = excluded.last_index_error,
        batch_size = excluded.batch_size,
        indexed_text_file_count = excluded.indexed_text_file_count,
        indexed_binary_file_count = excluded.indexed_binary_file_count,
        indexed_line_count = excluded.indexed_line_count,
        indexed_byte_count = excluded.indexed_byte_count,
        indexed_at = excluded.indexed_at,
        last_index_started_at = excluded.last_index_started_at,
        last_index_completed_at = excluded.last_index_completed_at
    `).run(payload);
  }

  _buildIndexProgressSummary(row: RepositoryRow | null = this._readRepositoryRow(), counts: RepoCounts = this._repoCounts()) {
    const contentCoverage = this._buildIndexedMemoryCoverage(row);
    return {
      repoId: this.repoId,
      ...counts,
      reusedIndex: row?.indexStatus === "ready" && counts.filesIndexed > 0,
      fingerprint: row?.contentFingerprint ?? null,
      quickRepoStamp: row?.quickRepoStamp ?? null,
      indexStatus: row?.indexStatus ?? "idle",
      indexedFileCount: row?.indexedFileCount ?? counts.filesIndexed,
      filesTotal: row?.fileCount ?? counts.filesIndexed,
      pendingDerivedState: Boolean(row?.pendingDerivedState),
      batchSize: row?.batchSize ?? null,
      lastIndexError: row?.lastIndexError ?? null,
      contentCoverage
    };
  }

  _buildIndexedMemoryCoverage(row: RepositoryRow | null = this._readRepositoryRow()) {
    const metrics = this.db.prepare(`
      SELECT
        COUNT(*) AS filesIndexed,
        COALESCE(SUM(CASE WHEN content_kind = 'text' THEN 1 ELSE 0 END), 0) AS textFilesIndexed,
        COALESCE(SUM(CASE WHEN content_kind = 'binary' THEN 1 ELSE 0 END), 0) AS binaryFilesIndexed,
        COALESCE(SUM(CASE WHEN content_kind = 'text' AND content_loaded = 1 THEN 1 ELSE 0 END), 0) AS fullTextBodiesStored,
        COALESCE(SUM(CASE WHEN content_kind = 'binary' AND byte_count > 0 THEN 1 ELSE 0 END), 0) AS binaryAssetsScanned,
        COALESCE(SUM(line_count), 0) AS indexedLineCount,
        COALESCE(SUM(byte_count), 0) AS indexedByteCount
      FROM files
      WHERE repo_id = ?
    `).get(this.repoId);

    const filesTotal = row?.fileCount ?? metrics.filesIndexed ?? 0;
    const indexStatus = row?.indexStatus ?? "idle";
    const awaitingSync = this._inventoryDirty || this._dirtyPaths.size > 0;
    const allFilesPersisted = filesTotal > 0 && metrics.filesIndexed === filesTotal;
    const allTextBodiesPersisted = metrics.textFilesIndexed === metrics.fullTextBodiesStored;
    const allBinaryAssetsScanned = metrics.binaryFilesIndexed === metrics.binaryAssetsScanned;
    const complete = indexStatus === "ready" && allFilesPersisted && allTextBodiesPersisted && allBinaryAssetsScanned;

    return {
      filesTotal,
      filesIndexed: metrics.filesIndexed,
      textFilesIndexed: metrics.textFilesIndexed,
      binaryFilesIndexed: metrics.binaryFilesIndexed,
      fullTextBodiesStored: metrics.fullTextBodiesStored,
      binaryAssetsScanned: metrics.binaryAssetsScanned,
      indexedLineCount: metrics.indexedLineCount,
      indexedByteCount: metrics.indexedByteCount,
      allFilesPersisted,
      allTextBodiesPersisted,
      allBinaryAssetsScanned,
      complete,
      status: complete ? "complete" : indexStatus,
      awaitingSync,
      canAnswerYesToRememberingWholeProject: complete && !awaitingSync,
      reminder: complete
        ? "ContextForge currently has the full text of every indexed text file stored in its local repository memory."
        : "ContextForge may have read the repo for an audit, but it should not claim complete remembered coverage until indexed memory reaches ready/complete."
    };
  }

  _buildDeferredIndexFallback({ reason = "tool", status = null, estimatedFileCount = null, note = null } = {}) {
    try {
      const row = this._readRepositoryRow();
      const counts = this._repoCounts();
      return {
        ...this._buildIndexProgressSummary(row, counts),
        syncReason: reason,
        status: status ?? this._deferredIndexState?.status ?? row?.indexStatus ?? "warming",
        deferred: true,
        estimatedFileCount: estimatedFileCount ?? this._deferredIndexState?.estimatedFileCount ?? row?.fileCount ?? counts.filesIndexed,
        batchSize: row?.batchSize ?? null,
        note: note ?? "ContextForge is still warming the repository index in the background."
      };
    } catch (error) {
      if (!isDatabaseLockError(error)) {
        throw error;
      }
    }

    const filesTotal = estimatedFileCount ?? this._deferredIndexState?.estimatedFileCount ?? 0;
    const effectiveStatus = status ?? this._deferredIndexState?.status ?? "warming";
    return {
      repoId: this.repoId,
      filesIndexed: 0,
      symbolsIndexed: 0,
      chunksIndexed: 0,
      edgesIndexed: 0,
      raptorNodesIndexed: 0,
      reusedIndex: false,
      fingerprint: null,
      quickRepoStamp: null,
      indexStatus: effectiveStatus === "error" ? "error" : "warming",
      indexedFileCount: 0,
      filesTotal,
      pendingDerivedState: true,
      batchSize: null,
      lastIndexError: null,
      contentCoverage: {
        status: effectiveStatus === "error" ? "error" : "warming",
        complete: false,
        filesTotal,
        filesIndexed: 0,
        textFilesIndexed: 0,
        binaryFilesIndexed: 0,
        fullTextBodiesStored: 0,
        binaryAssetsScanned: 0,
        indexedLineCount: 0,
        indexedByteCount: 0,
        allFilesPersisted: false,
        allTextBodiesPersisted: false,
        allBinaryAssetsScanned: false,
        awaitingSync: true,
        canAnswerYesToRememberingWholeProject: false,
        reminder: "ContextForge is still warming the persistent index, so it should not claim complete remembered coverage yet."
      },
      syncReason: reason,
      status: effectiveStatus,
      deferred: true,
      estimatedFileCount: filesTotal,
      note: note ?? "ContextForge is still warming the repository index in the background."
    };
  }

  _canReuseIndex(quickRepoStamp, fileCount) {
    const row = this._readRepositoryRow();

    if (!row || row.indexStatus !== "ready" || row.quickRepoStamp !== quickRepoStamp || row.fileCount !== fileCount) {
      return false;
    }

    const counts = this._repoCounts();
    const coverage = this._buildIndexedMemoryCoverage(row);
    return counts.filesIndexed === fileCount && counts.symbolsIndexed > 0 && counts.chunksIndexed > 0 && coverage.complete;
  }

  _indexRepositoryInBatches(inventoryFiles, { quickRepoStamp, batchSize }) {
    const totalFiles = inventoryFiles.length;
    const startedAt = Date.now();
    const batchCount = totalFiles ? Math.ceil(totalFiles / batchSize) : 0;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this._clearRepoData();
      this._writeRepositoryRow({
        contentFingerprint: null,
        quickRepoStamp,
        fileCount: totalFiles,
        indexedFileCount: 0,
        indexStatus: totalFiles ? "indexing" : "ready",
        pendingDerivedState: totalFiles ? 1 : 0,
        lastIndexError: null,
        batchSize,
        indexedTextFileCount: 0,
        indexedBinaryFileCount: 0,
        indexedLineCount: 0,
        indexedByteCount: 0,
        indexedAt: null,
        lastIndexStartedAt: startedAt,
        lastIndexCompletedAt: totalFiles ? null : startedAt
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    let processed = 0;

    try {
      for (let index = 0; index < inventoryFiles.length; index += batchSize) {
        const batch = inventoryFiles.slice(index, index + batchSize);
        this.db.exec("BEGIN IMMEDIATE");
        try {
          for (const entry of batch) {
            const file = loadRepositoryFile(this.rootDir, this.repoId, entry.absolutePath);
            this._upsertIndexedFile(file);
          }
          processed += batch.length;
          this._writeRepositoryRow({
            quickRepoStamp,
            fileCount: totalFiles,
            indexedFileCount: processed,
            indexStatus: processed < totalFiles ? "indexing" : "deriving",
            pendingDerivedState: 1,
            lastIndexError: null,
            batchSize,
            indexedTextFileCount: this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN content_kind = 'text' THEN 1 ELSE 0 END), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
            indexedBinaryFileCount: this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN content_kind = 'binary' THEN 1 ELSE 0 END), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
            indexedLineCount: this.db.prepare(`SELECT COALESCE(SUM(line_count), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
            indexedByteCount: this.db.prepare(`SELECT COALESCE(SUM(byte_count), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
            indexedAt: null,
            lastIndexStartedAt: startedAt,
            lastIndexCompletedAt: null
          });
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }

      this.db.exec("BEGIN IMMEDIATE");
      let summary;
      try {
        summary = this._rebuildDerivedStateFromIndex({
          quickRepoStamp,
          batchSize,
          startedAt
        });
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }

      this._invalidateRepoCaches();
      this._markRepoSynced();
      this.repoFingerprint = summary.repoFingerprint;
      this._quickRepoStamp = quickRepoStamp;
      this._ensureWatcher();

      this._recordSessionEvent({
        repoId: this.repoId,
        sessionId: this.sessionId,
        eventType: "index",
        payload: {
          fileCount: totalFiles,
          symbolCount: summary.symbolsIndexed,
          chunkCount: summary.chunksIndexed,
          fingerprint: summary.repoFingerprint,
          batchSize,
          batchCount
        }
      });

      return {
        repoId: this.repoId,
        filesIndexed: summary.filesIndexed,
        symbolsIndexed: summary.symbolsIndexed,
        chunksIndexed: summary.chunksIndexed,
        edgesIndexed: summary.edgesIndexed,
        raptorNodesIndexed: summary.raptorNodesIndexed,
        reusedIndex: false,
        fingerprint: summary.repoFingerprint,
        quickRepoStamp,
        indexStatus: "ready",
        contentCoverage: summary.contentCoverage,
        batchSize,
        batchCount
      };
    } catch (error) {
      this._writeRepositoryRow({
        quickRepoStamp,
        fileCount: totalFiles,
        indexedFileCount: processed,
        indexStatus: "error",
        pendingDerivedState: 1,
        lastIndexError: error.message,
        batchSize,
        indexedTextFileCount: this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN content_kind = 'text' THEN 1 ELSE 0 END), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
        indexedBinaryFileCount: this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN content_kind = 'binary' THEN 1 ELSE 0 END), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
        indexedLineCount: this.db.prepare(`SELECT COALESCE(SUM(line_count), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
        indexedByteCount: this.db.prepare(`SELECT COALESCE(SUM(byte_count), 0) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
        indexedAt: null,
        lastIndexStartedAt: startedAt,
        lastIndexCompletedAt: null
      });
      throw error;
    }
  }

  _repoCounts(): RepoCounts {
    return {
      filesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM files WHERE repo_id = ?`).get(this.repoId).count,
      symbolsIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM symbols WHERE repo_id = ?`).get(this.repoId).count,
      chunksIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM chunks WHERE repo_id = ?`).get(this.repoId).count,
      edgesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM symbol_edges WHERE repo_id = ?`).get(this.repoId).count,
      raptorNodesIndexed: this.db.prepare(`SELECT COUNT(*) AS count FROM raptor_nodes WHERE repo_id = ?`).get(this.repoId).count
    };
  }

  _repoDisplayName() {
    const packageInfo = this._readPackageInfo();
    return packageInfo?.name ?? path.basename(this.rootDir);
  }

  _registerIndexedRepo(summary: Record<string, any> = {}) {
    try {
      registerIndexedRepository({
        name: this._repoDisplayName(),
        rootPath: this.rootDir,
        repoId: this.repoId,
        fileCount: summary.filesIndexed ?? this._repoCounts().filesIndexed,
        symbolCount: summary.symbolsIndexed ?? this._repoCounts().symbolsIndexed,
        edgeCount: summary.edgesIndexed ?? this._repoCounts().edgesIndexed,
        raptorNodeCount: summary.raptorNodesIndexed ?? this._repoCounts().raptorNodesIndexed,
        indexStatus: summary.indexStatus ?? "ready",
        indexedAt: Date.now()
      });
    } catch {
      // Registry failures should never block normal repository work.
    }
  }

  _publicRegisteredRepo(repo: RegisteredRepoSummary = {}) {
    return {
      name: repo.name,
      repoId: repo.repoId,
      fileCount: Number(repo.fileCount ?? 0),
      symbolCount: Number(repo.symbolCount ?? 0),
      edgeCount: Number(repo.edgeCount ?? 0),
      raptorNodeCount: Number(repo.raptorNodeCount ?? 0),
      indexStatus: repo.indexStatus ?? "ready",
      indexedAt: repo.indexedAt ?? null
    };
  }

  _publicRepoGroup(group = null) {
    if (!group) {
      return null;
    }
    return {
      name: group.name,
      repos: (group.repos ?? []).map((repo) => this._publicRegisteredRepo(repo)),
      createdAt: group.createdAt ?? null,
      updatedAt: group.updatedAt ?? null
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

  _startupDeferThreshold() {
    const raw = Number.parseInt(process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STARTUP_DEFER_FILE_THRESHOLD;
  }

  _shouldDeferStartupPrime(task) {
    const counts = this._repoCounts();
    if (counts.filesIndexed > 0 && counts.chunksIndexed > 0) {
      return false;
    }

    const repoRow = this._readRepositoryRow();
    if (this._deferredIndexChild ||
      ["queued", "warming"].includes(this._deferredIndexState?.status) ||
      ["warming", "indexing", "deriving"].includes(repoRow?.indexStatus)) {
      return true;
    }

    if (task.label === "trivial" || task.loadStrategy === "minimal") {
      return false;
    }

    const inventory = this._loadRepoInventory();
    return inventory.files.length > this._startupDeferThreshold();
  }

  _queueDeferredStartupPrime(reason = "startup") {
    const inventory = this._loadRepoInventory();
    const estimatedFileCount = inventory.files.length;
    const quickRepoStamp = this._computeQuickRepoStamp(inventory.files);
    const batchSize = this._resolveIndexBatchSize(null, estimatedFileCount);

    if (!this._deferredIndexChild && !["queued", "warming"].includes(this._deferredIndexState?.status)) {
      this._deferredIndexState = {
        status: "queued",
        estimatedFileCount,
        syncReason: reason
      };
      try {
        this._writeRepositoryRow({
          quickRepoStamp,
          fileCount: estimatedFileCount,
          indexedFileCount: this._repoCounts().filesIndexed,
          indexStatus: "warming",
          pendingDerivedState: 1,
          lastIndexError: null,
          batchSize,
          indexedAt: null,
          lastIndexStartedAt: Date.now(),
          lastIndexCompletedAt: null
        });
      } catch (error) {
        if (!isDatabaseLockError(error)) {
          throw error;
        }
      }
      this._spawnDeferredStartupPrime(reason, estimatedFileCount, batchSize);
    }
    return this._buildDeferredIndexFallback({
      reason,
      status: this._deferredIndexState?.status ?? "queued",
      estimatedFileCount,
      note: "Large repository detected. ContextForge queued the full eager prime in the background so forge_start can return immediately."
    });
  }

  _spawnDeferredStartupPrime(reason, estimatedFileCount, batchSize) {
    const heapFlag = `--max-old-space-size=${this._backgroundHeapMb()}`;
    const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
    const child = spawn(process.execPath, [heapFlag, cliPath, "index", this.rootDir], {
      cwd: this.rootDir,
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        CONTEXTFORGE_INDEX_BATCH_SIZE: String(batchSize),
        CONTEXTFORGE_USE_ACTIVE_SESSION: "0",
        CONTEXTFORGE_REMEMBER_SESSION: "0"
      }
    });

    this._deferredIndexChild = child;
    this._deferredIndexState = {
      status: "warming",
      estimatedFileCount,
      syncReason: reason
    };

    child.unref?.();
    child.once("exit", (code) => {
      this._deferredIndexChild = null;
      if (this._closed) {
        return;
      }
      try {
        if (code === 0) {
          const row = this._readRepositoryRow();
          const counts = this._repoCounts();
          if (this._hasPendingDerivedState(row, counts)) {
            this._deferredIndexState = {
              status: "deriving",
              estimatedFileCount,
              syncReason: reason,
              ...this._buildIndexProgressSummary(row, counts),
              note: "Background prime finished file ingestion and re-queued the remaining derived-state rebuild."
            };
            this._spawnDeferredDerivedRepair(reason, estimatedFileCount, row?.batchSize ?? batchSize);
            return;
          }
          this._deferredIndexState = {
            status: row?.indexStatus ?? "ready",
            estimatedFileCount,
            syncReason: reason,
            ...this._buildIndexProgressSummary(row, counts)
          };
          return;
        }

        this._deferredIndexState = {
          status: "error",
          estimatedFileCount,
          syncReason: reason,
          error: `Background prime exited with code ${code ?? "unknown"}`
        };
      } catch (error) {
        if (!isDatabaseLockError(error)) {
          throw error;
        }
        this._deferredIndexState = {
          status: "warming",
          estimatedFileCount,
          syncReason: reason,
          note: "Background prime finished, but live progress could not be read because SQLite was temporarily write-locked."
        };
      }
    });
  }

  _backgroundHeapMb() {
    const raw = Number.parseInt(process.env.CONTEXTFORGE_BACKGROUND_HEAP_MB ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 8192;
  }

  _hasPendingDerivedState(repoRow, counts = this._repoCounts()) {
    if (!repoRow) {
      return false;
    }

    const pendingDerived = Boolean(repoRow.pendingDerivedState) || repoRow.indexStatus === "deriving";
    if (!pendingDerived) {
      return false;
    }

    return counts.filesIndexed > 0 && counts.chunksIndexed > 0;
  }

  _shouldDeferDerivedRepair(repoRow, counts = this._repoCounts()) {
    const raw = Number.parseInt(process.env.CONTEXTFORGE_INLINE_DERIVE_THRESHOLD ?? "", 10);
    const inlineThreshold = Number.isFinite(raw) && raw > 0 ? raw : 200;
    const fileCount = repoRow?.fileCount ?? counts.filesIndexed ?? 0;
    return fileCount > inlineThreshold || counts.symbolsIndexed > 5000 || counts.chunksIndexed > 5000;
  }

  _queueDeferredDerivedRepair(reason, repoRow, counts = this._repoCounts()) {
    const estimatedFileCount = repoRow?.fileCount ?? counts.filesIndexed ?? 0;
    const batchSize = repoRow?.batchSize ?? this._resolveIndexBatchSize(null, estimatedFileCount);

    if (!this._deferredIndexChild) {
      this._deferredIndexState = {
        status: "deriving",
        estimatedFileCount,
        syncReason: reason,
        note: "ContextForge detected a pending derived-state rebuild and re-queued it in the background."
      };
      this._spawnDeferredDerivedRepair(reason, estimatedFileCount, batchSize);
    }

    return {
      ...this._buildDeferredIndexFallback({
        reason,
        status: "deriving",
        estimatedFileCount,
        note: "ContextForge finished file ingestion earlier, but the derived graph/memory rebuild is still pending. It has been re-queued in the background."
      }),
      stalledDerivedState: true,
      repairQueued: true
    };
  }

  _spawnDeferredDerivedRepair(reason, estimatedFileCount, batchSize) {
    const heapFlag = `--max-old-space-size=${this._backgroundHeapMb()}`;
    const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
    const child = spawn(process.execPath, [heapFlag, cliPath, "derive", this.rootDir], {
      cwd: this.rootDir,
      stdio: "ignore",
      detached: true,
      env: {
        ...process.env,
        CONTEXTFORGE_INDEX_BATCH_SIZE: String(batchSize),
        CONTEXTFORGE_USE_ACTIVE_SESSION: "0",
        CONTEXTFORGE_REMEMBER_SESSION: "0"
      }
    });

    this._deferredIndexChild = child;
    this._deferredIndexState = {
      status: "deriving",
      estimatedFileCount,
      syncReason: reason
    };

    child.unref?.();
    child.once("exit", (code) => {
      this._deferredIndexChild = null;
      if (this._closed) {
        return;
      }
      try {
        const row = this._readRepositoryRow();
        const counts = this._repoCounts();
        this._deferredIndexState = {
          status: code === 0 ? row?.indexStatus ?? "ready" : "error",
          estimatedFileCount,
          syncReason: reason,
          ...this._buildIndexProgressSummary(row, counts),
          error: code === 0 ? undefined : `Background derive repair exited with code ${code ?? "unknown"}`
        };
      } catch (error) {
        if (!isDatabaseLockError(error)) {
          throw error;
        }
        this._deferredIndexState = {
          status: code === 0 ? "deriving" : "error",
          estimatedFileCount,
          syncReason: reason,
          note: code === 0
            ? "Background derive repair finished, but live progress could not be read because SQLite was temporarily write-locked."
            : "Background derive repair exited and SQLite was temporarily write-locked while checking progress."
        };
      }
    });
  }

  deriveRepository(options: Record<string, any> = {}) {
    const counts = this._repoCounts();
    if (!counts.filesIndexed || !counts.chunksIndexed) {
      return this.indexRepository({ force: options.force });
    }
    return this._resumePendingDerivedState({ reason: options.reason ?? "derive" });
  }

  _resumePendingDerivedState({ reason = "tool" } = {}) {
    const repoRow = this._readRepositoryRow();
    const counts = this._repoCounts();

    if (!this._hasPendingDerivedState(repoRow, counts)) {
      return {
        ...counts,
        repoId: this.repoId,
        reusedIndex: true,
        fingerprint: this.repoFingerprint ?? this._loadRepoFingerprint(),
        syncReason: reason,
        contentCoverage: this._buildIndexedMemoryCoverage(repoRow)
      };
    }

    const quickRepoStamp = repoRow?.quickRepoStamp ?? this._currentQuickRepoStamp();
    const startedAt = repoRow?.lastIndexStartedAt ?? Date.now();
    const batchSize = repoRow?.batchSize ?? this._resolveIndexBatchSize(null, repoRow?.fileCount ?? counts.filesIndexed);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const summary = this._rebuildDerivedStateFromIndex({
        quickRepoStamp,
        batchSize,
        startedAt
      });
      this.db.exec("COMMIT");

      this._invalidateRepoCaches();
      this._markRepoSynced();
      this.repoFingerprint = summary.repoFingerprint;
      this._quickRepoStamp = quickRepoStamp;
      this._ensureWatcher();

      const resumedSummary = {
        repoId: this.repoId,
        filesIndexed: summary.filesIndexed,
        symbolsIndexed: summary.symbolsIndexed,
        chunksIndexed: summary.chunksIndexed,
        edgesIndexed: summary.edgesIndexed,
        raptorNodesIndexed: summary.raptorNodesIndexed,
        reusedIndex: false,
        fingerprint: summary.repoFingerprint,
        quickRepoStamp,
        indexStatus: "ready",
        resumedDerivedState: true,
        syncReason: reason,
        contentCoverage: summary.contentCoverage
      };

      this._registerIndexedRepo(resumedSummary);
      this._recordSessionEvent({
        repoId: this.repoId,
        sessionId: this.sessionId,
        eventType: "derive_resume",
        payload: {
          reason,
          fileCount: summary.filesIndexed,
          symbolCount: summary.symbolsIndexed,
          edgeCount: summary.edgesIndexed,
          raptorNodeCount: summary.raptorNodesIndexed,
          fingerprint: summary.repoFingerprint
        }
      });

      return resumedSummary;
    } catch (error) {
      this.db.exec("ROLLBACK");
      const coverage = this._buildIndexedMemoryCoverage(repoRow);
      this._writeRepositoryRow({
        quickRepoStamp,
        fileCount: repoRow?.fileCount ?? counts.filesIndexed,
        indexedFileCount: counts.filesIndexed,
        indexStatus: "error",
        pendingDerivedState: 1,
        lastIndexError: error.message,
        batchSize,
        indexedTextFileCount: coverage.textFilesIndexed,
        indexedBinaryFileCount: coverage.binaryFilesIndexed,
        indexedLineCount: coverage.indexedLineCount,
        indexedByteCount: coverage.indexedByteCount,
        indexedAt: null,
        lastIndexStartedAt: startedAt,
        lastIndexCompletedAt: null
      });
      throw error;
    }
  }

  ensureRepositoryIndexed({ reason = "tool", force = false, eagerPrime = false } = {}) {
    let counts;
    let repoRow;
    try {
      counts = this._repoCounts();
      repoRow = this._readRepositoryRow();
    } catch (error) {
      if (!isDatabaseLockError(error)) {
        throw error;
      }
      return this._buildDeferredIndexFallback({
        reason,
        note: "ContextForge could not read live index progress because SQLite is temporarily write-locked. Returning the last known warm-up state."
      });
    }
    const hasIndex = counts.filesIndexed > 0 && counts.chunksIndexed > 0;
    const watcherAvailable = this._ensureWatcher();

    if (!force && hasIndex && !this._deferredIndexChild && this._hasPendingDerivedState(repoRow, counts)) {
      if (this._shouldDeferDerivedRepair(repoRow, counts)) {
        return this._queueDeferredDerivedRepair(reason, repoRow, counts);
      }
      return this._resumePendingDerivedState({ reason });
    }

    if (!force && !eagerPrime && ["warming", "indexing", "deriving"].includes(repoRow?.indexStatus) && hasIndex) {
      return {
        ...this._buildIndexProgressSummary(repoRow, counts),
        syncReason: reason,
        partial: repoRow.indexStatus !== "ready"
      };
    }

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
        syncReason: reason,
        contentCoverage: this._buildIndexedMemoryCoverage()
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
      totalLineCount: fileDigests.reduce((sum, file) => sum + (file.lineCount ?? 0), 0),
      totalByteCount: fileDigests.reduce((sum, file) => sum + (file.bytes ?? 0), 0),
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

  _syncChangedPaths(paths: Array<string | null | undefined>, { reason = "sync" }: Record<string, any> = {}) {
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
      })) as string[];

    if (!normalizedPaths.length) {
      return {
        ...this._repoCounts(),
        repoId: this.repoId,
        reusedIndex: true,
        fingerprint: this.repoFingerprint ?? this._loadRepoFingerprint(),
        syncReason: reason,
        syncMode: "noop",
        contentCoverage: this._buildIndexedMemoryCoverage()
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
        pathsChanged: normalizedPaths.length,
        contentCoverage: summary.contentCoverage
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      this._dirtyPaths = new Set<string>([...this._dirtyPaths, ...normalizedPaths]);
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

  _resolveWorkspacePath(targetPath: string, options: Record<string, any> = {}) {
    const input = String(targetPath ?? "").trim();
    if (!input) {
      throw new Error("A path is required.");
    }

    const resolved = path.resolve(this.rootDir, input);
    const relativePath = path.relative(this.rootDir, resolved);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("Path must stay inside the current repository.");
    }

    this._assertPathInsideRepo(resolved, {
      allowMissing: options.allowMissing
    });

    if (!options.allowMissing && !exists(resolved)) {
      throw new Error(`Path not found: ${input}`);
    }

    if (options.createParent) {
      ensureDir(path.dirname(resolved));
    }

    return resolved;
  }

  _repoRealRoot() {
    if (!this._realRoot) {
      this._realRoot = fs.realpathSync(this.rootDir);
    }

    return this._realRoot;
  }

  _assertPathInsideRepo(candidatePath, { allowMissing = false } = {}) {
    const rootReal = this._repoRealRoot();
    const candidateReal = allowMissing
      ? this._resolveRealTargetForMissingPath(candidatePath)
      : fs.realpathSync(candidatePath);

    const relativeReal = path.relative(rootReal, candidateReal);
    if (relativeReal.startsWith("..") || path.isAbsolute(relativeReal)) {
      throw new Error("Path must stay inside the current repository after resolving symlinks.");
    }
  }

  _resolveRealTargetForMissingPath(candidatePath) {
    let probe = candidatePath;
    while (!exists(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error("Unable to resolve a safe path inside the current repository.");
      }
      probe = parent;
    }

    const realAncestor = fs.realpathSync(probe);
    return path.resolve(realAncestor, path.relative(probe, candidatePath));
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
        packageManager: typeof manifest.packageManager === "string" ? manifest.packageManager : null,
        workspaceManager: detectWorkspaceManager(this.rootDir, manifest),
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
    const workspaceManagerText = packageInfo?.workspaceManager
      ? `Workspace manager: ${packageInfo.workspaceManager}.`
      : null;
    const manifestText = packageInfo?.name
      ? `${packageInfo.name}${packageInfo.version ? `@${packageInfo.version}` : ""}`
      : "no package manifest detected";

    return [
      `Package: ${manifestText}.`,
      workspaceManagerText,
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

  _persistGeneratedArtifact(fileName, content) {
    const generatedDir = path.join(this.rootDir, ".contextforge", "generated");
    ensureDir(generatedDir);
    const artifactPath = path.join(generatedDir, fileName);
    writeText(artifactPath, String(content ?? ""));
    return artifactPath;
  }

  _buildMapArtifact({ overview, areas, flows }) {
    return [
      `# ContextForge Repository Map`,
      ``,
      `## Overview`,
      `- Package: ${overview.packageInfo?.name ?? path.basename(this.rootDir)}${overview.packageInfo?.version ? `@${overview.packageInfo.version}` : ""}`,
      `- Top-level areas: ${overview.topLevel.map((item) => `${item.path} (${item.fileCount})`).join(", ")}`,
      `- Key entrypoints: ${overview.entrypoints.slice(0, 6).map((item) => item.path).join(", ") || "none"}`,
      ``,
      `## Areas`,
      ...areas.slice(0, 12).map((area) => `- ${area.label}: ${area.summary}`),
      ``,
      `## Flows`,
      ...flows.slice(0, 10).map((flow) => `- ${flow.label}: ${flow.summary}`)
    ].join("\n");
  }

  _buildWikiArtifact({ overview, areas, flows, contracts }) {
    return [
      `# ContextForge Wiki`,
      ``,
      `## Repository`,
      overview.summary,
      ``,
      `## Major Areas`,
      ...areas.slice(0, 12).map((area) => `### ${area.label}\n${area.summary}`),
      ``,
      `## Execution Flows`,
      ...flows.slice(0, 10).map((flow) => `### ${flow.label}\n${flow.summary}`),
      ``,
      `## Contracts`,
      ...contracts.slice(0, 12).map((contract) => `- ${contract.from} -> ${contract.to}: ${contract.summary}`)
    ].join("\n\n");
  }

  _buildContractsArtifact(contracts) {
    return [
      `# ContextForge Contracts`,
      ``,
      ...contracts.map((contract) => `- ${contract.from} -> ${contract.to}: ${contract.summary}`)
    ].join("\n");
  }

  _shouldUseInventoryWalk(query) {
    const signals = extractQuerySignals(query);
    if (signals.negation) return false;
    return signals.broadRepo || signals.exhaustive;
  }

  _shouldUseExhaustiveWalk(query) {
    const raw = String(query ?? "").trim();
    if (!raw) return false;
    const signals = extractQuerySignals(raw);
    if (signals.negation) return false;
    if (signals.scopeHints.length > 0) return false;
    return signals.exhaustive;
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

  _buildWalkSummary({ packageInfo, topLevel, packageSections, directorySections, rootFiles, importantFiles, audit = null, indexedMemory = null, exhaustive = false }) {
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
    const workspaceManagerText = packageInfo?.workspaceManager
      ? `Workspace manager: ${packageInfo.workspaceManager}.`
      : null;
    const roleText = audit?.roleBreakdown?.length
      ? `Most common file roles: ${audit.roleBreakdown.slice(0, 4).map((entry) => `${entry.role} (${entry.count})`).join(", ")}.`
      : null;
    const memoryText = indexedMemory
      ? indexedMemory.complete
        ? `Indexed memory is complete: ${indexedMemory.fullTextBodiesStored} text files stored with ${indexedMemory.indexedLineCount} total lines and ${indexedMemory.binaryAssetsScanned} binary assets tracked.`
        : `Indexed memory status is ${indexedMemory.status}: ${indexedMemory.filesIndexed}/${indexedMemory.filesTotal} files are currently reusable from the persistent repository index.`
      : null;

    return [
      `Package: ${manifestText}.`,
      workspaceManagerText,
      topLevel.length ? `Top-level layout: ${topLevelText}.` : "Top-level layout: no indexed files.",
      auditText,
      memoryText,
      packageText,
      directoryText,
      roleText,
      rootFiles.length ? `Key root files: ${rootFiles.slice(0, 6).join(", ")}.` : null,
      importantFiles.length
        ? exhaustive
          ? `Key entrypoints and anchor files include ${importantText}. Mention them in the first answer, but do not open them or call additional tools unless the user explicitly asks for drilldown.`
          : `Start with these representative files: ${importantText}.`
        : null,
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

export function createContextForge(rootDir: string, options: Record<string, any> = {}): any {
  return new ContextForge(rootDir, options);
}

export function pageHint(label, toolHint): string {
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

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  const single = String(value ?? "").trim();
  return single ? [single] : [];
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

function estimateTokensFromBytes(byteCount) {
  return Math.max(0, Math.ceil((Number(byteCount) || 0) / 4));
}

function createOutputCollector({ previewChars = 360, sectionChars = 4000 } = {}) {
  const sections = [];
  const currentLines = [];
  let currentLength = 0;
  let carry = "";
  let preview = "";
  let charCount = 0;

  const pushSection = () => {
    if (!currentLines.length) {
      return;
    }
    sections.push(currentLines.join("\n"));
    currentLines.length = 0;
    currentLength = 0;
  };

  const pushLongLine = (line) => {
    for (let index = 0; index < line.length; index += sectionChars) {
      sections.push(line.slice(index, index + sectionChars));
    }
  };

  const appendLine = (line) => {
    if (line.length > sectionChars && !currentLines.length) {
      pushLongLine(line);
      return;
    }

    const candidateLength = currentLength + line.length + 1;
    if (currentLines.length && candidateLength > sectionChars) {
      pushSection();
    }

    if (line.length > sectionChars && !currentLines.length) {
      pushLongLine(line);
      return;
    }

    currentLines.push(line);
    currentLength += line.length + 1;
  };

  return {
    write(chunk) {
      const text = String(chunk ?? "").replace(/\r\n/g, "\n");
      if (!text) {
        return;
      }

      charCount += text.length;
      if (preview.length < previewChars) {
        preview += text.slice(0, previewChars - preview.length);
      }

      const pieces = text.split("\n");
      pieces[0] = carry + pieces[0];
      carry = pieces.pop() ?? "";

      for (const line of pieces) {
        appendLine(line);
      }
    },
    finish() {
      if (carry.length) {
        appendLine(carry);
        carry = "";
      }
      pushSection();

      const normalizedPreview = preview.trim();
      return {
        charCount,
        preview: normalizedPreview
          ? charCount > normalizedPreview.length
            ? `${normalizedPreview}\n... [output truncated] ...`
            : normalizedPreview
          : "",
        sections
      };
    }
  };
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

function normalizeChangeScope(scope) {
  const normalized = String(scope ?? "unstaged").trim().toLowerCase();
  return ["unstaged", "staged", "all", "compare"].includes(normalized) ? normalized : "unstaged";
}

function collectGitChanges(rootDir, scope, baseRef) {
  const commands = [];
  if (scope === "staged") {
    commands.push(["diff", "--cached", "--name-status", "--unified=0"]);
  } else if (scope === "all") {
    commands.push(["diff", "--name-status", "--unified=0"]);
    commands.push(["diff", "--cached", "--name-status", "--unified=0"]);
  } else if (scope === "compare") {
    commands.push(["diff", "--name-status", "--unified=0", `${baseRef ?? "HEAD~1"}...HEAD`]);
  } else {
    commands.push(["diff", "--name-status", "--unified=0"]);
  }

  const fileMap = new Map();

  for (const args of commands) {
    const nameStatus = spawnSync("git", args, {
      cwd: rootDir,
      encoding: "utf8"
    });
    if (nameStatus.status !== 0) {
      continue;
    }

    const lines = normalizeFileLines(nameStatus.stdout).filter(Boolean);
    for (const line of lines) {
      const [status, ...rest] = line.split(/\s+/);
      const filePath = rest.pop();
      if (!filePath) {
        continue;
      }

      const diffArgs = [...args.slice(0, -1), "--", filePath];
      if (scope === "compare") {
        diffArgs.unshift(...["diff", "--unified=0", `${baseRef ?? "HEAD~1"}...HEAD`]);
      }
      const patchArgs = scope === "compare"
        ? ["diff", "--unified=0", `${baseRef ?? "HEAD~1"}...HEAD`, "--", filePath]
        : status === "A" && args.includes("--cached")
          ? ["diff", "--cached", "--unified=0", "--", filePath]
          : args.includes("--cached")
            ? ["diff", "--cached", "--unified=0", "--", filePath]
            : ["diff", "--unified=0", "--", filePath];
      const patch = spawnSync("git", patchArgs, {
        cwd: rootDir,
        encoding: "utf8"
      });
      const existing = fileMap.get(filePath) ?? {
        path: filePath,
        changeType: status,
        changedLines: []
      };
      existing.changeType = status;
      existing.changedLines.push(...parseChangedLineRanges(patch.stdout));
      fileMap.set(filePath, existing);
    }
  }

  return {
    scope,
    files: [...fileMap.values()].map((file) => ({
      ...file,
      changedLines: mergeLineRanges(file.changedLines)
    }))
  };
}

function parseChangedLineRanges(diffText) {
  const ranges = [];
  for (const line of normalizeFileLines(diffText)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      continue;
    }
    const start = Number.parseInt(match[1], 10);
    const count = Number.parseInt(match[2] ?? "1", 10);
    const end = Math.max(start, start + Math.max(count, 1) - 1);
    ranges.push({ start, end });
  }
  return ranges;
}

function mergeLineRanges(ranges) {
  const sorted = [...ranges]
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];

  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}

function intersectsAnyLineRange(symbol, ranges) {
  return ranges.some((range) => symbol.startLine <= range.end && symbol.endLine >= range.start);
}

function summarizeContracts({ files, symbols, edges }: { files: any[]; symbols: any[]; edges: any[] }) {
  const fileById = new Map<string, any>(files.map((file) => [file.fileId, file]));
  const symbolById = new Map<string, any>(symbols.map((symbol) => [symbol.symbolId, symbol]));
  const contracts = new Map<string, { from: string; to: string; edgeTypes: Set<string>; files: Set<string>; symbols: Set<string> }>();

  for (const edge of edges) {
    if (!["call", "import", "data", "control"].includes(edge.edgeType)) {
      continue;
    }
    const fromSymbol = symbolById.get(edge.fromSymbolId);
    const toSymbol = symbolById.get(edge.toSymbolId);
    if (!fromSymbol || !toSymbol) {
      continue;
    }

    const fromFile = fileById.get(fromSymbol.fileId);
    const toFile = fileById.get(toSymbol.fileId);
    if (!fromFile || !toFile) {
      continue;
    }

    const fromArea = topLevelAreaForPath(fromFile.relativePath);
    const toArea = topLevelAreaForPath(toFile.relativePath);
    if (!fromArea || !toArea || fromArea === toArea) {
      continue;
    }

    const key = `${fromArea}->${toArea}`;
    if (!contracts.has(key)) {
      contracts.set(key, {
        from: fromArea,
        to: toArea,
        edgeTypes: new Set(),
        files: new Set(),
        symbols: new Set()
      });
    }

    const contract = contracts.get(key);
    if (!contract) {
      continue;
    }
    contract.edgeTypes.add(edge.edgeType);
    contract.files.add(fromFile.relativePath);
    contract.files.add(toFile.relativePath);
    contract.symbols.add(fromSymbol.displayName);
    contract.symbols.add(toSymbol.displayName);
  }

  return [...contracts.values()]
    .map((contract) => ({
      from: contract.from,
      to: contract.to,
      edgeTypes: [...contract.edgeTypes].sort(),
      fileCount: contract.files.size,
      symbolCount: contract.symbols.size,
      summary: `${contract.from} depends on ${contract.to} through ${[...contract.edgeTypes].sort().join(", ")} edges touching ${contract.files.size} files.`
    }))
    .sort((left, right) => right.fileCount - left.fileCount || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

function topLevelAreaForPath(relativePath) {
  const normalized = String(relativePath ?? "");
  if (!normalized.includes("/")) {
    return "root";
  }
  return normalized.split("/")[0];
}

function detectWorkspaceManager(rootDir, manifest) {
  const packageManager = typeof manifest?.packageManager === "string"
    ? String(manifest.packageManager).split("@")[0]
    : null;
  if (packageManager) {
    return packageManager;
  }

  const signals = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
    ["bun", "bun.lockb"],
    ["npm", "package-lock.json"],
    ["npm", "npm-shrinkwrap.json"]
  ];

  for (const [manager, marker] of signals) {
    if (exists(path.join(rootDir, marker))) {
      return manager;
    }
  }

  return null;
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function inferFileRole(relativePath: string, content: string, language: string, file: any, options: Record<string, any> = {}) {
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
