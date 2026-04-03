const EXACT_TYPES = new Set([
  "assertion",
  "cli_table",
  "code",
  "compiler_error",
  "csv",
  "diff",
  "json",
  "line_numbered_output",
  "security_finding",
  "stack_trace",
  "xml",
  "yaml"
]);

const SAFE_TYPES = new Set([
  "dom_snapshot",
  "log",
  "plain_text",
  "prose_doc"
]);

export function decideRoute(contentType) {
  if (EXACT_TYPES.has(contentType)) {
    return "exact";
  }

  if (SAFE_TYPES.has(contentType)) {
    return "lossy_safe_with_invariant_check";
  }

  return "skip";
}
