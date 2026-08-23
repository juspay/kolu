/**
 * WHICH terminals a subscription reports — the include list and the mute, as
 * ONE value with ONE constructor and ONE reader.
 *
 * The question "does this subscription report terminal X?" has a single answer,
 * so it has a single home. It used to be two loose optional fields (`ids`,
 * `ignoreIds`) travelling side by side through every layer, carrying a coupling
 * rule neither field could express — with the result that the never-match
 * refusal was written at five sites in four spellings, the membership predicate
 * at four more, and the two halves had already drifted (one site refused an
 * empty include list, another happily built a spec carrying one).
 *
 * So: {@link watchScopeOf} is the only way to make a scope, and it is where BOTH
 * never-match shapes are refused — as a VALUE, because every caller already
 * wanted a value (a CLI failure, an MCP `ToolFailure`, a wire refusal) and it
 * was the throw that forced everyone to pre-check what the constructor was about
 * to check again. {@link scopeAdmits} is the only way to read one.
 *
 * The mute is FAIL-OPEN and that is the feature's whole point: an unknown or
 * stale id in the mute is inert, and a terminal that is not in the mute is
 * always watched. Only the include list fails closed.
 *
 * The wire keeps saying `ids` / `ignoreIds` ({@link PadiWatchIgnoreFields} and
 * friends) — this is the engine-side concept, not a rename of a shipped field.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";

/** The terminals a subscription reports. Constructed ONLY by
 *  {@link watchScopeOf}, which is what makes the two "never match anything"
 *  shapes below unrepresentable in a value anyone holds. */
export interface WatchScope {
  /** Terminals to report. `undefined` is the whole fleet; NEVER empty, because
   *  an empty include list is a subscription that can never match. */
  readonly include?: ReadonlySet<TerminalId>;
  /** Terminals to MUTE. `undefined` mutes nobody; NEVER empty, because an empty
   *  mute IS "mute nobody" and one spelling of that is enough. Fail-open: an id
   *  in here that no terminal answers to costs nothing. */
  readonly mute?: ReadonlySet<TerminalId>;
}

/** WHICH never-match shape a refusal is, so each face can append its own way
 *  out in its own grammar (`--ignore` for a shell, `ignoreIds` for a tool call)
 *  without padi holding either spelling. */
export type WatchScopeRefusal =
  /** An include list was given and it is empty. */
  | "no-ids"
  /** Every included terminal is also muted. */
  | "covered";

/** The constructor's answer: the scope, or the sentence that says why there
 *  isn't one. Structurally a `Parsed<WatchScope>` to every face that already
 *  speaks that shape, plus the {@link WatchScopeRefusal} discriminator on the
 *  error arm ONLY — a diagnostic that rides an error result is the exact state
 *  a two-arm union exists to exclude. */
export type ParsedWatchScope =
  | { readonly kind: "ok"; readonly value: WatchScope }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly refused: WatchScopeRefusal;
    };

/** The invariant, face-neutral. The way OUT of it is the face's own sentence —
 *  a caller with an `ids` array must not be told to "omit the id", which is one
 *  particular shell's positional grammar. */
export const WATCH_SCOPE_EMPTY =
  "this watch can never match anything: every included terminal is also muted.";

/** The other never-match shape, and the reason an empty include list is refused
 *  rather than read as "the whole fleet": a caller that sent one narrowed to
 *  nothing, and answering it with silence is indistinguishable from a quiet
 *  workspace. */
export const WATCH_SCOPE_NO_IDS =
  "this watch can never match anything: its included-terminal list is empty.";

/** The ONE constructor. Takes whatever a face has in hand — arrays off the
 *  wire, sets already built — normalizes an empty mute to "mute nobody", and
 *  refuses both never-match shapes here, once, so nobody downstream has to
 *  pre-check what this was about to check again. */
export function watchScopeOf(opts: {
  readonly ids?: Iterable<TerminalId>;
  readonly mute?: Iterable<TerminalId>;
}): ParsedWatchScope {
  const include = opts.ids === undefined ? undefined : new Set(opts.ids);
  if (include !== undefined && include.size === 0) {
    return { kind: "error", message: WATCH_SCOPE_NO_IDS, refused: "no-ids" };
  }
  const muted = opts.mute === undefined ? undefined : new Set(opts.mute);
  // Empty IS the identity — "mute nobody" is spelled by the key being absent
  // everywhere it travels, so there is no second spelling to normalize later.
  const mute = muted === undefined || muted.size === 0 ? undefined : muted;
  if (include !== undefined && mute !== undefined) {
    let admits = false;
    for (const id of include) {
      if (!mute.has(id)) {
        admits = true;
        break;
      }
    }
    if (!admits) {
      return { kind: "error", message: WATCH_SCOPE_EMPTY, refused: "covered" };
    }
  }
  return {
    kind: "ok",
    // Omit-or-spread, never an explicit `undefined`: "the whole fleet" and
    // "mute nobody" are spelled by the key being missing.
    value: {
      ...(include === undefined ? {} : { include }),
      ...(mute === undefined ? {} : { mute }),
    },
  };
}

/** The ONE reader. Every event source asks this — the hub's match, the queue's
 *  enqueue, a re-open's carry filter, the CLI's emit funnel — so a source added
 *  tomorrow inherits the whole rule instead of half of it. */
export function scopeAdmits(scope: WatchScope, id: TerminalId): boolean {
  return (
    (scope.include === undefined || scope.include.has(id)) &&
    scope.mute?.has(id) !== true
  );
}

/** The fleet-wide scope — no include list, no mute. Named so the several places
 *  that mean "everything" say it rather than each spelling `{}`. */
export const WATCH_SCOPE_ALL: WatchScope = {};
