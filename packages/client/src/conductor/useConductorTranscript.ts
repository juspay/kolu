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
  readonly pending: Accessor<boolean>;
  readonly error: Accessor<Error | undefined>;
}

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
