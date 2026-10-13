/**
 * Which form of a published closure a host pulls — decided by two facts about
 * the host's Nix (`resolveHostNix`), never by a setting:
 *
 *   - a macOS host pulls the SIGNED input-addressed closure (`ia`): rewriting a
 *     Mach-O breaks its code signature, and macOS kills it on launch;
 *   - a Linux host whose Nix line can verify the CONTENT-ADDRESSED form the
 *     publisher writes ({@link CA_LINES}) pulls `ca`, which needs no trust;
 *   - any other Linux Nix pulls the signed `ia`, exactly as a Mac does.
 *
 * The signed form needs the host's Nix to trust the login or the cache's key;
 * {@link signedBecause} says why a host was sent it, for the words a refusal
 * carries.
 */

import type { HostNix } from "./arch";
import type { PublishedClosure } from "./closureIndex";

/** Why a host is sent the signed closure rather than the content-addressed
 *  one. */
export type SignedBecause = "mach-o" | "nix-line";

export type ClosureRoute =
  | { readonly kind: "content-addressed"; readonly storePath: string }
  | {
      readonly kind: "signed";
      readonly storePath: string;
      readonly because: SignedBecause;
    };

/** The Nix lines (`major.minor`, inclusive–exclusive) that verify the
 *  content-addressed form a publisher writes — stated ONCE, here. The
 *  publisher (`.github/actions/publish-closure`) rewrites with Nix 2.34.8;
 *  Nix 2.35 changed how a self-referencing NAR is hashed, so 2.34 and 2.35
 *  refuse each other's rewrite (`ca hash mismatch importing path`, measured
 *  both ways — agent-distro#102); 2.17 is the oldest line that imports one. */
const CA_LINES = { from: [2, 17], before: [2, 35] } as const;

/** `nixVersion`'s `major.minor`. A version that does not start with one is a
 *  fault about the host's Nix, and loud. */
function nixLine(nixVersion: string): readonly [number, number] {
  const m = /^(\d+)\.(\d+)/.exec(nixVersion);
  if (m === null)
    throw new Error(
      `the host's Nix reported version ${JSON.stringify(nixVersion)}, which names no major.minor`,
    );
  return [Number(m[1]), Number(m[2])];
}

const atLeast = (
  [major, minor]: readonly [number, number],
  [m2, n2]: readonly [number, number],
): boolean => major > m2 || (major === m2 && minor >= n2);

/** The route `host` takes for `published` — see the module header. A Linux
 *  host on a content-addressed line whose entry names no `ca` is a broken
 *  publication, and throws. */
export function closureRoute(
  host: HostNix,
  published: PublishedClosure,
): ClosureRoute {
  if (host.system.endsWith("-darwin"))
    return { kind: "signed", storePath: published.ia, because: "mach-o" };
  const line = nixLine(host.nixVersion);
  if (atLeast(line, CA_LINES.from) && !atLeast(line, CA_LINES.before)) {
    if (published.ca === undefined)
      throw new Error(
        `the closure index names no content-addressed closure for ${host.system}`,
      );
    return { kind: "content-addressed", storePath: published.ca };
  }
  return { kind: "signed", storePath: published.ia, because: "nix-line" };
}

/** Why `host` was sent the signed closure, in words a user reads. */
export function signedBecause(because: SignedBecause, host: HostNix): string {
  switch (because) {
    case "mach-o":
      return "macOS kills a program whose code signature a content-addressed rewrite broke";
    case "nix-line":
      return `its Nix ${host.nixVersion} cannot verify the content-addressed form the publisher writes (written by Nix 2.34; Nix 2.17 through 2.34 can)`;
    default:
      return because satisfies never;
  }
}
