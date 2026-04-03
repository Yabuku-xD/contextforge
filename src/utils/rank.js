export function reciprocalRankFusion(rankings, k = 60) {
  const scores = new Map();

  rankings.forEach((items) => {
    items.forEach((item, index) => {
      const score = 1 / (k + index + 1);
      scores.set(item.id, (scores.get(item.id) ?? 0) + score);
    });
  });

  return scores;
}

export function sortByNumericField(items, field, direction = "desc") {
  return [...items].sort((left, right) => {
    const delta = (left[field] ?? 0) - (right[field] ?? 0);
    return direction === "desc" ? -delta : delta;
  });
}
