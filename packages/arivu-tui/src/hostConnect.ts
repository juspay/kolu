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
 * NOTE: this branch ADDS public API to the drishti-shared `@kolu/surface*`
 * packages — `@kolu/surface-nix-host` gains `dialAgentOnce` + its types + an
 * optional `extraArgs`/`remoteProgressLines`, and `@kolu/surface` gains the
 * `./first-frame` helper — so per `packages/AGENTS.md` / `.claude/rules/surface.md`
 * it REQUIRES a corresponding drishti PR that updates drishti for the new surface
 * API and passes full CI, linked from the kolu PR before merge. (Earlier text
 * here claimed "no drishti mirror PR needed" — true only while the dep was
 * consumed read-only and unchanged.) Mechanically the mirror is an npins `kolu`
 * pin bump in drishti once this lands on `juspay/kolu` master, kept green by CI:
 * drishti's source imports NONE of the new symbols (zero `.ts` change), and the
 * only build-config delta is hydrating the new zero-dep leaf `@kolu/shell-quote`
 * that `surface-nix-host` now imports. See the kolu PR body's merge-gate bullet.
 */
import type { arivuSurface } from "@kolu/arivu-contract";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
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
 *  `arivu --stdio`, and returns the contract-typed `Connection`. `kavalSocket`
 *  points the remote arivu at a specific kaval (`arivu --stdio --kaval <path>`);
 *  omit it and the remote arivu **discovers** the running kaval — a standalone
 *  one or a home-manager kolu-server (namespaced by listen port). */
export function connectArivuViaHost(
  host: string,
  kavalSocket?: string,
  onLog?: (line: string) => void,
): Promise<Connection> {
  return dialAgentOnce<ArivuContract>({
    host,
    // Where the dial's lifecycle / forwarded-daemon-stderr lines go. The bare
    // `--host` dashboard omits it (its lines reach process.stderr, harmless: it
    // snapshots then disposes BEFORE the alt-screen opens). The live `fleet`
    // board passes a sink so a held-open session can't bleed onto the screen.
    onLog,
    // `${agentPath}/bin/arivu`, run as `arivu --stdio`. The drv map is keyed to
    // the arivu DAEMON drv (sensors + git/gh), not the arivu-tui viewer.
    binary: "arivu",
    envVar: ARIVU_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[ARIVU_AGENT_DRVS_ENV],
    drvNoun: "arivu",
    // arivu's bin.ts writes its fatal as `arivu: <message>` right before exiting
    // (a multi-line `--kaval` ambiguity block included), so the dialer surfaces
    // that whole block as the failure reason. Same as `${drvNoun}:` here, but the
    // option is explicit because it is NOT always — see kaval-tui's `kaval --stdio:`.
    fatalPrefix: "arivu:",
    // Only pin the remote kaval when the user asked (--kaval); otherwise let the
    // remote arivu discover it, so a single remote kolu is found with no flag.
    // `extraArgs` is `dialAgentOnce`'s generic spawn-arg passthrough — this is
    // the one site that knows the args ARE `--kaval <socket>`.
    extraArgs: kavalSocket ? ["--kaval", kavalSocket] : undefined,
    // arivu has no `system.heartbeat`, so read the first frame of the `version`
    // cell as the connectivity probe. A `version` cell ALWAYS opens with a
    // snapshot frame, so an empty stream is a protocol/link failure, not a
    // benign "no value yet" — the probe exists to PROVE the remote arivu surface
    // yielded its snapshot, and `dialAgentOnce` discards the value before
    // `markConnected`, so `firstFrameOrThrow` surfaces the empty-stream failure
    // rather than collapsing it into a "connected" session.
    probe: async (client) =>
      firstFrameOrThrow(
        await client.surface.version.get({}),
        "arivu version cell yielded no snapshot frame — the remote surface stream ended empty (link or protocol failure)",
      ),
  });
}
