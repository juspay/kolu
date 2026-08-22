/**
 * The kaval daemon wire: the pty-host surface at its historic flat tags plus the
 * frozen control fragment as a `control` sibling, assembled into ONE group.
 *
 * Two things are pinned here, and the first is the load-bearing one. Composition
 * used to be a hand-splice of two finalized oRPC contracts re-adapted against a
 * widened matcher (two `as any` casts, and no way to see a collision); it is now
 * a disjoint union of two flat tag maps. Review #16 says a group assembled that
 * way has ZERO type-level safety and `RpcGroup.merge` silently drops a colliding
 * tag — so the ROUTE SET IS THE SPEC, and it is asserted literally below rather
 * than inferred.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { buildSurfaceFace } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  kavalControlSurface,
  kavalDaemonGroup,
  serveKavalDaemonSurface,
} from "./daemonSurface.ts";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { ptyHostClientOver } from "./ptyHostClient.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

const runtimes: Array<{ close(): Promise<void> }> = [];
const savedEnv = { ...process.env };
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  process.env = { ...savedEnv };
});

/** The FULL wire the daemon advertises, spelled out. Two things it proves that a
 *  size check alone cannot: every historic pty-host tag survived composition
 *  unrenamed and unprefixed (padi and kaval-tui address these literal strings),
 *  and the control fragment landed under `surface/control/` — the stable path
 *  `probeDaemonIdentity` dials at any pty-host version skew.
 *
 *  Note the SIX reserved `system/*` tags: three for the pty half at
 *  `surface/system/*` and three for the control sibling at
 *  `surface/control/system/*`. Every surface carries those three, which is the
 *  ONE overlap a bare merge would have collided — and the sibling prefix is what
 *  keeps them disjoint. Their presence here is the proof. */
const EXPECTED_DAEMON_TAGS = [
  // pty-host streams
  "surface/activity/get",
  "surface/commandRun/get",
  "surface/cwd/get",
  "surface/exit/get",
  "surface/foreground/get",
  "surface/inventory/get",
  "surface/terminalAttach/get",
  "surface/title/get",
  // pty-host procedures
  "surface/system/heartbeat",
  "surface/system/info",
  "surface/system/version",
  "surface/terminal/getHistory",
  "surface/terminal/getScreenCells",
  "surface/terminal/getScreenState",
  "surface/terminal/getScreenText",
  "surface/terminal/kill",
  "surface/terminal/killAll",
  "surface/terminal/list",
  "surface/terminal/resize",
  "surface/terminal/spawn",
  "surface/terminal/write",
  // pty-host reserved members
  "surface/system/clockNow",
  "surface/system/identity",
  "surface/system/live",
  // the frozen control fragment, as a sibling
  "surface/control/core/drain",
  "surface/control/core/hello",
  // …and ITS reserved members, at their own prefix
  "surface/control/system/clockNow",
  "surface/control/system/identity",
  "surface/control/system/live",
].sort();

describe("kaval daemon group", () => {
  it("advertises exactly the pty-host tags plus the control sibling's — nothing renamed, nothing dropped", () => {
    expect([...kavalDaemonGroup.requests.keys()].sort()).toEqual(
      EXPECTED_DAEMON_TAGS,
    );
  });

  it("is the DISJOINT union of its two halves (a silent merge-collision would shrink it)", () => {
    expect(kavalDaemonGroup.requests.size).toBe(
      ptyHostSurface.group.requests.size +
        kavalControlSurface.group.requests.size,
    );
    // Stated on the other axis too: no tag of one half appears in the other. A
    // future member named `control` on the pty surface would fail HERE with the
    // colliding name, not as a mysteriously missing route at runtime.
    const ptyTags = new Set(ptyHostSurface.group.requests.keys());
    const overlap = [...kavalControlSurface.group.requests.keys()].filter(
      (tag) => ptyTags.has(tag),
    );
    expect(overlap).toEqual([]);
  });

  it("binds exactly one handler at every advertised tag, and none anywhere else", () => {
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-tags-rc-")),
      lifetime: { kind: "forever" },
    });
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/user/1000/kaval-test",
    });
    runtimes.push(runtime);
    expect(Object.keys(runtime.handlers).sort()).toEqual(EXPECTED_DAEMON_TAGS);
  });
});

describe("kaval daemon surface", () => {
  it("adds frozen identity without moving system.version, and drain refuses without ending the daemon", async () => {
    process.env.KAVAL_COMMIT_HASH = "abc1234";
    process.env.KAVAL_BUILD_ID = "kaval-build-7";
    const ptyHost = createInProcessPtyHost({
      log: silentLog,
      rcDir: mkdtempSync(join(tmpdir(), "kaval-control-rc-")),
      lifetime: { kind: "forever" },
    });
    // Both channels must stay closed over the one boot record, rather than
    // re-reading mutable ambient identity at request/composition time.
    process.env.KAVAL_COMMIT_HASH = "changed-after-boot";
    process.env.KAVAL_BUILD_ID = "changed-after-boot";
    expect(Object.isFrozen(ptyHost)).toBe(true);
    expect(Object.isFrozen(ptyHost.boot)).toBe(true);
    expect(Object.isFrozen(ptyHost.boot.identity)).toBe(true);
    const runtime = serveKavalDaemonSurface({
      ptyHost,
      stateRoot: "/run/user/1000/kaval-test",
    });
    runtimes.push(runtime);
    // ONE dispatch over the composed handlers, two faces on top of it — which is
    // the whole point of a flat tag namespace: each face is built from the
    // STANDALONE surface it belongs to and neither learns it was composed.
    const dispatch = directDispatch(runtime);
    const pty = ptyHostClientOver(dispatch);
    const control = buildSurfaceFace(kavalControlSurface, dispatch).surface
      .core as {
      hello(): Effect.Effect<Record<string, unknown>, unknown>;
      drain(): Effect.Effect<void, unknown>;
    };

    // Existing consumers keep the exact historic path and shape.
    const version = await Effect.runPromise(pty.surface.system.version({}));
    expect(Object.keys(version).sort()).toEqual([
      "contractVersion",
      "identity",
      "lifetime",
      "pid",
      "startedAt",
    ]);
    expect(version.contractVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(version.identity).toEqual({
      staleKey: "kaval-build-7",
      navigableCommit: "abc1234",
    });

    const hello = await Effect.runPromise(control.hello());
    expect(hello).toEqual({
      stateRoot: "/run/user/1000/kaval-test",
      surfaceVersion: PTY_HOST_CONTRACT_VERSION,
      controlCoreVersion: "1.0",
      startedAt: version.startedAt,
      commit: "abc1234",
      buildId: "kaval-build-7",
    });

    // Letter: the frozen void verb refuses, loudly and with its reason. kaval
    // cannot drain (ending the process destroys its live PTYs), and `core.drain`
    // declares no error schema — so the refusal is an undeclared DEFECT rather
    // than a member error a supervisor could narrow on and "handle" (PLAN D4).
    // What a caller can rely on is that it REJECTS and says why.
    await expect(Effect.runPromise(control.drain())).rejects.toThrow(
      /not drainable/,
    );
    // Effect: neither a silent success nor a daemon-killing implementation can
    // pass — the same daemon still answers both identity channels afterward.
    await expect(Effect.runPromise(control.hello())).resolves.toEqual(hello);
    await expect(
      Effect.runPromise(pty.surface.system.heartbeat({})),
    ).resolves.toEqual({
      ts: expect.any(Number),
    });

    // The pty-host face is a valid, complete view of the composed daemon: its
    // members answer at the same tags they would standing alone.
    await expect(
      Effect.runPromise(pty.surface.terminal.list({})),
    ).resolves.toEqual({
      entries: [],
    });
  });
});
