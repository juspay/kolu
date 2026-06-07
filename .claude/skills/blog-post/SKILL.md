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

4. **Wire it into the site.** Posts live in `website/src/content/blog/` under a
   short, stable slug (the filename is the URL). Use the site's components for
   callouts, GitHub PR/issue references, and the table of contents; cite the real
   PRs behind each claim, and give the post a two-level heading outline so the TOC
   nests — write the headings as plain signposts of each section's point, not
   teasers, so the contents list reads as the argument in miniature. **Link every
   technology, tool, library, format, and product on its first mention** —
   `[Playwright](https://playwright.dev/)`, `[ffmpeg](https://ffmpeg.org/)`, a CDP
   method to its own doc page — the way the existing posts do; a named technology
   with no link is a miss. Balance prose with screenshots and code — host images
   in the site, don't hotlink.

5. **Verify and ship.** Build the site and confirm it renders, open the PR with
   the `forge-pr` skill, and run only the CI lane a docs change can touch (the
   website build plus formatting and lint — see the `ci` skill).
