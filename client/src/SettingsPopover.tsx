/** Settings popover — reads and writes preferences via useServerState directly.
 *  Only needs open/close state and trigger ref from the parent. */

import { type Component, Show, For, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import Toggle from "./Toggle";
import { useServerState } from "./useServerState";
import { useColorScheme, type ColorScheme } from "./useColorScheme";
import type { SidebarAgentPreviews } from "kolu-common";

const SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Preview-mode options for the sidebar agent previews segmented control.
 *  Order is intentional: narrowest ("none") to broadest ("all"), with
 *  the default ("attention") sitting next to "none" so users can quickly
 *  dial back from the default without overshooting into "all". */
const PREVIEW_OPTIONS: { value: SidebarAgentPreviews; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "attention", label: "Alert" },
  { value: "agents", label: "Agents" },
  { value: "all", label: "All" },
];

const SettingsPopover: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: HTMLElement;
}> = (props) => {
  const { preferences, updatePreferences } = useServerState();
  const { colorScheme, setColorScheme } = useColorScheme();

  let panelRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal({ top: 0, right: 0 });

  // Recompute position each time popover opens
  const updatePos = () => {
    if (!props.triggerRef) return;
    const rect = props.triggerRef.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  // Close on click outside (ignore clicks on the trigger itself)
  makeEventListener(document, "mousedown", (e) => {
    if (
      props.open &&
      panelRef &&
      !panelRef.contains(e.target as Node) &&
      !props.triggerRef?.contains(e.target as Node)
    ) {
      props.onOpenChange(false);
    }
  });

  // Close on Escape
  makeEventListener(document, "keydown", (e) => {
    if (props.open && e.key === "Escape") {
      props.onOpenChange(false);
    }
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={(el) => {
            panelRef = el;
            updatePos();
          }}
          data-testid="settings-popover"
          class="fixed z-50 bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-3 min-w-[200px] space-y-3"
          style={{
            top: `${pos().top}px`,
            right: `${pos().right}px`,
            "background-color": "var(--color-surface-1)",
          }}
        >
          {/* Color scheme */}
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-fg-2">Theme</span>
            <div
              data-testid="color-scheme-toggle"
              class="flex rounded-lg overflow-hidden border border-edge"
            >
              <For each={SCHEME_OPTIONS}>
                {(opt) => (
                  <button
                    data-testid={`color-scheme-${opt.value}`}
                    class="px-2 py-0.5 text-xs transition-colors cursor-pointer"
                    classList={{
                      "bg-accent text-surface-0": colorScheme() === opt.value,
                      "bg-surface-2 text-fg-2 hover:text-fg":
                        colorScheme() !== opt.value,
                    }}
                    onClick={() => setColorScheme(opt.value)}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          {/* Random terminal theme */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Random theme</span>
            <Toggle
              testId="random-theme-toggle"
              enabled={preferences().randomTheme}
              onChange={(on) => updatePreferences({ randomTheme: on })}
            />
          </label>
          {/* Scroll lock */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Scroll lock</span>
            <Toggle
              testId="scroll-lock-toggle"
              enabled={preferences().scrollLock}
              onChange={(on) => updatePreferences({ scrollLock: on })}
            />
          </label>
          {/* Activity alerts */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Activity alerts</span>
            <Toggle
              testId="activity-alerts-toggle"
              enabled={preferences().activityAlerts}
              onChange={(on) => updatePreferences({ activityAlerts: on })}
            />
          </label>
          {/* Sidebar agent previews — 4-way segmented control */}
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="text-fg-2">Agent previews</span>
            <div
              data-testid="sidebar-agent-previews-toggle"
              class="flex rounded-lg overflow-hidden border border-edge"
            >
              <For each={PREVIEW_OPTIONS}>
                {(opt) => (
                  <button
                    data-testid={`sidebar-agent-previews-${opt.value}`}
                    class="px-2 py-0.5 text-xs transition-colors cursor-pointer"
                    classList={{
                      "bg-accent text-surface-0":
                        preferences().sidebarAgentPreviews === opt.value,
                      "bg-surface-2 text-fg-2 hover:text-fg":
                        preferences().sidebarAgentPreviews !== opt.value,
                    }}
                    onClick={() =>
                      updatePreferences({ sidebarAgentPreviews: opt.value })
                    }
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          {/* Startup tips */}
          <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
            <span class="text-fg-2">Startup tips</span>
            <Toggle
              testId="startup-tips-toggle"
              enabled={preferences().startupTips}
              onChange={(on) => updatePreferences({ startupTips: on })}
            />
          </label>
        </div>
      </Portal>
    </Show>
  );
};

export default SettingsPopover;
