---
description: How to capture and post UI evidence on PRs
---

## PR Evidence

When the change has visible UI impact, post a `## Evidence` PR comment with screenshots. Use judgment — server-only diffs sometimes ripple into rendering.

**Delegate to a subagent** (`Agent(subagent_type="general-purpose", model="sonnet")`) so the main context stays clear of MCP and screenshot noise. Brief it with: the dev-server URL, what scenarios to capture, a `/tmp/kolu-evidence-<slug>.png` filename, and the PR number. Have it return only the markdown body it posted.

### Dev server

Spawn a dedicated dev server on a **free random port** (the user may have one on 5173 already). Hold the port number in a shell variable for the subagent and kill the process at the end:

```sh
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); p=s.getsockname()[1]; s.close(); print(p)')
# Override the client port — read packages/client/vite.config.ts and the
# `client`/`dev` recipes to find the right flag/env (e.g. `pnpm dev -- --port $PORT`).
just dev &  # adjusted for the port override
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' EXIT
```

For bug fixes that need a "before" shot, run a second server from a `git worktree` on `master` (different free port). Never stash the PR branch.

### Capture, host, post

The subagent drives `chrome-devtools` MCP — `new_page` at `http://localhost:$PORT/`, reproduces the relevant state, `take_screenshot` to `/tmp/kolu-evidence-<slug>.png`.

`gh pr comment` can't attach binaries, so upload to a long-lived `evidence-assets` GitHub release and embed the download URL inline:

```sh
gh release view evidence-assets >/dev/null 2>&1 || \
  gh release create evidence-assets --prerelease \
    --title "Evidence assets (auto-uploaded by /do)" --notes "Do not delete."
gh release upload evidence-assets /tmp/kolu-evidence-<slug>.png --clobber
```

URL pattern: `https://github.com/juspay/kolu/releases/download/evidence-assets/<filename>`. Use the single-quoted heredoc pattern (`<<'EOF'`) when posting so backticks and `$` survive unescaped.
