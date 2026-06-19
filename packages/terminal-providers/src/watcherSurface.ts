/**
 * `watcherSurface` — the typed contract `buildWatcherServer` serves and
 * kolu-server's local endpoint consumes in-process via `directLink` (the
 * no-wire member of the surface link family). A later phase serves the same
 * shape over an ssh `stdioLink` for a remote host — *local vs remote is only
 * the link*, which is the whole point of stating it as a contract now.
 *
 * The watcher is the host-resident half of awareness, **minus PTY-forwarding**:
 * it does NOT relay the pty-host surface (kolu-server still taps kaval
 * directly). It runs only the providers that read the host's own filesystem —
 * git, PR, and the agent detectors — and the agent-command tracker that feeds
 * them. So the contract is two halves:
 *
 *   1. **Signals in** (`terminal.*` lifecycle + `signal.*`) — the PTY-tap
 *      signals run in-server (kolu-server owns the kaval taps); it relays them
 *      to the host-side providers as procedure calls. `watch` seeds a terminal
 *      (pid for shell-idle detection, the spawn-time cwd the git/agent providers
 *      read once); `signal.{cwd,title,foreground,commandRun}` push each tap;
 *      `unwatch` tears the terminal down.
 *
 *   2. **Awareness out** — two per-terminal collections kolu-server mirrors and
 *      folds back onto its terminal metadata. They are split along the SAME
 *      persisted-vs-live write fence `metadata.ts` enforces, so the fold can
 *      keep the `terminals:dirty` autosave firehose off live churn:
 *        - `persistedAwareness` → `{ git, lastAgentCommand, lastActivityAt }`
 *          (folded via `updateServerMetadata`, fires `terminals:dirty`).
 *        - `liveAwareness` → `{ pr, agent }` (folded via
 *          `updateServerLiveMetadata`, does NOT).
 *      `cwd`, `foreground`, and `location` are deliberately absent — they stay
 *      in-server (kolu-server owns the cwd tap, the in-server foreground/process
 *      observer, and the endpoint's own location).
 *
 * The collection value schemas are `.pick`ed from kolu-common's canonical field
 * schemas, so the mirror cannot drift from the local metadata shape.
 */

import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import {
  LiveTerminalFieldsSchema,
  ServerPersistedTerminalFieldsSchema,
  TerminalIdSchema,
} from "kolu-common/surface";
import { z } from "zod";

/** The host-side providers' **persisted** output — the subset of
 *  `ServerPersistedTerminalFields` they own. `cwd` + `location` are excluded:
 *  the endpoint owns those in-server. */
export const PersistedAwarenessSchema =
  ServerPersistedTerminalFieldsSchema.pick({
    git: true,
    lastAgentCommand: true,
    lastActivityAt: true,
  });

/** The host-side providers' **live** output. `foreground` is excluded — the
 *  process observer runs in-server (the note's split). */
export const LiveAwarenessSchema = LiveTerminalFieldsSchema.pick({
  pr: true,
  agent: true,
});

const TerminalIdInputSchema = z.object({ id: TerminalIdSchema });

export const watcherSurface = defineSurface({
  collections: {
    persistedAwareness: {
      keySchema: TerminalIdSchema,
      schema: PersistedAwarenessSchema,
      // `keys` is unused — kolu-server already knows its terminal ids (it calls
      // `watch`), so it only ever subscribes per-key with `get`.
      verbs: ["get"],
    },
    liveAwareness: {
      keySchema: TerminalIdSchema,
      schema: LiveAwarenessSchema,
      verbs: ["get"],
    },
  },
  procedures: {
    terminal: {
      /** Begin watching a terminal. `pid` is the shell's pid (constant, the
       *  agent detectors compare it to the foreground pid for shell-idle); `cwd`
       *  is the spawn-time cwd the git/agent providers read once.
       *
       *  `seed` is the endpoint's CURRENT persisted awareness for this terminal.
       *  It is load-bearing for adoption (B3.3 redeploy survival): a restored
       *  survivor carries a non-zero `lastActivityAt` and a saved
       *  `lastAgentCommand`, and the watcher must seed its `record.meta` from
       *  them — both so the eager snapshot reproduces the restored values
       *  (rather than a defaults frame the endpoint would fold back, clobbering
       *  them) AND so `agentRecency`'s "don't re-bump a re-detected restored
       *  session" guard, which reads `record.meta.lastActivityAt`, actually
       *  fires. A fresh spawn passes its `createMetadata` defaults here, so the
       *  seed is a no-op for it. */
      watch: {
        input: z.object({
          id: TerminalIdSchema,
          pid: z.number(),
          cwd: z.string(),
          seed: PersistedAwarenessSchema,
        }),
        output: z.void(),
      },
      /** Stop watching a terminal — tear its providers down and drop its
       *  mirrored awareness. */
      unwatch: { input: TerminalIdInputSchema, output: z.void() },
    },
    /** The in-server PTY-tap signals, relayed to the host-side providers. Push,
     *  not forward: the watcher never taps kaval. */
    signal: {
      cwd: {
        input: z.object({ id: TerminalIdSchema, cwd: z.string() }),
        output: z.void(),
      },
      title: {
        input: z.object({ id: TerminalIdSchema, title: z.string() }),
        output: z.void(),
      },
      foreground: {
        input: z.object({
          id: TerminalIdSchema,
          process: z.string(),
          foregroundPid: z.number().optional(),
        }),
        output: z.void(),
      },
      commandRun: {
        input: z.object({ id: TerminalIdSchema, command: z.string() }),
        output: z.void(),
      },
    },
  },
});

export type WatcherSurface = SurfaceTypes<typeof watcherSurface.spec>;
/** The oRPC contract type a link is parameterized over — `directLink<WatcherContract>(router)`
 *  in-process today, the identical type over an ssh `stdioLink` later. Exported
 *  so consumers reference the contract as a type without a value import of
 *  `watcherSurface` (which they only need in a `typeof` query). */
export type WatcherContract = typeof watcherSurface.contract;
export type PersistedAwareness = z.infer<typeof PersistedAwarenessSchema>;
export type LiveAwareness = z.infer<typeof LiveAwarenessSchema>;
