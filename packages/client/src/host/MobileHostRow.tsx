import { useActiveHostSelector } from "./isActiveHost";

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { AttentionTriplet } from "@kolu/solid-statepip";
import { hostMarks } from "../attention/attentionMarks";
import DocLink from "../ui/DocLink";
import { hostKeys, padiMap } from "../wire";
import { conductorMode } from "../conductor/useConductorMode";
import { selectHostTab } from "./selectHostTab";
import { runAction } from "../runAction";
import { addHost } from "./addHost";
import { focusOnMount } from "./focusOnMount";
import { HostIdentityLabel } from "./HostIdentityLabel";
import { chipStatusDot, hostGlance, hostHue, hostLabel } from "./hostChipTone";
import { useHostKavalChain } from "./useHostKaval";

const MobileHostChip: Component<{ host: HostKey; onSwitch: () => void }> = (
  props,
) => {
  const state = createMemo(() => padiMap.entry(props.host).state());
  const selectedHost = useActiveHostSelector();
  const isActive = () => selectedHost(encodeHostKey(props.host));
  const kaval = useHostKavalChain(props.host);
  const glance = createMemo(() => hostGlance(state(), kaval()));
  const down = createMemo(() => glance().down);
  const statusDot = createMemo(() =>
    chipStatusDot(props.host, state(), kaval()),
  );
  const marks = hostMarks(encodeHostKey(props.host));

  return (
    <button
      type="button"
      aria-current={isActive() ? "true" : undefined}
      data-testid="mobile-host-chip"
      data-host={encodeHostKey(props.host)}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
      class="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
      classList={{
        "border-[var(--host-hue)] bg-[color-mix(in_srgb,var(--host-hue)_18%,var(--color-surface-1))] text-fg":
          isActive() && !down(),
        "border-[var(--host-hue)] bg-[color-mix(in_srgb,var(--host-hue)_12%,var(--color-surface-1))] text-fg-3 opacity-80":
          isActive() && down(),
        "border-edge bg-surface-2 text-fg-2 active:bg-surface-3":
          !isActive() && !down(),
        "border-danger/40 bg-surface-2 text-fg-3 opacity-70":
          !isActive() && down(),
      }}
      style={{ "--host-hue": hostHue(props.host) }}
      title={`${hostLabel(props.host)} — ${glance().title}`}
      onClick={() => {
        if (isActive() && !conductorMode()) return;
        selectHostTab(props.host);
        props.onSwitch();
      }}
    >
      <span
        class={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${statusDot()}`}
        aria-hidden="true"
      />
      <HostIdentityLabel
        host={props.host}
        glyphClass="h-4 w-4"
        labelClass={`max-w-[10rem] truncate font-medium${glance().labelDecoration}`}
      />
      <AttentionTriplet
        active={marks.active()}
        asking={marks.asking()}
        unseen={marks.unseenFinished()}
        viewing={isActive()}
        sizeClass="h-5 min-w-5 px-1.5"
        scopeLabel={hostLabel(props.host)}
      />
    </button>
  );
};

const MobileAddSection: Component<{ onClose: () => void }> = (props) => {
  const [draft, setDraft] = createSignal("");
  let inputEl: HTMLInputElement | undefined;

  onMount(() => focusOnMount(inputEl));

  const submit = (): void => {
    runAction("add host", addHost(draft(), props.onClose));
  };

  return (
    <div
      data-testid="mobile-host-add-section"
      class="mt-2 rounded-xl border border-edge bg-surface-1 p-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <p class="mb-2.5 text-[11px] leading-4 text-fg-2">
        Add another machine —{" "}
        <DocLink slug="remote-hosts" data-testid="mobile-host-add-docs">
          Learn more →
        </DocLink>
      </p>
      <div class="flex items-center gap-2">
        <input
          ref={inputEl}
          type="text"
          data-testid="mobile-host-add-input"
          class="h-11 min-w-0 flex-1 rounded-lg border border-edge bg-surface-0 px-3 text-sm text-fg placeholder:text-fg-3 focus:border-accent/50 focus:outline-none"
          placeholder="ssh host, e.g. srid@zest"
          aria-label="ssh host"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") {
              e.preventDefault();
              props.onClose();
            }
          }}
        />
        <button
          type="button"
          data-testid="mobile-host-add-submit"
          class="h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-surface-0 active:bg-accent/80"
          onClick={submit}
        >
          Add
        </button>
      </div>
    </div>
  );
};

const MobileHostRow: Component<{ onSwitch: () => void }> = (props) => {
  const [addOpen, setAddOpen] = createSignal(false);

  return (
    <div class="border-b border-edge/50 px-3 py-2">
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-3">
        Hosts
      </div>
      <div class="flex items-center gap-2">
        <div
          data-testid="mobile-host-row"
          class="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <For each={hostKeys()}>
            {(host) => <MobileHostChip host={host} onSwitch={props.onSwitch} />}
          </For>
        </div>
        <button
          type="button"
          data-testid="mobile-host-add-open"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-edge text-lg text-fg-3 active:bg-surface-2"
          aria-label="Add a host"
          aria-expanded={addOpen()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setAddOpen((v) => !v)}
        >
          +
        </button>
      </div>
      <Show when={addOpen()}>
        <MobileAddSection onClose={() => setAddOpen(false)} />
      </Show>
    </div>
  );
};

export default MobileHostRow;
