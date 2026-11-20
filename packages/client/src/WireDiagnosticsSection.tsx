import { type Component, createMemo, For, Show } from "solid-js";
import {
  collectDiagnosticSnapshot,
  type DiagnosticSnapshotInputs,
} from "./diagnosticSnapshot";
import Row from "./ui/Row";
import Section from "./ui/Section";

const WireDiagnosticsSection: Component<{
  serverBuild?: DiagnosticSnapshotInputs["serverBuild"];
}> = (props) => {
  const snapshot = createMemo(() =>
    collectDiagnosticSnapshot({ serverBuild: props.serverBuild }),
  );
  const parked = createMemo(
    () => snapshot().subscriptions.filter((s) => s.verdict === "parked").length,
  );
  return (
    <Section title="Wire">
      <div
        class="text-[11px] font-mono space-y-1"
        data-testid="wire-diagnostics"
      >
        <Row label="epoch / open since">
          <span class="tabular-nums text-fg-3">
            {snapshot().wire.epoch} ·{" "}
            {snapshot().wire.openSince === undefined
              ? "not open"
              : new Date(snapshot().wire.openSince as number)
                  .toISOString()
                  .slice(11, 23)}
          </span>
        </Row>
        <Row label="last probe">
          <span class="tabular-nums text-fg-3">
            {snapshot().wire.lastProbeAt === undefined
              ? "none yet"
              : `${new Date(snapshot().wire.lastProbeAt as number)
                  .toISOString()
                  .slice(11, 23)} ${
                  snapshot().wire.lastProbeOk ? "answered" : "TIMED OUT"
                }`}
          </span>
        </Row>

        <div class="text-[10px] text-fg-3/70 pt-1">
          dials ({snapshot().wire.dials.length})
        </div>
        <div data-testid="wire-dials" class="space-y-0.5">
          <For
            each={snapshot().wire.dials}
            fallback={
              <div class="text-[10px] text-fg-3/60 italic">
                no dial recorded
              </div>
            }
          >
            {(dial) => (
              <div class="text-[10px] tabular-nums flex items-baseline gap-2">
                <span class="text-fg-3/70">
                  {new Date(dial.startedAt).toISOString().slice(11, 23)}
                </span>
                <span
                  class={
                    dial.classification === "ended-without-open"
                      ? "text-danger font-semibold"
                      : "text-fg-2"
                  }
                >
                  {dial.classification}
                </span>
                <Show when={dial.closeCode !== undefined}>
                  <span class="text-fg-3/70">code {dial.closeCode}</span>
                </Show>
              </div>
            )}
          </For>
        </div>

        <div class="text-[10px] text-fg-3/70 pt-1">
          subscriptions ({snapshot().subscriptions.length})
          <Show when={parked() > 0}>
            <span class="text-danger font-semibold"> · {parked()} PARKED</span>
          </Show>
        </div>
        <div data-testid="wire-subscriptions" class="space-y-0.5">
          <For
            each={snapshot().subscriptions}
            fallback={
              <div class="text-[10px] text-fg-3/60 italic">
                no subscription registered
              </div>
            }
          >
            {(sub) => (
              <div class="text-[10px] tabular-nums flex items-baseline gap-2">
                <span
                  class={
                    sub.verdict === "parked"
                      ? "text-danger font-semibold"
                      : "text-fg-3/70"
                  }
                >
                  {sub.verdict}
                </span>
                <span class="text-fg-2 truncate">{sub.label}</span>
                <span class="text-fg-3/70">
                  {sub.lastFrameAt === undefined
                    ? "no frame"
                    : new Date(sub.lastFrameAt).toISOString().slice(11, 23)}
                  {" · "}
                  {sub.framesReceived}f/{sub.retries}r
                </span>
              </div>
            )}
          </For>
        </div>

        <div class="text-[10px] text-fg-3/70 pt-1">
          host entries ({snapshot().hosts.length})
        </div>
        <div data-testid="wire-hosts" class="space-y-0.5">
          <For
            each={snapshot().hosts}
            fallback={
              <div class="text-[10px] text-fg-3/60 italic">no host entry</div>
            }
          >
            {(host) => (
              <div class="text-[10px] tabular-nums flex items-baseline gap-2">
                <span class="text-fg-2">{host.key}</span>
                <span class="text-fg-3/70">{host.kind}</span>
                <span class="text-fg-3/70">{host.detail}</span>
                <span class="text-fg-3/70">
                  {host.lastUpdateAt === undefined
                    ? "no update"
                    : new Date(host.lastUpdateAt).toISOString().slice(11, 23)}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Section>
  );
};

export default WireDiagnosticsSection;
