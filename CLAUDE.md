# Miyou Planet Template — project memory

Read and follow [`AGENTS.md`](AGENTS.md) first. It contains the project's implementation phases, safety boundaries, calendar invariants, media rules, and required verification steps.

Useful commands:

```bash
npm run demo -- --port 5173 --strictPort
npm run check
```

The current open-source reference site intentionally exposes Day 01, 02, 03, 05, and 08 only. Treat `src/data/loveData.js`, `src/main.jsx`, and `src/styles.css` as a connected system: data type, task state, styling, and browser QA must be updated together.

Before editing, respond in Chinese with a read-only understanding and an implementation plan. After each change, run the relevant verification instead of assuming a successful build proves the UI works.
