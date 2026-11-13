/**
 * The kolu MCP face's v1 expose map — the ratified contract table from the
 * kolu-cli plan (docs/atlas/src/content/atlas/kolu-cli.mdx → "The MCP face"),
 * spelled as `@kolu/surface-mcp`'s default-deny allowlist, in its TWO
 * projections: over one host's `padiSurface` ({@link KOLU_MCP_EXPOSE}, what
 * `kolu mcp` serves) and over the whole fleet's `fleetSurface`
 * ({@link KOLU_FLEET_EXPOSE}, what kolu-server serves the conductor).
 *
 * **The terminal verbs have ONE definition.** {@link KOLU_MCP_TOOL_EXPOSE}
 * holds the rows and both maps spread it, because the two faces differ in what
 * a terminal is CALLED, never in what may be done to one. Two lists would be
 * two things to widen, and the day they disagreed an agent would find a verb on
 * one face that the other had quietly dropped.
 *
 * What the fleet face does NOT get is the standing subscription: `watch.close`
 * is a row of the stdio map alone, and `fleetSurface` declares no `watch`
 * member to hold one. That face serves exactly one conversation — the
 * conductor's — and a conversation sitting in a drain is a conversation a human
 * cannot speak into. It is woken instead; see {@link KOLU_FLEET_EXPOSE}.
 *
 * **The RESOURCE lists differ, on purpose.** `identity` · `status` ·
 * `daemonStatus` are per-host health facts: fleet-wide there is no single
 * answer to "what commit is padi?", there are N answers. So on the fleet face
 * they are COLUMNS of the one `hosts` resource — which is also the live roster,
 * and the thing an agent must be able to read before it can act on a refusal
 * naming a host. That resource is a CELL of ROWS (`surface://cells/hosts`), so
 * "which hosts can I use, and what is each one doing" is ONE read: as a
 * collection it would have been a key SET, and an agent that could name the
 * fleet would have had to guess a per-host template URI to learn anything
 * about a member of it. The stdio face has no `hosts` for the mirror reason: a
 * face serving one padi has one host, and a roster of one is a row an agent
 * would have to read to learn what it already knows.
 *
 * **Default deny**: an omitted member is unreachable, full stop. Widening this
 * map is a one-row diff with a review, never a default. The named denials below
 * ({@link KOLU_MCP_DENIED}) are explicit non-entries — each was considered and
 * refused, so a future widening argues against a recorded reason, not an
 * oversight.
 *
 * The table's "status — daemon/kaval health" row maps to THREE padiSurface
 * members (the status story): the `daemonStatus` collection (kaval liveness),
 * the `status` cell (kaval build-currency, `expectedKaval`), and the `identity`
 * cell — padi's own boot time + build commit, exposed read-only so an agent can
 * SEE "the daemon restarted under me" instead of inferring it from weirdness
 * (the restart-discipline section's generation-visibility mandate).
 *
 * `screen.text`, `lifecycle.sendInput`, `lifecycle.create` and `watch.open`
 * are deliberately NOT exposed as raw procedures here — each is served by a
 * bespoke tool of the same wire name (`screen_text` adds the tail mode the
 * skills' "read the last N lines" call needs; `lifecycle_sendInput` adds the
 * named-key vocabulary with the text-XOR-key submit discipline;
 * `lifecycle_create` adds the worktree directory and the typed first command,
 * so one call is `kolu create --toplevel --repo … --worktree … -- <cmd>`;
 * `watch_open` resolves `ignoreSelf` from this process's containing terminal,
 * which the daemon cannot). These are SUPERSESSIONS, not denials: the verb is
 * still reachable under its own wire name, so it does not belong in
 * {@link KOLU_MCP_DENIED} (whose members must all fail as `unknown tool`), and
 * the boot-time name-collision gate in `@kolu/surface-mcp` is what guarantees
 * the raw and bespoke spellings can never both register. The composite `wait_*`
 * tools are likewise bespoke (client-side scaffolding, not padiSurface
 * procedures), as is `agent_say` — which is a COMPOSITION of
 * `lifecycle.sendInput` plus the agent's own submit keys, and so has no raw
 * procedure of its own to supersede.
 *
 * `lifecycle_create` carries the #1872 protection the raw row used to state:
 * there is NO `command`/`env` spawn parameter, so a terminal created through
 * this face always gets the rc-hooked shell with the daemon's own clean env.
 * Its `run` is typed at that shell's first prompt, never an argv the daemon
 * execs. See `create.ts`.
 */

import type { PadiSurfaceSpec } from "@kolu/padi-client/surface";
import type { ExposeMap } from "@kolu/surface/expose";
import type { FleetSurfaceSpec } from "./fleet/fleetSurface.ts";

/** The TOOL rows BOTH projections mint, written once. Spread into each map
 *  below rather than restated in it: what an agent may DO to a terminal is the
 *  same on both faces, and a second list is where that stops being true.
 *
 *  The ONE exception is stated as a row of its own below, not hidden here:
 *  `watch.close` is stdio-only, because the fleet face serves no standing
 *  subscription at all (see {@link KOLU_FLEET_EXPOSE}). */
const KOLU_MCP_TOOL_EXPOSE = {
  // ── Read-only tools ──────────────────────────────────────────────────────
  "screen.history": { tool: { mutates: false } },
  "git.getStatus": { tool: { mutates: false } },
  "git.getDiff": { tool: { mutates: false } },
  "fs.listAll": { tool: { mutates: false } },
  "fs.readFile": { tool: { mutates: false } },

  // ── Mutating tools ───────────────────────────────────────────────────────
  // `lifecycle.create` is superseded by the bespoke tool of the same wire name
  // — see the module doc.
  /** Kill one terminal by id. */
  "lifecycle.kill": { tool: { mutates: true } },
} as const;

export const KOLU_MCP_EXPOSE = {
  // ── Resources (subscribable) ─────────────────────────────────────────────
  /** The live roster — id, title, command, agent kind + state per terminal. */
  terminals: "resource",
  /** The awaiting-ids set — which terminals need a human/agent NOW. */
  urgency: "resource",
  // The "status" story — daemon/kaval health + generation visibility:
  daemonStatus: "resource",
  status: "resource",
  identity: "resource",

  ...KOLU_MCP_TOOL_EXPOSE,

  // ── Standing settle-event subscriptions (this face only) ─────────────────
  // `watch.open` is superseded by the bespoke tool of the same wire name —
  // it resolves `ignoreSelf` from KAVAL_TERMINAL_ID, which the daemon cannot.
  /** Drop a subscription and its buffer. */
  "watch.close": { tool: { mutates: true } },
  // `watch.drain` is NOT exposed raw: it never blocks (by design — padi holds no
  // handler open), so an agent handed only that verb would poll. The bespoke
  // `watch_next` tool is the drain, and it parks on the pulse instead.
} as const satisfies ExposeMap<PadiSurfaceSpec>;

/** The FLEET projection — the same terminal verbs over `fleetSurface`, where a
 *  terminal is `host/id`. The three per-host health resources are gone and
 *  `hosts` is in their place; the module doc argues why.
 *
 *  There is no `watch.close` row and no `watch` member to put one on. This face
 *  serves ONE conversation — the conductor's — and that conversation may never
 *  be inside a call that blocks: it says what it watches and ends its turn,
 *  and kolu-server starts the next one when a watched terminal's agent stops,
 *  asks, or dies. The watch list is moved by two bespoke tools
 *  (`watch_terminal` / `unwatch_terminal`, `fleet/watchList.ts`) which address
 *  a TERMINAL rather than a subscription, so there is nothing here to close. */
export const KOLU_FLEET_EXPOSE = {
  // ── Resources (subscribable) ─────────────────────────────────────────────
  /** Every terminal on every connected host, keyed `<host>/<id>`. */
  terminals: "resource",
  /** Who needs someone, fleet-wide, at host-qualified ids. */
  urgency: "resource",
  /** The live roster, and the per-host health facts as its columns. */
  hosts: "resource",

  ...KOLU_MCP_TOOL_EXPOSE,
} as const satisfies ExposeMap<FleetSurfaceSpec>;

/** The NAMED denials — every member deliberately refused in v1, with the
 *  recorded reason. Each is an explicit non-entry, not an oversight; the unit
 *  test pins that none of these ever appears in {@link KOLU_MCP_EXPOSE} and
 *  that calling one through a served face fails as unknown.
 *
 *  Beyond this list, the `test__set` cell verbs and the cells not named in the
 *  map (`version`, `processMemory`, `hostInventory`, `hostListeners`, `activityFeed`, `session`,
 *  `newTerminalPolicy`, `agentDistro`, `agentDistroStatus`, `agentDistroReceipt`)
 *  are denied
 *  structurally by omission — resources are read-only projections and an
 *  unexposed member never registers. An agent's `lifecycle.create` still OBEYS
 *  `newTerminalPolicy` (that's #2045) and the Agents setting; it just cannot read
 *  or rewrite the user's choice. */
export const KOLU_MCP_DENIED: readonly { member: string; reason: string }[] = [
  {
    member: "terminalAttach",
    reason:
      "a raw byte stream is the wrong shape for MCP consumers — screen_text is the read face (the wait_outputSettled tool consumes the stream internally, watched not rendered)",
  },
  {
    member: "activity",
    reason:
      "padi's activity stream has NO current-value snapshot — createLiveActivitySource builds a fresh empty tracker per subscription and counts bytes only from subscribe-time, so a fresh subscriber (every MCP resources/read opens one) always starts empty. An MCP resource read of activity is therefore always [] and its subscribe delivers a bare change-nudge with no readable value — a resource that can't honor the read contract. `urgency` (a snapshot-bearing cell) answers who-needs-attention; the `terminals` records carry per-terminal agent state. A readable activity would need a snapshot-bearing source or an adapter that retains the streamed frame — a follow-up, not a v1 row.",
  },
  {
    member: "watchStates",
    reason:
      "the agent-state watch reaches this face through the states/heldForMs/nagMs params on watch.open, which is the SAME engine with a queue in front of it. Exposing the raw stream as well would give an agent a second, UNBUFFERED spelling of one feature — and unbuffered is exactly wrong here: an MCP client is not holding a socket between calls, so every nag that fired while it was thinking would be lost, which is the failure mode the standing subscription exists to remove. A socket-holding face (kolu watch) is what the stream is for.",
  },
  {
    member: "lifecycle.killAll",
    reason: "daemon-admin blast radius — a human verb",
  },
  {
    member: "lifecycle.recycleKaval",
    reason: "daemon-admin blast radius — a human verb",
  },
  {
    member: "lifecycle.discardSleeping",
    reason: "daemon-admin blast radius — a human verb",
  },
  { member: "lifecycle.sleep", reason: "lifecycle policy the canvas owns" },
  { member: "lifecycle.wake", reason: "lifecycle policy the canvas owns" },
  { member: "lifecycle.restart", reason: "lifecycle policy the canvas owns" },
  {
    member: "agentDistro.report",
    reason:
      "kolu-server's word on a delivery it ran to this host — the binder's own channel; an agent that called it would be telling padi a bundle landed that kolu never delivered",
  },
  { member: "lifecycle.resize", reason: "layout policy the canvas owns" },
  {
    member: "chrome.setTheme",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "chrome.setIntent",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "chrome.setParent",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "chrome.setActive",
    reason:
      "browser canvas arrangement — hazardous to script (steals the human's focus)",
  },
  {
    member: "chrome.setCanvasLayout",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "chrome.setSubPanel",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "chrome.setRightPanel",
    reason: "browser canvas arrangement — meaningless for an agent",
  },
  {
    member: "git.worktreeCreate",
    reason:
      "write-side beyond terminal control — composed INSIDE the bespoke `lifecycle_create` (behind the CLI's directory gates), not exposed as a raw verb; further raw write verbs stay expandable later, on demand, one row at a time",
  },
  {
    member: "git.worktreeRemove",
    reason:
      "write-side beyond terminal control — expandable later, on demand, one row at a time",
  },
  {
    member: "scratch.write",
    reason:
      "write-side beyond terminal control — expandable later, on demand, one row at a time",
  },
  {
    member: "session.restore",
    reason: "admin — session policy is the human's",
  },
  { member: "session.import", reason: "admin — session policy is the human's" },
  {
    member: "session.forfeit",
    reason: "admin — session policy is the human's",
  },
  {
    member: "screen.state",
    reason:
      "raw VT bytes (the serialized screen) — screen_text is the text read face",
  },
  {
    member: "fs.filePreviewTag",
    reason: "an iframe-preview cache tag — meaningless outside the browser",
  },
  {
    member: "preview.read",
    reason:
      "iframe binary preview plumbing — fs.readFile is the agent read face",
  },
  {
    member: "preview.repoRootForTerminal",
    reason: "iframe binary preview plumbing",
  },
  {
    member: "transcript.exportHtml",
    reason: "a browser export flow — not an agent verb (expandable on demand)",
  },
  {
    member: "watch.drain",
    reason:
      "served by the bespoke `watch_next` tool, which adds the blocking half — the raw verb never blocks (padi holds no handler open), so exposing it alone would teach agents to poll the very thing this feature exists to stop",
  },
  {
    member: "watchPulse",
    reason:
      "input-bearing pulse stream — the doorbell `watch_next` consumes internally; the events themselves ride the drain, never the pulse",
  },
  {
    member: "subscribeRepoChange",
    reason: "input-bearing pulse stream — not exposable as a static resource",
  },
  {
    member: "subscribeFileChange",
    reason: "input-bearing pulse stream — not exposable as a static resource",
  },
  {
    member: "terminalExit",
    reason:
      "input-bearing event — the wait tools consume exits internally; the terminals resource carries departures",
  },
] as const;
