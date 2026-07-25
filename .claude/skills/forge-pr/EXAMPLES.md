# Worked examples

Side-by-side bad/good PR bodies. Read when you want a model to imitate; the
rules in `SKILL.md` stand on their own without them.

## Examples

### Bad (typical LLM output)

```
Title: Update NixOS configuration and add new service

## Summary
- Added `kolu` service configuration
- Updated `flake.lock`
- Modified port from 8080 to 8090
- Added health check endpoint
- Updated README

## Testing
- Tested locally
```

### Good (small change — narrative is enough)

```
Title: Add kolu service with health monitoring

**Kolu now runs as a standalone NixOS service** with its own systemd
unit and a dedicated health-check endpoint. Previously it was bolted
onto the main app process, which made restarts disruptive.

The service binds to port 8090 to avoid clashing with the dev server.
*Health checks hit `/healthz` every 30s — systemd restarts the
service on three consecutive failures.*
```

### Good (richer change — structure earns its keep)

When the change has a flow, several discrete features, and a couple of before/after refinements, _show_ those instead of writing them out as prose:

````
Title: Export agent session as a self-contained HTML file

**Kolu can now export the active agent session as a portable,
self-contained HTML file** — Claude Code, OpenCode, or Codex, no
matter which one is running. The server reads the on-disk transcript,
normalizes it through a unified vendor-opaque IR, and ships back one
HTML document the browser opens in a new tab.

### How it fits together

```
Claude JSONL    ─┐
OpenCode SQLite ─┼─▶ loader ─▶ TranscriptEvent[] ─▶ renderer ─▶ HTML
Codex rollout   ─┘             (discriminated union)
```

The IR (`Transcript` in `anyagent/schemas`) is the key seam. The
renderer dispatches **only** on `event.kind` — never on `agentKind`.
_Adding a fourth integration is one new loader plus one `match` arm._

### What you get in the exported page

- **Header pills** — agent name, model, context-token count, PR link
- **Hide tools** — collapses tool-call cards for narrative reading
- **Theme** — cycles auto → light → dark
- **<kbd>j</kbd>/<kbd>k</kbd> nav** — jump between user prompts
- **Per-event icons** — person, robot, brain, wrench

### Refinements during review

| What was off | Fix |
| --- | --- |
| Claude loader threw `ENOENT` for new sessions; OpenCode/Codex returned `null` | All three loaders return `Transcript \| null` uniformly |
| OpenCode loader did per-message N+1 SQLite fetches | Collapsed into one ordered `LEFT JOIN` (~501 statements → 1) |

> _No streaming, by design — end-of-session export reads the whole
> transcript in one pass._
````

The flow diagram replaces a paragraph that would have to enumerate "Claude JSONL, OpenCode SQLite, Codex rollout — all converge on a single loader interface...". The bullet list replaces a comma-jammed sentence. The table replaces "Two refinements landed: first, the Claude loader used to throw...; second, the OpenCode loader collapsed...". Each structural element is doing work prose couldn't do as cleanly.
