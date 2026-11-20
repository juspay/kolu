// @vitest-environment happy-dom
import type { HostKey } from "kolu-common/hostKey";
import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let info: ConnectionInfo | undefined;
  const listeners = new Set<() => void>();
  return {
    host: { kind: "remote", target: "zest" } satisfies HostKey,
    get info() {
      return info;
    },
    setInfo(next: ConnectionInfo | undefined) {
      info = next;
      for (const l of listeners) l();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
});

vi.mock("../wire", () => {
  let ver: (() => number) | undefined;
  let setVer: ((n: number | ((p: number) => number)) => void) | undefined;
  const ensure = () => {
    if (!ver) {
      const pair = createSignal(0);
      ver = pair[0];
      setVer = pair[1];
      h.subscribe(() => setVer?.((n) => n + 1));
    }
  };
  return {
    activeHost: () => h.host,
    connectionInfo: () => {
      ensure();
      ver?.();
      return h.info;
    },
  };
});

const clock = vi.hoisted(() => {
  let now = 1_000_000;
  const subs = new Set<() => void>();
  return {
    read: () => now,
    advance(ms: number) {
      now += ms;
      for (const s of [...subs]) s();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset() {
      now = 1_000_000;
      subs.clear();
    },
  };
});

vi.mock("../time/clock", () => ({
  getClockNow: () => {
    const [n, setN] = createSignal(clock.read());
    clock.subscribe(() => setN(clock.read()));
    return n;
  },
}));

const { ConnectCanvas } = await import("./ConnectCanvas");

let dispose: (() => void) | undefined;
beforeEach(() => {
  clock.reset();
  h.setInfo(undefined);
  document.body.innerHTML = "";
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const elapsed = () =>
  document.querySelector('[data-testid="connect-elapsed"]')?.textContent ??
  null;

describe("ConnectCanvas elapsed timer (#1962)", () => {
  it("ticks every second with ZERO incoming log frames", async () => {
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "6 paths done · 84 B of 84 B" }],
      sinceMs: 3_000,
      campaignEpoch: 1,
    });

    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(elapsed()).toBe("3s");

    clock.advance(1_000);
    expect(elapsed()).toBe("4s");
    clock.advance(1_000);
    expect(elapsed()).toBe("5s");
    clock.advance(5_000);
    expect(elapsed()).toBe("10s");
  });

  it("keeps ticking when the anchor effect re-runs with the SAME sinceMs", async () => {
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "copying 6 paths…" }],
      sinceMs: 3_000,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(elapsed()).toBe("3s");

    clock.advance(2_000);
    expect(elapsed()).toBe("5s");

    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "copying path '/nix/store/…-pkg'…" }],
      sinceMs: 3_000,
      campaignEpoch: 1,
    });
    expect(elapsed()).toBe("5s");

    clock.advance(3_000);
    expect(elapsed()).toBe("8s");
  });

  it("re-baselines when the server sinceMs advances (stays honest to the session clock)", async () => {
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "provisioning" }],
      sinceMs: 3_000,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    clock.advance(2_000);
    expect(elapsed()).toBe("5s");

    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "provisioning" }],
      sinceMs: 40_000,
      campaignEpoch: 1,
    });
    expect(elapsed()).toBe("40s");
    clock.advance(1_000);
    expect(elapsed()).toBe("41s");
  });

  it("suppresses the sub-1s flash on a fresh frame", async () => {
    h.setInfo({
      phase: "connecting",
      log: [],
      sinceMs: 200,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="connect-elapsed"]'),
    ).toBeNull();
  });

  it("re-baselines when the active host switches (same sinceMs, component stays mounted)", async () => {
    h.host = { kind: "remote", target: "zest" };
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "building on zest" }],
      sinceMs: 0,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    clock.advance(2_000);
    expect(elapsed()).toBe("2s");

    h.host = { kind: "remote", target: "other" };
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "building on other" }],
      sinceMs: 0,
      campaignEpoch: 1,
    });
    expect(
      document.querySelector('[data-testid="connect-elapsed"]'),
    ).toBeNull();
    clock.advance(2_000);
    expect(elapsed()).toBe("2s");
  });

  it("re-baselines on same-host recheck when campaignEpoch advances (quiet stretch)", async () => {
    h.host = { kind: "remote", target: "zest" };
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: "provisioning" }],
      sinceMs: 0,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    clock.advance(40_000);
    expect(elapsed()).toBe("40s");

    h.setInfo({
      phase: "probing",
      log: [],
      sinceMs: 0,
      campaignEpoch: 2,
    });
    expect(
      document.querySelector('[data-testid="connect-elapsed"]'),
    ).toBeNull();
    clock.advance(2_000);
    expect(elapsed()).toBe("2s");
  });
});

describe("ConnectCanvas tail chrome", () => {
  const LONG_LINE =
    "copying path '/nix/store/5z2yp3ysx8476c8g5w25b0smlgkjvaq3-hello-2.12.3' from 'https://cache.nixos.org'";

  const mountWithTail = () => {
    h.host = { kind: "remote", target: "zest" };
    h.setInfo({
      phase: "provisioning",
      log: [{ source: "local", line: LONG_LINE }],
      sinceMs: 3_000,
      campaignEpoch: 1,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
  };

  it("wraps each line and holds a fixed six-row box, so the title and timer never move", () => {
    mountWithTail();
    const tail = document.querySelector<HTMLElement>(
      '[data-testid="connect-tail"]',
    );
    expect(tail).not.toBeNull();
    const chrome = tail?.className ?? "";
    expect(chrome).toContain("h-[6lh]");
    expect(chrome).toContain("justify-end");
    expect(chrome).toContain("overflow-hidden");
    const row = tail?.firstElementChild as HTMLElement | null;
    expect(row?.className).toContain("whitespace-pre-wrap");
    expect(row?.textContent).toBe(LONG_LINE);
    expect(
      document.querySelector('[data-testid="connect-tail-copy"]'),
    ).not.toBeNull();
  });

  it("offers the docs link below the log", () => {
    mountWithTail();
    const tail = document.querySelector('[data-testid="connect-tail"]');
    const link = document.querySelector(
      'a[href="https://kolu.dev/remote-hosts/"]',
    );
    expect(link?.textContent).toContain("Add another machine");
    expect(tail).not.toBeNull();
    expect(link).not.toBeNull();
    expect(
      (tail as Node).compareDocumentPosition(link as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
