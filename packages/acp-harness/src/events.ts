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
    };
