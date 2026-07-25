/**
 * The "is the viewer sitting at this host?" decision — the seam that stops kolu
 * offering a forward through a third machine to reach the machine the browser is
 * already on.
 *
 * Every case here is either a spelling two sources of the same address disagree
 * on, or a way the comparison must decline. The declining cases matter as much
 * as the matching ones: a match changes what a chip does, and the whole reason an
 * inexact comparison is acceptable is that a NON-match leaves the working forward
 * in place.
 */

import { describe, expect, it } from "vitest";
import {
  effectiveViewerAddress,
  forwardedForOf,
  isTrustedLocalPeer,
  normalizeAddress,
  sshTargetHostname,
  viewerIsOnHost,
} from "./viewerHost.ts";

describe("normalizeAddress", () => {
  it("unwraps a v4-mapped address, which is how a v4 peer arrives", () => {
    // `socket.remoteAddress` reports a v4 peer on a dual-stack listener in
    // v4-mapped form, while a resolver returns the bare v4 address. Without
    // this the two never compare equal and the feature simply never fires.
    expect(normalizeAddress("::ffff:100.64.0.7")).toBe("100.64.0.7");
    expect(normalizeAddress("100.64.0.7")).toBe("100.64.0.7");
  });

  it("drops a zone id, which belongs to the observer and not the address", () => {
    expect(normalizeAddress("fe80::1%eth0")).toBe("fe80::1");
  });

  it("unwraps URL brackets and folds hex case", () => {
    expect(normalizeAddress("[FD7A:1::2]")).toBe("fd7a:1::2");
  });

  it("leaves a plain address alone", () => {
    expect(normalizeAddress("fd7a:1::2")).toBe("fd7a:1::2");
    expect(normalizeAddress(" 10.0.0.1 ")).toBe("10.0.0.1");
  });

  it("does NOT mistake a v6 address that merely starts ::ffff: for a mapped one", () => {
    // `::ffff:1:2` is a real v6 address with no embedded v4 address in it. The
    // dotted-quad check is what tells the two apart; stripping the prefix here
    // would invent an address that is not the one bound.
    expect(normalizeAddress("::ffff:1:2")).toBe("::ffff:1:2");
  });
});

describe("viewerIsOnHost", () => {
  it("matches a viewer whose address is one of the host's", () => {
    expect(
      viewerIsOnHost({
        viewerAddress: "100.64.0.7",
        hostAddresses: ["100.64.0.7", "fd7a:1::2"],
      }),
    ).toBe(true);
  });

  it("matches ACROSS the spellings the two sides use", () => {
    // The case the whole normalization exists for, end to end: the browser's
    // peer address arrives v4-mapped, the resolver answers bare.
    expect(
      viewerIsOnHost({
        viewerAddress: "::ffff:100.64.0.7",
        hostAddresses: ["100.64.0.7"],
      }),
    ).toBe(true);
    // …and the other way round.
    expect(
      viewerIsOnHost({
        viewerAddress: "fd7a:1::2%wg0",
        hostAddresses: ["[FD7A:1::2]"],
      }),
    ).toBe(true);
  });

  it("does NOT match a different machine — the forward stays", () => {
    expect(
      viewerIsOnHost({
        viewerAddress: "100.64.0.9",
        hostAddresses: ["100.64.0.7", "fd7a:1::2"],
      }),
    ).toBe(false);
  });

  it("declines when the viewer's address is unknown", () => {
    // A proxied or socket-less connection. Declining keeps the forward, which
    // works; guessing would hand the user a link to their own machine that may
    // have nothing behind it.
    expect(
      viewerIsOnHost({ viewerAddress: undefined, hostAddresses: ["10.0.0.1"] }),
    ).toBe(false);
    expect(
      viewerIsOnHost({ viewerAddress: "", hostAddresses: ["10.0.0.1"] }),
    ).toBe(false);
  });

  it("declines when the host resolved to nothing", () => {
    // An `~/.ssh/config` alias DNS cannot resolve — common, and exactly why the
    // no-match side has to be the safe one.
    expect(
      viewerIsOnHost({ viewerAddress: "100.64.0.7", hostAddresses: [] }),
    ).toBe(false);
  });
});

describe("sshTargetHostname", () => {
  it("drops the user, which no resolver takes", () => {
    expect(sshTargetHostname("srid@zest")).toBe("zest");
    expect(sshTargetHostname("zest")).toBe("zest");
  });

  it("splits on the LAST @, so a user containing one cannot eat the host", () => {
    expect(sshTargetHostname("srid@example.com@zest")).toBe("zest");
  });
});

// ── Behind a proxy: whose address is the TCP peer, really? ──────────────
//
// Measured on production (pureintent), and the reason the first cut of this
// feature never fired once in the field:
//
//   browser ──https──▶ pureintent.rooster-blues.ts.net   (tailscale serve)
//                        └── proxy dials ──▶ http://100.122.32.106:7692
//
// tailscaled dials the backend from the HOST'S OWN tailnet address, so the only
// established connection to kolu has peer `100.122.32.106` — pureintent itself.
// The viewer's real address (zest, `100.90.229.113`) never appears as a TCP peer
// at all. The comparison was fine; the observation feeding it belonged to the
// proxy rather than to the viewer.

/** pureintent's own tailnet address — what tailscale serve dials FROM. */
const HOST_OWN = "100.122.32.106";
/** zest's tailnet address — the real viewer, per `getent hosts zest`. */
const ZEST = "100.90.229.113";
/** This server's own addresses, as it can enumerate them. */
const OWN_ADDRESSES = [HOST_OWN, "192.168.1.20"];

describe("isTrustedLocalPeer", () => {
  it("trusts loopback", () => {
    expect(isTrustedLocalPeer("127.0.0.1", OWN_ADDRESSES)).toBe(true);
    expect(isTrustedLocalPeer("::1", OWN_ADDRESSES)).toBe(true);
    expect(isTrustedLocalPeer("::ffff:127.0.0.1", OWN_ADDRESSES)).toBe(true);
  });

  it("trusts one of the server's OWN addresses — this is the tailscale-serve hop", () => {
    // Measured: tailscaled dials the backend from the host's own tailnet
    // address, so the proxy hop looks exactly like the machine itself.
    expect(isTrustedLocalPeer(HOST_OWN, OWN_ADDRESSES)).toBe(true);
  });

  it("trusts nothing else", () => {
    expect(isTrustedLocalPeer(ZEST, OWN_ADDRESSES)).toBe(false);
    expect(isTrustedLocalPeer("10.0.0.9", OWN_ADDRESSES)).toBe(false);
    expect(isTrustedLocalPeer(undefined, OWN_ADDRESSES)).toBe(false);
  });
});

describe("effectiveViewerAddress", () => {
  it("reads the forwarded client through a trusted proxy — THE FIELD CASE", () => {
    // The exact production topology. Without this the comparison ran against
    // `100.122.32.106` (pureintent) and could never match zest, so the feature
    // never fired once on the real deployment.
    expect(
      effectiveViewerAddress({
        peerAddress: HOST_OWN,
        forwardedFor: ZEST,
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe(ZEST);
  });

  it("IGNORES a forwarded header from an untrusted peer — it is attacker-controlled", () => {
    // Anyone who can reach kolu directly can send any header they like. Honouring
    // it would let a stranger claim to be sitting at any host in the fleet and be
    // handed a `localhost` link for its ports. The direct peer stands instead.
    expect(
      effectiveViewerAddress({
        peerAddress: "10.0.0.9",
        forwardedFor: ZEST,
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe("10.0.0.9");
  });

  it("takes the LAST hop a trusted proxy appended, not the first entry", () => {
    // A client can pre-set `X-Forwarded-For`; the proxy APPENDS the address it
    // actually received from. So the rightmost entry is the one the trusted hop
    // vouched for, and the leftmost is whatever the client typed.
    expect(
      effectiveViewerAddress({
        peerAddress: HOST_OWN,
        forwardedFor: `evil-claim, ${ZEST}`,
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe(ZEST);
  });

  it("falls back to the direct peer when a trusted hop added no header", () => {
    // Not a proxy at all — someone browsing on the kolu host itself. The peer is
    // the honest answer, and it simply will not match any REMOTE host, which is
    // the behaviour that was already correct.
    expect(
      effectiveViewerAddress({
        peerAddress: "127.0.0.1",
        forwardedFor: undefined,
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe("127.0.0.1");
  });

  it("ignores a header that is only separators or blanks", () => {
    // A malformed header must not produce an empty "address" that then compares
    // equal to something; it lands on the direct peer like any other non-answer.
    expect(
      effectiveViewerAddress({
        peerAddress: HOST_OWN,
        forwardedFor: " , ,",
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe(HOST_OWN);
  });

  it("stays undefined when there is no connection to speak of", () => {
    expect(
      effectiveViewerAddress({
        peerAddress: undefined,
        forwardedFor: ZEST,
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBeUndefined();
  });

  it("end-to-end: the field case now RECOGNISES zest, and the spoof does not", () => {
    // The two halves joined, because the whole point is what `viewerIsOnHost`
    // finally receives — the pure comparison never changed.
    const zestAddresses = [ZEST];
    expect(
      viewerIsOnHost({
        viewerAddress: effectiveViewerAddress({
          peerAddress: HOST_OWN,
          forwardedFor: ZEST,
          hostAddresses: OWN_ADDRESSES,
        }),
        hostAddresses: zestAddresses,
      }),
    ).toBe(true);
    expect(
      viewerIsOnHost({
        viewerAddress: effectiveViewerAddress({
          peerAddress: "10.0.0.9",
          forwardedFor: ZEST,
          hostAddresses: OWN_ADDRESSES,
        }),
        hostAddresses: zestAddresses,
      }),
    ).toBe(false);
  });
});

describe("forwardedForOf", () => {
  it("passes a single header through", () => {
    expect(forwardedForOf("100.90.229.113")).toBe("100.90.229.113");
  });

  it("re-joins a REPEATED header in arrival order", () => {
    // Node hands a repeated header over as an array, and a proxy chain
    // legitimately produces one. Joining in order is what keeps "the last entry
    // is the closest hop" true whichever shape it arrived in — reversing or
    // picking the first would silently invert the trust rule.
    expect(forwardedForOf(["evil-claim", "100.90.229.113"])).toBe(
      "evil-claim,100.90.229.113",
    );
    expect(
      effectiveViewerAddress({
        peerAddress: HOST_OWN,
        forwardedFor: forwardedForOf(["evil-claim", ZEST]),
        hostAddresses: OWN_ADDRESSES,
      }),
    ).toBe(ZEST);
  });

  it("keeps an absent header absent rather than empty", () => {
    // "No proxy said anything" and "a proxy said nothing usable" are different
    // facts; only the first means there was no proxy in the path.
    expect(forwardedForOf(undefined)).toBeUndefined();
    expect(forwardedForOf(null)).toBeUndefined();
  });
});
