/**
 * What the ⌘K "Forward a port…" field accepts — the parse alone, with no RPC.
 *
 * Every case here is a way a plausible input means something other than what it
 * looks like, or names a host that cannot be forwarded to at all.
 */

import type { HostKey } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import {
  encodedHostOf,
  forwardInputError,
  parseForwardInput,
} from "./forwardFromPalette";

const LOCAL: HostKey = { kind: "local" };
const PU: HostKey = { kind: "remote", target: "pu-dev" };
const HOSTS = [LOCAL, PU];

describe("parseForwardInput", () => {
  it("reads host:port against the hosts kolu actually has", () => {
    const parsed = parseForwardInput("pu-dev:5173", HOSTS, LOCAL);
    expect(parsed).toEqual({ ok: true, host: PU, port: 5173 });
  });

  it("reads a bare port as the host you are looking at", () => {
    // The common case — a port on the machine whose terminals are on screen —
    // and the reason the field does not demand a host name for it.
    expect(parseForwardInput("3000", HOSTS, PU)).toEqual({
      ok: true,
      host: PU,
      port: 3000,
    });
  });

  it("lets the local host be named as well as implied", () => {
    // A local host key has no target to type, so without these spellings it
    // would be reachable only by omission — which is fine until the active host
    // is a remote one and you want a local port anyway.
    expect(encodedHostOf(parseForwardInput("local:8080", HOSTS, PU))).toBe(
      "local",
    );
    expect(encodedHostOf(parseForwardInput("localhost:8080", HOSTS, PU))).toBe(
      "local",
    );
    // …and the loopback ADDRESSES too, which is the half a hand-rolled reading
    // of this lost. `kolu-common` owns the set of spellings that name the local
    // host, precisely because a second reader that knows only some of them mints
    // a divergent answer — which is the bug that set was introduced for.
    expect(encodedHostOf(parseForwardInput("127.0.0.1:8080", HOSTS, PU))).toBe(
      "local",
    );
    expect(encodedHostOf(parseForwardInput("::1:8080", HOSTS, PU))).toBe(
      "local",
    );
  });

  it("still takes a user@host literally, even at the loopback", () => {
    // The one case the shared codec is careful about: ssh as a DIFFERENT user to
    // the loopback is its own remote target, not the local host. Reusing the
    // codec inherits that judgment rather than re-deciding it here.
    expect(parseForwardInput("srid@localhost:8080", HOSTS, PU)).toEqual({
      ok: false,
      message: expect.stringContaining('kolu has no host "srid@localhost"'),
    });
  });

  it("refuses a host kolu does not have", () => {
    // Not pedantry: every surface that shows a forward is host-scoped (the
    // Inspector group, the host dropdown, the `⇄ n` badge), so a forward to a
    // machine with no host tab would be a live listener with nowhere to see or
    // cancel it.
    const parsed = parseForwardInput("some-box:5173", HOSTS, LOCAL);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.message).toMatch(/no host "some-box"/);
  });

  it("refuses input with no port number", () => {
    expect(parseForwardInput("pu-dev", HOSTS, LOCAL).ok).toBe(false);
    expect(parseForwardInput("pu-dev:", HOSTS, LOCAL).ok).toBe(false);
    expect(parseForwardInput("pu-dev:http", HOSTS, LOCAL).ok).toBe(false);
  });

  it("refuses a number that is not a TCP port", () => {
    // Port 0 means "any" to the kernel, never a server you can point at.
    expect(parseForwardInput("0", HOSTS, LOCAL).ok).toBe(false);
    expect(parseForwardInput("70000", HOSTS, LOCAL).ok).toBe(false);
  });

  it("splits on the LAST colon, so a colon-bearing host cannot eat its port", () => {
    const hosts: HostKey[] = [
      LOCAL,
      { kind: "remote", target: "user@box:2222" },
    ];
    const parsed = parseForwardInput("user@box:2222:5173", hosts, LOCAL);
    expect(parsed).toEqual({
      ok: true,
      host: { kind: "remote", target: "user@box:2222" },
      port: 5173,
    });
  });

  it("trims, because a pasted target brings whitespace", () => {
    expect(parseForwardInput("  pu-dev:5173  ", HOSTS, LOCAL).ok).toBe(true);
  });
});

describe("forwardInputError", () => {
  it("says nothing about an empty field", () => {
    // A user who has typed nothing yet has made no mistake; the palette refuses
    // an empty submit on its own.
    expect(forwardInputError("", HOSTS, LOCAL)).toBeNull();
    expect(forwardInputError("   ", HOSTS, LOCAL)).toBeNull();
  });

  it("is null for a target that parses, and the reason for one that does not", () => {
    expect(forwardInputError("pu-dev:5173", HOSTS, LOCAL)).toBeNull();
    expect(forwardInputError("nope:1", HOSTS, LOCAL)).toMatch(/no host/);
  });
});
