/**
 * padi's identity mechanics — the state-root default, the digest that keys the
 * runtime rendezvous, and the manifest that maps the digest back. The load-bearing
 * property under test is #1313 ISOLATION: distinct state-roots yield distinct
 * digests, so two padis never share a kaval; an identical state-root yields an
 * identical digest, so a re-boot dials the same daemon.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readStateRootManifest, writeStateRootManifest } from "kaval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultPadiStateRoot,
  padiDigest,
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
  resolvePadiStateRoot,
} from "./stateRoot.ts";

// Save + restore the env the helpers read, so cases can pin each branch without
// leaking into siblings.
const SAVED = {
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  HOME: process.env.HOME,
  KOLU_PADI_STATE_DIR: process.env.KOLU_PADI_STATE_DIR,
};
beforeEach(() => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
});
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("defaultPadiStateRoot — the binary spells it on the host", () => {
  it("IGNORES $XDG_STATE_HOME — HOME-only, so two launch contexts can't split padi's identity", () => {
    // Even with $XDG_STATE_HOME set (a login shell), the default is env-INSENSITIVE:
    // HOME-only, so a context WITHOUT it (a bare systemd unit, an ssh exec) resolves
    // the exact SAME root and the digest never diverges.
    process.env.XDG_STATE_HOME = "/somewhere/else/state";
    process.env.HOME = "/home/u";
    expect(defaultPadiStateRoot()).toBe("/home/u/.local/state/padi");
  });

  it("is $HOME/.local/state/padi with no $XDG_STATE_HOME either", () => {
    delete process.env.XDG_STATE_HOME;
    process.env.HOME = "/home/u";
    expect(defaultPadiStateRoot()).toBe("/home/u/.local/state/padi");
  });

  it("crashes loudly with no anchor — never a silent throwaway path", () => {
    delete process.env.XDG_STATE_HOME;
    delete process.env.HOME;
    // homedir() may still resolve from the passwd entry, so only assert the throw
    // when there is genuinely no anchor. On a box where homedir() answers, this
    // returns a real path — which is the point (never a throwaway). We assert the
    // shape either way: a resolved absolute path, or a loud throw.
    try {
      expect(defaultPadiStateRoot()).toMatch(/^\/.*\/padi$/);
    } catch (e) {
      expect((e as Error).message).toContain(
        "cannot resolve a default state-root",
      );
    }
  });
});

describe("resolvePadiStateRoot — override wins, always absolute", () => {
  it("resolves an explicit override to an absolute path", () => {
    expect(resolvePadiStateRoot("/srv/padi")).toBe("/srv/padi");
    expect(resolvePadiStateRoot("relative/dir")).toBe(resolve("relative/dir"));
  });

  it("reads KOLU_PADI_STATE_DIR when no explicit override", () => {
    process.env.KOLU_PADI_STATE_DIR = "/e2e/worker-3/padi";
    expect(resolvePadiStateRoot()).toBe("/e2e/worker-3/padi");
  });

  it("falls to the binary default (HOME-only) with neither override nor env", () => {
    delete process.env.KOLU_PADI_STATE_DIR;
    process.env.XDG_STATE_HOME = "/x/state"; // ignored — the default is env-insensitive
    process.env.HOME = "/home/u";
    expect(resolvePadiStateRoot()).toBe("/home/u/.local/state/padi");
  });
});

describe("padiDigest — the rendezvous key (#1313 isolation)", () => {
  it("is deterministic — the same state-root always keys the same daemon", () => {
    expect(padiDigest("/home/u/.local/state/padi")).toBe(
      padiDigest("/home/u/.local/state/padi"),
    );
  });

  it("is stable under path spelling — resolve normalizes . and ..", () => {
    expect(padiDigest("/a/b")).toBe(padiDigest("/a/./b"));
    expect(padiDigest("/a/b")).toBe(padiDigest("/a/x/../b"));
  });

  it("distinct state-roots yield distinct digests (the isolation property)", () => {
    expect(padiDigest("/home/a/padi")).not.toBe(padiDigest("/home/b/padi"));
  });

  it("is a short lowercase-hex slice (a short socket path, any state-root depth)", () => {
    expect(padiDigest("/some/deep/nested/state/root")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });
});

describe("the digest-keyed rendezvous paths", () => {
  it("padi serves at $XDG_RUNTIME_DIR/padi-<digest>/padi.sock", () => {
    const sr = "/home/u/.local/state/padi";
    const d = padiDigest(sr);
    expect(padiSocketPath(sr)).toBe(`/run/user/1000/padi-${d}/padi.sock`);
  });

  it("padi's kaval serves at kaval-<digest>/pty-host.sock — SAME digest", () => {
    const sr = "/home/u/.local/state/padi";
    const d = padiDigest(sr);
    expect(padiKavalSocketPath(sr)).toBe(
      `/run/user/1000/kaval-${d}/pty-host.sock`,
    );
  });

  it("padi and its kaval are distinct dirs under the same digest", () => {
    const sr = "/home/u/.local/state/padi";
    expect(dirname(padiSocketPath(sr))).not.toBe(
      dirname(padiKavalSocketPath(sr)),
    );
  });

  it("two padis at distinct state-roots get distinct kaval sockets (#1313)", () => {
    expect(padiKavalSocketPath("/home/a/padi")).not.toBe(
      padiKavalSocketPath("/home/b/padi"),
    );
  });

  it("an explicit socket override wins verbatim", () => {
    expect(padiSocketPath("/any/sr", "/tmp/pinned/padi.sock")).toBe(
      "/tmp/pinned/padi.sock",
    );
  });

  it("the gate sits beside the socket as padi.pid", () => {
    expect(padiGatePath("/run/user/1000/padi-abc/padi.sock")).toBe(
      "/run/user/1000/padi-abc/padi.pid",
    );
  });
});

describe("the state-root manifest (digest → state-root)", () => {
  it("round-trips the state-root through the runtime dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-manifest-"));
    writeStateRootManifest(dir, "/home/u/.local/state/padi");
    expect(readStateRootManifest(dir)).toBe("/home/u/.local/state/padi");
  });

  it("reads undefined from a dir with no manifest (a bare / legacy daemon)", () => {
    const dir = mkdtempSync(join(tmpdir(), "padi-nomanifest-"));
    expect(readStateRootManifest(dir)).toBeUndefined();
  });

  it("creates the 0700 dir if absent (padi writes kaval's before it binds)", () => {
    const parent = mkdtempSync(join(tmpdir(), "padi-mkmanifest-"));
    const dir = join(parent, "kaval-deadbeef");
    writeStateRootManifest(dir, "/srv/padi");
    expect(readStateRootManifest(dir)).toBe("/srv/padi");
  });
});
