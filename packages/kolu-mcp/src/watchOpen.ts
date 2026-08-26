/**
 * `watch_open` — the standing-subscription open, superseded so this face can
 * resolve `ignoreSelf`.
 *
 * padi cannot identify the caller: many clients share the daemon. This process
 * can, when it is running inside a kolu terminal (`KAVAL_TERMINAL_ID`). The
 * flag is resolved here into `ignoreIds` before the call crosses; padi only
 * ever sees ids. If the stamp is missing, garbled, or names a terminal THIS
 * padi has never heard of, the param is REFUSED rather than guessed — padi's
 * `confirmInFleet` holds all four arms, and the CLI's `--ignore-self` takes the
 * same rule off the same sum.
 *
 * ORDER matters and is shared with that face: the stamp is resolved FULLY,
 * fleet arm included, BEFORE the scope is built. Built the other way round, one
 * logical request — ids covered by a mute whose self is a stray stamp — was
 * refused as "can never match" here and as "not in fleet" there.
 *
 * The rest of the schema is padi's own `watch.open` input, spread so a knob
 * added on the wire reaches this face by being declared.
 */

import {
  CONTAINING_TERMINAL_ENV,
  confirmInFleet,
  containingTerminalId,
} from "@kolu/padi/containingTerminal";
// Every top-level VALUE import here is schema-level — this module is on the
// static tree-build path of every `kolu` invocation (the surface face mounts
// the table). The two pure concept modules have homes of their own under padi
// subpaths; the one transport-shaped reach — `readTerminalKeys`, whose closure
// carries the mirror — arrives dynamically inside the handler instead.
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiWatchOpenInput,
  PadiWatchOpenInputSchema,
} from "@kolu/padi-client/surface";
import {
  type WatchScopeRefusal,
  watchScopeOf,
} from "@kolu/padi-client/watchScope";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { match } from "ts-pattern";

export const WatchOpenArgsSchema = Schema.Struct({
  ...PadiWatchOpenInputSchema.fields,
  ignoreSelf: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Mute the terminal THIS MCP server is running inside (KAVAL_TERMINAL_ID). Fail-open for every other terminal: a new lane is always watched. Refused if this process is not inside a kolu terminal — pass ignoreIds rather than guessing.",
    }),
  ),
});
export type WatchOpenArgs = typeof WatchOpenArgsSchema.Type;

// ── The ignoreSelf sentences (tool-arg grammar — padi holds the FACT) ───────
//
// A tool caller has `ignoreSelf` and `ignoreIds`, never `--ignore-self`. padi
// answers what the stamp said and stops there; the sentence is this face's, the
// same way the CLI's is the CLI's.

const IGNORE_SELF_UNRESOLVABLE = `ignoreSelf: this MCP server is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). The transport cannot identify the caller — pass ignoreIds with the terminal to mute, rather than guessing.`;

const ignoreSelfInvalid = (raw: string): string =>
  `ignoreSelf: ${CONTAINING_TERMINAL_ENV}=${JSON.stringify(raw)} is not a terminal id.`;

const ignoreSelfNotInFleet = (self: TerminalId): string =>
  `ignoreSelf: the padi this server is connected to has never heard of terminal ${self} (${CONTAINING_TERMINAL_ENV}) — muting it would mute nobody and report success. This server is fronting another machine's fleet, or a daemon restart has re-keyed the terminals. Pass ignoreIds naming a terminal this padi owns.`;

/** The way OUT of each never-match shape, and its machine-readable reason, in
 *  THIS face's grammar. padi states the invariant; a tool caller has an `ids`
 *  array, not "the id", so the remedy is spelled here rather than served to it
 *  in a shell's positional wording. Exhaustive over the constructor's refusals,
 *  so a third shape stops this compiling instead of falling through. */
const scopeRefusal = (
  refused: WatchScopeRefusal,
): { readonly wayOut: string; readonly detail: string } =>
  refused === "covered"
    ? {
        wayOut:
          "Omit ids to watch the whole fleet, or drop the overlap from ignoreIds.",
        detail: "muted-covers-include",
      }
    : { wayOut: "Omit ids to watch the whole fleet.", detail: "empty-ids" };

/** A refusal is a VALUE here, the same shape the CLI half uses, so one feature
 *  has one representation of "refused before we dial" rather than a throw on one
 *  face and a value on the other. The handler below is the ONE place it becomes
 *  a {@link ToolFailure}. The ok arm is padi's own `watch.open` input,
 *  `ignoreSelf` already resolved into ids — nothing this face still has to
 *  carry out and re-decide. */
export type ParsedWatchOpen =
  | { readonly kind: "ok"; readonly value: PadiWatchOpenInput }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

/** One verdict on `confirmInFleet`'s four-arm sum, out of the `match` below —
 *  pure data, so the `mute.push`/`return` stays outside the arms. `exhaustive()`
 *  is the actual payoff: a future fifth `FleetTerminal` arm fails the build here
 *  instead of silently falling through to "muted". */
type IgnoreSelfVerdict =
  | { readonly kind: "muted"; readonly id: TerminalId }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

/** `live` is the padi's roster — the fleet the stamp is confirmed against. The
 *  caller reads it only when `ignoreSelf` was asked (every other id here is a
 *  full id off the wire), and passes it in so this half stays pure. */
export function resolveWatchOpenInput(
  args: WatchOpenArgs,
  live: readonly TerminalId[],
  env: { readonly [key: string]: string | undefined } = process.env,
): ParsedWatchOpen {
  const { ignoreSelf, ignoreIds, ids, ...rest } = args;
  // ONE assembly, both branches: `ignoreSelf` decides whether there is an EXTRA
  // id in the mute, never how the mute is built. (The two used to be separate
  // paths and had already diverged on the empty list.)
  const mute: TerminalId[] = [...(ignoreIds ?? [])];
  if (ignoreSelf === true) {
    // All four arms of padi's one stamp sum, answered here — before the scope,
    // so a stray stamp is never reported as a never-match scope.
    const verdict = match(confirmInFleet(containingTerminalId(env), live))
      .with(
        { kind: "none" },
        (): IgnoreSelfVerdict => ({
          kind: "error",
          message: IGNORE_SELF_UNRESOLVABLE,
          detail: { kind: "ignore-self-unresolvable" },
        }),
      )
      .with(
        { kind: "invalid" },
        (found): IgnoreSelfVerdict => ({
          kind: "error",
          message: ignoreSelfInvalid(found.raw),
          detail: { kind: "ignore-self-invalid", raw: found.raw },
        }),
      )
      .with(
        { kind: "stray" },
        (found): IgnoreSelfVerdict => ({
          kind: "error",
          message: ignoreSelfNotInFleet(found.id),
          detail: { kind: "ignore-self-not-in-fleet", id: found.id },
        }),
      )
      .with(
        { kind: "ok" },
        (found): IgnoreSelfVerdict => ({ kind: "muted", id: found.id }),
      )
      .exhaustive();
    if (verdict.kind === "error") {
      return {
        kind: "error",
        message: verdict.message,
        detail: verdict.detail,
      };
    }
    mute.push(verdict.id);
  }
  const scope = watchScopeOf({ ...(ids === undefined ? {} : { ids }), mute });
  if (scope.kind === "error") {
    const { wayOut, detail } = scopeRefusal(scope.refused);
    return {
      kind: "error",
      message: `${scope.message} ${wayOut}`,
      detail: { kind: detail },
    };
  }
  return {
    kind: "ok",
    value: {
      ...rest,
      ...(scope.value.include === undefined
        ? {}
        : { ids: [...scope.value.include] }),
      ...(scope.value.mute === undefined
        ? {}
        : { ignoreIds: [...scope.value.mute] }),
    },
  };
}

export const watchOpenTool: BespokeTool = {
  input: WatchOpenArgsSchema,
  mutates: true,
  title: "Open a terminal watch",
  description:
    "Start (or re-attach to) a named standing subscription. Omit ids to watch the WHOLE fleet — a list you forget to update goes blind to a lane nobody added. ignoreIds mutes known terminals (fail-open: a stale id costs nothing). ignoreSelf mutes the terminal this MCP server is running inside. Naming any of states/heldForMs/nagMs turns the subscription into an agent-state watch (snapshot · transition · nag); naming none leaves the settle detector (asking · finished · gone). Re-open the SAME name after a restart to reattach to the queue.",
  handler: (args, client) => {
    const padi = client as PadiSurfaceClient;
    const asked = args as WatchOpenArgs;
    return Effect.gen(function* () {
      // The roster, and ONLY when the stamp needs confirming against it: `kolu
      // mcp` honors --host and --socket, so this face can be fronting another
      // machine's fleet, in which case the stamp names a terminal nobody there
      // has heard of and the mute would mute nobody and return success. Every
      // other id on this call is a full id off the wire, so a caller who never
      // asked `ignoreSelf` pays no round trip — and the module loading the
      // read pays for it only too (the tree-build fence at the file head).
      // One bridge per crossing: the LAZY IMPORT inside `Effect.promise`
      // (module acquisition), then the read's own `Effect` composed into this
      // generator (execution) — a `runPromise` between them would allocate a
      // second run edge inside a handler and drop the failure's typing.
      const live: readonly TerminalId[] =
        asked.ignoreSelf === true
          ? yield* Effect.flatMap(
              Effect.promise(() => import("@kolu/padi/read")),
              ({ readTerminalKeys }) => readTerminalKeys(padi),
            )
          : [];
      const parsed = resolveWatchOpenInput(asked, live);
      // On the ERROR channel, not thrown: a throw inside a generator is a
      // DEFECT, and `failFrom` reads a `ToolFailure`'s own detail off the
      // failure it is handed. A refusal is not a bug in this server.
      if (parsed.kind === "error") {
        return yield* Effect.fail(
          new ToolFailure(parsed.message, parsed.detail),
        );
      }
      return yield* padi.surface.watch.open(parsed.value);
    });
  },
};
