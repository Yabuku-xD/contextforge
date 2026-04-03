import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runScoreboard } from "../../src/scoreboard.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("scoreboard returns side-by-side comparison rows and current winners", async () => {
  const scoreboard = await runScoreboard(sampleRepo);

  assert.equal(scoreboard.openTrack.status, "pass");
  assert.equal(scoreboard.openTrack.winners.retrieval.name, "contextforge");
  assert.ok(scoreboard.openTrack.rows.some((row) => row.name === "token_savior" && row.available));
  assert.equal(scoreboard.closedTrack.status, "pass");
  assert.deepEqual(scoreboard.closedTrack.rows.map((row) => row.name), ["contextforge"]);
});
