import { forgeGetTool } from "./forge_get_tool.js";
import { forgeStartupTool } from "./forge_startup.js";
import { forgeMemoryStatusTool } from "./forge_memory_status.js";
import { forgeMemoryWakeupTool } from "./forge_memory_wakeup.js";
import { forgeMemoryRecallTool } from "./forge_memory_recall.js";
import { forgeMemorySearchTool } from "./forge_memory_search.js";
import { forgeMemoryNavigateTool } from "./forge_memory_navigate.js";
import { forgeMemorySaveTool } from "./forge_memory_save.js";
import { forgeMemoryProfileSetTool } from "./forge_memory_profile_set.js";
import { forgeMemoryProfileGetTool } from "./forge_memory_profile_get.js";
import { forgeMemoryDiaryWriteTool } from "./forge_memory_diary_write.js";
import { forgeMemoryDiaryReadTool } from "./forge_memory_diary_read.js";
import { forgeMemoryFactAddTool } from "./forge_memory_fact_add.js";
import { forgeMemoryFactInvalidateTool } from "./forge_memory_fact_invalidate.js";
import { forgeMemoryFactQueryTool } from "./forge_memory_fact_query.js";
import { forgeMemoryTimelineTool } from "./forge_memory_timeline.js";
import { forgeBatchTool } from "./forge_batch.js";
import { forgeLookupTool } from "./forge_lookup.js";
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
import { forgeChangesTool } from "./forge_changes.js";
import { forgeRenameTool } from "./forge_rename.js";
import { forgeWhyTool } from "./forge_why.js";
import { forgeListReposTool } from "./forge_list_repos.js";
import { forgeGroupQueryTool } from "./forge_group_query.js";
import { forgeGroupStatusTool } from "./forge_group_status.js";
import { forgeMapTool } from "./forge_map.js";
import { forgeContractsTool } from "./forge_contracts.js";
import { forgeWikiTool } from "./forge_wiki.js";
import { forgeSessionTool } from "./forge_session.js";
import { forgeResumeTool } from "./forge_resume.js";
import { forgeStatsTool } from "./forge_stats.js";
import { forgeDoctorTool } from "./forge_doctor.js";

export const TOOL_REGISTRY = {
  forge_get_tool: forgeGetTool,
  forge_startup: forgeStartupTool,
  forge_memory_status: forgeMemoryStatusTool,
  forge_memory_wakeup: forgeMemoryWakeupTool,
  forge_memory_recall: forgeMemoryRecallTool,
  forge_memory_search: forgeMemorySearchTool,
  forge_memory_navigate: forgeMemoryNavigateTool,
  forge_memory_save: forgeMemorySaveTool,
  forge_memory_profile_set: forgeMemoryProfileSetTool,
  forge_memory_profile_get: forgeMemoryProfileGetTool,
  forge_memory_diary_write: forgeMemoryDiaryWriteTool,
  forge_memory_diary_read: forgeMemoryDiaryReadTool,
  forge_memory_fact_add: forgeMemoryFactAddTool,
  forge_memory_fact_invalidate: forgeMemoryFactInvalidateTool,
  forge_memory_fact_query: forgeMemoryFactQueryTool,
  forge_memory_timeline: forgeMemoryTimelineTool,
  forge_batch: forgeBatchTool,
  forge_lookup: forgeLookupTool,
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
  forge_changes: forgeChangesTool,
  forge_rename: forgeRenameTool,
  forge_why: forgeWhyTool,
  forge_list_repos: forgeListReposTool,
  forge_group_query: forgeGroupQueryTool,
  forge_group_status: forgeGroupStatusTool,
  forge_map: forgeMapTool,
  forge_contracts: forgeContractsTool,
  forge_wiki: forgeWikiTool,
  forge_session: forgeSessionTool,
  forge_resume: forgeResumeTool,
  forge_stats: forgeStatsTool,
  forge_doctor: forgeDoctorTool
};
