/**
 * WHAT THE AGENT HALF TELLS THE CONVERSATION — one closed union, and the only
 * door between them.
 *
 * The split `./harness.ts` is being turned into, one kind of traffic at a time:
 * the code that receives a message from the agent narrows it into a member of
 * this union, and the code that writes rows is reached from `emit`'s case for
 * that member. Nothing crosses the other way except the readings a caller asks
 * for.
 *
 * WHY A UNION RATHER THAN THE PROTOCOL'S PAYLOADS. A consumer that needs
 * something not in here needs a new member, not a look at the wire — which is
 * what keeps the ACP version in one file and the conversation in another. The
 * members are named after [olai](https://github.com/juspay/olai)'s
 * `packages/plugins/chat/src/events.ts` wherever the fact is the same, because
 * the two products run the same adapters and two names for one wire is two
 * vocabularies to keep in step.
 *
 * THIS FILE IMPORTS NO PRODUCT: no `kolu-common`, no row, no fleet ref, no
 * terminal. `src/seam.test.ts` holds that.
 */

import type { Background } from "@kolu/acp/engine";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { FileDiff, PlanStep, ToolStatus, Usage } from "@kolu/acp/wire";

/**
 * ONE THING THE AGENT SAID, as the door carries it.
 *
 * `emit` answers with a `string | null` because one member needs an answer: a
 * resume the agent does not have mints a divider row BEFORE the replacement
 * conversation opens, and the caller that owns that row is the one that knows
 * its key — and whether one was drawn at all.
 */
export type AgentEvent =
  /** The agent says a page it sent somebody to is done. One notification, two
   *  things that could be waiting on it, and only one of them can be true: a
   *  conversation's question row, or the sign-in row whose request this
   *  elicitation belongs to. The payload is the notification's own params — the
   *  reading of which is the conversation's, and `./payloads.ts` owns it. */
  | { readonly _tag: "elicitationComplete"; readonly params: unknown }
  /** The agent's prose, one chunk as it arrived. */
  | { readonly _tag: "said"; readonly text: string }
  /** A background task's report, which the agent injects as a user-role turn.
   *  `onto` is the call it belongs to, or `null` for a notification that named
   *  no call — the losing direction, and the one the row can draw. */
  | {
      readonly _tag: "taskNotification";
      readonly onto: {
        readonly toolUseId: string;
        readonly task: string;
        readonly report: string;
      } | null;
    }
  /** A tool call, as we last heard of it — announced or moved.
   *
   *  ONE member rather than the protocol's announce/update pair: the transcript
   *  is keyed by `id`, so a second report of a call is the same row with new
   *  fields. `undefined` is "unchanged", never "cleared" — the protocol's own
   *  rule for an update. */
  /** The whole slash-command list, replaced rather than merged. */
  | {
      readonly _tag: "commands";
      readonly commands: ReadonlyArray<{
        readonly name: string;
        readonly description: string | null;
      }>;
    }
  /** Every setting the agent offers, as the update carried them — the reading
   *  of HOW each is drawn is the conversation's (`readSettings`), because that
   *  is where the panel's shapes live. */
  | {
      readonly _tag: "settings";
      readonly config: ReadonlyArray<SessionConfigOption> | null | undefined;
    }
  /** How full the context is. Several a turn: the newest wins. */
  | { readonly _tag: "usage"; readonly usage: Usage }
  /** The agent's plan — replaced whole, removed when empty. kolu's own row
   *  kind: [olai](https://github.com/juspay/olai)'s panel draws no plan. */
  | { readonly _tag: "plan"; readonly steps: ReadonlyArray<PlanStep> }
  | {
      readonly _tag: "tool";
      readonly id: string;
      readonly title: string | undefined;
      readonly status: ToolStatus | undefined;
      /** What was asked for, out of the frame's own input and answer. */
      readonly detail: string | undefined;
      /** What the call has to say while it runs, out of its content blocks — a
       *  different question from `detail`. */
      readonly asked: string | undefined;
      readonly progress: string | undefined;
      readonly diffs: ReadonlyArray<FileDiff> | undefined;
      readonly locations: ReadonlyArray<string> | undefined;
      /** The call's own input and the agent's answer, as the leg read them —
       *  kolu's own reading of a `kolu` call is the conversation's
       *  (`./kolu.ts`), and it needs both halves across frames. */
      readonly rawInput: unknown;
      readonly answer: unknown;
      /** Which server and tool, where the leg positively recognised the call as
       *  one of the servers THIS conversation handed over. */
      readonly mcp: { readonly server: string; readonly tool: string } | null;
      /** Whether this call's question reaches a person as a FORM rather than a
       *  card — one agent's own spelling of its own built-in. */
      readonly asksThroughForm: boolean | undefined;
      /** Which `Agent` call this one was made inside, by that call's own id. */
      readonly parent: string | undefined;
      /** ... and, the other way round, that this call SENT one out. */
      readonly spawned:
        | { readonly kind: string | null; readonly said: string | null }
        | undefined;
      /** ... and that it ARMED a background task, as the leg read it — the
       *  row's own words are the conversation's (`Armed`), which is why this
       *  is the leg's `Background` and not the wire's shape. */
      readonly armed: Background | undefined;
      /** ... and that the title on this frame is a placeholder rather than the
       *  call's name. `undefined` is "not provisional", not "unchanged": the
       *  claim is scoped to THIS frame's title. */
      readonly provisional: boolean | undefined;
    };
