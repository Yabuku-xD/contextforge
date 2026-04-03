import { ctxGetTool } from "./ctx_get_tool.js";
import { ctxStartup } from "./ctx_startup.js";
import { ctxSearch } from "./ctx_search.js";
import { ctxSymbol } from "./ctx_symbol.js";
import { ctxScope } from "./ctx_scope.js";
import { ctxImpact } from "./ctx_impact.js";
import { ctxWhy } from "./ctx_why.js";
import { ctxSession } from "./ctx_session.js";
import { ctxResume } from "./ctx_resume.js";
import { ctxStats } from "./ctx_stats.js";
import { ctxDoctor } from "./ctx_doctor.js";

export const TOOL_REGISTRY = {
  ctx_get_tool: ctxGetTool,
  ctx_startup: ctxStartup,
  ctx_search: ctxSearch,
  ctx_symbol: ctxSymbol,
  ctx_scope: ctxScope,
  ctx_impact: ctxImpact,
  ctx_why: ctxWhy,
  ctx_session: ctxSession,
  ctx_resume: ctxResume,
  ctx_stats: ctxStats,
  ctx_doctor: ctxDoctor
};
