# Closed Track

This directory is reserved for closed-track concepts that cannot be reproduced directly inside ContextForge.

Augment influenced the benchmark concept, but it is not a required release dependency in this repo. The shipped closed track now stays locally verifiable:

- `localVerified`: the maintained end-to-end suite in `benchmark/end-to-end/local-tasks.json`
- `swebenchSubset`: the maintained subset in `benchmark/swebench/subset.json`

That keeps `phase3`, `release`, and `scoreboard` reproducible without pretending we can validate paid black-box tools from inside the workspace.
