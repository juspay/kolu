/**
 * `notify` — the origin's OS-notification delivery seam. Pins both PWA landmines
 * (getRegistration not `.ready`; the worker shows it via `showNotification`, never
 * `new Notification()`), the tag-keyed replace, the fire-and-forget no-ops (no
 * worker / no active worker / no permission / delivery failure), and the click
 * round-trip through the validating `parse`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_ACK_TYPE, SW_MESSAGE_TYPE } from "./index";
import { createNotify } from "./notify";

interface Click {
  host: string;
  id: string;
}

/** A validator for the test payload shape — the real seam demands one so a
 *  malformed/stale envelope is dropped, never routed. */
const parseClick = (data: unknown): Click | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.host !== "string" || typeof d.id !== "string") return undefined;
  return { host: d.host, id: d.id };
};

interface FakeReg {
  active: object | null;
  showNotification: ReturnType<typeof vi.fn>;
}

/** Stub `navigator.serviceWorker` with a controllable registration + message bus,
 *  and `Notification` with a permission state. Returns handles to assert on. */
function stubEnv(opts: {
  registration: FakeReg | null;
  permission?: NotificationPermission;
  /** Simulate `sessionStorage` unavailable (private mode / disabled by policy):
   *  every access throws, so the routed-id dedup can never be durably recorded. */
  storageUnavailable?: boolean;
}) {
  const listeners = new Set<(e: { data: unknown; source?: unknown }) => void>();
  const getRegistration = vi.fn().mockResolvedValue(opts.registration);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration,
      addEventListener: (
        _t: string,
        cb: (e: { data: unknown; source?: unknown }) => void,
      ) => listeners.add(cb),
      removeEventListener: (
        _t: string,
        cb: (e: { data: unknown; source?: unknown }) => void,
      ) => listeners.delete(cb),
    },
  });
  vi.stubGlobal("Notification", {
    permission: opts.permission ?? "granted",
    requestPermission: vi.fn().mockResolvedValue("granted"),
  });
  // A minimal in-memory sessionStorage so the routed-id cross-navigation dedup has
  // a store to read/write (jsdom-free unit env).
  const store = new Map<string, string>();
  vi.stubGlobal(
    "sessionStorage",
    opts.storageUnavailable
      ? {
          getItem: () => {
            throw new Error("sessionStorage disabled");
          },
          setItem: () => {
            throw new Error("sessionStorage disabled");
          },
          removeItem: () => {
            throw new Error("sessionStorage disabled");
          },
        }
      : {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => store.delete(k),
        },
  );
  return {
    getRegistration,
    emitMessage: (data: unknown, source?: unknown) => {
      for (const cb of [...listeners]) cb({ data, source });
    },
    listenerCount: () => listeners.size,
  };
}

const activeReg = (): FakeReg => ({
  active: {},
  showNotification: vi.fn().mockResolvedValue(undefined),
});

afterEach(() => vi.unstubAllGlobals());

describe("notify.show", () => {
  it("shows through the service worker with the tag (landmine 2 + tag replace)", async () => {
    const reg = activeReg();
    const env = stubEnv({ registration: reg });
    const notify = createNotify<Click>(parseClick);

    await notify.show({
      tag: "hostB/t7",
      title: "terminal awaiting on hostB",
      data: { host: "hostB", id: "t7" },
    });

    expect(env.getRegistration).toHaveBeenCalledOnce(); // getRegistration, not `.ready`
    expect(reg.showNotification).toHaveBeenCalledWith(
      "terminal awaiting on hostB",
      expect.objectContaining({
        tag: "hostB/t7",
        data: { host: "hostB", id: "t7" },
      }),
    );
  });

  it("is a silent no-op when there is no registration (dev / degraded boot — never hangs)", async () => {
    stubEnv({ registration: null });
    const notify = createNotify<Click>(parseClick);
    // Resolves — does not hang (the `.ready` failure mode this seam exists to avoid).
    await expect(
      notify.show({ tag: "t", title: "x", data: { host: "h", id: "i" } }),
    ).resolves.toBeUndefined();
  });

  it("is a silent no-op when the registration has no active worker", async () => {
    const reg: FakeReg = {
      active: null, // installing/waiting — showNotification would reject
      showNotification: vi.fn(),
    };
    stubEnv({ registration: reg });
    const notify = createNotify<Click>(parseClick);
    await notify.show({ tag: "t", title: "x", data: { host: "h", id: "i" } });
    expect(reg.showNotification).not.toHaveBeenCalled();
  });

  it("is a silent no-op when permission is not granted", async () => {
    const reg = activeReg();
    stubEnv({ registration: reg, permission: "default" });
    const notify = createNotify<Click>(parseClick);
    await notify.show({ tag: "t", title: "x", data: { host: "h", id: "i" } });
    expect(reg.showNotification).not.toHaveBeenCalled();
  });

  it("swallows a showNotification rejection (fire-and-forget never rejects)", async () => {
    const reg: FakeReg = {
      active: {},
      showNotification: vi.fn().mockRejectedValue(new Error("boom")),
    };
    stubEnv({ registration: reg });
    const notify = createNotify<Click>(parseClick);
    await expect(
      notify.show({ tag: "t", title: "x", data: { host: "h", id: "i" } }),
    ).resolves.toBeUndefined();
  });
});

describe("notify.onClick", () => {
  it("fires with the validated payload, ignores other messages + malformed data, unsubscribes", () => {
    const env = stubEnv({ registration: null });
    const notify = createNotify<Click>(parseClick);
    const seen: Click[] = [];
    const off = notify.onClick((d) => seen.push(d));

    // A non-click message is ignored.
    env.emitMessage({ type: "something-else", data: { host: "x", id: "y" } });
    // A malformed/stale envelope (no valid shape) is dropped, never routed.
    env.emitMessage({ type: SW_MESSAGE_TYPE, data: {} });
    // A real click envelope (as NOTIFICATION_SW_SOURCE posts it) delivers `data`.
    env.emitMessage({
      type: SW_MESSAGE_TYPE,
      data: { host: "hostB", id: "t7" },
    });
    expect(seen).toEqual([{ host: "hostB", id: "t7" }]);

    off();
    expect(env.listenerCount()).toBe(0);
    env.emitMessage({ type: SW_MESSAGE_TYPE, data: { host: "z", id: "z" } });
    expect(seen).toHaveLength(1); // unsubscribed — no further delivery
  });

  it("acks the EXACT delivering worker (event.source) and routes once per click id", () => {
    const env = stubEnv({ registration: null });
    const notify = createNotify<Click>(parseClick);
    const seen: Click[] = [];
    notify.onClick((d) => seen.push(d));

    const source = { postMessage: vi.fn() };
    // A delivery carrying a click id: ack goes to event.source (never the page
    // controller), and the payload routes once.
    env.emitMessage(
      {
        type: SW_MESSAGE_TYPE,
        data: { host: "hostB", id: "t7" },
        id: "click-1",
      },
      source,
    );
    expect(source.postMessage).toHaveBeenCalledWith({
      type: NOTIFICATION_ACK_TYPE,
      id: "click-1",
    });
    expect(seen).toEqual([{ host: "hostB", id: "t7" }]);

    // A retry of the SAME id (the worker posts again before the ack lands): ack
    // again, but do NOT re-route — one action per click.
    env.emitMessage(
      {
        type: SW_MESSAGE_TYPE,
        data: { host: "hostB", id: "t7" },
        id: "click-1",
      },
      source,
    );
    expect(source.postMessage).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
  });

  it("routes exactly once even when the ack postMessage throws (redundant worker mid-replacement)", () => {
    const env = stubEnv({ registration: null });
    const notify = createNotify<Click>(parseClick);
    const seen: Click[] = [];
    notify.onClick((d) => seen.push(d));

    // The delivering worker turned `redundant` mid worker-replacement: acking it throws.
    // The route runs BEFORE the ack and the id is durably claimed first, so the click
    // fires exactly once and the throw never propagates — earlier ordering (ack-then-route)
    // would have claimed the id, thrown, and left the handler never invoked (zero actions).
    const throwingSource = {
      postMessage: vi.fn(() => {
        throw new Error("worker redundant");
      }),
    };
    expect(() =>
      env.emitMessage(
        {
          type: SW_MESSAGE_TYPE,
          data: { host: "hostB", id: "t7" },
          id: "click-1",
        },
        throwingSource,
      ),
    ).not.toThrow();
    expect(seen).toEqual([{ host: "hostB", id: "t7" }]);
    expect(throwingSource.postMessage).toHaveBeenCalledOnce();

    // The id is durably claimed, so the worker's fallback navigation (and any retry) is
    // deduped — a retry of the same id acks but never re-routes.
    const retrySource = { postMessage: vi.fn() };
    env.emitMessage(
      {
        type: SW_MESSAGE_TYPE,
        data: { host: "hostB", id: "t7" },
        id: "click-1",
      },
      retrySource,
    );
    expect(seen).toHaveLength(1);
    expect(retrySource.postMessage).toHaveBeenCalledWith({
      type: NOTIFICATION_ACK_TYPE,
      id: "click-1",
    });
  });

  it("does NOT route a live id-carrying click when event.source is absent (defers to the fallback navigation)", () => {
    const env = stubEnv({ registration: null });
    const notify = createNotify<Click>(parseClick);
    const seen: Click[] = [];
    notify.onClick((d) => seen.push(d));

    // No `event.source` ⇒ the page can't ack the delivering worker, so routing live
    // un-acked would let the worker's retry horizon lapse into a fallback navigate
    // that routes the SAME click again. Stay silent: the fallback is the single route.
    env.emitMessage({
      type: SW_MESSAGE_TYPE,
      data: { host: "hostB", id: "t7" },
      id: "click-1",
    });
    expect(seen).toEqual([]);
  });

  it("does NOT route a live id-carrying click when the routed-id store is unavailable", () => {
    const env = stubEnv({ registration: null, storageUnavailable: true });
    const notify = createNotify<Click>(parseClick);
    const seen: Click[] = [];
    notify.onClick((d) => seen.push(d));

    // The dedup record can't be persisted, so it couldn't survive a fallback
    // navigation — routing live risks a double-fire. Defer to the fallback route, and
    // do NOT ack (so the worker actually falls back).
    const source = { postMessage: vi.fn() };
    env.emitMessage(
      {
        type: SW_MESSAGE_TYPE,
        data: { host: "hostB", id: "t7" },
        id: "click-1",
      },
      source,
    );
    expect(seen).toEqual([]);
    expect(source.postMessage).not.toHaveBeenCalled();
  });
});
