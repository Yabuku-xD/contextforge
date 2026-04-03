import { reciprocalRankFusion } from "../utils/rank.js";
import { exactSymbolSearch } from "./exact.js";
import { bm25Search } from "./bm25.js";
import { vectorSearch, embedText } from "./vectors.js";
import { collapsedTreeSearch } from "./raptor/collapsed.js";
import { traversalSearch } from "./raptor/traversal.js";
import { routeRaptorStrategy } from "./raptor/route.js";
import { rerankWithGraph } from "../graph/graph-rerank.js";
import { tokenize } from "../utils/text.js";

export function hybridSearch({
  db,
  query,
  symbols,
  chunks,
  raptorNodes,
  repoGraph,
  limit = 10,
  useGraph = true
}) {
  const raptorPlan = routeRaptorStrategy(query);
  const exact = exactSymbolSearch(query, symbols, limit).map((item) => ({ id: item.symbolId, symbolId: item.symbolId, fileId: item.fileId, label: item.canonicalName, text: item.body, score: item.score, kind: "exact" }));
  const bm25 = bm25Search(db, query, limit).map((item) => ({ ...item, kind: "bm25" }));
  const vectorItems = chunks.map((chunk) => ({
    id: chunk.chunkId,
    label: chunk.label,
    text: chunk.text,
    fileId: chunk.fileId,
    embedding: chunk.embedding ?? embedText(chunk.text),
    score: 0,
    kind: "vector"
  }));
  const vector = vectorSearch(query, vectorItems, limit).map((item) => ({
    id: item.id,
    label: item.label,
    text: item.text,
    fileId: item.fileId,
    score: item.score,
    kind: "vector"
  }));
  const collapsedLimit = raptorPlan.strategy === "collapsed" ? limit : raptorPlan.strategy === "traversal" ? Math.max(2, Math.ceil(limit / 3)) : Math.max(1, Math.ceil(limit / 4));
  const traversalLimit = raptorPlan.strategy === "traversal" ? limit : raptorPlan.strategy === "collapsed" ? Math.max(2, Math.ceil(limit / 3)) : Math.max(1, Math.ceil(limit / 4));
  const collapsed = collapsedTreeSearch(query, raptorNodes, collapsedLimit).map((item) => ({ id: item.id, label: item.label, score: item.score + kindBias("raptor_collapsed", raptorPlan.strategy), kind: "raptor_collapsed" }));
  const traversal = traversalSearch(query, raptorNodes, traversalLimit).map((item) => ({ id: item.id, label: item.label, score: item.score + kindBias("raptor_traversal", raptorPlan.strategy), kind: "raptor_traversal" }));

  const fusedScores = reciprocalRankFusion([exact, bm25, vector, collapsed, traversal]);
  const merged = new Map();

  for (const list of [exact, bm25, vector, collapsed, traversal]) {
    for (const item of list) {
      const current = merged.get(item.id) ?? { ...item, score: 0, sources: [] };
      current.score = fusedScores.get(item.id) ?? current.score;
      current.sources = [...new Set([...current.sources, item.kind])];
      current.lexicalScore = lexicalScore({ label: current.label, text: current.text }, query);
      current.structuralScore = structuralScore(current.label);
      current.raptorBonus = Math.max(current.raptorBonus ?? 0, kindBias(item.kind, raptorPlan.strategy));
      current.raptorStrategy = raptorPlan.strategy;
      merged.set(item.id, current);
    }
  }

  let results = [...merged.values()]
    .sort((left, right) => (right.score + (right.lexicalScore ?? 0) * 0.4 + (right.structuralScore ?? 0) + (right.raptorBonus ?? 0)) - (left.score + (left.lexicalScore ?? 0) * 0.4 + (left.structuralScore ?? 0) + (left.raptorBonus ?? 0)))
    .slice(0, limit);

  if (useGraph) {
    results = rerankWithGraph({
      query,
      results,
      repoGraph,
      symbols
    }).slice(0, limit);
  }

  return results;
}

export function planRaptorStrategy(query) {
  return routeRaptorStrategy(query);
}

function lexicalScore(item, query) {
  const haystack = new Set(tokenize(`${item.label ?? ""} ${item.text ?? ""}`));
  const queryTokens = tokenize(query);
  let matches = 0;
  for (const token of queryTokens) {
    if (haystack.has(token) || [...haystack].some((candidate) => candidate.includes(token) || token.includes(candidate))) {
      matches += 1;
    }
  }
  return queryTokens.length ? matches / queryTokens.length : 0;
}

function kindBias(kind, strategy) {
  if (strategy === "collapsed" && kind === "raptor_collapsed") return 0.2;
  if (strategy === "traversal" && kind === "raptor_traversal") return 0.2;
  if (strategy === "flat") return -0.05;
  return 0;
}

function structuralScore(label) {
  const depth = String(label ?? "").split("::").filter(Boolean).length;
  if (!depth) {
    return 0;
  }

  if (depth === 1) {
    return 0.015;
  }

  if (depth === 2) {
    return 0.02;
  }

  return Math.max(-0.01, 0.02 - (depth - 2) * 0.015);
}
