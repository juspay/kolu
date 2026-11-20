import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDaemonHome } from "@kolu/surface-daemon";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import {
  getPtyHostSocketPath,
  KAVAL_GATE_FILE,
  KAVAL_LOG_FILE,
  KAVAL_NS_PREFIX,
  kavalLogPath,
  legacyKavalSocketPath,
  PTY_HOST_SOCK_FILE,
  STATE_ROOT_MANIFEST_FILE,
} from "./socketPath.ts";

const SAVED_XDG = process.env.XDG_RUNTIME_DIR;

beforeEach(() => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
});
afterEach(() => {
  if (SAVED_XDG === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = SAVED_XDG;
});

function masterSocket(app: string): string {
  return getRuntimeSocketPath({ app, file: PTY_HOST_SOCK_FILE });
}

describe("daemonHome golden — kaval paths byte-identical to master", () => {
  it("bare standalone kaval: dir / gate / socket / log / rc / manifest", () => {
    const expectedSock = masterSocket(KAVAL_NS_PREFIX);
    const expectedDir = dirname(expectedSock);

    expect(getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX)).toBe(expectedSock);
    expect(kavalLogPath(expectedSock)).toBe(join(expectedDir, KAVAL_LOG_FILE));

    const home = resolveDaemonHome({
      app: KAVAL_NS_PREFIX,
      placement: "runtime",
      socketFile: PTY_HOST_SOCK_FILE,
    });
    expect(home.dir).toBe(expectedDir);
    expect(home.socketPath).toBe(expectedSock);
    expect(home.gatePath).toBe(join(expectedDir, KAVAL_GATE_FILE));
    expect(home.file(KAVAL_LOG_FILE)).toBe(join(expectedDir, KAVAL_LOG_FILE));
    expect(home.file("rc")).toBe(join(expectedDir, "rc"));
    expect(home.file(STATE_ROOT_MANIFEST_FILE)).toBe(
      join(expectedDir, STATE_ROOT_MANIFEST_FILE),
    );
  });

  it("digest-keyed kaval: instance mode only (never pre-joined app)", () => {
    const digest = "abcdef0123456789";
    const ns = `${KAVAL_NS_PREFIX}-${digest}`;
    const expectedSock = masterSocket(ns);
    const expectedDir = dirname(expectedSock);

    const home = resolveDaemonHome({
      app: KAVAL_NS_PREFIX,
      placement: "runtime",
      instance: digest,
      socketFile: PTY_HOST_SOCK_FILE,
    });
    expect(home.appNamespace).toBe(ns);
    expect(home.dir).toBe(expectedDir);
    expect(home.socketPath).toBe(expectedSock);
    expect(home.gatePath).toBe(join(expectedDir, KAVAL_GATE_FILE));
    expect(home.gatePath).toBe(join(expectedDir, "kaval.pid"));
    expect(home.file(KAVAL_LOG_FILE)).toBe(join(expectedDir, KAVAL_LOG_FILE));
    expect(home.file(STATE_ROOT_MANIFEST_FILE)).toBe(
      join(expectedDir, STATE_ROOT_MANIFEST_FILE),
    );
  });

  it("legacy port-keyed kaval via instance: String(port)", () => {
    const expected = masterSocket(`${KAVAL_NS_PREFIX}-7681`);
    expect(legacyKavalSocketPath(7681)).toBe(expected);
    expect(
      resolveDaemonHome({
        app: KAVAL_NS_PREFIX,
        placement: "runtime",
        instance: "7681",
        socketFile: PTY_HOST_SOCK_FILE,
      }).socketPath,
    ).toBe(expected);
    expect(
      resolveDaemonHome({
        app: KAVAL_NS_PREFIX,
        placement: "runtime",
        instance: "7681",
        socketFile: PTY_HOST_SOCK_FILE,
      }).gatePath,
    ).toBe(join(dirname(expected), "kaval.pid"));
  });

  it("/tmp fallback shape via pure runtimeRoot: null", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    const uid = process.getuid?.() ?? "shared";
    const digest = "deadbeefcafebabe";
    const expectedDir = `/tmp/kaval-${digest}-${uid}`;
    const expectedSock = join(expectedDir, PTY_HOST_SOCK_FILE);

    expect(masterSocket(`kaval-${digest}`)).not.toBe(expectedSock);
    expect(
      resolveDaemonHome({
        app: KAVAL_NS_PREFIX,
        placement: "runtime",
        instance: digest,
        socketFile: PTY_HOST_SOCK_FILE,
        runtimeRoot: null,
      }).socketPath,
    ).toBe(expectedSock);
  });
});
