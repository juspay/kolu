/**
 * Pins kolu's names on the rendezvous path — app dir `kolu`, file
 * `pty-host.sock` — for both anchors. The mechanism (override handling, the
 * XDG/`/tmp/<app>-$UID` split, and the `$TMPDIR`-independence regression
 * behind the macOS "no pty-host socket" bug) is pinned generically in
 * `@kolu/surface`'s `unix-socket.test.ts`; what would break kolu-server ↔
 * kaval-tui rendezvous from HERE is only a drift in these names.
 */
import { afterEach, describe, expect, it } from "vitest";
import { getPtyHostSocketPath } from "./socketPath.ts";

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
