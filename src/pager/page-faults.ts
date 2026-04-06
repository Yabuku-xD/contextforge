export function noteFault(page) {
  return {
    ...page,
    faultCount: (page.faultCount ?? 0) + 1,
    lastUsedAt: Date.now()
  };
}

export function retrievalHandle({ label, toolHint }) {
  return `[Paged out: ${label}. Re-open with ${toolHint}.]`;
}
