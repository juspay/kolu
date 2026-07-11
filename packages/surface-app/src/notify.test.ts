/**
 * `notify` — the origin's OS-notification delivery seam. Pins both PWA landmines
 * (getRegistration not `.ready`; the worker shows it via `showNotification`, never
 * `new Notification()`), the tag-keyed replace, the fire-and-forget no-ops (no
 * worker / no permission), and the click round-trip.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { SW_MESSAGE_TYPE } from "./index";
import { createNotify } from "./notify";

interface FakeReg {
  showNotification: ReturnType<typeof vi.fn>;
  getNotifications: ReturnType<typeof vi.fn>;
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

afterEach(() => vi.unstubAllGlobals());

describe("notify.show", () => {
  it("shows through the service worker with the tag (landmine 2 + tag replace)", async () => {
    const reg: FakeReg = {
      showNotification: vi.fn().mockResolvedValue(undefined),
      getNotifications: vi.fn().mockResolvedValue([]),
    };
    const env = stubEnv({ registration: reg });
    const notify = createNotify<{ host: string; id: string }>();

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
    const notify = createNotify<unknown>();
    // Resolves — does not hang (the `.ready` failure mode this seam exists to avoid).
    await expect(
      notify.show({ tag: "t", title: "x", data: null }),
    ).resolves.toBeUndefined();
  });

  it("is a silent no-op when permission is not granted", async () => {
    const reg: FakeReg = {
      showNotification: vi.fn(),
      getNotifications: vi.fn(),
    };
    stubEnv({ registration: reg, permission: "default" });
    const notify = createNotify<unknown>();
    await notify.show({ tag: "t", title: "x", data: null });
    expect(reg.showNotification).not.toHaveBeenCalled();
  });
});

describe("notify.close", () => {
  it("closes open notifications carrying the tag", async () => {
    const close = vi.fn();
    const reg: FakeReg = {
      showNotification: vi.fn(),
      getNotifications: vi.fn().mockResolvedValue([{ close }, { close }]),
    };
    stubEnv({ registration: reg });
    const notify = createNotify<unknown>();
    await notify.close("hostB/t7");
    expect(reg.getNotifications).toHaveBeenCalledWith({ tag: "hostB/t7" });
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe("notify.onClick", () => {
  it("fires with the payload on a SW click message, ignores other messages, unsubscribes", () => {
    const env = stubEnv({ registration: null });
    const notify = createNotify<{ host: string; id: string }>();
    const seen: Array<{ host: string; id: string }> = [];
    const off = notify.onClick((d) => seen.push(d));

    // A non-click message is ignored.
    env.emitMessage({ type: "something-else", data: { host: "x", id: "y" } });
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
