/** padi's own account of why it is slow, as a section of the Diagnostic Info
 *  dialog — the answer of `diagnostics.read` on the active host's padi.
 *
 *  Fetched when the dialog opens and on **Refresh**, never polled. The fetch
 *  state lives in {@link createPadiDiagnosticsFetch}, owned by the dialog, so
 *  the **Copy JSON** dump carries the same answer this section shows. */

import type { PadiDiagnostics, TimingSummary } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  untrack,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import { runAction } from "./runAction";
import { formatSize } from "./ui/memory";
import Row from "./ui/Row";
import Section from "./ui/Section";
import { activeHost, padiMap } from "./wire";

export type PadiDiagnosticsFetch =
  /** `host: null` is the value the fetch is built with, before its first ask
   *  — replaced in the mount's own flush, so it is never painted. */
  | { readonly kind: "loading"; readonly host: HostKey | null }
  | {
      readonly kind: "not-connected";
      readonly host: HostKey;
      readonly connection: string;
    }
  | { readonly kind: "error"; readonly host: HostKey; readonly message: string }
  | {
      readonly kind: "answer";
      readonly host: HostKey;
      readonly answer: PadiDiagnostics;
    };

export interface PadiDiagnosticsFetcher {
  readonly state: Accessor<PadiDiagnosticsFetch>;
  readonly refresh: () => void;
}

/** The dialog's one fetch of the active host's diagnostics: asked once as the
 *  dialog mounts, and again on `refresh()`. A superseded answer is dropped.
 *
 *  The question's two reads — which host is active, and whether that host's
 *  padi is connected — are taken in a MEMO, never in the imperative phase.
 *  A keyed-entry read registers its subscription ref-count through
 *  `onCleanup` under whatever scope reads it, and a settle callback forbids
 *  children, so reading the entry there throws. The memo is both a legal
 *  owner for that cleanup and the right lifetime for it: the ref-count is
 *  released when the dialog goes away.
 *
 *  The ask is the effect's apply arm, where a write belongs, and only its
 *  FIRST run asks — a later host switch or connection change recomputes the
 *  memo and asks nothing, so this stays the dialog's one automatic question.
 *  That run lands in the mount's flush, so the section opens on "Asking
 *  padi…" with the question already put. */
export function createPadiDiagnosticsFetch(): PadiDiagnosticsFetcher {
  const [state, setState] = createSignal<PadiDiagnosticsFetch>({
    kind: "loading",
    host: null,
  });
  let generation = 0;
  const target = createMemo(() => {
    const host = activeHost();
    return { host, connection: padiMap.entry(host).state().kind };
  });
  const ask = (now: { host: HostKey; connection: string }): void => {
    const { host, connection } = now;
    const mine = ++generation;
    if (connection !== "connected") {
      setState({ kind: "not-connected", host, connection });
      return;
    }
    setState({ kind: "loading", host });
    runAction(
      "read padi diagnostics",
      padiMap
        .entry(host)
        .procedures.diagnostics.read()
        .pipe(
          Effect.match({
            onSuccess: (answer) => {
              if (mine === generation) {
                setState({ kind: "answer", host, answer });
              }
            },
            onFailure: (err) => {
              if (mine === generation) {
                setState({
                  kind: "error",
                  host,
                  message: toError(err).message,
                });
              }
            },
          }),
        ),
    );
  };
  createEffect(target, (now, previous) => {
    if (previous === undefined) ask(now);
  });
  /** The Refresh button — a DOM event handler, which may read freely; the
   *  memo is already owned, so taking its current value registers nothing. */
  const refresh = (): void => ask(untrack(target));
  return { state, refresh };
}

/** Milliseconds, compact: one decimal under 10, whole above. */
const num = (v: number): string =>
  v < 10 ? v.toFixed(1) : String(Math.round(v));

/** A timing summary as `median · p99 · worst`, in ms — the order each caption
 *  below names once, so a row stays one line. */
const timing = (s: TimingSummary): string =>
  `${num(s.medianMs)} · ${num(s.p99Ms)} · ${num(s.maxMs)}`;

/** A measured value, or its reason — never a dash or a zero. */
function measuredText<T>(
  m: { kind: "measured"; value: T } | { kind: "unmeasured"; reason: string },
  show: (v: T) => string,
): JSX.Element {
  return m.kind === "measured" ? (
    <span class="whitespace-nowrap">{show(m.value)}</span>
  ) : (
    <span class="italic text-fg-3/70">{m.reason}</span>
  );
}

const CAPTION = "text-[10px] text-fg-3/70 mb-0.5";
const TH = "text-left font-normal text-fg-3/70 pr-2 pb-0.5 whitespace-nowrap";
const TD = "pr-2 align-top";

const Answer: Component<{ answer: PadiDiagnostics }> = (props) => (
  <div class="space-y-2">
    <div class="space-y-0.5">
      <Row label="Memory">
        <span class="font-mono">
          RSS {formatSize(props.answer.memory.rssBytes)} · heap{" "}
          {formatSize(props.answer.memory.heapUsedBytes)} /{" "}
          {formatSize(props.answer.memory.heapTotalBytes)} · outside heap{" "}
          {formatSize(props.answer.memory.nonHeapBytes)}
        </span>
      </Row>
      <Row label="Stalls">
        <span class="font-mono" data-testid="padi-diagnostics-stalls">
          last minute{" "}
          {measuredText(
            props.answer.stalls.lastMinute,
            (v) => `${timing(v.summary)} ms`,
          )}
          <br />
          this minute (
          {Math.round(props.answer.stalls.current.elapsedMs / 1000)} s){" "}
          {measuredText(
            props.answer.stalls.current.summary,
            (v) => `${timing(v)} ms`,
          )}
        </span>
      </Row>
      <Row label="Watches">
        <span class="font-mono" data-testid="padi-diagnostics-kernel-watches">
          {measuredText(
            props.answer.kernelWatches,
            (v) =>
              `${v.total.toLocaleString("en-US")} in the kernel${
                v.perInstance.length === 0
                  ? ", no inotify instance"
                  : `: ${v.perInstance
                      .map(
                        (i) =>
                          `fd ${i.fd} holds ${i.watches.toLocaleString("en-US")}`,
                      )
                      .join(" · ")}`
              }`,
          )}
        </span>
      </Row>
    </div>

    <div>
      <div class={CAPTION}>
        child processes, last {props.answer.children.windowMs / 1000} s · ms as
        median · p99 · worst
      </div>
      <table class="text-[10px] font-mono tabular-nums w-full">
        <thead>
          <tr>
            <th class={TH}>kind</th>
            <th class={TH}>runs</th>
            <th class={TH}>start call</th>
            <th class={TH}>run</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.answer.children.rows}
            fallback={
              <tr>
                <td class="italic text-fg-3/60" colspan={4}>
                  none started
                </td>
              </tr>
            }
          >
            {(row) => (
              <tr data-testid="padi-diagnostics-child-row">
                <td class={`${TD} text-fg whitespace-nowrap`}>
                  {row.kind}
                  <For each={row.causes}>
                    {(c) => (
                      <span class="text-fg-3/70">
                        {" "}
                        {c.cause}×{c.count}
                      </span>
                    )}
                  </For>
                </td>
                <td class={`${TD} whitespace-nowrap`}>
                  {row.started}
                  <Show when={row.running > 0}>
                    <span class="text-fg-3/70"> +{row.running} running</span>
                  </Show>
                  <Show when={row.failedToStart > 0}>
                    <span class="text-danger"> {row.failedToStart} failed</span>
                  </Show>
                </td>
                <td class={TD}>{measuredText(row.startCall, timing)}</td>
                <td class={TD}>{measuredText(row.run, timing)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>

    <div>
      <div class={CAPTION}>
        calls, last {props.answer.calls.windowMs / 1000} s · ms as median · p99
        · worst
      </div>
      <table class="text-[10px] font-mono tabular-nums w-full">
        <thead>
          <tr>
            <th class={TH}>procedure</th>
            <th class={TH}>n</th>
            <th class={TH}>total</th>
            <th class={TH}>in children</th>
          </tr>
        </thead>
        <tbody>
          <For
            each={props.answer.calls.rows}
            fallback={
              <tr>
                <td class="italic text-fg-3/60" colspan={4}>
                  no calls
                </td>
              </tr>
            }
          >
            {(row) => (
              <tr>
                <td class={`${TD} text-fg whitespace-nowrap`}>
                  {row.procedure}
                </td>
                <td class={TD}>{row.count}</td>
                <td class={`${TD} whitespace-nowrap`}>{timing(row.total)}</td>
                <td class={TD}>
                  {measuredText(row.inChildren, (v) =>
                    v.children === 0
                      ? "no children"
                      : `${timing(v.summary)} (${v.children})`,
                  )}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>

    <div>
      <div class={CAPTION}>
        file watchers ({props.answer.watchers.rows.length}), slowest install
        first
      </div>
      <div class="space-y-1 text-[10px] font-mono">
        <For
          each={props.answer.watchers.rows}
          fallback={<div class="italic text-fg-3/60">no watcher</div>}
        >
          {(row) => (
            <div data-testid="padi-diagnostics-watcher-row">
              <div class="flex items-baseline gap-2">
                <span class="text-fg whitespace-nowrap">{row.kind}</span>
                <Show when={row.state.kind !== "watching"}>
                  <span
                    class={
                      row.state.kind === "failed"
                        ? "text-danger"
                        : "text-fg-3/70"
                    }
                  >
                    {row.state.kind}
                  </span>
                </Show>
                <span class="ml-auto text-right text-fg-2">
                  {measuredText(row.lastInstallMs, (v) => `${num(v)} ms`)}
                  <Show when={row.rebuilds > 0}>
                    <span class="text-fg-3/70">
                      {" "}
                      · {row.rebuilds} rebuilds
                      {row.detail.kind === "tree" &&
                      row.detail.lastRebuildReason !== null
                        ? ` (${row.detail.lastRebuildReason})`
                        : ""}
                    </span>
                  </Show>
                </span>
              </div>
              <div class="text-fg-3 break-all">
                {row.root}
                <span class="text-fg-3/70">
                  {" · "}
                  {measuredText(
                    row.directories,
                    (v) => `${v} director${v === 1 ? "y" : "ies"}`,
                  )}
                </span>
              </div>
              <div class="text-fg-3/70">asked by {row.askers.join(", ")}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  </div>
);

const PadiDiagnosticsSection: Component<{
  fetch: PadiDiagnosticsFetcher;
}> = (props) => (
  <Section
    title="padi"
    data-testid="padi-diagnostics"
    status={
      <button
        type="button"
        data-testid="padi-diagnostics-refresh"
        onClick={() => props.fetch.refresh()}
        class="text-[10px] px-1.5 py-px rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        Refresh
      </button>
    }
  >
    <div class="text-[11px]">
      <Switch>
        <Match when={props.fetch.state().kind === "loading"}>
          <span class="text-fg-3/70 italic">Asking padi…</span>
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "not-connected" ? s : undefined;
          })()}
        >
          {(s) => (
            <span class="text-fg-3">
              padi on this host is not connected ({s().connection}), so there is
              nothing to ask.
            </span>
          )}
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "error" ? s : undefined;
          })()}
        >
          {(s) => (
            <span class="text-danger" data-testid="padi-diagnostics-error">
              {s().message}
            </span>
          )}
        </Match>
        <Match
          when={(() => {
            const s = props.fetch.state();
            return s.kind === "answer" ? s : undefined;
          })()}
        >
          {(s) => <Answer answer={s().answer} />}
        </Match>
      </Switch>
    </div>
  </Section>
);

export default PadiDiagnosticsSection;
