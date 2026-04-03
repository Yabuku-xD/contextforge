# Open Track

This directory is for public open-baseline imports used by `compare`, `gate`, and `phase3`.

Supported baseline file names:

- `context_mode.report.json`
- `token_savior.report.json`

Report shape:

```json
{
  "name": "context_mode",
  "available": true,
  "source": "external_import",
  "summary": {
    "startup": {
      "avgTokensBeforeUsefulAction": 0,
      "avgLatencyMs": null,
      "avgFilesRead": 0
    },
    "compression": {
      "fidelityRate": 1,
      "avgTokenReduction": 0,
      "avgLatencyMs": null
    },
    "retrieval": {
      "hitAt1": 0,
      "hitAt5": 0,
      "mrr": 0,
      "avgTokensToCorrectAnswer": 0,
      "avgFilesRead": 0,
      "avgLatencyMs": null
    },
    "session": {
      "recallAtK": 0,
      "correctnessRate": 0,
      "falseCausalLinkRate": 0,
      "avgLatencyMs": null
    },
    "endToEnd": {
      "successRate": 0,
      "tokensPerSuccessfulTask": 0,
      "startupCost": 0,
      "steadyStateCost": 0,
      "filesReadPerSuccessfulTask": 0,
      "avgLatencyMs": null
    }
  },
  "notes": [
    "Optional notes about how the report was generated."
  ]
}
```

Useful command:

```bash
node ./src/cli.js validate-report benchmark/open-track/context_mode.report.json
```
