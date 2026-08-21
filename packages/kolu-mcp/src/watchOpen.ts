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
  containingTerminalId,
  ignoreIdsOf,
  ignoreSelfInvalid,
  ignoreSelfUnresolvable,
  type PadiSurfaceClient,
} from "@kolu/padi/dial";
import {
  type PadiWatchOpenInput,
  PadiWatchOpenInputSchema,
} from "@kolu/padi/surface";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp";
import { Schema } from "effect";

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

export function resolveWatchOpenInput(
  args: WatchOpenArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): { readonly input: PadiWatchOpenInput } {
  const { ignoreSelf, ignoreIds, ...rest } = args;
  if (ignoreSelf !== true) {
    return {
      input: {
        ...rest,
        ...(ignoreIds === undefined ? {} : { ignoreIds }),
      },
    };
  }
  const self = containingTerminalId(env);
  if (self.kind === "none") {
    throw new ToolFailure(ignoreSelfUnresolvable("mcp"), {
      kind: "ignore-self-unresolvable",
    });
  }
  if (self.kind === "invalid") {
    throw new ToolFailure(ignoreSelfInvalid(self.raw, "mcp"), {
      kind: "ignore-self-invalid",
      raw: self.raw,
    });
  }
  const muted = ignoreIdsOf(ignoreIds, self.id);
  return {
    input: {
      ...rest,
      ...(muted === undefined ? {} : { ignoreIds: [...muted] }),
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
    const { input } = resolveWatchOpenInput(args as WatchOpenArgs);
    return (client as PadiSurfaceClient).surface.watch.open(input);
  },
};
