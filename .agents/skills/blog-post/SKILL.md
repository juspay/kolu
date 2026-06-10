---
name: blog-post
description: >-
  Write a kolu blog post grounded in the real build history — mine the Claude
  Code session logs behind a feature for the actual story (for large efforts,
  fan out over the transcripts with an ultracode workflow), draft it in the
  author's voice, and wire it into the Astro site. Use when asked to write a
  blog post or engineering essay about something that was built, especially one
  that should read as a narrative of what actually happened rather than invented
  marketing copy.
argument-hint: "<feature/topic to write about, or a PR/package whose story to tell>"
---

# Writing a kolu blog post

A kolu blog post is a first-person engineering essay grounded in **what actually
happened** when something was built — the dead-end, the load-bearing decision,
the bug that taught the lesson. Its source of truth is the Claude Code session
logs that produced the work, not invented marketing copy.

**Show the story, don't only tell it.** A good post leans on figures over prose:
a trajectory chart, before/after cards, a timeline, a flow diagram, a comparison
bar, a real screenshot — visualization carrying more of the argument than text.
Every figure is grounded in real data (status timestamps, `ps` output, measured
durations); a chart is an argument, never decoration. This applies to every post,
not just the obviously visual ones.

## Steps

1. **Locate the work's sessions.** Find the Claude Code session logs behind the
   feature (they live under `~/.claude/projects/`, one directory per working
   directory). Map them deterministically by tracing PRs → branches → logs, not
   by keyword hits.

2. **Mine them for the story.** Read the human/assistant narrative out of the
   logs and pull out the why behind decisions, the hard-won lessons and
   dead-ends, the concrete mechanisms, and vivid verbatim quotes. When the effort
   spans more than a handful of sessions, fan out with an **ultracode workflow** —
   one agent per transcript returning structured notes — then synthesize the
   notes into a single digest, draft from it, and run an adversarial editor pass.
   The digest is the fact-checked spine; never fabricate numbers, dates, quotes,
   or PRs.

3. **Write it in the author's voice.** Use the `pg` skill (Paul Graham voice)
   unless told otherwise, and settle the inline house style up front. Match the
   register of the existing posts; a new post often pairs as a sequel to one.
   **Give it a non-cryptic title.** The frontmatter `title` is a plain,
   self-explanatory headline that states what happened and carries the payoff —
   "Making Kolu's macOS e2e CI lane 14x faster", not a slug and not a clever
   teaser the reader can't decode until they've finished. Let the `description`
   tease the concrete hook (the 64 GB leak, the one-character typo). This is a
   deliberate shift from the older evocative-title posts toward titles that tell
   the reader up front what they'll learn — apply it to every new post.

4. **Wire it into the site.** Posts live in `website/src/content/blog/` under a
   short, stable slug (the filename is the URL). Use the site's components for
   callouts, GitHub PR/issue references, and the table of contents; cite the real
   PRs behind each claim, and give the post a two-level heading outline so the TOC
   nests — write the headings as plain signposts of each section's point, not
   teasers, so the contents list reads as the argument in miniature. **Link every
   technology, tool, library, format, and product on its first mention** —
   `[Playwright](https://playwright.dev/)`, `[ffmpeg](https://ffmpeg.org/)`, a CDP
   method to its own doc page — the way the existing posts do; a named technology
   with no link is a miss. When content is a sequence of steps or a short
   enumeration (e.g. two API methods that each fail, two gotchas), use a markdown
   list or table instead of a dense paragraph — keep the *argument* in prose, but
   stop hiding enumerable content in paragraphs (a deliberate post-specific
   loosening of the `pg` skill's "don't replace argument with bullets" rule).
   When you quote something the author literally typed into an agent's CLI prompt
   box (Claude Code, Codex, etc.) as a turning point, render it with the `Prompt`
   component (`website/src/components/Prompt.astro`) — `<Prompt>…</Prompt>` — not a
   plain blockquote, so it reads as a human typing into the agent's input field;
   see `auto-demo.mdx` for the reference usage. Balance prose with screenshots and
   code — host images in the site, don't hotlink.

   **Figures: hand-author inline SVG, theme-aware.** Draw charts directly as
   inline `<svg>` in the MDX (no chart library) — see `macos-e2e-lane.mdx` for
   five reference figures. Color every stroke and fill with the site's `--color-*`
   CSS custom properties (`--color-ink`, `--color-ink-dim`, `--color-ink-muted`,
   `--color-rule-strong`, `--color-amber`, `--color-live-alert`, `--color-live-lime`,
   `--color-void`, …; the palette lives in `website/src/styles/global.css`) so a
   figure tracks light/dark automatically — never hardcode a hex value. Give each
   `<svg>` a `role="img"` and an `aria-label` describing the data it shows.

   > **MDX/SVG gotcha (hard-won on the macOS-lane post).** Astro's MDX passes
   > camelCase SVG presentation attributes (`textAnchor`, `fontSize`) through
   > literally, and SVG silently ignores them — every label renders at the 16px
   > left-anchored default. Use each attribute's real kebab-case SVG spelling:
   > `text-anchor`, `font-size`, `font-weight`, `font-family`, `stroke-width`,
   > `fill-opacity`. Genuinely camelCase SVG attributes like `viewBox` stay as-is.
   > Eyeballing misses it — catch it by measuring `getBBox()` in a real browser
   > against the **built** site.

5. **Verify and ship.** Build the site and confirm it renders, then verify every
   figure in **both light and dark themes** against the built output with the
   chrome-devtools MCP — confirm labels are actually placed (`getBBox()`), not
   merely present in the DOM — before opening the PR with the `forge-pr` skill.
   Run only the CI lane a docs change can touch (the website build plus formatting
   and lint — see the `ci` skill).
