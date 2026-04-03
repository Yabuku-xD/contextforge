import { forgeGetTool } from "./forge_get_tool.js";
import { forgeStartupTool } from "./forge_startup.js";
import { forgeScanTool } from "./forge_scan.js";
import { forgeUnderstandTool } from "./forge_understand.js";
import { forgeWalkTool } from "./forge_walk.js";
import { forgeReadTool } from "./forge_read.js";
import { forgeWriteTool } from "./forge_write.js";
import { forgeEditTool } from "./forge_edit.js";
import { forgeBashTool } from "./forge_bash.js";
import { forgeSearchTool } from "./forge_search.js";
import { forgeSymbolTool } from "./forge_symbol.js";
import { forgeScopeTool } from "./forge_scope.js";
import { forgeImpactTool } from "./forge_impact.js";
import { forgeWhyTool } from "./forge_why.js";
import { forgeSessionTool } from "./forge_session.js";
import { forgeResumeTool } from "./forge_resume.js";
import { forgeStatsTool } from "./forge_stats.js";
import { forgeDoctorTool } from "./forge_doctor.js";

export const TOOL_REGISTRY = {
  forge_get_tool: forgeGetTool,
  forge_startup: forgeStartupTool,
  forge_scan: forgeScanTool,
  forge_understand: forgeUnderstandTool,
  forge_walk: forgeWalkTool,
  forge_read: forgeReadTool,
  forge_write: forgeWriteTool,
  forge_edit: forgeEditTool,
  forge_bash: forgeBashTool,
  forge_search: forgeSearchTool,
  forge_symbol: forgeSymbolTool,
  forge_scope: forgeScopeTool,
  forge_impact: forgeImpactTool,
  forge_why: forgeWhyTool,
  forge_session: forgeSessionTool,
  forge_resume: forgeResumeTool,
  forge_stats: forgeStatsTool,
  forge_doctor: forgeDoctorTool
};
