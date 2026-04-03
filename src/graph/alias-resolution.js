const SYNONYM_GROUPS = [
  ["auth", "authentication", "credential", "credentials", "login"],
  ["token", "session", "cookie"],
  ["retry", "backoff", "retriable"],
  ["timeout", "timeouts", "timedout"],
  ["checkout", "payment", "payments", "order"],
  ["test", "tests", "testing"]
];

const SYNONYM_MAP = buildSynonymMap();

export function resolveAliasSeeds(query, symbols, limit = 5) {
  const directTokens = new Set(aliasTokens(query));
  const expandedTokens = expandAliasTokens(directTokens);
  if (!expandedTokens.size) {
    return [];
  }

  return symbols
    .map((symbol) => ({
      symbolId: symbol.symbolId,
      score: scoreAliasCandidate({ directTokens, expandedTokens }, symbol)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.symbolId);
}

export function scoreAliasCandidate(queryShape, symbol) {
  const { directTokens, expandedTokens } = queryShape;
  const symbolTokens = expandAliasTokens(aliasTokens(`${symbol.displayName} ${symbol.canonicalName}`));
  if (!symbolTokens.size) {
    return 0;
  }

  let score = 0;
  for (const token of expandedTokens) {
    if (!symbolTokens.has(token) && ![...symbolTokens].some((candidate) => candidate.includes(token) || token.includes(candidate))) {
      continue;
    }

    score += directTokens.has(token) ? 1 : 0.6;
  }

  return score / Math.max(directTokens.size || expandedTokens.size, 1);
}

function aliasTokens(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[/:._-]+/g, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .flatMap((token) => token.endsWith("s") && token.length > 4 ? [token, token.slice(0, -1)] : [token]);
}

function expandAliasTokens(tokens) {
  const expanded = new Set();
  for (const token of tokens) {
    expanded.add(token);
    for (const alias of SYNONYM_MAP.get(token) ?? []) {
      expanded.add(alias);
    }
  }
  return expanded;
}

function buildSynonymMap() {
  const map = new Map();
  for (const group of SYNONYM_GROUPS) {
    for (const token of group) {
      map.set(token, new Set(group.filter((candidate) => candidate !== token)));
    }
  }
  return map;
}
