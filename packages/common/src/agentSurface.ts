/**
 * `agentSurface` — the typed wire shape `kolu --stdio` agents serve over
 * stdio. The parent's `RemoteTerminalBackend` consumes it; the agent
 * implements it backed by its local PTY world. Kolu's main user-facing
 * surface (`kolu-common/surface`) is a separate contract — the parent
 * re-serves that one to the browser, mirroring agent state into its own
 * `terminalMetadata` collection.
 *
 * R-2 ships this contract in slices:
 *
 *   - 2b (this commit) — wire shape + `system.heartbeat` to prove the
 *     stdio link is alive. Subsequent slices populate the collection
 *     and add terminal/fs/git procedures into the same `defineSurface`
 *     declaration (no parallel contract).
 *   - 2c — heartbeat-as-layer consumer (parent-side, no schema change).
 *   - 2d — `terminal.{spawn,kill,write,resize}` procedures +
 *     `terminalData`/`terminalCommandRun`/`terminalTitle` streams.
 *   - 2e — populating the `terminalMetadata` collection from the agent's
 *     local backend (no schema change — same collection shape).
 *
 * **AgentTerminalMetadata is the server half** of `TerminalMetadata`
 * (cwd, git, agent, pr, foreground, lastAgentCommand, lastActivityAt).
 * UI-only state (themeName, canvasLayout, subPanel, rightPanel, intent,
 * parentId) lives on the parent side only — the agent has no business
 * knowing the user's pixel layout.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { z } from "zod";
import { TerminalIdSchema, TerminalServerMetadataSchema } from "./surface.ts";

export const agentSurface = defineSurface({
  collections: {
    /** Server-half of per-terminal metadata, keyed by terminal id. The
     *  parent mirrors this into its own `surface.terminalMetadata`
     *  collection via `mirrorRemoteCollection` (slice 2e). */
    terminalMetadata: {
      keySchema: TerminalIdSchema,
      schema: TerminalServerMetadataSchema,
      verbs: ["keys", "get"],
    },
  },
  procedures: {
    system: {
      /** Parent's heartbeat layer polls this every 5s once
       *  `markConnected()` has fired. The agent returns its pid so
       *  parent-side debugging (`kill -USR1 $pid`) stays cheap. */
      heartbeat: {
        input: z.object({}),
        output: z.object({ ok: z.boolean(), pid: z.number() }),
      },
    },
  },
});

export type AgentSurface = SurfaceTypes<typeof agentSurface.spec>;
export type AgentTerminalMetadata =
  AgentSurface["collections"]["terminalMetadata"]["Value"];
export type AgentContract = typeof agentSurface.contract;
