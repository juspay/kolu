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

/** The refusal sentence for a scope whose mute covers every included terminal.
 *  The way OUT of it is the face's own sentence, in its own grammar. */
export const WATCH_SCOPE_MUTE_COVERS_ALL =
  "this watch can never match anything: every included terminal is also muted.";

/** The refusal sentence for a scope given an EMPTY include list. */
export const WATCH_SCOPE_EMPTY_INCLUDE_LIST =
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
    return {
      kind: "error",
      message: WATCH_SCOPE_EMPTY_INCLUDE_LIST,
      refused: "no-ids",
    };
  }
  const muted = opts.mute === undefined ? undefined : new Set(opts.mute);
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
      return {
        kind: "error",
        message: WATCH_SCOPE_MUTE_COVERS_ALL,
        refused: "covered",
      };
    }
  }
  return {
    kind: "ok",
    value: {
      ...(include === undefined ? {} : { include }),
      ...(mute === undefined ? {} : { mute }),
    },
  };
}

export function scopeAdmits(scope: WatchScope, id: TerminalId): boolean {
  return (
    (scope.include === undefined || scope.include.has(id)) &&
    scope.mute?.has(id) !== true
  );
}

/** The fleet-wide scope — no include list, no mute. Named so the several places
 *  that mean "everything" say it rather than each spelling `{}`. */
export const WATCH_SCOPE_ALL: WatchScope = {};
