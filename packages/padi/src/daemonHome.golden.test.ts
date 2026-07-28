/**
 * Golden path pins — every padi-derived path must stay byte-identical to the
 * master-shipped derivation. A surviving old daemon is found only if the new
 * build spells the same strings.
 *
 * Expected runtime sockets are frozen via `@kolu/surface/unix-socket`'s
 * builder + the same digest formula padi ships (sha256 slice), never through
 * production helpers that now route through daemonHome.
 */

import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDaemonHome } from "@kolu/surface-daemon";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import {
  KAVAL_GATE_FILE,
  KAVAL_LOG_FILE,
  KAVAL_NS_PREFIX,
  PTY_HOST_SOCK_FILE,
  STATE_ROOT_MANIFEST_FILE,
} from "kaval";
import {
  PADI_GATE_FILE,
  PADI_LOG_FILE,
  PADI_SOCK_FILE,
  PADI_STDERR_LOG_FILE,
  padiDigest,
  padiGatePath,
  padiKavalSocketPath,
  padiLogPath,
  padiSocketPath,
  padiStderrLogPath,
} from "./stateRoot.ts";

const SAVED = {
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  HOME: process.env.HOME,
};

beforeEach(() => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  process.env.HOME = "/home/golden";
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Frozen master digest — same sha256 slice as `padiDigest`. */
function masterDigest(stateRoot: string): string {
  return createHash("sha256")
    .update(resolve(stateRoot))
    .digest("hex")
    .slice(0, 16);
}

function masterPadiSocket(stateRoot: string): string {
  return getRuntimeSocketPath({
    app: `padi-${masterDigest(stateRoot)}`,
    file: PADI_SOCK_FILE,
  });
}

function masterKavalSocket(stateRoot: string): string {
  return getRuntimeSocketPath({
    app: `kaval-${masterDigest(stateRoot)}`,
    file: PTY_HOST_SOCK_FILE,
  });
}

describe("daemonHome golden — padi paths byte-identical to master", () => {
  const stateRoot = "/home/golden/.local/state/padi";

  it("digest matches the frozen sha256 slice", () => {
    expect(padiDigest(stateRoot)).toBe(masterDigest(stateRoot));
  });

  it("padi gate / socket under padi-<digest>/", () => {
    const expectedSock = masterPadiSocket(stateRoot);
    const expectedDir = dirname(expectedSock);
    const digest = masterDigest(stateRoot);

    expect(padiSocketPath(stateRoot)).toBe(expectedSock);
    expect(padiGatePath(expectedSock)).toBe(join(expectedDir, PADI_GATE_FILE));

    const home = resolveDaemonHome({
      app: "padi",
      placement: "runtime",
      instance: digest,
    });
    expect(home.appNamespace).toBe(`padi-${digest}`);
    expect(home.dir).toBe(expectedDir);
    expect(home.socketPath).toBe(expectedSock);
    expect(home.gatePath).toBe(join(expectedDir, PADI_GATE_FILE));
    expect(home.gatePath).toBe(join(expectedDir, "padi.pid"));
    // never padi-<digest>.pid
    expect(home.gatePath.includes(`padi-${digest}.pid`)).toBe(false);
  });

  it("padi's kaval under kaval-<digest>/ with pty-host.sock", () => {
    const expectedSock = masterKavalSocket(stateRoot);
    const expectedDir = dirname(expectedSock);
    const digest = masterDigest(stateRoot);

    expect(padiKavalSocketPath(stateRoot)).toBe(expectedSock);

    const home = resolveDaemonHome({
      app: KAVAL_NS_PREFIX,
      placement: "runtime",
      instance: digest,
      socketFile: PTY_HOST_SOCK_FILE,
    });
    expect(home.dir).toBe(expectedDir);
    expect(home.socketPath).toBe(expectedSock);
    expect(home.gatePath).toBe(join(expectedDir, KAVAL_GATE_FILE));
    expect(home.file(KAVAL_LOG_FILE)).toBe(join(expectedDir, KAVAL_LOG_FILE));
    expect(home.file(STATE_ROOT_MANIFEST_FILE)).toBe(
      join(expectedDir, STATE_ROOT_MANIFEST_FILE),
    );
  });

  it("padi logs stay on the persistent state-root (not the runtime home)", () => {
    // These are NOT daemonHome paths — pin them so a mistaken migration
    // into the runtime dir is caught.
    expect(padiLogPath(stateRoot)).toBe(
      join(resolve(stateRoot), PADI_LOG_FILE),
    );
    expect(padiStderrLogPath(stateRoot)).toBe(
      join(resolve(stateRoot), PADI_STDERR_LOG_FILE),
    );
  });

  it("explicit socket override wins verbatim", () => {
    expect(padiSocketPath(stateRoot, "/custom/padi.sock")).toBe(
      "/custom/padi.sock",
    );
    expect(padiKavalSocketPath(stateRoot, "/custom/kaval.sock")).toBe(
      "/custom/kaval.sock",
    );
  });

  it("/tmp fallback under forced unset XDG", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const uid = process.getuid?.() ?? "shared";
    const digest = masterDigest(stateRoot);
    const expectedPadi = `/tmp/padi-${digest}-${uid}/${PADI_SOCK_FILE}`;
    const expectedKaval = `/tmp/kaval-${digest}-${uid}/${PTY_HOST_SOCK_FILE}`;

    expect(masterPadiSocket(stateRoot)).toBe(expectedPadi);
    expect(padiSocketPath(stateRoot)).toBe(expectedPadi);
    expect(
      resolveDaemonHome({
        app: "padi",
        placement: "runtime",
        instance: digest,
      }).socketPath,
    ).toBe(expectedPadi);

    expect(masterKavalSocket(stateRoot)).toBe(expectedKaval);
    expect(padiKavalSocketPath(stateRoot)).toBe(expectedKaval);
  });
});
