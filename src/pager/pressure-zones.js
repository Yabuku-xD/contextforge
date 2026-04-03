export function pressureZone(totalBudget, usedBudget) {
  const usage = totalBudget ? usedBudget / totalBudget : 0;
  if (usage < 0.6) return "green";
  if (usage < 0.85) return "yellow";
  return "red";
}
