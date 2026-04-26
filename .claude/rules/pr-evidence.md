## PR Evidence

When a PR adds or fixes user-facing UI behavior, attach screenshots so reviewers can see the visual diff without checking out the branch. Use the `chrome-devtools` MCP — it's already wired up in `.mcp.json` via `just ai::mcp-chrome-devtools`.

### When this applies

The diff touches at least one of:

- `packages/client/src/**`
- `packages/client/index.html`
- Anything user-visible in CSS, fonts, or rendering

If the diff is server-only, tests, docs, type-only refactor, or CI/Nix tweaks, post a single `_No UI changes — evidence step skipped._` comment under the `## Evidence` heading and exit.

### How to capture

1. **Ensure the dev server is up** at `http://localhost:5173`.
   - Probe with `curl -fsS http://localhost:5173/ -o /dev/null`.
   - If down, launch `just dev` with `run_in_background: true` and wait for the probe to succeed before continuing. Tear it down at the end of the step (`TaskStop`) — leaving a stray dev server holding port 5173 will block the next `/do` run.

2. **Reproduce the end state.** Kolu's client is a single-page app, so most "states" come from interaction (open command palette, drag a tab, open settings dialog) rather than a route. Use `mcp__chrome-devtools__new_page` (or `navigate_page`) for `http://localhost:5173/`, then drive the UI with `click` / `fill` / `press_key` / `wait_for` until the relevant state is on screen.

3. **Snap with `mcp__chrome-devtools__take_screenshot`.**
   - Default to `fullPage: true`. Use a viewport-only shot when the full page would be misleading (e.g. infinite terminal scrollback).
   - Save under `/tmp/kolu-evidence-<short-slug>.png`. Use a slug derived from the PR branch or feature so concurrent runs don't collide.
   - For **bug fixes**, capture two shots: one on the PR branch (the fix), and one on `master` (the bug). To get the master shot without disturbing the working tree, check out the file(s) from origin/master in a temporary worktree (`git worktree add ../kolu-master master`) and run a second dev server on a different port (`KOLU_CLIENT_PORT=5174 just dev` if the recipe supports it, otherwise just stop/start). Remove the worktree afterward.

### How to host the screenshots

`gh pr comment` cannot attach binary files. Push them to a long-lived `evidence-assets` GitHub release in the same repo and embed the resulting download URL:

```sh
# Create the release once (idempotent — second invocation no-ops)
gh release view evidence-assets >/dev/null 2>&1 || \
  gh release create evidence-assets \
    --title "Evidence assets (auto-uploaded by /do)" \
    --notes "Screenshots and other artifacts referenced from PR comments. Do not delete." \
    --prerelease

gh release upload evidence-assets /tmp/kolu-evidence-<slug>.png --clobber
```

The asset URL follows the pattern:

```
https://github.com/juspay/kolu/releases/download/evidence-assets/<filename>
```

### How to post

Single-quoted heredoc per the do-skill convention so backticks and `$` survive unescaped:

```sh
gh pr comment --body "$(cat <<'EOF'
## Evidence

**<one-line description of what's shown>**

![after](https://github.com/juspay/kolu/releases/download/evidence-assets/kolu-evidence-<slug>.png)

<!-- For bug fixes, include the before shot in a side-by-side table: -->

| Before (master) | After (this PR) |
|-----------------|-----------------|
| ![before](https://github.com/juspay/kolu/releases/download/evidence-assets/kolu-evidence-<slug>-before.png) | ![after](https://github.com/juspay/kolu/releases/download/evidence-assets/kolu-evidence-<slug>-after.png) |

<!-- Optional: 1–2 lines pointing reviewers at what to look for. -->
EOF
)"
```

Keep the comment short — the screenshots are the artifact; prose is just orientation.
