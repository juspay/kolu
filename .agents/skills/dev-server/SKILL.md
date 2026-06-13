---
name: dev-server
description: >-
  Launch the kolu dev server on two RANDOM free ports so it never collides with
  the running production `kolu.service`, remember the ports for the rest of the
  session, and tear down only the dev instance. Load before running the app
  locally — for evidence capture, driving a live kolu with the chrome-devtools
  MCP, or any `just dev` you'd otherwise run by hand. Triggers on "run kolu
  locally", "launch the dev server", "boot kolu", "drive a live kolu", "start the
  app to screenshot it", or before pointing chrome-devtools at a local kolu.
---

# dev-server — launch kolu locally without touching production

A long-running production kolu (`kolu.service`, systemd `--user`) listens on the
**fixed default ports** `7681`/`5173`. An agent that runs `just dev` (or
`just dev 7681 5173`) binds those same ports and **disrupts production** — this
happened on [#1109](https://github.com/juspay/kolu/issues/1109). Never bind the
defaults; never touch the systemd unit. This skill is the canonical "run the app
locally" path so that can't recur.

## 1. Launch on two random free ports — always `just dev-auto`

```sh
just dev-auto
```

`dev-auto` picks **two unique free ports** (backend + frontend), exports them,
and prints the resolved URLs before forking server + client with HMR:

```
→ server http://localhost:<SERVER_PORT>
→ client http://localhost:<CLIENT_PORT>
```

**Never** run `just dev` with the fixed defaults, and **never** pass the production
ports positionally (`just dev 7681 5173`). `dev-auto` is the only launch command.
Run it in the background (it stays up serving with hot reload).

## 2. Remember both ports — persist, don't re-grep

Parse the two URLs once and persist them to a per-worktree scratch file so every
later tool call (and chrome-devtools) reaches the right URL without re-grepping
logs or guessing:

```sh
# Capture from the backgrounded dev-auto output ($dev_log)
server_url=$(grep -oE '→ server (http://[^ ]+)' "$dev_log" | awk '{print $3}')
client_url=$(grep -oE '→ client (http://[^ ]+)' "$dev_log" | awk '{print $3}')
mkdir -p .dev-server
jq -n --arg s "$server_url" --arg c "$client_url" \
  '{server:$s, client:$c}' > .dev-server/ports.json   # gitignored, per-worktree
```

`.dev-server/` is gitignored (like `.codex-debate/` / `.lens-debate/`), so the
scratch never shows up in a diff. Read `.dev-server/ports.json` whenever you need
the URL again — single source of truth for the session.

## 3. Learn production's ports — read-only, to steer clear

Inspect the running unit purely to confirm which ports/PID to **avoid**. Never
mutate it:

```sh
systemctl --user status kolu --no-pager   # production's PID + state (read-only)
ss -ltnp | grep -i kolu                    # which ports production holds
```

**Never** `start` / `stop` / `restart` / `kill` the `kolu.service` unit or its
nix-store process. You only read its state — `dev-auto`'s random ports already
keep you off it.

## 4. Hand chrome-devtools the remembered client URL

```sh
client_url=$(jq -r .client .dev-server/ports.json)
```

`navigate_page` the chrome-devtools MCP to `$client_url` — never to `:5173`.
This is the local path the evidence skill's "drive a state live" step (§A2) uses
for a state no e2e scenario reaches.

## 5. Tear down only the dev instance

On cleanup, kill **only** the PIDs bound to the remembered random ports (or rooted
in this worktree). Resolve them from the scratch file — never a broad `pkill`:

```sh
for url in $(jq -r '.server, .client' .dev-server/ports.json); do
  port=${url##*:}
  pid=$(ss -ltnp "sport = :$port" | grep -oP 'pid=\K[0-9]+' | head -1)
  [ -n "$pid" ] && kill "$pid"
done
rm -f .dev-server/ports.json
```

**Never** `pkill -f kolu` / `vite` / `tsx` — those broad patterns can hit
production or unrelated processes. Match the remembered ports only.

## Acceptance (verify before declaring the app launched / torn down)

- Two **random** ports, both remembered in `.dev-server/ports.json` and reused
  across the session (no re-grepping, no guessing).
- Production `kolu.service` **provably untouched** — bracket the session with
  `just prod-guard snapshot` (before) and `just prod-guard check` (after); it
  fails loudly if the live unit's PID, restart count, or start time moved, instead
  of relying on you to eyeball `systemctl --user status kolu`.
- Teardown removes **only** the dev instance (the remembered PIDs); production
  keeps running.
