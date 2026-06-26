/**
 * `pulam-tui status|watch --host <ssh>` — reach an `pulam` daemon on a remote
 * machine over ssh, provisioning it with Nix, and hand back a `Connection` of
 * the SAME shape the local unix-socket path returns. `status` and `watch` are
 * written against `Connection`, so the transport is the only thing that changes
 * — the commands are byte-for-byte unchanged over ssh.
 *
 * The reach + provision + supervise + one-shot-dial composition is
 * `@kolu/surface-nix-host`'s `dialAgentOnce`: it resolves the daemon's `.drv`
 * for the host's arch, ships it (`nix copy --derivation` → realise), runs
 * `ssh <host> pulam --stdio`, speaks `terminalWorkspaceSurface` over that child's stdio, and
 * proves the link with the caller's `probe` before flipping the connect watchdog
 * off. pulam's `--stdio` mode (built in P1c) is the serve seam the ssh dial
 * speaks to — the remote pulam dials the remote kaval locally and recomputes
 * awareness from now. Unlike kaval, pulam is ephemeral, so a re-provision just
 * re-derives; nothing survives the link.
 *
 * pulam's only volatile differences from the other one-shot CLIs (kaval-tui):
 * the binary name, the per-system drv-map env var, and a deliberate OVERRIDE of
 * the dial's default `system.live` probe. Where the default just proves the link
 * is alive, pulam overrides it with a PROTOCOL ASSERTION: it reads the first frame
 * of the `version` cell (its surface is the `awareness` collection + a `version`
 * cell), proving the remote pulam surface yielded its snapshot — which doubles as
 * exercising the seam the kolu fold's version-skew gate later consumes. This is
 * the documented exception, not the norm.
 *
 * This is the ONLY place pulam-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the pulam daemon closure (the staleKey allow-list). It
 * consumes `@kolu/surface*` read-only (`dialAgentOnce` + `firstFrameOrThrow`),
 * adding no public API to those drishti-shared packages, so it needs no drishti
 * mirror PR (`.claude/rules/surface.md`).
 */
import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { dialAgentOnce } from "@kolu/surface-nix-host";
import type { Connection } from "./connect.ts";

type PulamContract = typeof terminalWorkspaceSurface.contract;

/** The per-system `{ system → pulam daemon .drv }` map env var, baked by the
 *  `pulam-tui` Nix wrapper (`mkAgentTuiWrapper` in default.nix). Named ONCE as a
 *  constant so the literal passed to `dialAgentOnce` (for its errors) and the
 *  `process.env[…]` read can't drift apart — TS has no way to tie a bare string
 *  literal to the matching `process.env.FOO` property otherwise. */
const PULAM_AGENT_DRVS_ENV = "PULAM_AGENT_DRVS_JSON";

/** Dial an pulam on `host` over ssh. Provisions the daemon's closure, runs
 *  `pulam --stdio`, and returns the contract-typed `Connection`. `kavalSocket`
 *  points the remote pulam at a specific kaval (`pulam --stdio --kaval <path>`);
 *  omit it and the remote pulam **discovers** the running kaval — a standalone
 *  one or a home-manager kolu-server (namespaced by listen port). */
export function connectPulamViaHost(
  host: string,
  kavalSocket?: string,
): Promise<Connection> {
  return dialAgentOnce<PulamContract>({
    host,
    // The dial's lifecycle / forwarded-daemon-stderr lines fall to its default
    // sink, process.stderr — harmless: `status`/`watch` print their data to
    // stdout and own no alt-screen, so a forwarded stderr line can't corrupt
    // the output.
    // `${agentPath}/bin/pulam`, run as `pulam --stdio`. The drv map is keyed to
    // the pulam DAEMON drv (sensors + git/gh), not the pulam-tui viewer.
    binary: "pulam",
    envVar: PULAM_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[PULAM_AGENT_DRVS_ENV],
    drvNoun: "pulam",
    // pulam's bin.ts writes its fatal as `pulam: <message>` right before exiting
    // (a multi-line `--kaval` ambiguity block included), so the dialer surfaces
    // that whole block as the failure reason. Same as `${drvNoun}:` here, but the
    // option is explicit because it is NOT always — see kaval-tui's `kaval --stdio:`.
    fatalPrefix: "pulam:",
    // Only pin the remote kaval when the user asked (--kaval); otherwise let the
    // remote pulam discover it, so a single remote kolu is found with no flag.
    // `extraArgs` is `dialAgentOnce`'s generic spawn-arg passthrough — this is
    // the one site that knows the args ARE `--kaval <socket>`.
    extraArgs: kavalSocket ? ["--kaval", kavalSocket] : undefined,
    // OVERRIDE of `dialAgentOnce`'s default `system.live` probe — and this is the
    // documented exception, NOT the norm. It is a deliberate PROTOCOL ASSERTION,
    // not a liveness check: the `version` cell ALWAYS opens with a snapshot frame,
    // so reading its first frame proves the remote pulam surface actually yielded
    // its snapshot — a contract guarantee `system.live` does not exercise. An empty
    // stream is a protocol/link failure, not a benign "no value yet"; `dialAgentOnce`
    // discards the value before `markConnected`, so `firstFrameOrThrow` surfaces the
    // empty-stream failure rather than collapsing it into a "connected" session.
    probe: async (client) =>
      firstFrameOrThrow(
        await client.surface.version.get({}),
        "pulam version cell yielded no snapshot frame — the remote surface stream ended empty (link or protocol failure)",
      ),
  });
}
