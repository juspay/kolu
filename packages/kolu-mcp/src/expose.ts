/**
 * The kolu MCP face's v1 expose map — the ratified contract table from the
 * kolu-cli plan (docs/atlas/src/content/atlas/kolu-cli.mdx → "The MCP face"),
 * spelled as `@kolu/surface-mcp`'s default-deny allowlist over `padiSurface`.
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
 * `screen.text` and `lifecycle.sendInput` are deliberately NOT exposed as raw
 * procedures here — each is served by a bespoke tool of the same wire name
 * (`screen_text` adds the tail mode the skills' "read the last N lines" call
 * needs; `lifecycle_sendInput` adds the named-key vocabulary with the
 * text-XOR-key submit discipline). The composite `wait_*` tools are likewise
 * bespoke (client-side scaffolding, not padiSurface procedures).
 */

import type { PadiSurfaceSpec } from "@kolu/padi/surface";
import type { ExposeMap } from "@kolu/surface-mcp";

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

  // ── Read-only tools ──────────────────────────────────────────────────────
  "screen.history": { tool: { mutates: false } },
  "git.getStatus": { tool: { mutates: false } },
  "git.getDiff": { tool: { mutates: false } },
  "fs.listAll": { tool: { mutates: false } },
  "fs.readFile": { tool: { mutates: false } },

  // ── Mutating tools ───────────────────────────────────────────────────────
  /** Spawn a terminal — takes only `cwd` + an optional `parentId` (plus display
   *  chrome); returns the TerminalInfo whose `id` the driving agent captures.
   *  There is deliberately NO `command` and NO `env` parameter (`PadiCreateInputSchema`
   *  is `{ cwd?, parentId? }` — packages/padi/src/surface.ts): a terminal created
   *  through a face always gets the rc-hooked shell with the daemon's own clean env,
   *  so an agent literally cannot ask for a shell-less, caller-env-carrying terminal —
   *  the exact shape that silently lost agent transcripts in #1872. The missing
   *  `command`/`env` is the protection, not a gap; do not add it here. */
  "lifecycle.create": { tool: { mutates: true } },
  /** Kill one terminal by id. */
  "lifecycle.kill": { tool: { mutates: true } },
} as const satisfies ExposeMap<PadiSurfaceSpec>;

/** The NAMED denials — every member deliberately refused in v1, with the
 *  recorded reason. Each is an explicit non-entry, not an oversight; the unit
 *  test pins that none of these ever appears in {@link KOLU_MCP_EXPOSE} and
 *  that calling one through a served face fails as unknown.
 *
 *  Beyond this list, the `test__set` cell verbs and the cells not named in the
 *  map (`version`, `processMemory`, `hostInventory`, `activityFeed`, `session`,
 *  `newTerminalPolicy`) are denied structurally by omission — resources are
 *  read-only projections and an unexposed member never registers. An agent's
 *  `lifecycle.create` still OBEYS `newTerminalPolicy` (that's #2045); it just
 *  cannot read or rewrite the user's setting. */
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
      "write-side beyond terminal control — expandable later, on demand, one row at a time",
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
