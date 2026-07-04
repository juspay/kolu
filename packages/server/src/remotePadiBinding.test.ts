/**
 * `RemotePadiSession` unit — the ssh arm's adapter logic, WITHOUT ssh.
 *
 * The transport (provision · ssh · reconnect) is `@kolu/surface-nix-host`'s
 * `HostSession`, proven by its own tests; what THIS arm adds is the padi-specific
 * layer — the control-core `hello` handshake, skew refusal, scoping to
 * `.surface.padi`, identity readouts, and drain. So the "host" here is a hand-
 * driven fake `RemoteMirrorSession` (the same pattern `reServeSurface.test.ts`
 * uses): `setClient` mints a fresh client promise + fires `onState` (a spawn),
 * `drop` clears it (a link death). No process, no ssh, no nix.
 */

import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import type {
  ConnectionState,
  HostSessionState,
  RemoteMirrorSession,
} from "@kolu/surface-nix-host";
import type { AnyContractRouter } from "@orpc/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { RemotePadiSession, remotePadiHost } from "./remotePadiBinding.ts";

// ── Fakes ────────────────────────────────────────────────────────────────────

const BASE_STATE: HostSessionState = {
  connection: "connecting",
  progressLines: [],
  remoteProgressLines: [],
  lastError: null,
  failureCause: null,
};

let drainCalls = 0;

/** A fake padi COMBINED client: answers the frozen control core (`hello`/`drain`)
 *  and carries a `.surface.padi` marker so `scopePadiSurface` (which returns
 *  `{ surface: client.surface.padi }`) has something to scope to. */
function makeCombined(hello: {
  stateRoot: string;
  surfaceVersion: string;
  controlCoreVersion: string;
  startedAt: number;
  commit?: string;
}): unknown {
  return {
    surface: {
      control: {
        core: {
          hello: async () => hello,
          drain: async () => {
            drainCalls += 1;
          },
        },
      },
      padi: { marker: "padi-scoped" },
    },
  };
}

const helloOk = (
  over: Partial<{ commit: string; startedAt: number }> = {},
) => ({
  stateRoot: "/remote/.local/state/padi",
  surfaceVersion: PADI_SURFACE_VERSION,
  controlCoreVersion: "1.0",
  startedAt: over.startedAt ?? 1000,
  commit: over.commit ?? "abc1234",
});

/** A hand-driven `RemoteMirrorSession` standing in for the ssh `HostSession`. */
class FakeHost implements RemoteMirrorSession<AnyContractRouter> {
  private clientPromise: Promise<unknown> | null = null;
  private state: HostSessionState = BASE_STATE;
  private readonly listeners = new Set<(s: HostSessionState) => void>();
  destroyed = false;
  pinCount = 0;
  markConnectedCount = 0;

  /** A fresh spawn: a NEW client promise (so a cursor advances on identity) + a
   *  state fire. */
  setClient(client: unknown, connection: ConnectionState = "connected"): void {
    this.clientPromise = Promise.resolve(client);
    this.state = {
      ...this.state,
      connection,
      lastError: null,
      failureCause: null,
    };
    this.fire();
  }

  /** The link died: no client, a disconnected frame. */
  drop(): void {
    this.clientPromise = null;
    this.state = {
      ...this.state,
      connection: "disconnected",
      lastError: "link dropped",
      failureCause: "network",
    };
    this.fire();
  }

  pin(): Promise<unknown> {
    this.pinCount += 1;
    return this.clientPromise ?? Promise.reject(new Error("no client yet"));
  }
  currentClient(): Promise<unknown> | null {
    return this.destroyed ? null : this.clientPromise;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  onState(cb: (s: HostSessionState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state); // snapshot-then-delta, like HostSession.
    return () => {
      this.listeners.delete(cb);
    };
  }
  markConnected(): void {
    this.markConnectedCount += 1;
  }
  destroy(): void {
    this.destroyed = true;
    this.clientPromise = null;
    this.fire();
  }
  private fire(): void {
    for (const cb of [...this.listeners]) cb(this.state);
  }
}

const newSession = (): { host: FakeHost; rp: RemotePadiSession } => {
  const host = new FakeHost();
  const rp = new RemotePadiSession(
    host as RemoteMirrorSession<never>,
    "remote-e2e",
  );
  return { host, rp };
};

beforeEach(() => {
  drainCalls = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RemotePadiSession — the ssh arm's handshake + scope + drain", () => {
  it("handshakes a fresh spawn, scopes to .surface.padi, and reads identity", async () => {
    const { host, rp } = newSession();
    host.setClient(
      makeCombined(helloOk({ commit: "deadbee", startedAt: 4242 })),
    );

    const client = (await rp.currentClient()) as { surface: unknown };
    // scopePadiSurface = { surface: combined.surface.padi } — the re-serve mirrors
    // `.surface.padi.<member>`, so the scoped client's surface IS padi's.
    expect(client.surface).toEqual({ marker: "padi-scoped" });

    // Identity is read off the control-core hello (the daemonInventory + rail cells).
    expect(rp.padiSurfaceVersion()).toBe(PADI_SURFACE_VERSION);
    expect(rp.padiBuildCommit()).toBe("deadbee");
    expect(rp.padiStartedAt()).toBe(4242);
  });

  it("refuses an incompatible padiSurface LOUDLY (skew) — rejects the client, degrades the cell, never a kill", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined({ ...helloOk(), surfaceVersion: "99.0" }));

    // The mirrored client REJECTS so the pump's cursor keeps waiting (no crash).
    await expect(rp.currentClient()).rejects.toThrow(/skew/i);

    // …and the connection cell reads a loud, honest degraded/remote frame — never a
    // silent "connected but empty".
    let last: HostSessionState | undefined;
    rp.onState((s) => {
      last = s;
    });
    expect(last?.connection).toBe("disconnected");
    expect(last?.failureCause).toBe("remote");
    expect(rp.padiSurfaceVersion()).toBeNull();
  });

  it("drains the bound padi over the COMBINED control-core client (the restart verb)", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk()));
    await rp.currentClient();

    await rp.drainBoundPadi();
    expect(drainCalls).toBe(1);
  });

  it("throws on drain when unbound (no crash, an honest error)", async () => {
    const { rp } = newSession();
    await expect(rp.drainBoundPadi()).rejects.toThrow(/not bound/i);
  });

  it("re-handshakes a NEW spawn on reconnect, refreshing identity", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk({ commit: "aaa1111" })));
    await rp.currentClient();
    expect(rp.padiBuildCommit()).toBe("aaa1111");

    // Link drops: identity clears to the honest "unknown".
    host.drop();
    expect(rp.padiBuildCommit()).toBeNull();
    expect(rp.currentClient()).toBeNull();

    // A fresh spawn (a respawned/re-adopted padi) re-handshakes with fresh identity.
    host.setClient(makeCombined(helloOk({ commit: "bbb2222" })));
    await rp.currentClient();
    expect(rp.padiBuildCommit()).toBe("bbb2222");
  });

  it("advances currentClient identity per spawn, but stays STABLE within one (no cursor spin)", async () => {
    const { host, rp } = newSession();
    host.setClient(makeCombined(helloOk()));
    const a = rp.currentClient();
    const b = rp.currentClient();
    // Stable within a spawn — the memoized promise, so makeClientCursor keeps
    // waiting instead of busy-spinning on a fresh object each poll.
    expect(a).toBe(b);

    host.setClient(makeCombined(helloOk()));
    const c = rp.currentClient();
    // A genuinely new spawn → a new promise identity → the cursor advances.
    expect(c).not.toBe(a);
    await Promise.all([a, c]);
  });

  it("pin() kicks the host spawn; markConnected + destroy forward", () => {
    const { host, rp } = newSession();
    void rp.pin().catch(() => {});
    expect(host.pinCount).toBe(1);

    rp.markConnected();
    expect(host.markConnectedCount).toBe(1);

    rp.destroy();
    expect(host.destroyed).toBe(true);
    expect(rp.isDestroyed()).toBe(true);
    expect(rp.currentClient()).toBeNull();
  });
});

describe("remotePadiHost — the KOLU_PADI_HOST knob", () => {
  const prior = process.env.KOLU_PADI_HOST;

  it("is undefined when unset or blank (→ local arm)", () => {
    delete process.env.KOLU_PADI_HOST;
    expect(remotePadiHost()).toBeUndefined();
    process.env.KOLU_PADI_HOST = "   ";
    expect(remotePadiHost()).toBeUndefined();
    if (prior === undefined) delete process.env.KOLU_PADI_HOST;
    else process.env.KOLU_PADI_HOST = prior;
  });

  it("returns the trimmed host when set (→ remote arm)", () => {
    process.env.KOLU_PADI_HOST = "  nix@prod  ";
    expect(remotePadiHost()).toBe("nix@prod");
    if (prior === undefined) delete process.env.KOLU_PADI_HOST;
    else process.env.KOLU_PADI_HOST = prior;
  });
});
