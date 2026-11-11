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
 *  into the orchestrator and back, and a view toggle must never register as a
 *  wobble in padi's connection health. The panel reports its own pending/error
 *  state, where a person can see what it is about.
 *
 *  The fence re-runs the whole stream on a transport drop, so the first frame
 *  after a reconnect is a fresh snapshot — which is exactly why `onRetry`
 *  clears the accumulator: a reducer that kept its rows across a re-subscribe
 *  would double every one the snapshot re-states. */

import type { OrchestratorFrame } from "@kolu/padi-client/orchestrator";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { runStreamScoped, toError } from "@kolu/surface/run-stream";
import type { HostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { activeHost, activePadiStreams } from "../wire";
import {
  applyFrame,
  EMPTY_TRANSCRIPT,
  type TranscriptState,
} from "./transcript";

export interface TranscriptFeed {
  readonly rows: Accessor<TranscriptState["rows"]>;
  /** No frame yet on this host's stream — the panel draws its own quiet
   *  "opening the conversation" line rather than an empty transcript that looks
   *  like a conversation with nothing in it. */
  readonly pending: Accessor<boolean>;
  readonly error: Accessor<Error | undefined>;
}

/** Open the active host's transcript for the lifetime of the calling owner. The
 *  panel is the only caller; a host switch re-keys the subscription and resets
 *  the rows, because the previous host's conversation is not this one's. */
export function createOrchestratorTranscript(): TranscriptFeed {
  const [state, setState] = createSignal<TranscriptState>(EMPTY_TRANSCRIPT);
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();

  createEffect(
    on(activeHost, (_host: HostKey) => {
      setState(EMPTY_TRANSCRIPT);
      setPending(true);
      setError(undefined);
      onCleanup(
        runStreamScoped<OrchestratorFrame>(
          unenrolledStreamCall(
            activePadiStreams.orchestratorTranscript.unenrolled,
            {},
            {
              label: "orchestratorTranscript",
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
            // The host ENDED the stream — padi's orchestrator went away. Not an
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
    }),
  );

  return { rows: () => state().rows, pending, error };
}
