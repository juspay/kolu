import { decodeHostKey } from "kolu-common/hostKey";
import type { ConductorToolRow } from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { hostLabel } from "../host/hostChipTone";
import { isDesktop } from "../useMobile";
import ConductorDiffs from "./ConductorDiffs";
import ConductorLook from "./ConductorLook";
import { useShownClock } from "../ui/shown";
import {
  agentLineSubject,
  callSubject,
  failureReason,
  foldJson,
  runningFor,
  sentInput,
  toolLabel,
  waitedFor,
} from "./toolCard";
import { useOpenTile } from "./useOpenTile";

const STATUS_MARK: Record<ConductorToolRow["status"], string> = {
  pending: "·",
  in_progress: "◐",
  completed: "✓",
  failed: "✗",
};

const STATUS_CLASS: Record<ConductorToolRow["status"], string> = {
  pending: "text-fg-3",
  in_progress: "text-busy",
  completed: "text-ok",
  failed: "text-danger",
};

const runningClock = (
  row: ConductorToolRow,
  now: () => number,
): string | null =>
  row.status === "in_progress" ? runningFor(row, now()) : null;

const ConductorToolCard: Component<{ row: ConductorToolRow }> = (props) => {
  const openTileAt = useOpenTile();
  const now = useShownClock();

  const openTile = (at: { host: string; id: TerminalId } | null) => (
    <Show when={at}>
      {(target) => (
        <button
          type="button"
          data-testid="conductor-tool-open-tile"
          data-terminal-id={target().id}
          data-host={target().host}
          class="text-[0.7rem] font-semibold text-accent hover:underline cursor-pointer shrink-0"
          onClick={() => openTileAt(target())}
        >
          open tile
        </button>
      )}
    </Show>
  );

  const folded = (
    label: string,
    body: string | null,
    kind: "document" | "evidence",
  ) => (
    <Show when={body}>
      {(text) => (
        <details class="group/call col-span-full min-w-0">
          <summary class="w-fit list-none font-mono text-[0.65rem] text-fg-3 cursor-pointer [&::-webkit-details-marker]:hidden">
            <span class="group-open/call:hidden">▸</span>
            <span class="hidden group-open/call:inline">▾</span> {label}
          </summary>
          <pre
            data-testid="conductor-tool-detail"
            class="mt-1.5 max-h-64 overflow-auto rounded-md bg-surface-0 px-2.5 py-2 font-mono text-[0.65rem] leading-relaxed whitespace-pre-wrap wrap-anywhere text-fg-2"
          >
            {kind === "document" ? foldJson(text()) : text()}
          </pre>
        </details>
      )}
    </Show>
  );

  const reason = () => failureReason(props.row);

  const phone = () => !isDesktop();
  const showChip = () => !phone() || props.row.kolu === undefined;

  return (
    <div
      data-testid="conductor-tool-card"
      data-tool-kind={props.row.kolu?.kind ?? "generic"}
      data-host={props.row.kolu?.host ?? undefined}
      data-status={props.row.status}
      class="grid min-w-0 items-center gap-x-2.5 gap-y-1.5 rounded-lg border border-edge bg-surface-1 px-2.5 py-1.5 text-xs"
      classList={{
        "grid-cols-[auto_minmax(0,1fr)_auto]": showChip(),
        "grid-cols-[minmax(0,1fr)_auto]": !showChip(),
      }}
    >
      <Show when={showChip()}>
        <span class="font-mono text-[0.62rem] font-semibold text-fg-3 bg-surface-2 rounded px-1.5 py-px">
          {toolLabel(props.row)}
        </span>
      </Show>
      <span
        class="min-w-0"
        classList={{ truncate: !phone(), "wrap-anywhere": phone() }}
      >
        <Show when={props.row.kolu?.host}>
          {(host) => (
            <span
              data-testid="conductor-tool-host"
              class="mr-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent"
            >
              {hostLabel(decodeHostKey(host()))}
            </span>
          )}
        </Show>
        {(() => {
          const call = props.row.kolu;
          if (call === undefined)
            return <span class="text-fg">{props.row.text}</span>;
          return (
            <>
              <Show when={call.kind === "create"}>→ </Show>
              <b class="font-semibold">{call.name ?? "terminal"}</b>
              {(() => {
                switch (call.kind) {
                  case "create":
                    return (
                      <>
                        <Show when={call.cwd}>
                          {(cwd) => <span class="text-fg-2"> · {cwd()}</span>}
                        </Show>
                        <Show when={call.agent}>
                          {(agent) => (
                            <span class="font-mono text-fg-2">
                              {" "}
                              · {agent()}
                            </span>
                          )}
                        </Show>
                      </>
                    );
                  case "sendInput":
                    return (
                      <Show when={sentInput(call)}>
                        {(sent) => (
                          <span class="font-mono text-fg-2">
                            {" "}
                            ←{" "}
                            {sent().as === "key"
                              ? sent().value
                              : `“${sent().value}”`}
                          </span>
                        )}
                      </Show>
                    );
                  case "settle":
                    return (
                      <>
                        <Show when={call.state}>
                          {(state) => (
                            <span class="text-alert"> · {state()}</span>
                          )}
                        </Show>
                        <Show when={waitedFor(call.elapsedMs)}>
                          {(waited) => (
                            <span class="text-fg-2"> after {waited()}</span>
                          )}
                        </Show>
                      </>
                    );
                  case "screen":
                    return <span class="text-fg-2"> · screen</span>;
                  case "kill":
                    return <span class="text-fg-2"> · killed</span>;
                }
              })()}
            </>
          );
        })()}
      </span>
      <span class="flex items-center gap-2 shrink-0">
        <Show when={runningClock(props.row, now)}>
          {(elapsed) => (
            <span class="font-mono text-[0.65rem] text-busy">
              · {elapsed()}
            </span>
          )}
        </Show>
        {openTile(callSubject(props.row.kolu))}
        <span class={`font-mono ${STATUS_CLASS[props.row.status]}`}>
          {STATUS_MARK[props.row.status]}
        </span>
      </span>
      <Show when={agentLineSubject(props.row)}>
        {(at) => (
          <ConductorLook rowId={props.row.id} host={at().host} id={at().id} />
        )}
      </Show>
      <Show when={props.row.armed}>
        {(armed) => (
          <div class="col-span-full font-mono text-[0.68rem] text-fg-2 border-l-2 border-busy pl-2">
            <b class="text-fg">{armed().task}</b>
            <Show when={armed().description}>
              {(what) => <span> · {what()}</span>}
            </Show>
            <span class="text-busy">
              {" "}
              · {armed().ended ?? "still running…"}
            </span>
            <Show when={armed().report}>
              {(report) => <div class="text-fg-3">{report()}</div>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.row.spawned}>
        {(spawned) => (
          <div class="col-span-full font-mono text-[0.68rem] text-fg-2">
            ⤷ {spawned().kind ?? "subagent"}
            <Show when={spawned().said}>
              {(said) => <span class="text-fg-3"> · {said()}</span>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.row.stranded}>
        <div class="col-span-full font-mono text-[0.65rem] text-attention">
          its turn ended and it never reported back
        </div>
      </Show>
      <Show when={reason()}>
        {(why) => (
          <div
            data-testid="conductor-tool-reason"
            class="col-span-full min-w-0 font-mono text-[0.68rem] text-danger whitespace-pre-wrap wrap-anywhere"
          >
            {why()}
          </div>
        )}
      </Show>
      {(() => {
        const call = props.row.kolu;
        if (call === undefined)
          return folded("call", props.row.detail ?? null, "document");
        if (props.row.status === "failed") return null;
        if (call.kind === "settle")
          return folded("last lines (screenTail)", call.screenTail, "evidence");
        if (call.kind === "screen")
          return folded("screen", call.snapshot, "evidence");
        return folded("answer", props.row.progress ?? null, "document");
      })()}
      <Show
        when={
          props.row.kolu === undefined &&
          props.row.status !== "failed" &&
          props.row.progress
        }
      >
        {(progress) => (
          <pre class="col-span-full min-w-0 font-mono text-[0.65rem] text-fg-3 whitespace-pre-wrap wrap-anywhere max-h-24 overflow-hidden">
            {progress()}
          </pre>
        )}
      </Show>
      <Show when={props.row.diffs}>
        {(diffs) => <ConductorDiffs rowId={props.row.id} diffs={diffs()} />}
      </Show>
    </div>
  );
};

export default ConductorToolCard;
