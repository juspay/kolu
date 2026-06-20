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

## 0. First decide local vs. pu — production lives on this machine

Disrupting production is **not only a port collision.** A second incident: an
agent ran `just dev-auto` repeatedly (each forks a node server + a kaval daemon)
plus nix builds, all on the user's machine *while production kolu and other
agents were live* — the pile-up drove the **OOM-killer to `SIGKILL` production**
(`status=9/KILL`). Random ports kept it off production's *ports*; nothing kept it
off production's *RAM*. The user's standing rule after that: **"always run on pu,
nothing locally."**

So before launching anything, decide where it runs:

- **Run on a `pu` box (the default for `/be`-style runs)** whenever production
  kolu is live on this machine — i.e. any time `systemctl --user is-active kolu`
  is `active`. Builds, the dev server, and evidence capture all go on a fresh pu
  box (see the **pu** and **evidence** skills): the box has its own RAM and
  loopback, so a local OOM can't reach production. **Never** loop `just dev-auto`
  + nix builds locally next to a live production kolu.
- **Run locally only** when production is **not** running here (`is-active` →
  `inactive`/`failed`), or the user has explicitly OK'd local execution this
  session. Then the rest of this skill (random ports, scoped teardown) applies.

When in doubt, prefer pu — a clean CI-like box never touches the user's machine.

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

- **Local was the right venue at all** — production kolu was `inactive` (or the
  user OK'd local). If production is live here, heavy work belonged on a pu box
  (§0); a single throwaway local launch is one thing, but **never** a loop of
  `dev-auto` + builds beside it.
- Two **random** ports, both remembered in `.dev-server/ports.json` and reused
  across the session (no re-grepping, no guessing).
- Production `kolu.service` **provably untouched** — `systemctl --user status
  kolu` shows the same PID **and uptime** before and after your run (a changed
  uptime means it restarted — an OOM kill counts as touching it, even if no
  command of yours named it).
- Teardown removes **only** the dev instance (the remembered PIDs); production
  keeps running.
