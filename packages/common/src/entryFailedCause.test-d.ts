/**
 * TYPE-LEVEL pin — the W4 types decision D1 (generic `EntryStatus<Cause>`,
 * `@kolu/surface-map` decision #1's option 2) + D2 (the typed contract-skew
 * version pair).
 *
 * `tsc` GREEN over this file ⇒:
 *  - a BARE `EntryStatus` (the unnarrowed `Cause = string` default) still accepts
 *    ANY string as `cause` — every existing non-padi consumer keeps compiling
 *    untouched, the load-bearing property D1 depends on.
 *  - `padiHostMap`'s own `EntryStatus` is narrowed to {@link EntryFailedCause} — an
 *    arbitrary string `cause` is a COMPILE ERROR there (the `@ts-expect-error`
 *    below), not merely re-checked at runtime.
 *  - {@link PadiEntryStatus}'s `contract-skew-refused` arm carries the D2 typed
 *    `running`/`expected` version pair; every OTHER cause does not (unrepresentable
 *    to invent a version pair for e.g. `"link-failed"`).
 */

import type { EntryStatus } from "@kolu/surface-map";
import type { EntryFailedCause, PadiEntryStatus } from "./surfacesWithPadi.ts";

// A BARE `EntryStatus` (default `Cause = string`) accepts an arbitrary string —
// the load-bearing default: an unnarrowed consumer's `.cause` reads keep compiling
// with NO edits when `@kolu/surface-map` gains the `Cause` parameter.
const bare: EntryStatus = {
  kind: "failed",
  reason: "boom",
  cause: "anything-at-all",
};
void bare;

// `padiHostMap`'s narrowed status: only a REAL `EntryFailedCause` member compiles.
const padiFailed: EntryStatus<EntryFailedCause> = {
  kind: "failed",
  reason: "remote padi contract skew",
  cause: "contract-skew-refused",
};
void padiFailed;

const padiFailedInvalid: EntryStatus<EntryFailedCause> = {
  kind: "failed",
  reason: "boom",
  // @ts-expect-error — an arbitrary string is not a member of `EntryFailedCause`;
  // if this line ever compiles, D1's narrowing (`padiHostMap`'s own `Cause`) has
  // regressed to the generic default.
  cause: "some-made-up-reason",
};
void padiFailedInvalid;

// D2: the typed version pair rides ONLY the `contract-skew-refused` arm.
const skewed: PadiEntryStatus = {
  kind: "failed",
  reason: "padi contract skew",
  cause: "contract-skew-refused",
  running: "1.0.0",
  expected: "1.1.0",
};
void skewed;

const linkFailed: PadiEntryStatus = {
  kind: "failed",
  reason: "host unreachable",
  cause: "link-failed",
  // @ts-expect-error — `running`/`expected` are NOT representable on any cause
  // other than `contract-skew-refused` (D2: a version pair only means something for
  // a skew refusal) — if this line ever compiles, `PadiEntryStatus`'s per-cause
  // narrowing has regressed to a flat, always-optional shape.
  running: "1.0.0",
};
void linkFailed;
