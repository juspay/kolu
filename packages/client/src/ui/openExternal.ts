/** Leave kolu for an external http(s) URL, in a new tab, fire-and-forget.
 *
 *  One home for the flag pair, because it is a security posture rather than a
 *  preference: `noopener` denies the new tab a handle on kolu's `window`
 *  (`window.opener`), and `noreferrer` keeps kolu's URL — which carries the
 *  viewer's host and can carry a terminal id — out of the target's `Referer`.
 *  Both matter most for exactly the URLs kolu opens this way: a dev server an
 *  agent started, or a link out of a sandboxed preview.
 *
 *  It exists because there were two hand-written copies claiming they couldn't
 *  drift, and a third nearby spelling (`"noopener"` alone) proving they can.
 *
 *  NOT for the two openers that need the WINDOW back — the session-export tab
 *  (which reads the handle to detect a blocked popup and fall back to a download)
 *  and the scrollback-PDF tab (which writes into the document). Those want a
 *  handle, not a fire-and-forget, so folding them in here would mean handing back
 *  a `Window | null` and this function would stop being one decision. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
