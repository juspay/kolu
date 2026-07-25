/** The Inspector's **Ports** section — "what is this terminal serving?", and one
 *  click from the page.
 *
 *  Every chip is a listening TCP port padi's scanner attributed to this terminal's
 *  process subtree. Two shapes, and which one you get is decided by facts, never by
 *  a guess:
 *
 *   - **Openable** — the port is bound to the ANY address (`0.0.0.0` / `::`) on the
 *     KOLU SERVER's own host, so it already answers on every interface of that host,
 *     including the name in the viewer's address bar. The chip is a link.
 *   - **Needs a forward** — a loopback-bound port (invisible from any other machine
 *     — loopback never leaves the box) or a port on a REMOTE host (the ssh hosts
 *     `KOLU_PADI_HOST` adds; `location.hostname` is not that machine). The chip
 *     renders with an inert affordance that says so. PRT2 makes it live by opening a
 *     forward through `@kolu/port-forward`; this phase deliberately builds none of
 *     that, so the affordance states the situation rather than offering an action
 *     that would silently do nothing.
 *
 *  **The URL is always built from `location.hostname`, never a literal
 *  "localhost".** kolu's real deployment shape is a server on a headless linux box
 *  viewed from a laptop, so "localhost" in a link means the LAPTOP — the one machine
 *  that certainly isn't running the dev server. The host in the address bar is the
 *  one name that is reachable by construction: the page loaded from it.
 *
 *  The port/scheme pair is deliberately fixed at `http` — a dev server on a
 *  wildcard port is overwhelmingly http, and guessing https from a port number
 *  would produce a broken tab more often than a working one. */

import { activeArm } from "@kolu/padi/surface";
import { foldPorts, type TerminalId } from "kolu-common/surface";
import { type Component, For, Show, createMemo } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { OpenIcon } from "../ui/Icons";
import { openExternal } from "../ui/openExternal";
import Section from "../ui/Section";
import { activeHost } from "../wire";

/** The URL a wildcard-bound port answers on: the host the page was served from,
 *  which IS the kolu server's host. Exported for the unit test — the whole point of
 *  this function is the hostname it does NOT use. */
export function portUrl(hostname: string, port: number): string {
  return `http://${hostname}:${port}`;
}

/** Why a chip is not openable, as the words shown to the user. `null` when it IS
 *  openable. Pure and total over the two facts a chip has (is it wildcard-bound, is
 *  its terminal on the kolu server's own host), so there is no third "unknown"
 *  rendering to get wrong. */
export function needsForwardReason(opts: {
  wildcard: boolean;
  onKoluHost: boolean;
}): string | null {
  if (!opts.onKoluHost) {
    return "on a remote host — needs a forward (coming next)";
  }
  if (!opts.wildcard) {
    return "bound to loopback — needs a forward (coming next)";
  }
  return null;
}

const PortsSection: Component<{ terminalId: TerminalId }> = (props) => {
  const store = useTerminalStore();
  // Is the terminal being inspected on the machine serving this page? The
  // Inspector always shows the ACTIVE host's terminal, and `{ kind: "local" }` is
  // exactly "the padi on the kolu server's own host" — so this is the whole
  // question, read off the key rather than compared against a hostname string.
  const onKoluHost = () => activeHost().kind === "local";
  // Every pane of the tile: the scanner attributes a port to the pane whose
  // subtree holds it — correct and unavoidable, each pane being its own process
  // tree — but "run the dev server in the split, read the Inspector on the main
  // pane, see nothing" would then be the DEFAULT experience, because a split is
  // exactly where a long-running server goes. What a tile's panes ARE is the
  // store's to say (`getTilePaneIds`), not this section's.
  //
  // `foldPorts` is the vocabulary's own collapse (the same one the scanner applies
  // per terminal), so the wildcard-OR rule is stated once for both ends of the
  // wire rather than re-implemented here.
  const ports = createMemo(() =>
    foldPorts(
      store
        .getTilePaneIds(props.terminalId)
        .flatMap((id) => activeArm(store.getMetadata(id))?.ports ?? []),
    ),
  );
  return (
    <Show when={ports().length > 0}>
      <Section title="Ports">
        <div class="flex flex-col gap-1" data-testid="inspector-ports">
          <For each={ports()}>
            {(port) => {
              const reason = () =>
                needsForwardReason({
                  wildcard: port.wildcard,
                  onKoluHost: onKoluHost(),
                });
              return (
                <div class="flex items-baseline gap-2 text-[11px] leading-snug">
                  <span class="font-mono text-fg font-semibold tabular-nums">
                    {port.port}
                  </span>
                  <span class="font-mono text-fg-3/80 truncate min-w-0">
                    {port.name}
                  </span>
                  <span class="ml-auto shrink-0">
                    <Show
                      when={reason() === null}
                      fallback={
                        // Inert on purpose — see the module header. `title` carries the
                        // same sentence for the truncated layout, and the cursor stays
                        // default so it never reads as a dead button.
                        <span
                          class="text-fg-3/50 text-[10px] italic"
                          data-testid="inspector-port-needs-forward"
                          data-port={port.port}
                          title={reason() ?? undefined}
                        >
                          needs a forward
                        </span>
                      }
                    >
                      {/* `openExternal` — the one way kolu leaves for an http(s)
                       *  URL, shared with the Code tab's preview, so the
                       *  `noopener,noreferrer` posture really is stated once. */}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 text-accent hover:underline cursor-pointer"
                        data-testid="inspector-port-open"
                        data-port={port.port}
                        title={portUrl(window.location.hostname, port.port)}
                        onClick={() =>
                          openExternal(
                            portUrl(window.location.hostname, port.port),
                          )
                        }
                      >
                        <OpenIcon class="w-3 h-3" />
                        open
                      </button>
                    </Show>
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Section>
    </Show>
  );
};

export default PortsSection;
