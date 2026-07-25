import { afterEach, expect, it } from "vitest";
import { socketPathFor } from "./socketPath.ts";

const original = process.env.XDG_RUNTIME_DIR;
afterEach(() => {
  process.env.XDG_RUNTIME_DIR = original;
});

it("puts the socket in the runtime dir, keyed by terminal id", () => {
  process.env.XDG_RUNTIME_DIR = "/run/user/1000";
  expect(socketPathFor("e7f2")).toBe("/run/user/1000/kolu/acp-e7f2.sock");
});

it("refuses to guess when there is no private runtime dir", () => {
  // Falling back to /tmp would move a 0600 socket into a shared directory —
  // a downgrade quiet enough that nobody would notice it happened.
  delete process.env.XDG_RUNTIME_DIR;
  expect(() => socketPathFor("e7f2")).toThrow(/XDG_RUNTIME_DIR/);
});
