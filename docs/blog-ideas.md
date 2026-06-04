# Blog post ideas

Backlog of post ideas mined from merged PRs. Voice: Paul Graham via the `/pg` skill.

## Planned (committed to write)

- [ ] **Make the Model Argue With Itself** — the AI review gauntlet. Review a diff by
      pitting agents against each other until they agree: codex⇄claude on correctness,
      lowy⇄hickey on structure, run in parallel in isolated worktrees, consolidated back
      onto the branch. Sequel to *The spacetime of code* (which covered only the two
      lenses; this is the whole machine).
      Feeds: #1094 (`/codex-debate`), #1113 (`/lens-debate`), #1106 (`/be`),
      #1145 / #1153 / #1159 / #1165 / #1168 (`/be-review` + refinements), #1117.

- [ ] **Fresh After Deploy** — killing the service worker. A stale client after deploy,
      why the service worker caused it, and the race-free, user-gated reload that
      replaced it. Tight web-deploy war story.
      Feeds: #1149, #1125, #1135.

## Backlog (not yet committed)

- The pill that wouldn't stop spinning — inferring an opaque agent's state by
  screen-scraping + journals (#1160, #1166, #1157, #1124, #1119, #1115, #1109).
- Leaf extractions, the electricity sweep continued — `@kolu/log`, `@kolu/html-escape`
  (#1089; plan in `docs/atlas/src/content/atlas/electricity.mdx`).
- Video PR evidence — record a flow off the Cucumber/Playwright harness (#1033, #1099,
  #1037; plan in `docs/atlas/src/content/atlas/video-evidence.mdx`). Extends *Eyes for the Agent*.
- Two more leaks not in the heap — Linux fd leak (#1127), exit-subscription leak (#1105).
- The Code tab learns to render — Markdown GFM/HTML/highlight, Source⇄Rendered (#1155, #1093).
