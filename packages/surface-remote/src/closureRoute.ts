/**
 * Which form of a closure travels to a host — decided by facts about the
 * Nixes involved, never by a setting. ONE table, {@link CA_FORMS}, says which
 * Nix writes and verifies which content-addressed form; both routes read it:
 *
 *   - the PUBLISHED route ({@link closureRoute}) — what a host pulls from a
 *     cache, decided by two facts about the host's Nix (`resolveHostNix`):
 *       - a macOS host pulls the SIGNED input-addressed closure (`ia`):
 *         rewriting a Mach-O breaks its code signature, and macOS kills it on
 *         launch;
 *       - a Linux host whose Nix verifies the content-addressed form the
 *         publisher writes pulls `ca`, which needs no trust;
 *       - any other Linux Nix pulls the signed `ia`, exactly as a Mac does;
 *   - the SENDER's staging ({@link stagingRoute}) — whether this machine
 *     rewrites a closure it holds content-addressed before shipping it to a
 *     Linux host: only when the `nix` that writes the rewrite, the store on
 *     this machine that takes it, and the host's store that takes the ship all
 *     handle the same form — else it ships the closure AS BUILT
 *     (input-addressed, signed by no one).
 *
 * Both the signed and the as-built form need the host's Nix to trust the login
 * (or, for the signed one, the cache's key); {@link signedBecause} and
 * {@link asBuiltBecause} say why a host was sent one, for the words a refusal
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

/** The content-addressed FORMS a Nix writes and verifies, named by the first
 *  Nix line (`major.minor`) of each, oldest first — stated ONCE, here. A Nix
 *  verifies only the form its own line writes:
 *
 *   - `2.17` — the oldest line that imports a content-addressed rewrite;
 *   - `2.35` — Nix 2.35 changed how a self-referencing NAR is hashed, so 2.34
 *     and 2.35 refuse each other's rewrite (`ca hash mismatch importing
 *     path`, measured both ways between two stores — agent-distro#102 — and
 *     between one machine's `nix` and its own daemon — #2368). */
const CA_FORMS = ["2.17", "2.35"] as const;

/** A content-addressed form: the first Nix line that writes it. */
export type CaForm = (typeof CA_FORMS)[number];

/** Why a macOS host is sent the closure as built, in words a user reads —
 *  one sentence for both routes. */
export const MACH_O_BECAUSE =
  "macOS kills a program whose code signature a content-addressed rewrite broke";

/** Why a target whose system nobody named is sent the closure as built. */
export const UNKNOWN_SYSTEM_BECAUSE =
  "nobody named its Nix system, so it is sent the form every store can run";

/** Does `system` (a Nix system, `aarch64-darwin`) name a macOS host — the one
 *  kind that only ever takes the signed, input-addressed closure? ONE rule for
 *  both routes: the published one here and the sender's staging
 *  (`nixCopy.ts`), so a Nix that one day re-signs a rewritten Mach-O flips
 *  them together. */
export function isDarwinSystem(system: string): boolean {
  return system.endsWith("-darwin");
}

/** A Nix version's leading `major.minor`. */
const NIX_LINE_RE = /^(\d+)\.(\d+)/;

/** Does `nixVersion` start with a `major.minor` — the one thing every rule
 *  here reads off it? A caller that reads a version off a Nix asks this where
 *  it reads it, so a Nix answering something else stops at its own seat. */
export function namesNixLine(nixVersion: string): boolean {
  return NIX_LINE_RE.test(nixVersion);
}

/** `nixVersion`'s `major.minor`. A version that does not start with one is a
 *  fault about the host's Nix, and loud. */
function nixLine(nixVersion: string): readonly [number, number] {
  const m = NIX_LINE_RE.exec(nixVersion);
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

/** The content-addressed form a Nix on `nixVersion` writes and verifies —
 *  `null` for a Nix older than every form, or one that reported no version. */
export function caForm(nixVersion: string | null): CaForm | null {
  if (nixVersion === null) return null;
  const line = nixLine(nixVersion);
  for (let i = CA_FORMS.length - 1; i >= 0; i--) {
    const form = CA_FORMS[i] as CaForm;
    if (atLeast(line, nixLine(form))) return form;
  }
  return null;
}

/** The line of the Nix the publisher (`.github/actions/publish-closure`)
 *  rewrites with — 2.34.8 — and so the form it writes, derived, never stated
 *  twice. */
const PUBLISHER_NIX_LINE = "2.34";
const PUBLISHER_FORM: CaForm = (() => {
  const form = caForm(PUBLISHER_NIX_LINE);
  if (form === null)
    throw new Error(
      `the publisher's Nix ${PUBLISHER_NIX_LINE} writes no content-addressed form`,
    );
  return form;
})();

/** The Nix lines that handle `form`, in words: `Nix 2.17 through 2.34`, or
 *  `Nix 2.35 and later` for the newest. */
function formLines(form: CaForm): string {
  const next = CA_FORMS[CA_FORMS.indexOf(form) + 1];
  if (next === undefined) return `Nix ${form} and later`;
  const [major, minor] = nixLine(next);
  return `Nix ${form} through ${major}.${minor - 1}`;
}

/** The route `host` takes for `published` — see the module header. A Linux
 *  host on the publisher's form whose entry names no `ca` is a broken
 *  publication, and throws. */
export function closureRoute(
  host: HostNix,
  published: PublishedClosure,
): ClosureRoute {
  if (isDarwinSystem(host.system))
    return { kind: "signed", storePath: published.ia, because: "mach-o" };
  if (caForm(host.nixVersion) === PUBLISHER_FORM) {
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
      return MACH_O_BECAUSE;
    case "nix-line":
      return `its Nix ${host.nixVersion} cannot verify the content-addressed form the publisher writes (written by Nix ${PUBLISHER_NIX_LINE}; ${formLines(PUBLISHER_FORM)} can)`;
    default:
      return because satisfies never;
  }
}

/** The three Nixes sender staging involves, by their reported versions:
 *
 *   - `cli` — the `nix` on this machine that computes a rewrite's hash
 *     (`nix --version` always names one);
 *   - `senderStore` — the Nix that verifies what this machine's store takes
 *     (its daemon's, for a daemon store); `null` when the store named none;
 *   - `targetStore` — the Nix that verifies what the host's store takes;
 *     `null` when the store named none. */
export interface StagingNix {
  readonly cli: string;
  readonly senderStore: string | null;
  readonly targetStore: string | null;
}

/** Why this machine sends a Linux host the closure as built rather than
 *  content-addressed: its own `nix` and store disagree on the form
 *  (`sender-nix`), or they agree and the host's store does not (`target-nix`). */
export type AsBuiltBecause = "sender-nix" | "target-nix";

export type StagingRoute =
  | { readonly kind: "content-addressed"; readonly form: CaForm }
  | { readonly kind: "as-built"; readonly because: AsBuiltBecause };

/** Whether this machine stages a closure for a Linux host content-addressed
 *  — only when all three Nixes of {@link StagingNix} write or verify the same
 *  form, so no rewrite is attempted that a store is known to refuse — or
 *  ships it as built. The sender's own disagreement is named first: a host
 *  can never take a rewrite this machine could not make. */
export function stagingRoute(nix: StagingNix): StagingRoute {
  const form = caForm(nix.cli);
  if (form === null || form !== caForm(nix.senderStore))
    return { kind: "as-built", because: "sender-nix" };
  if (caForm(nix.targetStore) !== form)
    return { kind: "as-built", because: "target-nix" };
  return { kind: "content-addressed", form };
}

/** A reported Nix version as the words name it: the number, flagged when it
 *  is older than every content-addressed form. */
function versionWords(version: string): string {
  return caForm(version) === null
    ? `${version} (older than Nix ${CA_FORMS[0]}, the first that imports a content-addressed rewrite)`
    : version;
}

/** Why this machine sent a Linux host the closure as built, in words a user
 *  reads — naming the versions that disagree, and never one a Nix did not
 *  report. */
export function asBuiltBecause(
  because: AsBuiltBecause,
  nix: StagingNix,
): string {
  switch (because) {
    case "sender-nix":
      return `this machine's Nix daemon (${nix.senderStore === null ? "which reported no version" : versionWords(nix.senderStore)}) does not verify the content-addressed form its nix ${versionWords(nix.cli)} writes`;
    case "target-nix":
      return `its Nix${nix.targetStore === null ? ", which reported no version," : ` ${versionWords(nix.targetStore)}`} does not verify the content-addressed form this machine's Nix ${versionWords(nix.cli)} writes`;
    default:
      return because satisfies never;
  }
}
