# SWE-bench Subset

This directory holds the local SWE-bench-style subset used by ContextForge Phase 3.

- `subset.json` is a small, verified task set expressed in the same query-and-expected-answer format as the local end-to-end suite.
- These are context and diagnosis tasks, not patch-generation tasks.
- The goal is to measure whether ContextForge surfaces the right files, symbols, and session evidence before a coding agent edits anything.

Each task may define:

- `issue`: natural-language issue framing
- `kind`: `search`, `symbol`, `scope`, `impact`, `why`, `session`, or `resume`
- `query`: the task prompt used for startup and retrieval
- `setupEvents`: optional session history injected before evaluation
- `expectedTop`, `expectedIncludes`, `expectedAny`, `expectedGraphIncludes`, or `expectedSessionMin`
