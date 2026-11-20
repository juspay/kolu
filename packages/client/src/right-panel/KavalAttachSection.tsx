import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { localDaemonStatus } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import CopyCommandButton from "../ui/CopyCommandButton";
import Disclosure from "../ui/Disclosure";
import DocLink from "../ui/DocLink";
import { CopyIcon } from "../ui/Icons";
import { kavalCmd, kavalSocketArg } from "./kavalCmd";

const SHORT_ID_LEN = 8;

const VERBS = ["attach", "snapshot", "send"] as const;
type Verb = (typeof VERBS)[number];

const KAVAL_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["list", "your live terminals"],
  ["create", "spawn a new terminal"],
  ["kill", "end a terminal the daemon owns"],
];
const PADI_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  ["status", "snapshot every terminal"],
  ["watch", "follow the workspace live"],
  ["wait", "block until an agent's turn ends"],
  ["create", "spawn a terminal / split / worktree'd agent"],
];

const SegButton: Component<{
  pressed: boolean;
  onClick: () => void;
  testId?: string;
  title?: string;
  children: string;
}> = (props) => (
  <button
    type="button"
    aria-pressed={props.pressed}
    data-testid={props.testId}
    title={props.title}
    onClick={props.onClick}
    class="cursor-pointer rounded px-2 py-0.5 font-mono text-[10px] transition-colors"
    classList={{
      "bg-surface-0 text-fg shadow-sm": props.pressed,
      "text-fg-3 hover:text-fg": !props.pressed,
    }}
  >
    {props.children}
  </button>
);

const ReferenceGroup: Component<{
  cli: string;
  rows: ReadonlyArray<readonly [string, string]>;
}> = (props) => (
  <div class="space-y-1">
    <p class="font-mono text-[10px] text-fg-3/80">{props.cli}</p>
    <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
      <For each={props.rows}>
        {([verb, gloss]) => (
          <>
            <span class="font-mono text-[11px] text-fg-2">{verb}</span>
            <span class="text-[11px] text-fg-3 leading-snug">{gloss}</span>
          </>
        )}
      </For>
    </div>
  </div>
);

const KavalAttachSection: Component<{ terminalId: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const terminals = () => store.getTilePaneIds(props.terminalId);
  const hasSplits = () => terminals().length > 1;
  const socket = createMemo(() => localDaemonStatus()?.socketPath);

  const [wantedPane, setWantedPane] = createSignal<TerminalId | null>(null);
  const [verb, setVerb] = createSignal<Verb>("attach");
  const selectedId = (): TerminalId => {
    const wanted = wantedPane();
    return wanted !== null && terminals().includes(wanted)
      ? wanted
      : props.terminalId;
  };
  const short = () => selectedId().slice(0, SHORT_ID_LEN);
  const testIdSuffix = () => {
    const i = terminals().indexOf(selectedId());
    return i <= 0 ? "" : `-split-${i - 1}`;
  };
  const paneLabel = (i: number) =>
    i === 0 ? (hasSplits() ? "Main" : "Terminal") : `Split ${i}`;

  return (
    <div class="space-y-3">
      <p class="text-[11px] leading-relaxed text-fg-3">
        Reach these terminals from any shell with{" "}
        <span class="font-mono text-fg-2">kaval-tui</span> — attach, dump
        scrollback, or send a prompt to the agent inside.{" "}
        <DocLink slug="kaval">Learn more&nbsp;↗</DocLink>
      </p>

      <div class="space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <Show when={hasSplits()}>
            <span class="inline-flex gap-0.5 rounded-md border border-edge bg-surface-2 p-0.5">
              <For each={terminals()}>
                {(id, i) => (
                  <SegButton
                    pressed={selectedId() === id}
                    onClick={() => setWantedPane(id)}
                    testId={`inspector-attach-term-${i()}`}
                    title={id}
                  >
                    {paneLabel(i())}
                  </SegButton>
                )}
              </For>
            </span>
          </Show>
          <span class="inline-flex gap-0.5 rounded-md border border-edge bg-surface-2 p-0.5">
            <For each={VERBS}>
              {(v) => (
                <SegButton
                  pressed={verb() === v}
                  onClick={() => setVerb(v)}
                  testId={`inspector-attach-verb-${v}`}
                >
                  {v}
                </SegButton>
              )}
            </For>
          </span>
          <span class="ml-auto">
            <CopyCommandButton
              command={short()}
              copyText={selectedId()}
              title={selectedId()}
              testId={`inspector-id-command${testIdSuffix()}`}
              rounded="rounded"
              widthClass="w-auto"
              idle={<CopyIcon class="w-3 h-3" />}
            />
          </span>
        </div>

        <CopyCommandButton
          command={kavalCmd(verb(), short(), socket())}
          title={kavalCmd(verb(), selectedId(), socket())}
          testId={`inspector-${verb()}-command${testIdSuffix()}`}
          rounded="rounded-md"
          idle={<CopyIcon class="w-3 h-3" />}
        />

        <Show when={verb() === "send"}>
          <p class="text-[10px] leading-snug text-fg-3/70">
            Replace <span class="font-mono">'&lt;prompt&gt;'</span> with your
            text — <span class="font-mono">send</span> refuses an empty payload.
          </p>
        </Show>
      </div>

      <div class="rounded-lg border border-accent/30 bg-accent/10 p-2.5 space-y-1">
        <p class="text-[11px] font-medium text-fg-2">
          Drive one agent from another
        </p>
        <p class="text-[11px] leading-relaxed text-fg-3">
          <span class="font-mono text-fg-2">send</span> it a prompt,{" "}
          <span class="font-mono text-fg-2">wait</span> for its turn to end,{" "}
          <span class="font-mono text-fg-2">snapshot</span> the reply, and
          prompt again. The <span class="font-mono text-fg-2">/kolu</span> skill
          wires this loop —{" "}
          <a
            href="https://github.com/srid/llm-debate"
            target="_blank"
            rel="noopener noreferrer"
            class="text-accent hover:underline"
          >
            llm-debate
          </a>{" "}
          is a worked example.
        </p>
        <p class="text-[11px] leading-relaxed text-fg-3">
          For a hooked agent, wait in <em>two phases</em>:{" "}
          <span class="font-mono text-fg-2">
            padi-tui wait "$id" --until working
          </span>{" "}
          to catch it start, THEN{" "}
          <span class="font-mono text-fg-2">--until awaiting,waiting</span> for
          it to hand back — otherwise a stale{" "}
          <span class="font-mono">awaiting</span> from the previous turn reads
          as done before it even begins.
        </p>
      </div>

      <Disclosure summary="kaval-tui · padi-tui reference">
        <div class="space-y-2.5 pt-1">
          <ReferenceGroup cli="kaval-tui" rows={KAVAL_REFERENCE} />
          <ReferenceGroup cli="padi-tui · workspace" rows={PADI_REFERENCE} />
          <Show when={socket()}>
            {(s) => (
              <div class="space-y-1">
                <p class="text-[10px] text-fg-3/80">
                  This kolu's kaval socket — append it to a{" "}
                  <span class="font-mono text-fg-2">kaval-tui</span> reference
                  command (list / create / kill) to target this server.
                </p>
                <CopyCommandButton
                  command={kavalSocketArg(s())}
                  testId="inspector-socket"
                  rounded="rounded-md"
                  idle={<CopyIcon class="w-3 h-3" />}
                />
              </div>
            )}
          </Show>
        </div>
      </Disclosure>
    </div>
  );
};

export default KavalAttachSection;
