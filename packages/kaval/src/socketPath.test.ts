/**
 * Pins kolu's names on the rendezvous path — app dir `kolu`, file
 * `pty-host.sock` — for both anchors. The mechanism (override handling, the
 * XDG/`/tmp/<app>-$UID` split, and the `$TMPDIR`-independence regression
 * behind the macOS "no pty-host socket" bug) is pinned generically in
 * `@kolu/surface`'s `unix-socket.test.ts`; what would break kolu-server ↔
 * kaval-tui rendezvous from HERE is only a drift in these names.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  PTY_HOST_SOCK_FILE,
} from "./socketPath.ts";

describe("getPtyHostSocketPath", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  it("returns an explicit override verbatim", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath("/custom/x.sock")).toBe("/custom/x.sock");
  });

  it("anchors under $XDG_RUNTIME_DIR/kolu on systemd Linux", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath()).toBe("/run/user/1000/kolu/pty-host.sock");
  });

  it("falls back to the fixed per-user /tmp/kolu-$UID off systemd", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const uid = process.getuid?.() ?? "shared";
    expect(getPtyHostSocketPath()).toBe(`/tmp/kolu-${uid}/pty-host.sock`);
  });

  it("parameterizes the app dir (default kolu) so a standalone daemon owns its own namespace", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(getPtyHostSocketPath(undefined, "kaval")).toBe(
      "/run/user/1000/kaval/pty-host.sock",
    );
    // default is unchanged
    expect(getPtyHostSocketPath()).toBe("/run/user/1000/kolu/pty-host.sock");
  });
});

describe("discoverPtyHostSockets", () => {
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
  });

  /** Lay down `<runtime>/<ns>/pty-host.sock` files (plain files stand in for the
   *  unix sockets — discovery only checks existence). */
  function seed(namespaces: string[]): string {
    const runtime = mkdtempSync(join(tmpdir(), "kdisc-"));
    for (const ns of namespaces) {
      mkdirSync(join(runtime, ns), { recursive: true });
      writeFileSync(join(runtime, ns, PTY_HOST_SOCK_FILE), "");
    }
    return runtime;
  }

  it("finds per-port server namespaces and a bare standalone one", () => {
    const runtime = seed(["kaval-7681", "kaval-18331", "kaval", "unrelated"]);
    process.env.XDG_RUNTIME_DIR = runtime;
    const found = discoverPtyHostSockets().sort();
    expect(found).toEqual(
      [
        join(runtime, "kaval", PTY_HOST_SOCK_FILE),
        join(runtime, "kaval-18331", PTY_HOST_SOCK_FILE),
        join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
      ].sort(),
    );
  });

  it("ignores a namespace dir with no socket yet", () => {
    const runtime = seed(["kaval-7681"]);
    mkdirSync(join(runtime, "kaval-9999")); // dir but no pty-host.sock
    process.env.XDG_RUNTIME_DIR = runtime;
    expect(discoverPtyHostSockets()).toEqual([
      join(runtime, "kaval-7681", PTY_HOST_SOCK_FILE),
    ]);
  });

  it("returns [] when the runtime root is unreadable / absent", () => {
    process.env.XDG_RUNTIME_DIR = join(tmpdir(), "kdisc-does-not-exist-xyz");
    expect(discoverPtyHostSockets()).toEqual([]);
  });
});
