/**
 * `watch_open` — the standing-subscription open, superseded so this face can
 * resolve `ignoreSelf`.
 *
 * padi cannot identify the caller: many clients share the daemon. This process
 * can, when it is running inside a kolu terminal (`KAVAL_TERMINAL_ID`). The
 * flag is resolved here into `ignoreIds` before the call crosses; padi only
 * ever sees ids. If the stamp is missing, the param is REFUSED rather than
 * guessed — the same rule the CLI's `--ignore-self` takes.
 *
 * The rest of the schema is padi's own `watch.open` input, spread so a knob
 * added on the wire reaches this face by being declared.
 */

import {
  CONTAINING_TERMINAL_ENV,
  containingTerminalId,
  type PadiSurfaceClient,
  watchScopeOf,
} from "@kolu/padi/dial";
import {
  type PadiWatchOpenInput,
  PadiWatchOpenInputSchema,
} from "@kolu/padi/surface";
import { readTerminalKeys } from "@kolu/padi/read";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

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
  refused: "covered" | "no-ids",
): { readonly wayOut: string; readonly detail: string } =>
  refused === "covered"
    ? {
        wayOut:
          "Omit ids to watch the whole fleet, or drop the overlap from ignoreIds.",
        detail: "muted-covers-include",
      }
    : { wayOut: "Omit ids to watch the whole fleet.", detail: "empty-ids" };

/** What this face decided BEFORE anything crosses to padi. */
export interface WatchOpenPlan {
  /** padi's own `watch.open` input, `ignoreSelf` already resolved into ids. */
  readonly input: PadiWatchOpenInput;
  /** The containing terminal `ignoreSelf` resolved to, when it was asked —
   *  carried out so the handler can ask the padi it is about to call whether
   *  that terminal is in ITS roster. */
  readonly self?: TerminalId;
}

/** A refusal is a VALUE here, the same shape the CLI half uses, so one feature
 *  has one representation of "refused before we dial" rather than a throw on one
 *  face and a value on the other. The handler below is the ONE place it becomes
 *  a {@link ToolFailure}. */
export type ParsedWatchOpen =
  | { readonly kind: "ok"; readonly value: WatchOpenPlan }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

export function resolveWatchOpenInput(
  args: WatchOpenArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): ParsedWatchOpen {
  const { ignoreSelf, ignoreIds, ids, ...rest } = args;
  // ONE assembly, both branches: `ignoreSelf` decides whether there is an EXTRA
  // id in the mute, never how the mute is built. (The two used to be separate
  // paths and had already diverged on the empty list.)
  const mute: TerminalId[] = [...(ignoreIds ?? [])];
  let self: TerminalId | undefined;
  if (ignoreSelf === true) {
    const found = containingTerminalId(env);
    if (found.kind === "none") {
      return {
        kind: "error",
        message: IGNORE_SELF_UNRESOLVABLE,
        detail: { kind: "ignore-self-unresolvable" },
      };
    }
    if (found.kind === "invalid") {
      return {
        kind: "error",
        message: ignoreSelfInvalid(found.raw),
        detail: { kind: "ignore-self-invalid", raw: found.raw },
      };
    }
    self = found.id;
    mute.push(self);
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
      input: {
        ...rest,
        ...(scope.value.include === undefined
          ? {}
          : { ids: [...scope.value.include] }),
        ...(scope.value.mute === undefined
          ? {}
          : { ignoreIds: [...scope.value.mute] }),
      },
      ...(self === undefined ? {} : { self }),
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
    const parsed = resolveWatchOpenInput(args as WatchOpenArgs);
    // The ONE throw: the pure half above answers in values, and this is the
    // boundary that must speak MCP's failure vocabulary.
    if (parsed.kind === "error") {
      throw new ToolFailure(parsed.message, parsed.detail);
    }
    const padi = client as PadiSurfaceClient;
    const { input, self } = parsed.value;
    return Effect.gen(function* () {
      // The SAME membership question the CLI asks: is the containing terminal
      // one THIS padi owns? `kolu mcp` honors --host and --socket, so this face
      // can be fronting another machine's fleet — in which case the stamp names
      // a terminal nobody there has heard of, and the mute would mute nobody
      // and return success. The CLI used to ask and this face did not; asking
      // the ROSTER (rather than the transport's shape) is what makes both
      // exact, and covers a stamp re-keyed by a daemon restart as well.
      if (self !== undefined) {
        const live = yield* readTerminalKeys(padi);
        if (!live.includes(self)) {
          // On the ERROR channel, not thrown: a throw inside a generator is a
          // DEFECT, and `failFrom` reads a `ToolFailure`'s own detail off the
          // failure it is handed. A refusal is not a bug in this server.
          return yield* Effect.fail(
            new ToolFailure(ignoreSelfNotInFleet(self), {
              kind: "ignore-self-not-in-fleet",
              id: self,
            }),
          );
        }
      }
      return yield* padi.surface.watch.open(input);
    });
  },
};
