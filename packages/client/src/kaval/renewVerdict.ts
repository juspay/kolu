/** The honest post-renew verdict for the `incompatible` skew card — pure and
 *  subscription-free (like {@link file://./kavalCurrency.ts} and
 *  {@link file://./pendingWindow.ts}), so its truth table is unit-tested without
 *  mounting the live `daemonStatus`.
 *
 * ── The honesty gap this closes ──────────────────────────────────────────────
 * "Update & restart kaval" (`hosts.renewDaemon`) drains the host's padi and its
 * RPC resolves the moment the DRAIN takes — the fresh kaval reconnects later, or
 * (a host with a foreign/orphaned kaval, or a cross-supervisor fight on a shared
 * box) it never does and the `incompatible` card silently RE-APPEARS. The card's
 * first-time copy — "Updating re-provisions the current build and starts a
 * correct-version kaval" — then reads as an optimistic promise the user just
 * watched fail, and they click again, forever.
 *
 * So the card's copy becomes a total function of one bit: has a renew for this
 * host already SETTLED (and we are STILL on the `incompatible` card)? If so the
 * card must say the last update did NOT converge — never repaint the same
 * hopeful first-time copy over a proven-looping recovery. */

/** `first-time` — no settled renew for this host yet: offer the recovery with
 *  its ordinary copy. `did-not-converge` — a renew already ran to its drain and
 *  the host is STILL incompatible: say so, and name the likely cause (a kaval
 *  from another kolu install / instance on the host is holding the old version),
 *  rather than promising the same update again. */
export type SkewRenewVerdict = "first-time" | "did-not-converge";

/** Pick the `incompatible`-card verdict. Called only where the card renders (the
 *  host IS incompatible), so "still incompatible" is implicit; the inputs are the
 *  per-host renew markers from `useDaemonRestart`. A renew mid-flight is neither
 *  outcome yet — it stays `first-time` (the button shows its own in-flight
 *  label), so the honest "did not converge" only appears once the attempt has
 *  actually SETTLED and left the host unconverged. */
export function skewRenewVerdict(
  renewAttempted: boolean,
  renewInFlight: boolean,
): SkewRenewVerdict {
  return renewAttempted && !renewInFlight ? "did-not-converge" : "first-time";
}
