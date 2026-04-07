import { clip } from "../utils/text.js";

export const CONTEXTFORGE_MEMORY_DIALECT_NAME = "ForgeCapsule";

export const CONTEXTFORGE_MEMORY_DIALECT_SPEC = [
  "ForgeCapsule is ContextForge's compact memory dialect for wake-up summaries and diary/checkpoint records.",
  "Fields are pipe-separated and summary-first so any text-reading model can use them without a decoder.",
  "Core fields: W=wing, H=hall, R=room, T=title, I=importance(1-5), K=tags, S=summary.",
  "Optional fields: ENT=linked entities, FACT=typed relation, SRC=source hint, TS=timestamp.",
  "Example: W:repo.contextforge|H:discoveries|R:memory-stack|T:implemented layered memory|I:4|K:memory,temporal,wakeup|S:added global memory DB and layered recall."
].join(" ");

export function renderForgeCapsule({
  wing = "general",
  hall = "events",
  room = "general",
  title = "",
  summary = "",
  tags = [],
  importance = 0.5,
  entities = [],
  source = "",
  timestamp = ""
}: Record<string, any>) {
  const parts = [
    `W:${compactToken(wing)}`,
    `H:${compactToken(hall)}`,
    `R:${compactToken(room)}`,
    `T:${compactText(title, 56)}`
  ];

  if (typeof importance === "number" && Number.isFinite(importance)) {
    const stars = Math.max(1, Math.min(5, Math.round(importance * 5)));
    parts.push(`I:${stars}`);
  }
  if (tags?.length) {
    parts.push(`K:${tags.slice(0, 6).map((tag: any) => compactToken(tag)).join(",")}`);
  }
  if (entities?.length) {
    parts.push(`ENT:${entities.slice(0, 5).map((entity: any) => compactToken(entity)).join(",")}`);
  }
  if (source) {
    parts.push(`SRC:${compactToken(source)}`);
  }
  if (timestamp) {
    parts.push(`TS:${compactToken(timestamp)}`);
  }
  parts.push(`S:${compactText(summary, 180)}`);

  return parts.join("|");
}

function compactToken(value: any) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-zA-Z0-9_.:/-]+/g, "")
    .slice(0, 72) || "general";
}

function compactText(value: any, limit: number) {
  return clip(String(value ?? "").replace(/\s+/g, " ").trim(), limit)
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ");
}
