export function classifyContent(content, metadata = {}) {
  const text = String(content ?? "");
  const filePath = String(metadata.filePath ?? "");
  const loweredPath = filePath.toLowerCase();

  if (metadata.forceType) {
    return metadata.forceType;
  }

  if (metadata.isSecurityFinding) return "security_finding";
  if (metadata.isDiff || loweredPath.endsWith(".diff") || text.startsWith("diff --git")) return "diff";
  if (metadata.isStackTrace || /at .+\(.+:\d+:\d+\)/.test(text) || /Traceback \(most recent call last\)/.test(text)) return "stack_trace";
  if (metadata.isAssertion || /Assertion(Error|Failed)/.test(text) || /Expected:/.test(text)) return "assertion";
  if (metadata.isCompilerError || /\berror TS\d+:/i.test(text) || /SyntaxError:/.test(text)) return "compiler_error";
  if (/^\s*\d+[:|]/m.test(text)) return "line_numbered_output";
  if (looksLikeCode(text, loweredPath)) return "code";
  if (looksLikeJson(text, loweredPath)) return "json";
  if (looksLikeHtml(text, loweredPath)) return "dom_snapshot";
  if (looksLikeXml(text, loweredPath)) return "xml";
  if (looksLikeYaml(text, loweredPath)) return "yaml";
  if (looksLikeCsv(text, loweredPath)) return "csv";
  if (looksLikeCliTable(text)) return "cli_table";
  if (looksLikeLog(text, loweredPath)) return "log";
  if (looksLikeMarkdown(text, loweredPath)) return "prose_doc";
  return "plain_text";
}

function looksLikeCode(text, filePath) {
  if (/\.(c|cc|cpp|go|java|js|jsx|mjs|mts|py|rb|rs|ts|tsx)$/i.test(filePath)) {
    return true;
  }

  const codeSignals = [
    /\b(function|class|const|let|var|import|export|return)\b/,
    /=>/,
    /{\s*[\r\n]/,
    /\bdef\s+\w+\s*\(/,
    /\bpublic\s+\w+/,
    /\bpackage\s+[a-z0-9_.]+/i
  ];

  return codeSignals.filter((signal) => signal.test(text)).length >= 2;
}

function looksLikeJson(text, filePath) {
  return filePath.endsWith(".json") || /^\s*[{[]/.test(text);
}

function looksLikeXml(text, filePath) {
  return /\.(xml|svg)$/i.test(filePath) || (/^\s*</.test(text) && !looksLikeHtml(text, filePath));
}

function looksLikeYaml(text, filePath) {
  return /\.(ya?ml)$/i.test(filePath) || /^---\s*$/m.test(text);
}

function looksLikeCsv(text, filePath) {
  return filePath.endsWith(".csv") || text.split("\n").slice(0, 3).every((line) => line.includes(","));
}

function looksLikeHtml(text, filePath) {
  return /\.(html|htm)$/i.test(filePath) || /<(html|div|span|body|button|input)\b/i.test(text);
}

function looksLikeCliTable(text) {
  return /^\|.+\|$/m.test(text) || /[-+|]{5,}/.test(text);
}

function looksLikeLog(text, filePath) {
  if (/\.(log|out|err)$/i.test(filePath)) {
    return true;
  }

  const lines = text.split("\n");
  const timestampLines = lines.filter((line) => /^\d{4}-\d{2}-\d{2}|^\[\w+\]/.test(line.trim())).length;
  return lines.length > 5 && timestampLines >= 2;
}

function looksLikeMarkdown(text, filePath) {
  return /\.(md|mdx|txt)$/i.test(filePath) || /^#{1,6}\s+/m.test(text);
}
