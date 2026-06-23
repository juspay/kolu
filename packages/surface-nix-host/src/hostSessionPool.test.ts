/**
 * Regression coverage for the HostSession POOL (`getHostSession` /
 * `evictHostSession`).
 *
 * The pool keys one ref-counted session per `(host, binary)`. The bug this
 * guards: `buildHostRegistry.remove()` calls `session.destroy()`, which marks
 * the pooled session inert (pump exited, never reconnects). If `getHostSession`
 * kept handing that destroyed instance back, a later re-`add()` of the SAME host
 * — whose `buildEntry` calls `getHostSession` — would get a dead session and
 * never reconnect. So a destroyed pool entry must be treated as ABSENT: a fresh
 * session is built and replaces the stale one.
 *
 * Drives the REAL `getHostSession` shape (no spawn — the resolver is a constant
 * thunk and no caller acquires, so no ssh child is ever created).
 */
import { describe, expect, it } from "vitest";
import {
  evictHostSession,
  getHostSession,
  type HostSessionOptions,
} from "./hostSession";

let n = 0;
/** A unique `(host, binary)` per call so tests never collide in the module-level
 *  pool (which persists across `it` blocks). */
function freshOpts(): HostSessionOptions {
  n += 1;
  return {
    host: `pool-host-${n}`,
    binary: "agent",
    resolveDrvPath: () => Promise.resolve("/nix/store/deadbeef-agent.drv"),
  };
}

describe("getHostSession — the (host, binary) pool", () => {
  it("returns the SAME live session for a repeated (host, binary)", () => {
    const opts = freshOpts();
    const a = getHostSession(opts);
    const b = getHostSession(opts);
    expect(b).toBe(a);
  });

  it("hands back a FRESH session after the pooled one is destroyed (the remove-then-add bug)", () => {
    const opts = freshOpts();
    const first = getHostSession(opts);

    // Model `buildHostRegistry.remove()`: destroy the host's session. Without
    // the pool guard this would linger as a destroyed entry under the key.
    first.destroy();
    expect(first.isDestroyed()).toBe(true);

    // Model the re-`add()` of the same host: its `buildEntry` calls
    // `getHostSession` again. It MUST be a fresh, NON-destroyed session — not the
    // inert one we just destroyed.
    const second = getHostSession(opts);
    expect(second).not.toBe(first);
    expect(second.isDestroyed()).toBe(false);
  });

  it("evictHostSession frees the key so the next get builds fresh", () => {
    const opts = freshOpts();
    const first = getHostSession(opts);
    evictHostSession(opts.host, opts.binary);
    const second = getHostSession(opts);
    expect(second).not.toBe(first);
  });

  it("evictHostSession is a no-op for an unknown (host, binary)", () => {
    expect(() => evictHostSession("never-pooled", "agent")).not.toThrow();
  });
});
