/**
 * `notify` — the origin's OS-notification delivery seam. Pins both PWA landmines
 * (getRegistration not `.ready`; the worker shows it via `showNotification`, never
 * `new Notification()`), the tag-keyed replace, the fire-and-forget no-ops (no
 * worker / no active worker / no permission / delivery failure), and the click
 * round-trip through the validating `parse`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SW_MESSAGE_TYPE } from "./index";
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
}) {
  const listeners = new Set<(e: { data: unknown }) => void>();
  const getRegistration = vi.fn().mockResolvedValue(opts.registration);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration,
      addEventListener: (_t: string, cb: (e: { data: unknown }) => void) =>
        listeners.add(cb),
      removeEventListener: (_t: string, cb: (e: { data: unknown }) => void) =>
        listeners.delete(cb),
    },
  });
  vi.stubGlobal("Notification", {
    permission: opts.permission ?? "granted",
    requestPermission: vi.fn().mockResolvedValue("granted"),
  });
  return {
    getRegistration,
    emitMessage: (data: unknown) => {
      for (const cb of [...listeners]) cb({ data });
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
});
