import type { PadiSurfaceSpec } from "@kolu/padi-client/surface";
import type { ExposeMap } from "@kolu/surface/expose";
import type { FleetSurfaceSpec } from "./fleet/fleetSurface.ts";

const KOLU_MCP_TOOL_EXPOSE = {
  "screen.history": { tool: { mutates: false } },
  "git.getStatus": { tool: { mutates: false } },
  "git.getDiff": { tool: { mutates: false } },
  "fs.listAll": { tool: { mutates: false } },
  "fs.readFile": { tool: { mutates: false } },

  "lifecycle.kill": { tool: { mutates: true } },
} as const;

export const KOLU_MCP_EXPOSE = {
  terminals: "resource",
  urgency: "resource",
  daemonStatus: "resource",
  status: "resource",
  identity: "resource",

  ...KOLU_MCP_TOOL_EXPOSE,

  "watch.close": { tool: { mutates: true } },

  "diagnostics.read": { tool: { mutates: false } },
} as const satisfies ExposeMap<PadiSurfaceSpec>;

/** The FLEET projection — the same terminal verbs over `fleetSurface`, where a
 *  terminal is `host/id`. The three per-host health resources are gone and
 *  `hosts` is in their place; the module doc argues why.
 *
 *  There is no `watch.close` row and no `watch` member to put one on. This face
 *  serves ONE conversation — the conductor's — and that conversation may never
 *  be inside a call that blocks: it says what it is running and ends its turn,
 *  and kolu-server starts the next one when a member terminal's agent stops,
 *  asks, or dies. A work's membership is moved by bespoke tools (`work_adopt`
 *  / `work_leave`, `fleet/works.ts`) which address a TERMINAL rather than a
 *  subscription, so there is nothing here to close. */
export const KOLU_FLEET_EXPOSE = {
  terminals: "resource",
  urgency: "resource",
  hosts: "resource",
  works: "resource",

  ...KOLU_MCP_TOOL_EXPOSE,
} as const satisfies ExposeMap<FleetSurfaceSpec>;

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
  {
    member: "agentDistro.models",
    reason:
      "the harness and model a piece of work runs on are kolu's to offer, not the Conductor's: the setup form asks the host itself, and `lifecycle_create` builds a planner's or implementor's command off the work's answers — an agent reading the list would only be back to writing the flags",
  },
  {
    member: "agentDistro.launch",
    reason:
      "how a harness takes a model is read by kolu itself when `lifecycle_create` starts a planner or implementor off the work's answers — an agent holding it would only be back to writing the flags",
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
