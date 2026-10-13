/**
 * Which form of a published bundle a host pulls — decided by two facts about
 * the host's Nix (`resolveHostNix`), never by a setting:
 *
 *   - a macOS host pulls the SIGNED input-addressed bundle (`ia`): rewriting a
 *     Mach-O breaks its code signature, and macOS kills it on launch;
 *   - a Linux host whose Nix line can verify the CONTENT-ADDRESSED form
 *     agent-distro publishes — Nix 2.17 through 2.34; upstream rewrites with
 *     2.34, and 2.35 changed how a self-referencing path is hashed, so the two
 *     lines refuse each other's form — pulls `ca`, which needs no trust;
 *   - any other Linux Nix pulls the signed `ia`, exactly as a Mac does.
 *
 * The signed form needs the host's Nix to trust the login or the cache's key;
 * {@link signedBecause} says why a host was sent it, for the words a refusal
 * carries.
 */

import type { CaIndexEntry } from "@kolu/agent-distro/caIndex";
import type { HostNix } from "@kolu/surface-remote";

/** Why a host is sent the signed bundle rather than the content-addressed one. */
export type SignedBecause = "mach-o" | "nix-line";

export type BundleRoute =
  | { readonly kind: "content-addressed"; readonly storePath: string }
  | {
      readonly kind: "signed";
      readonly storePath: string;
      readonly because: SignedBecause;
    };

/** The Nix lines (`major.minor`, inclusive–exclusive) that verify the
 *  content-addressed form upstream publishes. */
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

/** The route `host` takes for `published` — see the module header. */
export function bundleRoute(
  host: HostNix,
  published: CaIndexEntry,
): BundleRoute {
  if (host.system.endsWith("-darwin"))
    return { kind: "signed", storePath: published.ia, because: "mach-o" };
  const line = nixLine(host.nixVersion);
  if (atLeast(line, CA_LINES.from) && !atLeast(line, CA_LINES.before)) {
    if (published.ca === undefined)
      throw new Error(
        `agent-distro's index names no content-addressed bundle for ${host.system}`,
      );
    return { kind: "content-addressed", storePath: published.ca };
  }
  return { kind: "signed", storePath: published.ia, because: "nix-line" };
}

/** Why `host` was sent the signed bundle, in words a user reads. */
export function signedBecause(because: SignedBecause, host: HostNix): string {
  switch (because) {
    case "mach-o":
      return "macOS kills a program whose code signature a content-addressed rewrite broke";
    case "nix-line":
      return `its Nix ${host.nixVersion} cannot verify the content-addressed form agent-distro publishes (written by Nix 2.34; Nix 2.17 through 2.34 can)`;
    default:
      return because satisfies never;
  }
}
