import { pageAffinity } from "./affinity.js";

export function maybePinPage(page, reason = "repeat_fault", context = {}): any {
  const affinity = pageAffinity(page, context);
  if (
    (page.faultCount ?? 0) >= 2 ||
    ["active_failure", "active_edit", "repeat_fault"].includes(reason) ||
    affinity.failureMatch ||
    affinity.activeFileMatch ||
    affinity.activeSymbolMatch ||
    affinity.hotToolMatch
  ) {
    return {
      ...page,
      pinState: "pinned"
    };
  }

  return page;
}
