/**
 * The host picker — W4 "the switch".
 *
 * DELIBERATELY HIDDEN: it lives ONLY as a nested group under the command palette's
 * "Labs" section (beta features that work but aren't stable) — no ChromeBar slot, no
 * keybinding, no discoverability tip. Together with `KOLU_PADI_HOST` (the default host
 * only), the palette item is the sole way to reach remote terminals until the feature
 * stabilizes; the ChromeBar switcher graduates later. Typing "switch"/"host" finds it
 * (the palette flattens on query). Its description carries the beta known-issues link.
 *
 * The picker offers the known hosts as ACTIONS (local, the server default, and each
 * server-persisted recent host — shared across your devices) and a free-typed value
 * input for a new ssh host. Picking one calls `switchHost`, which adds the host to
 * the server pool (a deliberate two-step add-then-connect) before swapping the tab's
 * binding in place — no page reload.
 */

import type { PaletteGroup, PaletteItem } from "../CommandPalette";
import { recentHosts } from "../wire";
import {
  activeHost,
  forgetHost,
  LOCAL_HOST,
  serverDefaultHost,
  switchHost,
} from "./bindings";

export function hostPickerCommand(): PaletteGroup {
  return {
    kind: "group",
    name: "Switch host",
    section: "help",
    // Beta — surfaces the known-issues link so a finder gets the "unsupported" signal.
    // (Plain URL text: the palette's description is secondary text, not a live link.)
    description:
      "Beta · known issues: https://kolu.dev/atlas/remote-bind-parity.html",
    children: (): PaletteItem[] => {
      const active = activeHost();
      const recents = recentHosts();
      // Local always; the server default (if it's a remote host); then each recent.
      // De-duped, first-seen order (a `Set` preserves insertion order).
      const known = [
        ...new Set([
          LOCAL_HOST,
          ...(serverDefaultHost() !== LOCAL_HOST ? [serverDefaultHost()] : []),
          ...recents,
        ]),
      ];

      const hostAction = (host: string): PaletteItem => ({
        kind: "action",
        name: host === LOCAL_HOST ? "local (this machine)" : host,
        description: host === active ? "current" : undefined,
        onSelect: () => void switchHost(host),
      });

      // A recent host can be forgotten (dropped from the pool + recentHosts) via a
      // nested action, so the list doesn't grow forever. Local is never in `recents`
      // (the server never persists it); the DEFAULT host (`KOLU_PADI_HOST`) CAN land
      // in recents but is NOT forgettable — it is STRUCTURAL (its session backs the HTTP
      // `/rpc` handler + the samplers), so `hosts.remove(default)` REJECTS with a typed
      // `UnremovableHostError` server-side (A3). Filtering it out of this list is the UX
      // layer over that real server guard — no dead action offered — not the guard itself.
      const forgettable = recents.filter((h) => h !== serverDefaultHost());
      const forgetGroup: PaletteItem | undefined =
        forgettable.length > 0
          ? {
              kind: "group",
              name: "Forget a host…",
              description: "Drop a remembered host from the pool + recents",
              children: (): PaletteItem[] =>
                forgettable.map((host) => ({
                  kind: "action",
                  name: host,
                  onSelect: () => void forgetHost(host),
                })),
            }
          : undefined;

      return [
        ...known.map(hostAction),
        {
          kind: "value",
          name: "Connect to a host…",
          description: "Type an ssh host (from ~/.ssh/config, or user@host)",
          prefill: () => "",
          placeholder: "user@host or host",
          validate: (v: string) => (v.trim() ? null : "Enter a hostname"),
          onSubmit: (value: string) => void switchHost(value.trim()),
          children: () => [
            {
              kind: "hint",
              text: "The host is added to the pool, then this tab switches to it — loud connecting/degraded states show while it warms.",
            },
          ],
        },
        ...(forgetGroup ? [forgetGroup] : []),
      ];
    },
  };
}
