import type { PwaIdentity } from "kolu-common/contract";
import { hostHueFor } from "kolu-common/hostHue";

/** The app's display name — the string the browser tab title, the About dialog, and
 *  the installed PWA all read: `Kolu [<host>]`, always this kolu-server's own hostname.
 *
 *  Under ALWAYS-MAP the canvas boots on the LOCAL default (`KOLU_PADI_HOST` seeds a POOL,
 *  it no longer makes "the whole canvas become a remote host"), and *which* host a tab
 *  views is a client-side selection surfaced by the ChromeBar strip — not a server fact.
 *  So the identity no longer folds a remote host into the name (the old single-host
 *  `Kolu [<server> → <remote>]` arrow read a comma-seed-list as one remote and was wrong);
 *  it is the server's own host, byte-identical to a local single-host boot. */
export function appName(hostname: string): string {
  return `Kolu [${hostname}]`;
}

/** kolu-server's PWA identity — display {@link appName}, per-host theme color, and the
 *  raw hostname. Consumed by the `server.info` probe (browser tab title + About dialog)
 *  and the PWA manifest name. */
export function pwaIdentityForHostname(hostname: string): PwaIdentity {
  return {
    hostname,
    name: appName(hostname),
    // The window/chrome theme tint and the client's host tabs share ONE palette +
    // hash (kolu-common/hostHue), but seed it DIFFERENTLY on purpose: here we seed
    // the raw hostname (so each machine's installed PWA window stays distinct),
    // while the client keys `encodeHostKey` (local host → the literal `local`). So
    // the colour is stable per surface — NOT guaranteed identical across the PWA
    // chrome and the client's tab for the same host. See kolu-common/hostHue.
    themeColor: hostHueFor(hostname),
  };
}
