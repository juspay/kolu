import type { Effect } from "effect";
import { pollOnChange } from "@kolu/surface/poll-on-change";
import {
  type StreamingProcedure,
  type Subscription,
  wireSubscriptionError,
  writeWrappedValue,
} from "@kolu/surface/solid";
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { runActionPromise } from "../runAction";

export interface PolledQueryConfig<Input, PulseInput, Pulse, Result> {
  input: Accessor<Input | null>;
  live: Accessor<boolean>;
  pulseProc: () => StreamingProcedure<PulseInput, Pulse>;
  pulseHost?: Accessor<unknown>;
  pulseInput: (input: Input) => PulseInput;
  query: (input: Input) => Effect.Effect<Result, unknown>;
  onError?: (err: Error) => void;
  swallowError?: (err: Error) => boolean;
  active?: Accessor<boolean>;
}

type InputHostKey<Input> =
  | { readonly i: Input; readonly key: string }
  | { readonly i: null; readonly key: null };

function inputHostKeyOf<Input>(
  i: Input | null,
  host: unknown,
): InputHostKey<Input> {
  return i === null
    ? { i: null, key: null }
    : { i, key: JSON.stringify([i, host ?? null]) };
}

type ResumeDecision<Input> =
  | { readonly kind: "paused-hold" }
  | { readonly kind: "idle-blank" }
  | {
      readonly kind: "resume-same-key";
      readonly i: Input;
      readonly key: string;
    }
  | {
      readonly kind: "new-key-blank";
      readonly i: Input;
      readonly key: string;
    };

function resumeDecision<Input>(
  state: InputHostKey<Input>,
  shownKey: string | null,
  isActive: boolean,
): ResumeDecision<Input> {
  if (!isActive) return { kind: "paused-hold" };
  if (state.key === null) return { kind: "idle-blank" };
  return state.key === shownKey
    ? { kind: "resume-same-key", i: state.i, key: state.key }
    : { kind: "new-key-blank", i: state.i, key: state.key };
}

export function createPolledQuery<Input, PulseInput, Pulse, Result>(
  config: PolledQueryConfig<Input, PulseInput, Pulse, Result>,
): Subscription<Result> & { readonly complete: Accessor<boolean> } {
  const {
    input,
    live,
    pulseProc,
    pulseHost,
    pulseInput,
    query,
    onError,
    swallowError,
    active = () => true,
  } = config;

  const [store, setStore] = createStore<{ v: Result | undefined }>({
    v: undefined,
  });
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>();
  const [pulseEnded, setPulseEnded] = createSignal(false);

  function isReconnectBlip(): boolean {
    return !live();
  }

  function isBenignTransient(err: Error): boolean {
    return swallowError?.(err) === true;
  }

  function surfaceError(raw: unknown): void {
    const err = raw instanceof Error ? raw : new Error(String(raw));
    if (isReconnectBlip() || isBenignTransient(err)) return;
    setError(err);
    if (pending()) setPending(false);
  }

  let shownKey: string | null = null;

  function blank(): void {
    setStore("v", undefined);
    setPending(true);
    shownKey = null;
  }

  const inputHostKey = createMemo(
    () => inputHostKeyOf(input(), pulseHost?.()),
    undefined,
    { equals: (a, b) => a.key === b.key },
  );

  createEffect(
    on([active, inputHostKey], ([isActive, state]) => {
      const decision = resumeDecision(state, shownKey, isActive);
      if (decision.kind === "paused-hold") return;

      setError(undefined);
      setPulseEnded(false);
      if (decision.kind === "idle-blank") {
        blank();
        return;
      }
      if (decision.kind === "new-key-blank") blank();
      const { i, key: activeKey } = decision;
      const pulseCtl = new AbortController();
      onCleanup(() => pulseCtl.abort());
      pollOnChange<PulseInput, Pulse, Result>({
        pulse: pulseProc(),
        pulseInput: pulseInput(i),
        query: (signal) => runActionPromise(query(i), signal),
        onResult: (result) =>
          batch(() => {
            writeWrappedValue<Result>(setStore, result);
            shownKey = activeKey;
            if (pending()) setPending(false);
            if (error()) setError(undefined);
          }),
        onError: (err) => surfaceError(err),
        onComplete: () => setPulseEnded(true),
        signal: pulseCtl.signal,
      });
    }),
  );

  const sub = Object.assign(() => store.v, {
    error,
    pending,
    complete: pulseEnded,
  });

  if (onError) wireSubscriptionError(sub, onError);

  return sub;
}
