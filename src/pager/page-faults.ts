export function noteFault(page): any {
  return {
    ...page,
    faultCount: (page.faultCount ?? 0) + 1,
    lastUsedAt: Date.now()
  };
}

export function retrievalHandle({ label, toolHint }): string {
  return `[Paged out: ${label}. Re-open with ${toolHint}.]`;
}
