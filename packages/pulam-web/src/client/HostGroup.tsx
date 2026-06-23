/**
 * One host's terminal list — the R4.8a render leaf.
 *
 * Subscribes the host's `awareness` collection (the R4.8a payload) and renders a
 * row per terminal: the cwd basename, the foreground process name, and the agent
 * kind. While the surface handshake is still in flight (the `version` cell has
 * yielded no snapshot yet — its first frame is the parent's "link live" signal),
 * a "connecting…" line stands in. NO git status, NO drill-in — that's R4.8b.
 *
 * `awareness.use({})` returns `{ keys, byKey }` (`@kolu/surface/solid`'s
 * `useCollection` shape): `keys()` is a reactive accessor over the live terminal
 * id set, `byKey(id)` a per-key `Subscription` accessor reading that terminal's
 * latest `AwarenessValue`. The whole thing re-notifies through Solid's
 * reactivity as the parent folds the mirror's deltas into its cache.
 */

import { For, type JSX, Show } from "solid-js";
import type { AwarenessValue } from "@kolu/terminal-workspace/surface";
import { surfaceForHost } from "./wire.ts";

/** The last path segment of `cwd` — the terminal's working dir at a glance.
 *  A trailing slash is trimmed first so `/a/b/` reads as `b`, not empty. */
function basename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return base.length > 0 ? base : cwd;
}

/** One terminal row's label, derived from its awareness value. */
function describe(value: AwarenessValue): string {
  const where = basename(value.cwd);
  const fg = value.foreground?.name;
  const agent = value.agent?.kind;
  const tail = [fg, agent].filter((s): s is string => Boolean(s)).join(" · ");
  return tail.length > 0 ? `${where}  —  ${tail}` : where;
}

export function HostGroup(props: { host: string }): JSX.Element {
  const app = surfaceForHost(props.host);
  const awareness = app.collections.awareness.use({});
  // The handshake cell: `undefined` until the first `version` frame arrives, so
  // it doubles as the coarse "link live yet?" signal for the overlay.
  const version = app.cells.version.use();

  return (
    <section
      style={{
        border: "1px solid #1b2026",
        "border-radius": "8px",
        margin: "12px 0",
        overflow: "hidden",
        background: "#0f1216",
      }}
    >
      <header
        style={{
          padding: "8px 12px",
          background: "#141922",
          "border-bottom": "1px solid #1b2026",
          "font-weight": "600",
          color: "#9fd2ff",
        }}
      >
        {props.host}
      </header>
      <Show
        when={version.value() !== undefined}
        fallback={
          <div style={{ padding: "12px", color: "#6b7480" }}>connecting…</div>
        }
      >
        <Show
          when={awareness.keys().length > 0}
          fallback={
            <div style={{ padding: "12px", color: "#6b7480" }}>
              no terminals
            </div>
          }
        >
          <ul style={{ "list-style": "none", margin: "0", padding: "0" }}>
            <For each={awareness.keys()}>
              {(id) => {
                const sub = awareness.byKey(id);
                return (
                  <li
                    style={{
                      padding: "6px 12px",
                      "border-bottom": "1px solid #161b22",
                      "font-size": "13px",
                      "white-space": "nowrap",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                    }}
                  >
                    <Show when={sub?.()} fallback={<span>…</span>}>
                      {(value) => <span>{describe(value())}</span>}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
}
