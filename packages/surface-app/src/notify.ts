/**
 * `notify` — OS-notification delivery at the origin's ONE service worker.
 *
 * The last hop of cross-host attention: actually showing an OS notification from
 * a PWA. It is short but MINED, and both landmines are real-world:
 *
 *   1. **`getRegistration()`, not `.ready`.** `navigator.serviceWorker.ready`
 *      resolves only when an active worker EXISTS — in any context where none
 *      registers (a dev server, a degraded boot) it HANGS FOREVER, silently
 *      killing the notification path. `getRegistration()` answers honestly,
 *      including "there isn't one", which we handle.
 *   2. **The service worker shows it, never `new Notification()`.** In an
 *      installed (standalone) PWA the page-context constructor throws "Illegal
 *      constructor" — notifications MUST go through `registration.showNotification()`.
 *      Code that works in a browser tab dies precisely when the user commits to
 *      the app.
 *
 * Both are why delivery is a framework piece at all: ONE seam at the origin's one
 * service worker, instead of N windows each attempting their own delivery. The
 * `tag` carries the multi-window discipline — two open windows must not both ping
 * you, and with a tag-keyed `show` they can't (the OS REPLACES the same-tag
 * notification instead of stacking a duplicate). The click payload comes back to
 * `onClick` as plain `data` the APP routes; the framework does not know what
 * clicking attention means.
 *
 * The worker itself (`NOTIFICATION_SW_SOURCE`) already handles `notificationclick`
 * — it focuses an open window and `postMessage`s `{ type: SW_MESSAGE_TYPE, data }`;
 * `onClick` below is the page-side half that receives it.
 */

import { SW_MESSAGE_TYPE } from "./index";

/** A notification to show. `tag` keys the multi-window replace; `data` is the
 *  opaque routing payload handed back to {@link Notify.onClick}. */
export interface NotifyOptions<D> {
  /** The dedup/replace key — the OS replaces a same-`tag` notification rather
   *  than stacking a duplicate (so two windows never double-ping). Route it per
   *  attention item, e.g. `${host}/${itemId}`. */
  tag: string;
  title: string;
  body?: string;
  icon?: string;
  /** Opaque routing payload — echoed to `onClick` when the notification is
   *  clicked (structured-cloneable; the worker `postMessage`s it verbatim). */
  data: D;
}

/** The origin's notification seam. `D` is the app's own click-routing payload
 *  shape (kolu: `{ host, id }`). */
export interface Notify<D> {
  /** Request OS notification permission (idempotent — resolves `true` when
   *  already granted, `false` when denied). Delivery is a no-op until granted. */
  requestPermission(): Promise<boolean>;
  /** Show (or replace, by `tag`) a notification through the service worker.
   *  A no-op — never a throw or a hang — where there is no worker or no
   *  permission, so a caller may fire-and-forget it. */
  show(opts: NotifyOptions<D>): Promise<void>;
  /** Close any open notification(s) carrying `tag` (e.g. when its attention
   *  clears). No-op where there is no worker. */
  close(tag: string): Promise<void>;
  /** Subscribe to notification CLICKS. Fires with the clicked notification's
   *  `data`; returns an unsubscribe fn. */
  onClick(handler: (data: D) => void): () => void;
}

const swAvailable = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Build a {@link Notify} for a payload shape `D`. */
export function createNotify<D>(): Notify<D> {
  return {
    async requestPermission(): Promise<boolean> {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") return false;
      return (await Notification.requestPermission()) === "granted";
    },

    async show(opts): Promise<void> {
      if (!swAvailable()) return;
      // Permission is the app's to request; attempting a show without it would
      // only reject — silent no-op until granted (landmine-free fire-and-forget).
      if (
        typeof Notification !== "undefined" &&
        Notification.permission !== "granted"
      ) {
        return;
      }
      // Landmine 1: getRegistration(), never `.ready`.
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return; // no worker to deliver through — honest, not a hang
      // Landmine 2: the worker shows it; `tag` makes the OS replace, never stack.
      await reg.showNotification(opts.title, {
        tag: opts.tag,
        body: opts.body,
        icon: opts.icon,
        data: opts.data,
      });
    },

    async close(tag): Promise<void> {
      if (!swAvailable()) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const open = await reg.getNotifications({ tag });
      for (const n of open) n.close();
    },

    onClick(handler): () => void {
      if (!swAvailable()) return () => {};
      const listener = (event: MessageEvent): void => {
        const msg = event.data as { type?: string; data?: D } | undefined;
        if (msg?.type !== SW_MESSAGE_TYPE) return;
        handler(msg.data as D);
      };
      navigator.serviceWorker.addEventListener("message", listener);
      return () =>
        navigator.serviceWorker.removeEventListener("message", listener);
    },
  };
}
