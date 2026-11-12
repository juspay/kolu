/** The transcript STREAM, driven into the reducer.
 *
 *  Two decisions worth the paragraph they cost.
 *
 *  **Per-ITEM delivery, which is why this is not `streams.<key>.use()`.** That
 *  primitive hands back the LATEST frame as a reactive value — perfect for a
 *  member whose every yield is a full replacement (the activity set, the
 *  preferences cell), and wrong for this one: two deltas settling into one
 *  reactive tick would leave the first unapplied, and a delta that is never
 *  applied is a row that never appears. A reducer needs every frame, in order,
 *  which is what a callback consumer gets and a value accessor cannot promise.
 *
 *  **Deliberately UN-ENROLLED.** `unenrolledStreamCall` is the fence applied
 *  without joining `client.health()` — the terminal attach's carve-out, for the
 *  same reason: this subscription opens and closes every time somebody flips
 *  into the conductor and back, and a view toggle must never register as a
 *  wobble in the wire's connection health. The panel reports its own
 *  pending/error state, where a person can see what it is about.
 *
 *  The fence re-runs the whole stream on a transport drop, so the first frame
 *  after a reconnect is a fresh snapshot — which is exactly why `onRetry`
 *  clears the accumulator: a reducer that kept its rows across a re-subscribe
 *  would double every one the snapshot re-states. */

import type { ConductorFrame } from "kolu-common/conductor";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { runStreamScoped, toError } from "@kolu/surface/run-stream";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { app } from "../wire";
import {
  applyFrame,
  EMPTY_TRANSCRIPT,
  type TranscriptState,
} from "./transcript";

export interface TranscriptFeed {
  readonly rows: Accessor<TranscriptState["rows"]>;
  /** No frame yet — the panel draws its own quiet "opening the conversation"
   *  line rather than an empty transcript that looks like a conversation with
   *  nothing in it. */
  readonly pending: Accessor<boolean>;
  readonly error: Accessor<Error | undefined>;
}

/** Open the conversation's transcript for the lifetime of the calling owner.
 *  The panel is the only caller, and there is exactly one conversation, so the
 *  stream is opened once and torn down when the panel goes — no host keys it
 *  and nothing re-subscribes on a switch. */
export function createConductorTranscript(): TranscriptFeed {
  const [state, setState] = createSignal<TranscriptState>(EMPTY_TRANSCRIPT);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();

  onCleanup(
    runStreamScoped<ConductorFrame>(
      unenrolledStreamCall(
        app.streams.conductorTranscript.unenrolled,
        {},
        {
          label: "conductorTranscript",
          // A re-subscribe replays from the top with a fresh snapshot;
          // clearing here is what keeps the retry from duplicating rows.
          onRetry: () => {
            setState(EMPTY_TRANSCRIPT);
            setPending(true);
          },
        },
      ),
      {
        onFrame: (frame) => {
          setPending(false);
          setState((prev) => applyFrame(prev, frame));
        },
        // kolu-server ENDED the stream — the conversation went away. Not an
        // error, and not a reason to keep saying "opening": whatever rows
        // arrived are what there is.
        onEnd: () => setPending(false),
        onFailure: (err) => {
          setPending(false);
          setError(toError(err));
        },
      },
    ),
  );

  return { rows: () => state().rows, pending, error };
}
