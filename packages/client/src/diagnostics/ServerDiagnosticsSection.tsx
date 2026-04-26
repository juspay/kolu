import type { ServerDiagnostics } from "kolu-common";
import { type Component, createMemo, For, type Resource, Show } from "solid-js";
import { serverProcessId, wsStatus } from "../rpc/rpc";
import Row from "../ui/Row";
import Section from "../ui/Section";
import {
  formatDetails,
  formatDuration,
  formatMB,
  formatResourceAge,
} from "./format";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ServerDiagnosticsSection: Component<{
  serverDiagnostics: Resource<ServerDiagnostics>;
}> = (props) => {
  const activeWatches = createMemo(
    () =>
      props
        .serverDiagnostics()
        ?.trackedResources.filter((r) => r.kind === "fs-watch") ?? [],
  );
  const activeResources = createMemo(
    () =>
      props
        .serverDiagnostics()
        ?.trackedResources.filter((r) => r.kind !== "fs-watch") ?? [],
  );

  return (
    <Section title="Server" data-testid="diagnostic-server">
      <div class="space-y-0.5">
        <Row label="WS" variant="badge">
          {wsStatus()}
        </Row>
        <Show when={serverProcessId()}>
          {(pid) => (
            <Row label="Process">
              <span class="font-mono text-fg-3">{pid().slice(0, 8)}</span>
            </Row>
          )}
        </Show>
        <Show
          when={props.serverDiagnostics()}
          fallback={
            <div
              data-testid="server-diagnostics-loading"
              class="text-[11px] text-fg-3/60 italic"
            >
              {props.serverDiagnostics.error
                ? `Server diagnostics unavailable: ${errorMessage(
                    props.serverDiagnostics.error,
                  )}`
                : "Loading server diagnostics"}
            </div>
          }
        >
          {(server) => (
            <>
              <Row label="Uptime">
                <span class="font-mono text-fg">
                  {formatDuration(server().uptimeMs)}
                </span>
              </Row>
              <Row label="Memory">
                <span class="font-mono text-fg">
                  rss {formatMB(server().memory.rss)}
                  <span class="text-fg-3/70">
                    {" "}
                    · heap {formatMB(server().memory.heapUsed)} /{" "}
                    {formatMB(server().memory.heapTotal)}
                  </span>
                </span>
              </Row>
              <Row label="Publisher">
                <span class="font-mono text-fg">
                  {server().counts.publisherSize}
                </span>
              </Row>
            </>
          )}
        </Show>
      </div>

      <Show when={props.serverDiagnostics()}>
        {(server) => (
          <>
            <div class="mt-3 pt-2 border-t border-edge/50">
              <div class="text-[10px] text-fg-3/70 mb-1">
                Terminal processes
              </div>
              <Show
                when={server().processes.length > 0}
                fallback={
                  <div class="text-[11px] text-fg-3/60 italic">
                    No terminal processes
                  </div>
                }
              >
                <div class="space-y-1 text-[10px] font-mono">
                  <For each={server().processes}>
                    {(proc) => (
                      <div class="grid grid-cols-[9ch_8ch_1fr_auto] items-baseline gap-3">
                        <span class="text-fg-3/70">
                          {proc.terminalId.slice(0, 8)}
                        </span>
                        <span class="text-fg-2 tabular-nums">
                          pid {proc.pid}
                        </span>
                        <span class="text-fg-2 truncate" title={proc.cwd}>
                          {proc.foregroundProcess ?? proc.cwd}
                        </span>
                        <Show when={proc.agentKind}>
                          {(kind) => <span class="text-accent">{kind()}</span>}
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="mt-3 pt-2 border-t border-edge/50">
              <div class="text-[10px] text-fg-3/70 mb-1">
                Active file system watches
              </div>
              <Show
                when={activeWatches().length > 0}
                fallback={
                  <div class="text-[11px] text-fg-3/60 italic">
                    No active file watches
                  </div>
                }
              >
                <div class="space-y-1 text-[10px] font-mono">
                  <For each={activeWatches()}>
                    {(resource) => (
                      <div>
                        <div class="grid grid-cols-[12ch_14ch_1fr_6ch] items-baseline gap-3">
                          <span class="text-fg-2">{resource.label}</span>
                          <span class="text-fg-3/70">
                            {resource.owner ?? "unknown"}
                          </span>
                          <span class="text-fg-2 break-all">
                            {resource.target ?? "—"}
                          </span>
                          <span class="text-fg-3/70 tabular-nums">
                            {formatResourceAge(server(), resource)}
                          </span>
                        </div>
                        <Show when={formatDetails(resource.details)}>
                          {(details) => (
                            <div class="pl-[12ch] text-fg-3/60 break-all">
                              {details()}
                            </div>
                          )}
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            <div class="mt-3 pt-2 border-t border-edge/50">
              <div class="text-[10px] text-fg-3/70 mb-1">
                Other tracked resources
              </div>
              <Show
                when={activeResources().length > 0}
                fallback={
                  <div class="text-[11px] text-fg-3/60 italic">
                    No active timers, subscriptions, or DB handles
                  </div>
                }
              >
                <div class="space-y-1 text-[10px] font-mono">
                  <For each={activeResources()}>
                    {(resource) => (
                      <div class="grid grid-cols-[12ch_13ch_1fr_6ch] items-baseline gap-3">
                        <span class="text-fg-2">{resource.label}</span>
                        <span class="text-fg-3/70">{resource.kind}</span>
                        <span class="text-fg-2 break-all">
                          {resource.target ?? resource.owner ?? "—"}
                        </span>
                        <span class="text-fg-3/70 tabular-nums">
                          {formatResourceAge(server(), resource)}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </Section>
  );
};

export default ServerDiagnosticsSection;
