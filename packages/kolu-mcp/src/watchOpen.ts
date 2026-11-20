import {
  CONTAINING_TERMINAL_ENV,
  confirmInFleet,
  containingTerminalId,
} from "@kolu/padi/containingTerminal";
import {
  PadiWatchNagMsSchema,
  type PadiWatchOpenInput,
  PadiWatchOpenInputSchema,
} from "@kolu/padi-client/surface";
import { padiOf } from "./bundleClient.ts";
import { parseNag } from "@kolu/padi-client/watchDuration";
import {
  type WatchScopeRefusal,
  watchScopeOf,
} from "@kolu/padi-client/watchScope";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import { match } from "ts-pattern";

const {
  nagMs: _wireNagMs,
  nagCount: _wireNagCount,
  ...watchOpenFields
} = PadiWatchOpenInputSchema.fields;
export const WatchOpenArgsSchema = Schema.Struct({
  ...watchOpenFields,
  nagMs: Schema.optionalKey(
    Schema.Union([PadiWatchNagMsSchema, Schema.String]).annotate({
      description:
        'RE-report a terminal every this many milliseconds for as long as it keeps holding a matching state. A string spells the same in duration form — "30m" — and suffixing a count caps it: "30m/3" is three reminders past the first report, then quiet about that terminal until the state changes (a bare interval repeats forever). Omit to be told once.',
    }),
  ),
  ignoreSelf: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Mute the terminal THIS MCP server is running inside (KAVAL_TERMINAL_ID). Fail-open for every other terminal: a new lane is always watched. Refused if this process is not inside a kolu terminal — pass ignoreIds rather than guessing.",
    }),
  ),
});
export type WatchOpenArgs = typeof WatchOpenArgsSchema.Type;

const IGNORE_SELF_UNRESOLVABLE = `ignoreSelf: this MCP server is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). The transport cannot identify the caller — pass ignoreIds with the terminal to mute, rather than guessing.`;

const ignoreSelfInvalid = (raw: string): string =>
  `ignoreSelf: ${CONTAINING_TERMINAL_ENV}=${JSON.stringify(raw)} is not a terminal id.`;

const ignoreSelfNotInFleet = (self: TerminalId): string =>
  `ignoreSelf: the padi this server is connected to has never heard of terminal ${self} (${CONTAINING_TERMINAL_ENV}) — muting it would mute nobody and report success. This server is fronting another machine's fleet, or a daemon restart has re-keyed the terminals. Pass ignoreIds naming a terminal this padi owns.`;

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

export type ParsedWatchOpen =
  | { readonly kind: "ok"; readonly value: PadiWatchOpenInput }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

type IgnoreSelfVerdict =
  | { readonly kind: "muted"; readonly id: TerminalId }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly detail: Record<string, unknown>;
    };

export function resolveWatchOpenInput(
  args: WatchOpenArgs,
  live: readonly TerminalId[],
  env: { readonly [key: string]: string | undefined } = process.env,
): ParsedWatchOpen {
  const nag =
    args.nagMs === undefined
      ? undefined
      : typeof args.nagMs === "number"
        ? ({ kind: "ok", value: { ms: args.nagMs } } as const)
        : parseNag("nagMs", args.nagMs);
  if (nag !== undefined && nag.kind === "error") {
    return {
      kind: "error",
      message: nag.message,
      detail: { kind: "bad-nag-arg", raw: args.nagMs },
    };
  }
  const { ignoreSelf, ignoreIds, ids, nagMs: _parsed, ...rest } = args;
  const mute: TerminalId[] = [...(ignoreIds ?? [])];
  if (ignoreSelf === true) {
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
      ...(nag === undefined
        ? {}
        : {
            nagMs: nag.value.ms,
            ...(nag.value.count === undefined
              ? {}
              : { nagCount: nag.value.count }),
          }),
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
    'Start (or re-attach to) a named standing subscription. Omit ids to watch the WHOLE fleet — a list you forget to update goes blind to a lane nobody added. ignoreIds mutes known terminals (fail-open: a stale id costs nothing). ignoreSelf mutes the terminal this MCP server is running inside. Naming any of states/heldForMs/nagMs turns the subscription into an agent-state watch (snapshot · transition · nag) — nagMs may carry a cap after a slash ("60000/3"): three reminders past the first report, then quiet; a bare interval repeats forever. Naming none leaves the settle detector (asking · finished · gone). Re-open the SAME name after a restart to reattach to the queue — the snapshotted standing truth and the nag budget you left come with it.',
  handler: (args, client) => {
    const padi = padiOf(client);
    const asked = args as WatchOpenArgs;
    return Effect.gen(function* () {
      const live: readonly TerminalId[] =
        asked.ignoreSelf === true
          ? yield* Effect.flatMap(
              Effect.promise(() => import("@kolu/padi/read")),
              ({ readTerminalKeys }) => readTerminalKeys(padi),
            )
          : [];
      const parsed = resolveWatchOpenInput(asked, live);
      if (parsed.kind === "error") {
        return yield* Effect.fail(
          new ToolFailure(parsed.message, parsed.detail),
        );
      }
      return yield* padi.surface.watch.open(parsed.value);
    });
  },
};
