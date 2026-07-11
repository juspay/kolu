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
 * clicking attention means — but it does VALIDATE the envelope (`parse`) before
 * routing, so a `{}` a stale worker or a pre-upgrade notification substitutes is
 * dropped loudly rather than mis-routed.
 *
 * The worker itself (`NOTIFICATION_SW_SOURCE`) handles `notificationclick` two
 * ways: it focuses an OPEN window and `postMessage`s `{ type: SW_MESSAGE_TYPE,
 * data }` (the live path `onClick` receives), OR — with NO window open — it opens
 * one with the payload encoded in a URL param (`NOTIFICATION_DATA_PARAM`), which
 * `onClick` reads once at startup so the one-action click survives a cold start.
 */

import {
  NOTIFICATION_ACK_TYPE,
  NOTIFICATION_CLICK_ID_PARAM,
  NOTIFICATION_DATA_PARAM,
  SW_MESSAGE_TYPE,
} from "./index";

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
   *  clicked (structured-cloneable; the worker `postMessage`s it verbatim, and
   *  JSON-encodes it into the cold-start URL param). */
  data: D;
}

/** The origin's notification seam. `D` is the app's own click-routing payload
 *  shape (kolu: a `{ kind }`-discriminated union). */
export interface Notify<D> {
  /** Request OS notification permission (idempotent — resolves `true` when
   *  already granted, `false` when denied). Delivery is a no-op until granted. */
  requestPermission(): Promise<boolean>;
  /** Show (or replace, by `tag`) a notification through the service worker.
   *  A no-op — never a throw or a hang — where there is no worker, no active
   *  worker, or no permission; an operational browser failure is caught and
   *  logged, never rejected. So a caller may safely fire-and-forget it. */
  show(opts: NotifyOptions<D>): Promise<void>;
  /** Subscribe to notification CLICKS. Fires with the clicked notification's
   *  VALIDATED `data` (via `parse`; a malformed/stale envelope is dropped with a
   *  warning, never routed). Covers both the live postMessage path and the
   *  cold-start URL-param handoff. Returns an unsubscribe fn. */
  onClick(handler: (data: D) => void): () => void;
}

const swAvailable = (): boolean =>
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

/** Build a {@link Notify} for a payload shape `D`. `parse` validates an incoming
 *  click envelope — the framework relays only well-formed payloads, so a stale
 *  notification carrying a pre-upgrade shape (or a `{}` a degraded worker
 *  substitutes) is dropped, never mis-routed. Return `undefined` to reject. */
export function createNotify<D>(
  parse: (data: unknown) => D | undefined,
): Notify<D> {
  // Route one raw click envelope: validate, then hand the app its typed payload.
  const route = (raw: unknown, handler: (data: D) => void): void => {
    const parsed = parse(raw);
    if (parsed === undefined) {
      console.warn(
        "notify.onClick: dropping malformed/stale click payload",
        raw,
      );
      return;
    }
    handler(parsed);
  };

  return {
    async requestPermission(): Promise<boolean> {
      if (typeof Notification === "undefined") return false;
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") return false;
      try {
        return (await Notification.requestPermission()) === "granted";
      } catch (err) {
        // A browser that rejects the prompt (or an insecure context) must not
        // turn a fire-and-forget request into an unhandled rejection.
        console.warn("notify.requestPermission failed", err);
        return false;
      }
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
      try {
        // Landmine 1: getRegistration(), never `.ready`.
        const reg = await navigator.serviceWorker.getRegistration();
        // A registration can exist WITHOUT an active worker (installing/waiting);
        // `showNotification` on it rejects. `reg.active` is the honest gate.
        if (!reg?.active) return; // no worker to deliver through — not a hang
        // Landmine 2: the worker shows it; `tag` makes the OS replace, never stack.
        await reg.showNotification(opts.title, {
          tag: opts.tag,
          body: opts.body,
          icon: opts.icon,
          data: opts.data,
        });
      } catch (err) {
        // Delivery is best-effort: a failed OS notification is logged, never
        // rejected into an unhandled promise the fire-and-forget caller discards.
        console.warn("notify.show failed", err);
      }
    },

    onClick(handler): () => void {
      if (!swAvailable()) return () => {};
      // The worker retries `postMessage` until we ACK (a message is dropped if this
      // page installed its listener AFTER the worker first posted — an open-but-still-
      // loading window). So: ACK every delivery (stops the retry loop), but ROUTE
      // once per click `id` (a retry can arrive before our ack lands, and a durable
      // fallback navigate can re-deliver the same id after we already routed it).
      const listener = (event: MessageEvent): void => {
        const msg = event.data as
          | { type?: string; data?: unknown; id?: unknown }
          | undefined;
        if (msg?.type !== SW_MESSAGE_TYPE) return;
        const id = typeof msg.id === "string" ? msg.id : undefined;
        if (id !== undefined) {
          // ACK the EXACT worker that delivered this message (`event.source`), NOT
          // `navigator.serviceWorker.controller`: mid worker-replacement the
          // controller can be a DIFFERENT worker than the one retrying, so acking
          // the controller would never reach the delivering loop — it would time out
          // and fall back to a navigate, re-routing the click. `event.source` is the
          // sender, so the ack always lands.
          const source = event.source as ServiceWorker | null;
          source?.postMessage({ type: NOTIFICATION_ACK_TYPE, id });
          if (wasRouted(id)) return; // already routed this click (retry / re-deliver)
          markRouted(id);
        }
        route(msg.data, handler);
      };
      navigator.serviceWorker.addEventListener("message", listener);
      // Cold-start / fallback handoff: a click that couldn't be delivered live opened
      // or navigated a window with the payload + id in the URL params. Consume it ONCE
      // here (dedup by id, then strip the params so a reload can't re-route) — the same
      // validated `route` path, so a cold click and a live click behave alike.
      consumePendingClick(handler, route);
      return () =>
        navigator.serviceWorker.removeEventListener("message", listener);
    },
  };
}

/** A bounded FIFO of recently-routed click ids, kept in `sessionStorage` so it
 *  survives the worker's durable fallback NAVIGATION (a live route followed by a
 *  fallback navigate must not fire twice). Capped so it can never grow without
 *  bound (F27); `sessionStorage` is per-tab and best-effort — if it is unavailable
 *  (private mode, disabled) we simply lose cross-navigation dedup, never throw. */
const ROUTED_IDS_KEY = "kolu.surface-app.notify.routedIds";
const ROUTED_IDS_CAP = 64;

function readRoutedIds(): string[] {
  try {
    const raw = sessionStorage.getItem(ROUTED_IDS_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function wasRouted(id: string): boolean {
  return readRoutedIds().includes(id);
}

function markRouted(id: string): void {
  try {
    const ids = readRoutedIds();
    if (ids.includes(id)) return;
    ids.push(id);
    while (ids.length > ROUTED_IDS_CAP) ids.shift();
    sessionStorage.setItem(ROUTED_IDS_KEY, JSON.stringify(ids));
  } catch {
    // sessionStorage unavailable — cross-navigation dedup degrades, never crashes.
  }
}

/** Read + retire a cold-start / fallback click payload from the URL
 *  (`NOTIFICATION_DATA_PARAM` + `NOTIFICATION_CLICK_ID_PARAM`), routing it through the
 *  same validated path as a live postMessage click. Dedups by id so a live route
 *  followed by the worker's fallback NAVIGATION (which re-delivers the same id via the
 *  URL) never fires the action twice. */
function consumePendingClick<D>(
  handler: (data: D) => void,
  route: (raw: unknown, handler: (data: D) => void) => void,
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get(NOTIFICATION_DATA_PARAM);
  const id = url.searchParams.get(NOTIFICATION_CLICK_ID_PARAM) ?? undefined;
  if (encoded === null) return;
  // Strip both params first — regardless of validity — so a reload never re-fires it.
  url.searchParams.delete(NOTIFICATION_DATA_PARAM);
  url.searchParams.delete(NOTIFICATION_CLICK_ID_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  // A fallback navigate re-delivers a click this page may have ALREADY routed live —
  // skip it if so, and otherwise record it so a later re-delivery is deduped.
  if (id !== undefined) {
    if (wasRouted(id)) return;
    markRouted(id);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(encoded);
  } catch (err) {
    console.warn("notify: dropping unparsable cold-start click payload", err);
    return;
  }
  route(raw, handler);
}
