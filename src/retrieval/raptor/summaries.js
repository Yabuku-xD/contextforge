import { clip } from "../../utils/text.js";

export function summarizeChildren(node, children) {
  const labels = children.slice(0, 8).map((child) => child.label).join(", ");
  const childCount = children.length;
  return clip(`${node.label} groups ${childCount} children: ${labels}`, 280);
}
