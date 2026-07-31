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

A third incident proved the threat isn't just `just dev`/`dev-auto`: an agent
reached for `just build` (`nix build`) to test the **production binary**
"deterministically," reasoning it was *safer* than the flaky dev server. But the
built `result/bin/kolu` **ignores `KOLU_STATE_DIR`** and binds the **production
state dir** `~/.config/kolu` + the production kaval socket ([#1414](https://github.com/juspay/kolu/issues/1414)) —
a worse collision than ports/RAM, sharing *state* with live `kolu.service`. It
left a stray instance alive on production's socket. So: **the built binary
(`just build` → `result/bin/kolu`) is a forbidden local route too** — never run a
production build locally beside a live kolu; it goes on a pu box like everything
else. "Production-faithful" is not "production-safe"; faithfulness is exactly why
it collides.

So before launching anything, decide where it runs.

**`systemctl --user is-active kolu` is NOT the gate — do not use it alone.** It
only sees the *packaged* unit, and it answers `inactive` in two indistinguishable
cases: the unit is stopped, and **the unit does not exist at all** (exit 4, `Unit
kolu.service could not be found`). Reading that `inactive` as "nothing is live, so
local is safe" is the caught-error-collapses-to-a-default defect from the design
philosophy, wearing a venue-gate hat — and it is not hypothetical. On the
maintainer's own machine there is **no `kolu.service` unit at all**, while five
kolus run, one of them a 22-hour `just dev` from another worktree holding the
user's live PTYs and agent sessions. The OOM-killer does not care which of the two
shapes started the kolu it reaps; a gate that only sees one of them licenses
exactly the incident it exists to prevent.

So probe for **any** live kolu, both shapes, read-only:

```sh
systemctl --user is-active kolu           # packaged production — may not exist here
pgrep -af 'packages/kaval/src/bin\.ts'    # EVERY kolu's pty-host daemon: packaged AND `just dev`
```

Every kolu — nix-store binary or `just dev` out of a worktree — runs
`packages/kaval/src/bin.ts`, so the second probe is the one that actually holds.
(Read-only `pgrep` is fine and is used this way in **remote-host-testing**; the
ban in §5 is on pattern-*killing*, never on pattern-*looking*.)

- **Run on a `pu` box (the default for `/be`-style runs)** whenever that `pgrep`
  prints anything, or `is-active` says `active`. Builds, the dev server, and
  evidence capture all go on a fresh pu box (see the **pu** and **evidence**
  skills): the box has its own RAM and loopback, so a local OOM can't reach any of
  them. **Never** loop `just dev-auto` + nix builds locally next to a live kolu —
  and **never run the built `result/bin/kolu` locally** either (it grabs the
  production state dir + kaval socket; isolating ports is not enough).
- **Run locally only** when the `pgrep` is **empty** *and* `is-active` is not
  `active` — i.e. you positively established that no kolu of either shape is
  running here. Then the rest of this skill (random ports, scoped teardown)
  applies.

An inconclusive or erroring probe means **pu**, never local — absence of evidence
is not evidence of absence. When in doubt, prefer pu: a clean CI-like box never
touches the user's machine.

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

`.dev-server/` is gitignored (like `.agent-debate/` / `.lens-debate/`), so the
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

- **Teardown kills ONLY the exact PIDs recorded at spawn time.** Capture `$!`
  the instant you launch anything backgrounded (`nohup … & PID=$!; echo "$PID"
  >> .dev-server/spawned.pids`) and kill those PIDs — plus the port-resolved
  dev PIDs above — nothing else. Didn't capture it? Leave the process.
- **NO pattern selection of processes, in ANY form.** `pkill -f`,
  `pgrep | kill`, and a hand-rolled `ps | grep | kill` are the same banned
  class — as is matching by marker, substring, socket path, or store path.
  The hand-rolled variant is not a loophole: one such marker,
  `kaval-<digest>/pty-host`, matched **every** kaval on the box and killed
  production — every PTY died (2026-07-12). A stray the pids file missed is
  **reported** (pid + args), never hunted.

**A cleanup kill that returns non-zero (e.g. exit 144 — `SIGKILL`+128, you killed
your own process group) or visibly kills your own shell means you mismatched the
target: STOP.** Do not "retry" it or run a broader pattern — re-check which PID you
hit (`ps -p "$PID" -o pid,uptime,args`); a long uptime / low PID is production, not
your seconds-old spawn. Re-running a substring kill after the first failure is how
the production-kaval kill compounded.

## Acceptance (verify before declaring the app launched / torn down)

- **Local was the right venue at all** — you ran §0's **both-shapes** probe and
  the `pgrep` came back **empty** (or the user OK'd local). An `is-active` of
  `inactive` on its own does **not** clear this bar. If any kolu is live here,
  heavy work belonged on a pu box (§0); a single throwaway local launch is one
  thing, but **never** a loop of `dev-auto` + builds beside it.
- Two **random** ports, both remembered in `.dev-server/ports.json` and reused
  across the session (no re-grepping, no guessing).
- **Every** kolu that was live before your run is still live after it — same PIDs,
  same uptimes (`pgrep -af 'packages/kaval/src/bin\.ts'` before and after, plus
  `systemctl --user status kolu` if that unit exists). A changed uptime means it
  restarted; an OOM kill counts as touching it, even if no command of yours named
  it — and it counts just as much for a `just dev` kolu as for `kolu.service`.
- Teardown removes **only** the dev instance (the remembered PIDs); production
  keeps running.
