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
import {
  foldPorts,
  knownPorts,
  type PortReach,
  portReach,
  type TerminalId,
} from "kolu-common/surface";
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

/** The words for each reason a chip is not openable — a table over
 *  `PortReach`'s `via` union, so a new forward mechanism (PRT2 adds one) is a
 *  COMPILE ERROR here rather than a silently missing sentence. The decision itself
 *  is `portReach` in the vocabulary; this file owns only how it reads. */
export const FORWARD_REASON: Record<
  Extract<PortReach, { kind: "needs-forward" }>["via"],
  string
> = {
  "remote-host": "on a remote host — needs a forward (coming next)",
  loopback: "bound to loopback — needs a forward (coming next)",
};

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
  // `knownPorts` is the ONE place "we never looked" reads as no ports, and calling
  // it here is deliberate: a pane whose first scan has not landed (or was blind)
  // contributes nothing to the tile rather than asserting it serves nothing. The
  // section then renders nothing at all for a tile with no KNOWN ports, so an
  // unknown pane never produces a claim on screen either way.
  const ports = createMemo(() =>
    foldPorts(
      store.getTilePaneIds(props.terminalId).flatMap((id) => {
        const arm = activeArm(store.getMetadata(id));
        return arm ? knownPorts(arm.ports) : [];
      }),
    ),
  );
  return (
    <Show when={ports().length > 0}>
      <Section title="Ports">
        <div class="flex flex-col gap-1" data-testid="inspector-ports">
          <For each={ports()}>
            {(port) => {
              const reach = () =>
                portReach({
                  wildcard: port.wildcard,
                  onKoluHost: onKoluHost(),
                });
              const forwardReason = () => {
                const r = reach();
                return r.kind === "needs-forward"
                  ? FORWARD_REASON[r.via]
                  : undefined;
              };
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
                      when={reach().kind === "direct"}
                      fallback={
                        // Inert on purpose — see the module header. `title` carries the
                        // reason for the truncated layout, and the cursor stays default
                        // so it never reads as a dead button.
                        <span
                          class="text-fg-3/50 text-[10px] italic"
                          data-testid="inspector-port-needs-forward"
                          data-port={port.port}
                          title={forwardReason()}
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
