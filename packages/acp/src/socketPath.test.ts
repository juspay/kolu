import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { afterEach, expect, it } from "vitest";
import { socketPathFor } from "./socketPath.ts";

const original = process.env.XDG_RUNTIME_DIR;
afterEach(() => {
  if (original === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = original;
});

it("puts the socket in the runtime dir, keyed by terminal id", () => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  expect(socketPathFor("e7f2")).toBe("/run/user/1000/kolu/acp-e7f2.sock");
});

it("falls back to a fixed per-user /tmp dir where there is no XDG runtime dir", () => {
  // macOS, and any non-systemd Linux. NOT os.tmpdir(): $TMPDIR differs between
  // a launchd-spawned process and a `nix run` CLI, so the proxy and its client
  // would land on different sockets and never meet.
  delete process.env.XDG_RUNTIME_DIR;
  const uid = process.getuid?.() ?? "shared";
  expect(socketPathFor("e7f2")).toBe(`/tmp/kolu-${uid}/acp-e7f2.sock`);
});

it("spells the path the same way the rest of kolu does", () => {
  // This module re-derives the shape rather than importing it (that module
  // pulls in the oRPC server, and @kolu/acp depends on nothing from the
  // framework). This test is what keeps the duplicate honest: if kolu's
  // rendezvous convention moves, acp's must move with it.
  for (const xdg of ["/run/user/1000", undefined]) {
    if (xdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = xdg;
    expect(socketPathFor("e7f2")).toBe(
      getRuntimeSocketPath({ app: "kolu", file: "acp-e7f2.sock" }),
    );
  }
});
