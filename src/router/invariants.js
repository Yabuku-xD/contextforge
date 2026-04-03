import { unique } from "../utils/text.js";

const HTML_ATTR_RE = /\b(?:id|class|name|data-[\w-]+|aria-[\w-]+|href|src|type|role)=["'][^"']+["']/gi;
const FILE_RE = /\b(?:[A-Za-z]:)?[./~\w-]+(?:\/[\w.-]+)+\b/g;
const LINE_RE = /(?<=:)\d+(?::\d+)?\b/g;
const EXIT_RE = /\bexit code[:= ]+\d+\b/gi;
const ASSERT_RE = /\b(?:AssertionError|AssertionFailedError|Expected:|Received:).*/gi;
const KEY_RE = /"[^"]+"\s*:|[A-Za-z0-9_.-]+\s*:/g;
const IDENT_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

export function extractInvariants(contentType, content) {
  const text = String(content ?? "");
  const items = [];

  if (["diff", "code", "stack_trace", "assertion", "compiler_error"].includes(contentType)) {
    items.push(...matchAll(FILE_RE, text));
    items.push(...matchAll(LINE_RE, text).map((value) => `line:${value}`));
    items.push(...matchAll(ASSERT_RE, text));
  }

  if (["json", "xml", "yaml", "csv"].includes(contentType)) {
    items.push(...matchAll(KEY_RE, text));
  }

  if (contentType === "dom_snapshot") {
    items.push(...matchAll(HTML_ATTR_RE, text));
  }

  items.push(...matchAll(EXIT_RE, text));

  if (items.length < 4) {
    items.push(...matchAll(IDENT_RE, text).slice(0, 12));
  }

  return unique(items.filter(Boolean)).slice(0, 64);
}

export function checkInvariants(invariants, compressedText) {
  const text = String(compressedText ?? "");
  const missing = invariants.filter((item) => !text.includes(item));
  return {
    ok: missing.length === 0,
    missing
  };
}

function matchAll(pattern, value) {
  return [...value.matchAll(pattern)].map((match) => match[0]);
}
