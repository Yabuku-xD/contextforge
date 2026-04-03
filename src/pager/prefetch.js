export function recommendPrefetchPages({ recentEvents = [] }) {
  const pages = [];
  for (const event of recentEvents.slice(-8)) {
    if (event.eventType === "edit" && event.payload?.filePath) {
      pages.push({
        pageType: "retrieval_pack",
        sourceItemType: "file",
        sourceItemId: event.payload.filePath
      });
    }

    if (event.eventType === "failure" && event.payload?.symbolId) {
      pages.push({
        pageType: "session_memory",
        sourceItemType: "symbol",
        sourceItemId: event.payload.symbolId
      });
    }

    if (event.eventType === "failure" && event.payload?.filePath) {
      pages.push({
        pageType: "retrieval_pack",
        sourceItemType: "file",
        sourceItemId: event.payload.filePath
      });
    }

    if (event.eventType === "search" && event.payload?.topFilePath) {
      pages.push({
        pageType: "retrieval_pack",
        sourceItemType: "file",
        sourceItemId: event.payload.topFilePath
      });
    }

    if ((event.payload?.query ?? "").toLowerCase().includes("auth")) {
      pages.push({
        pageType: "module",
        sourceItemType: "module",
        sourceItemId: "auth"
      });
    }
  }

  return dedupePages(pages);
}

function dedupePages(pages) {
  const seen = new Set();
  return pages.filter((page) => {
    const key = `${page.pageType}:${page.sourceItemType}:${page.sourceItemId}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
