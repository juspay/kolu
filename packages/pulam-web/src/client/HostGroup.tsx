/**
 * One host's terminal list — the R4.8a render leaf.
 *
 * Subscribes the host's `awareness` collection (the R4.8a payload) and renders a
 * row per terminal: the cwd basename, the foreground process name, and the agent
 * kind. NO git status, NO drill-in — that's R4.8b.
 *
 * Connection / loading / error states, truthfully:
 *
 *   - The "connecting…" overlay is driven by the version subscription's REAL
 *     `pending()` — true only until the parent↔browser ws delivers its first
 *     frame. It is NOT `version.value() !== undefined`: the parent's version cell
 *     is seeded (its `inMemoryStore` needs a value), so a `value()` read clears
 *     the instant the ws subscribes, which would drop the overlay before the ws
 *     even connected and show "no terminals" spuriously. KNOWN R4.8a LIMITATION:
 *     once the ws frame lands we can't, from the surface alone, tell "remote ssh
 *     link still copying/connecting" from "remote connected with zero terminals"
 *     — that needs a real per-host connection-state primitive on the shared
 *     surface (a contract change + drishti PR), deferred to R4.8b. So a host
 *     whose remote is still provisioning shows "no terminals", not "connecting".
 *   - A subscription FAILURE (version, collection keys, or a per-key stream) is
 *     surfaced via `onError` and rendered — never collapsed into the empty/
 *     connecting state (the repo's subscription error-surfacing rule).
 *
 * `awareness.use({})` returns `{ keys, byKey }` (`@kolu/surface/solid`'s
 * `useCollection` shape): `keys()` is a reactive accessor over the live terminal
 * id set, `byKey(id)` a per-key `Subscription` accessor reading that terminal's
 * latest `AwarenessValue`. The whole thing re-notifies through Solid's
 * reactivity as the parent folds the mirror's deltas into its cache.
 */

import { createSignal, For, type JSX, Show } from "solid-js";
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
  // Surface the FIRST subscription error (version, collection keys, or a per-key
  // stream) rather than letting it collapse into the empty/connecting state. One
  // signal across all three: the first failure wins and is rendered.
  const [error, setError] = createSignal<string | null>(null);
  const onError = (err: Error): void => {
    setError((prev) => prev ?? err.message);
  };
  const awareness = app.collections.awareness.use({ onError });
  // The version subscription: `pending()` is the TRUTHFUL loading signal (no ws
  // frame yet), used for the overlay below — NOT `value() !== undefined`, which
  // the seeded parent cell makes true the instant the ws subscribes. See the
  // module comment for the R4.8a limitation this leaves.
  const version = app.cells.version.use({ onError });

  return (
    <section class="my-3 overflow-hidden rounded-lg border border-[#1b2026] bg-[#0f1216]">
      <header class="border-b border-[#1b2026] bg-[#141922] px-3 py-2 font-semibold text-[#9fd2ff]">
        {props.host}
      </header>
      <Show
        when={error() === null}
        fallback={<div class="p-3 text-[#ff8d8d]">{error()}</div>}
      >
        <Show
          when={!version.pending()}
          fallback={<div class="p-3 text-[#6b7480]">connecting…</div>}
        >
          <Show
            when={awareness.keys().length > 0}
            fallback={<div class="p-3 text-[#6b7480]">no terminals</div>}
          >
            <ul class="m-0 list-none p-0">
              <For each={awareness.keys()}>
                {(id) => {
                  const sub = awareness.byKey(id);
                  return (
                    <li class="overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#161b22] px-3 py-1.5 text-[13px]">
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
      </Show>
    </section>
  );
}
