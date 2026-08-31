/**
 * The dial URL when a turnkey connect seam's caller names none — ONE law, shared
 * by both doors.
 *
 * A browser app dials the origin that served it. That is not a choice, which is
 * why it is a default rather than a required option: every browser consumer that
 * spelled `url` by hand spelled exactly this, through the same `surfaceWsUrl`
 * (the `https:` → `wss:` swap plus the surface path). `connectSurface` has
 * defaulted it since it existed; `connectSurfaces` did not, so an app whose wire
 * is a rooted bundle had to re-derive at its call site the one line its
 * single-surface twin got free — the small residue that survives an otherwise
 * complete collapse, and the reason this lives here now instead of in one seam.
 *
 * A THUNK, deferred to connect time, so merely importing a seam never touches
 * `location` — a Node consumer (a CLI, a test, an SSR pass) can import the module
 * and only meets the requirement if it actually dials without a URL. And then it
 * THROWS rather than fabricating an address: refusing before anything is
 * allocated is the same law the post-dial unwind holds on the other side of the
 * await, and a made-up origin would surface as a connection that retries forever
 * against nothing.
 *
 * Package-internal: not on any barrel. `surfaceWsUrl` is the public derivation a
 * consumer reaches for; this is only the two seams' agreement about when to call
 * it for you.
 */

import { surfaceWsUrl } from "./index";

/** The page's own origin through {@link surfaceWsUrl}. `seam` names the caller in
 *  the refusal, since that is the door the reader has to go fix. */
export function defaultSurfaceUrl(seam: string): string {
  if (typeof location === "undefined") {
    throw new Error(
      `${seam}: no \`url\` was given and there is no browser \`location\` to derive ` +
        "one from — pass `url` explicitly outside a browser",
    );
  }
  return surfaceWsUrl(location.origin);
}
