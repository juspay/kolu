/** Diagnostic Info — runtime state dump for support tickets and
 *  self-diagnosis. Opened from command palette → Debug → Diagnostic
 *  info. Content split into `<DiagnosticInfoContent/>` so a future
 *  always-visible dev inspector can reuse it without the modal chrome. */

import { type Component, For, Show, createMemo } from "solid-js";
import Dialog from "@corvu/dialog";
import { toast } from "solid-sonner";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";
import Section from "./ui/Section";
import Row from "./ui/Row";
import { wsStatus, serverProcessId } from "./rpc/rpc";
import { getDiagnostics } from "./terminal/useTerminalDiagnostics";
import { currentLayout, layoutPin } from "./layout/useLayout";
import type { TerminalId } from "kolu-common";

/** One-shot browser facts read at first render. Stable for the session,
 *  so no reactive source needed — keeps this module's dependency surface
 *  small. */
function browserFacts() {
  const canvas = document.createElement("canvas");
  const gl2 = !!canvas.getContext("webgl2");
  return { userAgent: navigator.userAgent, webgl2Supported: gl2 };
}

const DiagnosticInfoContent: Component<{ activeId: TerminalId | null }> = (
  props,
) => {
  const browser = browserFacts();

  const snapshot = createMemo(() => ({
    browser,
    session: {
      layout: currentLayout(),
      layoutPin: layoutPin(),
      wsStatus: wsStatus(),
      serverProcessId: serverProcessId(),
      activeId: props.activeId,
      terminalCount: getDiagnostics().length,
    },
    terminals: getDiagnostics().map((d) => ({
      id: d.id,
      cols: d.cols,
      rows: d.rows,
      renderer: d.renderer,
    })),
  }));

  function copyJson() {
    void navigator.clipboard
      .writeText(JSON.stringify(snapshot(), null, 2))
      .then(() => toast.success("Diagnostic info copied"))
      .catch((err: Error) => toast.error(`Failed to copy: ${err.message}`));
  }

  return (
    <div class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[80vh]">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-edge shrink-0">
        <Dialog.Label class="font-semibold text-fg text-sm">
          Diagnostic info
        </Dialog.Label>
        <button
          type="button"
          onClick={copyJson}
          class="text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Copy JSON
        </button>
      </div>

      <div class="overflow-y-auto">
        <Section title="Browser">
          <div class="space-y-0.5">
            <Row label="WebGL 2">
              <span class={browser.webgl2Supported ? "text-ok" : "text-danger"}>
                {browser.webgl2Supported ? "available" : "unavailable"}
              </span>
            </Row>
            <Row label="UA">
              <span class="font-mono text-fg-3 break-all">
                {browser.userAgent}
              </span>
            </Row>
          </div>
        </Section>

        <Section title="Session">
          <div class="space-y-0.5">
            <Row label="Layout">
              <span class="text-fg">
                {currentLayout()}
                {layoutPin() !== "auto"
                  ? ` (pinned ${layoutPin()})`
                  : " (auto)"}
              </span>
            </Row>
            <Row label="WS" variant="badge">
              {wsStatus()}
            </Row>
            <Show when={serverProcessId()}>
              {(pid) => (
                <Row label="Server">
                  <span class="font-mono text-fg-3">{pid().slice(0, 8)}</span>
                </Row>
              )}
            </Show>
            <Row label="Active">
              <span class="font-mono text-fg-3">
                {props.activeId ? props.activeId.slice(0, 8) : "—"}
              </span>
            </Row>
            <Row label="Count">
              <span class="font-mono text-fg">{getDiagnostics().length}</span>
            </Row>
          </div>
        </Section>

        <Section title="Terminals">
          <Show
            when={getDiagnostics().length > 0}
            fallback={
              <div class="text-[11px] text-fg-3/60 italic">No terminals</div>
            }
          >
            <div class="space-y-0.5">
              <For each={getDiagnostics()}>
                {(d) => (
                  <div class="grid grid-cols-[9ch_8ch_1fr_auto] items-baseline gap-3 text-[11px] font-mono">
                    <span class="text-fg-3/70">{d.id.slice(0, 8)}</span>
                    <span class="text-fg-2 tabular-nums">
                      {d.cols}×{d.rows}
                    </span>
                    <span
                      class={
                        d.renderer === "webgl" ? "text-accent" : "text-fg-2"
                      }
                    >
                      {d.renderer}
                    </span>
                    <Show when={props.activeId === d.id}>
                      <span class="text-[10px] text-fg-3/70">active</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Section>
      </div>
    </div>
  );
};

const DiagnosticInfo: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: TerminalId | null;
}> = (props) => (
  <ModalDialog
    open={props.open}
    onOpenChange={(open) => {
      props.onOpenChange(open);
      if (!open) refocusTerminal();
    }}
    size="md"
  >
    <Dialog.Content>
      <DiagnosticInfoContent activeId={props.activeId} />
    </Dialog.Content>
  </ModalDialog>
);

export default DiagnosticInfo;
