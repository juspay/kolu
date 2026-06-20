/**
 * `arivu-tui --host <ssh>` — reach an `arivu` daemon on a remote machine over
 * ssh, provisioning it with Nix, and hand back a `Connection` of the SAME shape
 * the local unix-socket path returns. Every `cmd*()` (list/watch) is written
 * against `Connection`, so the transport is the only thing that changes — the
 * commands are byte-for-byte unchanged over ssh.
 *
 * The reach + provision + supervise + one-shot-dial composition is
 * `@kolu/surface-nix-host`'s `dialAgentOnce`: it resolves the daemon's `.drv`
 * for the host's arch, ships it (`nix copy --derivation` → realise), runs
 * `ssh <host> arivu --stdio`, speaks `arivuSurface` over that child's stdio, and
 * proves the link with the caller's `probe` before flipping the connect watchdog
 * off. arivu's `--stdio` mode (built in P1c) is the serve seam the ssh dial
 * speaks to — the remote arivu dials the remote kaval locally and recomputes
 * awareness from now. Unlike kaval, arivu is ephemeral, so a re-provision just
 * re-derives; nothing survives the link.
 *
 * arivu's only volatile differences from the other one-shot CLIs (kaval-tui):
 * the binary name, the per-system drv-map env var, and the connectivity probe.
 * arivu has no `system.heartbeat` (its surface is the `awareness` collection + a
 * `version` cell), so the probe reads the first frame of the `version` cell —
 * which doubles as exercising the seam the kolu fold's version-skew gate later
 * consumes.
 *
 * This is the ONLY place arivu-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the arivu daemon closure (the staleKey allow-list).
 *
 * NOTE: this branch ADDS public API to `@kolu/surface-nix-host` (the
 * `dialAgentOnce` one-shot dialer + its types, exported from that package's
 * `index.ts`), so per `packages/AGENTS.md` / `.claude/rules/surface.md` it
 * REQUIRES a corresponding drishti PR that updates drishti for the new surface
 * API and passes full CI, linked from the kolu PR before merge. (Earlier text
 * here claimed "no drishti mirror PR needed" — that was true only while the dep
 * was consumed read-only and unchanged; adding a new exported symbol to
 * `index.ts` is an observable module-API delta (the rule names "exported types"
 * explicitly), so it no longer holds. Mechanically the mirror is an npins
 * `kolu` pin bump in drishti once this lands on `juspay/kolu` master, kept green
 * by CI — drishti imports none of the symbols this branch touched, so it needs
 * zero source changes; see the kolu PR body's merge-gate bullet.)
 */
import type { arivuSurface } from "@kolu/arivu-contract";
import { dialAgentOnce } from "@kolu/surface-nix-host";
import type { Connection } from "./connect.ts";

type ArivuContract = typeof arivuSurface.contract;

/** The per-system `{ system → arivu daemon .drv }` map env var, baked by the
 *  `arivu-tui` Nix wrapper (`mkAgentTuiWrapper` in default.nix). Named ONCE as a
 *  constant so the literal passed to `dialAgentOnce` (for its errors) and the
 *  `process.env[…]` read can't drift apart — TS has no way to tie a bare string
 *  literal to the matching `process.env.FOO` property otherwise. */
const ARIVU_AGENT_DRVS_ENV = "ARIVU_AGENT_DRVS_JSON";

/** Dial an arivu on `host` over ssh. Provisions the daemon's closure, runs
 *  `arivu --stdio`, and returns the contract-typed `Connection`. */
export function connectArivuViaHost(host: string): Promise<Connection> {
  return dialAgentOnce<ArivuContract>({
    host,
    // `${agentPath}/bin/arivu`, run as `arivu --stdio`. The drv map is keyed to
    // the arivu DAEMON drv (sensors + git/gh), not the arivu-tui viewer.
    binary: "arivu",
    envVar: ARIVU_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[ARIVU_AGENT_DRVS_ENV],
    drvNoun: "arivu",
    // arivu has no `system.heartbeat`, so read the first frame of the `version`
    // cell as the connectivity probe.
    probe: (client) => firstFrame(client.surface.version.get({})),
  });
}

/** Read the first value an async stream yields (then close it) — used to turn
 *  arivu's snapshot-then-delta `version` cell into the one-shot dial's
 *  connectivity probe. A `version` cell ALWAYS opens with a snapshot frame, so
 *  an empty stream is a protocol/link failure, not a benign "no value yet": the
 *  probe exists to PROVE the remote arivu surface yielded its snapshot, and
 *  `dialAgentOnce` discards the value before `markConnected`. Returning
 *  `undefined` on an empty stream would collapse that failure into a "connected"
 *  session (see `.agency/code-police.md` → caught-error-must-not-collapse-to-
 *  empty), so we throw instead. */
async function firstFrame(
  streamPromise: Promise<AsyncIterable<unknown>>,
): Promise<unknown> {
  for await (const v of await streamPromise) return v;
  throw new Error(
    "arivu version cell yielded no snapshot frame — the remote surface stream ended empty (link or protocol failure)",
  );
}
