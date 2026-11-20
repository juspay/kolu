import { useActiveHostSelector } from "./isActiveHost";
import { conductorMode } from "../conductor/useConductorMode";

import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  type DragEvent,
  SortableProvider,
} from "@thisbeyond/solid-dnd";
import { createMediaQuery } from "@solid-primitives/media";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { Portal } from "solid-js/web";
import { AttentionTriplet } from "@kolu/solid-statepip";
import { hostMarks } from "../attention/attentionMarks";
import { jumpToAsking } from "../attention/attentionNav";
import DocLink from "../ui/DocLink";
import { surface } from "../ui/Surface";
import { forwardsForHost } from "../forwards/useForwards";
import { type AnchorSide, useAnchoredPopover } from "../ui/useAnchoredPopover";
import { useServerIdentity } from "../useServerIdentity";
import { activeHost, hostKeys, padiMap, updatePreferences } from "../wire";
import { selectHostTab } from "./selectHostTab";
import { addHost } from "./addHost";
import { focusOnMount } from "./focusOnMount";
import {
  releaseHostDiagnosticsAnchor,
  toggleHostDiagnostics,
  useHostDiagnosticsSelector,
} from "./useHostDiagnosticsOpen";
import { HostChipShell } from "./HostChipShell";
import { HostIdentityLabel } from "./HostIdentityLabel";
import AgentDistroHostMark from "../agents/AgentDistroHostMark";
import { forwardRingLabel, HostStatusDot } from "./HostStatusDot";
import { HostTabWorkingStripe, hostActiveLabel } from "./HostTabWorkingStripe";
import { activeKavalPresence } from "../kaval/useDaemonStatus";
import {
  chipStatusDot,
  hostDisplayName,
  hostGlance,
  hostHue,
  hostLabel,
  kavalChainOf,
} from "./hostChipTone";
import { useHostKavalChain } from "./useHostKaval";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { runAction } from "../runAction";
import { computeVisibleHosts, type HostFit } from "./hostOverflow";
import { removeHost } from "./removeHost";
import { createDragClickGuard } from "./dragClickGuard";
import { isPinnedHostKey, moveHostKey, reorderableHostKeys } from "./hostOrder";

const FIRST_FRAME_CHIP_WIDTH_GUESS: number = 96;

const atMd = createMediaQuery("(min-width: 48rem)");
const OVERFLOW_TRIGGER_RESERVE: number = 44;
const ADD_BUTTON_RESERVE: number = 38;

const labelForKey: (key: string) => string = (key) =>
  hostLabel(decodeHostKey(key));

const HostChip: Component<{
  host: HostKey;
  drag?: (el: HTMLElement) => void;
  consumeDragClick?: () => boolean;
}> = (props) => {
  const state = () => padiMap.entry(props.host).state();
  const encKey = encodeHostKey(props.host);
  const marks = hostMarks(encKey);
  const forwardCount = () => forwardsForHost(props.host).length;
  const activeSuffix = () =>
    marks.active() > 0 ? `, ${hostActiveLabel(marks.active())}` : "";
  const selectedHost = useActiveHostSelector();
  const isActive = () => selectedHost(encodeHostKey(props.host));
  const kaval = useHostKavalChain(props.host);
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  const statusDot = () => chipStatusDot(props.host, state(), kaval());
  const { hostname } = useServerIdentity();
  const name = () => hostDisplayName(props.host, hostname());
  const isOpen = useHostDiagnosticsSelector();
  const diagOpen = () => isOpen(encKey);

  let chipEl: HTMLDivElement | undefined;

  return (
    <div
      ref={(el) => {
        chipEl = el;
        props.drag?.(el);
        onCleanup(() => releaseHostDiagnosticsAnchor(el));
      }}
      class="group -mb-px flex items-center shrink-0 text-xs"
      on:click={{
        capture: true,
        handleEvent: (e) => {
          if (props.consumeDragClick?.() !== true) return;
          e.stopPropagation();
          e.preventDefault();
        },
      }}
      data-testid="host-chip"
      data-host={encKey}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
    >
      <HostChipShell
        host={props.host}
        decoration={glance().labelDecoration}
        active={isActive()}
        down={down()}
        tab={{
          style: { "--host-hue": hostHue(props.host) },
          "data-asking": marks.asking() > 0 && !isActive() ? "" : undefined,
          "data-unseen":
            marks.unseenFinished() > 0 && marks.asking() === 0 && !isActive()
              ? ""
              : undefined,
        }}
        diagnostics={{
          "data-testid": "host-diagnostics-open",
          "aria-haspopup": "dialog",
          "aria-expanded": diagOpen(),
          "aria-label": `Details for ${name()} — ${glance().title}${activeSuffix()}${forwardCount() > 0 ? `, ${forwardRingLabel(forwardCount())}` : ""}`,
          title: `${glance().title}${activeSuffix()} — click for details`,
          onClick: (e) => {
            e.stopPropagation();
            if (chipEl === undefined)
              throw new Error("host chip has no element to hang details off");
            toggleHostDiagnostics(encKey, chipEl);
          },
        }}
        select={{
          role: "tab",
          "aria-selected": isActive(),
          "data-testid": "host-select",
          onClick: () => selectHostTab(props.host),
          title: `${name()} — ${glance().title}${activeSuffix()}`,
        }}
        status={
          <HostStatusDot
            statusDot={statusDot()}
            forwardCount={forwardCount()}
          />
        }
        attention={
          <AttentionTriplet
            asking={marks.asking()}
            unseen={marks.unseenFinished()}
            viewing={isActive()}
            sizeClass="min-w-4 px-1 h-4"
            scopeLabel={name()}
            onAsking={() => jumpToAsking(encKey)}
            class="-ml-1 mr-2.5"
          />
        }
        agents={<AgentDistroHostMark host={props.host} />}
        stripe={<HostTabWorkingStripe active={marks.active()} />}
      />
    </div>
  );
};

const SortableHostChip: Component<{ hostKey: string }> = (props) => {
  const sortable = createSortable(props.hostKey);
  const host = decodeHostKey(props.hostKey);
  const consumeDragClick = createDragClickGuard(
    () => sortable.isActiveDraggable,
  );
  return (
    <HostChip host={host} drag={sortable} consumeDragClick={consumeDragClick} />
  );
};

const HostSwitcherRow: Component<{
  hostKey: string;
  onPicked: () => void;
  testIdPrefix: string;
}> = (props) => {
  const host = decodeHostKey(props.hostKey);
  const isLocal = () => host.kind === "local";
  const selectedHost = useActiveHostSelector();
  const isActive = () => selectedHost(props.hostKey);
  const state = () => padiMap.entry(host).state();
  const kaval = useHostKavalChain(host);
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  const statusDot = () => chipStatusDot(host, state(), kaval());
  const marks = hostMarks(props.hostKey);
  const pickHost = () => {
    selectHostTab(host);
    props.onPicked();
  };

  return (
    <div
      class="group/host-row relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-lg p-1.5 pl-2.5 transition-colors"
      classList={{
        "bg-accent/20 ring-2 ring-accent/65": isActive() && !down(),
        "bg-surface-1/55 ring-1 ring-edge/70 hover:bg-surface-2/85 hover:ring-edge-bright/80":
          !isActive() && !down(),
        "opacity-70 ring-1 ring-danger/40": down(),
      }}
      data-active={isActive() ? "" : undefined}
      data-down={down() ? "" : undefined}
    >
      <Show when={isActive()}>
        <span
          class="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent"
          aria-hidden="true"
        />
      </Show>
      <button
        type="button"
        data-testid={`${props.testIdPrefix}-option-${props.hostKey}`}
        aria-current={isActive() ? "true" : undefined}
        title={`${hostLabel(host)} — ${glance().title}`}
        class="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        onClick={pickHost}
      >
        <span
          class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot()}`}
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1">
          <span
            class="flex min-w-0 items-center gap-1.5 text-xs font-medium"
            classList={{
              "text-fg": isActive() && !down(),
              "text-fg-2": !isActive() && !down(),
              "text-fg-3": down(),
            }}
          >
            <HostIdentityLabel
              host={host}
              labelClass={`truncate${glance().labelDecoration}`}
            />
            <Show when={isActive()}>
              <span class="shrink-0 rounded-full border border-accent/45 bg-accent/15 px-1.5 text-[9px] font-semibold leading-4 text-accent">
                active
              </span>
            </Show>
          </span>
          <span
            class="block truncate text-[10px] leading-3"
            classList={{
              "text-accent": isActive() && !down(),
              "text-fg-3": !isActive() && !down(),
              "text-danger": down(),
            }}
          >
            {glance().short}
          </span>
        </span>
      </button>
      <AttentionTriplet
        active={marks.active()}
        asking={marks.asking()}
        unseen={marks.unseenFinished()}
        viewing={isActive()}
        sizeClass="min-w-4 px-1 h-4"
        scopeLabel={hostLabel(host)}
        onAsking={() => {
          jumpToAsking(props.hostKey);
          props.onPicked();
        }}
      />
      <Show when={!isLocal()} fallback={<span class="h-7 w-6" />}>
        <button
          type="button"
          class="pointer-events-auto h-7 w-6 inline-flex items-center justify-center rounded-lg text-fg-3 opacity-0 transition-[opacity,color,background-color] hover:bg-danger/10 hover:text-danger group-hover/host-row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
          data-testid={`${props.testIdPrefix}-remove-${props.hostKey}`}
          aria-label={`Remove host ${hostLabel(host)}`}
          title={`Remove ${hostLabel(host)}`}
          onClick={() => runAction("remove host", removeHost(host))}
        >
          ✕
        </button>
      </Show>
    </div>
  );
};

const hostSwitcherChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

const HostSwitcherPopover: Component<{
  triggerRef: () => HTMLElement | undefined;
  open: () => boolean;
  onDismiss: () => void;
  anchor?: AnchorSide;
  hostKeys: readonly string[];
  testIdPrefix: string;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: props.triggerRef,
    open: props.open,
    onDismiss: props.onDismiss,
    anchor: props.anchor ?? "bottom-start",
    panelMinWidth: 352,
  });

  return (
    <Show when={props.open()}>
      <Portal>
        <div
          ref={panelRef}
          data-testid={`${props.testIdPrefix}-menu`}
          class={`fixed z-50 w-[min(22rem,calc(100vw-1rem))] p-1.5 ${hostSwitcherChrome.class}`}
          style={{ ...panelStyle(), ...hostSwitcherChrome.style }}
        >
          <div class="max-h-[min(22rem,calc(100vh-4rem))] space-y-1 overflow-y-auto">
            <For each={props.hostKeys}>
              {(hostKey) => (
                <HostSwitcherRow
                  hostKey={hostKey}
                  onPicked={props.onDismiss}
                  testIdPrefix={props.testIdPrefix}
                />
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

const HostOverflowMenu: Component<{ hosts: string[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;

  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid="host-overflow-trigger"
        class="pointer-events-auto shrink-0 h-8 px-2 inline-flex items-center gap-1 rounded-md bg-transparent text-xs text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        aria-label={`${props.hosts.length} more host${props.hosts.length === 1 ? "" : "s"}`}
        title={props.hosts.map(labelForKey).join(", ")}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯ +{props.hosts.length}
      </button>
      <HostSwitcherPopover
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        hostKeys={props.hosts}
        testIdPrefix="host-overflow"
      />
    </>
  );
};

const HostDropdownSwitcher: Component<{ hosts: HostKey[] }> = (props) => {
  const [open, setOpen] = createSignal(false);
  let triggerEl: HTMLButtonElement | undefined;
  const active = () => activeHost();
  const current = () => !conductorMode();
  const state = () => padiMap.entry(active()).state();
  const kaval = () => kavalChainOf(activeKavalPresence());
  const glance = () => hostGlance(state(), kaval());
  const down = () => glance().down;
  const statusDot = () => chipStatusDot(active(), state(), kaval());
  const hostKeys = () => props.hosts.map(encodeHostKey);

  return (
    <>
      <div
        role="tablist"
        aria-label="Hosts"
        class="host-tab -mb-px flex h-8 items-center shrink-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50"
        classList={{
          "host-tab-active": current(),
          "host-tab-idle": !current() && !down(),
          "host-tab-down": down(),
        }}
        style={{ "--host-hue": hostHue(active()) }}
        data-testid="host-dropdown-switcher"
        data-down={down() ? "" : undefined}
      >
        <button
          type="button"
          role="tab"
          aria-selected={current()}
          aria-expanded={open()}
          ref={triggerEl}
          class="pointer-events-auto flex h-8 items-center gap-1.5 pl-2.5 pr-2 text-xs transition-colors focus-visible:outline-none cursor-pointer"
          classList={{ "text-fg": !down(), "text-fg-3": down() }}
          aria-label={`Switch host — currently ${hostLabel(active())}`}
          title={`Switch host — currently ${hostLabel(active())}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span
            class={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDot()}`}
            aria-hidden="true"
          />
          <HostIdentityLabel
            host={active()}
            labelClass={`truncate max-w-[5rem] font-medium${glance().labelDecoration}`}
          />
          <span aria-hidden="true" class="text-fg-3">
            ▾
          </span>
        </button>
      </div>
      <HostSwitcherPopover
        triggerRef={() => triggerEl}
        open={open}
        onDismiss={() => setOpen(false)}
        hostKeys={hostKeys()}
        testIdPrefix="host-switcher"
      />
    </>
  );
};

const addHostChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

const AddHostAffordance: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  let triggerEl: HTMLButtonElement | undefined;
  let inputEl: HTMLInputElement | undefined;
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => triggerEl,
    open,
    onDismiss: () => setOpen(false),
    anchor: "bottom-start",
    panelMinWidth: 288,
  });
  createEffect(() => {
    if (!open()) return;
    focusOnMount(inputEl);
  });
  const submit = (): void => {
    runAction(
      "add host",
      addHost(draft(), () => {
        setDraft("");
        setOpen(false);
      }),
    );
  };
  return (
    <>
      <button
        type="button"
        ref={triggerEl}
        data-testid="host-add-open"
        class="pointer-events-auto shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-1/60 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
        aria-label="Add a host"
        title="Add a host (ssh target)"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={panelRef}
            data-testid="host-add-menu"
            class={`fixed z-50 w-[min(20rem,calc(100vw-1rem))] p-3 ${addHostChrome.class}`}
            style={{ ...panelStyle(), ...addHostChrome.style }}
          >
            <p class="mb-2.5 text-[11px] leading-4 text-fg-2">
              Add another machine —{" "}
              <DocLink slug="remote-hosts" data-testid="host-add-docs">
                Learn more →
              </DocLink>
            </p>
            <input
              ref={inputEl}
              type="text"
              data-testid="host-add-input"
              class="pointer-events-auto h-8 w-full rounded-lg border border-edge bg-surface-1 px-2.5 text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
              placeholder="ssh host, e.g. srid@zest"
              aria-label="ssh host"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
          </div>
        </Portal>
      </Show>
    </>
  );
};

const HostSelectorStrip: Component = () => {
  const { showTipOnce } = useTips();

  let containerRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  createResizeObserver(
    () => containerRef,
    (rect) => setContainerWidth(rect.width),
  );

  const [chipWidths, setChipWidths] = createStore<Record<string, number>>({});
  const [measureRefs, setMeasureRefs] = createStore<
    Record<string, HTMLDivElement | undefined>
  >({});
  createResizeObserver(
    () =>
      Object.values(measureRefs).filter(
        (el): el is HTMLDivElement => el !== undefined,
      ),
    (rect, el) => {
      const key = el.dataset.hostKey;
      if (key) setChipWidths(key, rect.width);
    },
  );

  const chipFits = createMemo<HostFit[]>(() =>
    hostKeys().map((h) => {
      const key = encodeHostKey(h);
      return { key, width: chipWidths[key] ?? FIRST_FRAME_CHIP_WIDTH_GUESS };
    }),
  );
  const chipsBudget = createMemo(() => containerWidth() - ADD_BUTTON_RESERVE);
  const hostFit = createMemo(() =>
    computeVisibleHosts(
      chipFits(),
      encodeHostKey(activeHost()),
      chipsBudget(),
      OVERFLOW_TRIGGER_RESERVE,
    ),
  );

  const draggableVisible = createMemo(() =>
    hostFit().visible.filter((key) => !isPinnedHostKey(key)),
  );
  createEffect(() => {
    if (draggableVisible().length > 1)
      showTipOnce(CONTEXTUAL_TIPS.hostRearrange);
  });
  const dropHost = ({ draggable, droppable }: DragEvent): void => {
    if (!droppable || draggable.id === droppable.id) return;
    updatePreferences({
      hostOrder: moveHostKey(
        reorderableHostKeys(hostKeys()),
        String(draggable.id),
        String(droppable.id),
      ),
    });
  };

  return (
    <div
      ref={containerRef}
      class="host-strip pointer-events-auto relative flex h-8 flex-1 items-end gap-1.5 min-w-0"
      data-testid="host-selector-strip"
    >
      <div classList={{ hidden: atMd() }} inert={atMd()}>
        <HostDropdownSwitcher hosts={hostKeys()} />
      </div>
      <div classList={{ hidden: !atMd() }} inert={!atMd()}>
        <DragDropProvider
          collisionDetector={closestCenter}
          onDragEnd={dropHost}
        >
          <DragDropSensors />
          <SortableProvider ids={draggableVisible()}>
            <div
              role="tablist"
              aria-label="Hosts"
              class="host-tablist flex items-end gap-0.5 min-w-0 flex-nowrap"
              data-testid="host-chip-row"
            >
              <For each={hostFit().visible}>
                {(key) =>
                  isPinnedHostKey(key) ? (
                    <HostChip host={decodeHostKey(key)} />
                  ) : (
                    <SortableHostChip hostKey={key} />
                  )
                }
              </For>
              <Show when={hostFit().overflowed.length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowed} />
              </Show>
            </div>
          </SortableProvider>
        </DragDropProvider>
      </div>

      <div
        aria-hidden="true"
        class="invisible pointer-events-none absolute left-0 top-0 flex items-center gap-1.5"
      >
        <For each={hostKeys()}>
          {(host) => {
            const key = encodeHostKey(host);
            onCleanup(() => setMeasureRefs(key, undefined));
            return (
              <div
                ref={(el) => setMeasureRefs(key, el)}
                data-host-key={key}
                class="shrink-0"
              >
                <div class="group -mb-px flex items-center shrink-0 text-xs">
                  <HostChipShell
                    host={host}
                    attention={
                      <AttentionTriplet
                        asking={hostMarks(key).asking()}
                        unseen={hostMarks(key).unseenFinished()}
                        viewing={useActiveHostSelector()(key)}
                        sizeClass="min-w-4 px-1 h-4"
                        scopeLabel="Measurement"
                        class="-ml-1 mr-2.5"
                      />
                    }
                    agents={<AgentDistroHostMark host={host} measuring />}
                  />
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <AddHostAffordance />
    </div>
  );
};

export default HostSelectorStrip;
