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
  type PortInfo,
  type PortReach,
  portReach,
  samePortList,
  type TerminalId,
} from "kolu-common/surface";
import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createForward, forwardFor, viewerHost } from "../forwards/useForwards";
import { sameHost } from "../host/hostChipTone";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { OpenIcon } from "../ui/Icons";
import Section from "../ui/Section";
import { activeHost } from "../wire";

/** The URL a wildcard-bound port answers on: the host the page was served from,
 *  which IS the kolu server's host. Exported for the unit test — the whole point of
 *  this function is the hostname it does NOT use.
 *
 *  An IPv6 literal is RE-BRACKETED. `location.hostname` strips the brackets the URL
 *  form requires, so a kolu reached over IPv6 (a tailnet `fd7a:…` address is the
 *  ordinary case, not an exotic one) yielded `http://fd7a::2:8123` — where the
 *  parser reads the last `:8123` as part of the address and the URL is simply
 *  malformed. Detected by the colon: a registered hostname or an IPv4 literal can
 *  never contain one, so this needs no address parsing. */
export function portUrl(hostname: string, port: number): string {
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}

/** The words for each reason a chip is not open-as-is — a table over `PortReach`'s
 *  `via` union, so a new mechanism is a COMPILE ERROR here rather than a silently
 *  missing sentence. The decision itself is `portReach` in the vocabulary; this
 *  file owns only how it reads. */
export const FORWARD_REASON: Record<
  Extract<PortReach, { kind: "needs-forward" }>["via"],
  string
> = {
  "remote-host": "on a remote host — opens through a forward",
  loopback: "bound to loopback — opens through a forward",
};

/** …and the same for the arm no mechanism serves. Kept apart from the table above
 *  because these are not "click to forward" rows: there is nothing to offer, so
 *  the sentence has to stand on its own rather than promise an action. */
export const NO_MECHANISM_REASON: Record<
  Extract<PortReach, { kind: "no-mechanism" }>["via"],
  string
> = {
  "interface-bind":
    "bound to one interface of a remote host — no forward can reach it",
};

/** What clicking a chip should DO — the join of "is this port reachable as-is?"
 *  (`portReach`, which knows nothing about the viewer) with "is the viewer
 *  sitting at the machine this port is on?".
 *
 *  The second half exists because a host in kolu's fleet can be the machine you
 *  are reading kolu FROM. Without it, a port on that machine offered a forward:
 *  a door on the kolu SERVER so that your browser could reach a port on the
 *  machine you are already sitting at — a round trip through a third box to
 *  arrive where you started. It worked, and it was baffling.
 *
 *  Pure and total, so the whole decision is testable without a socket, and so
 *  that the render site below is a reader of it rather than a second copy:
 *
 *   - `here`     — open `<the page's own host>:<port>`. The port answers on the
 *                  machine serving this page.
 *   - `viewer`   — open `localhost:<port>`. The port is on the machine the
 *                  browser is running on, so the browser's OWN loopback reaches
 *                  it and no door is needed or possible.
 *   - `forward`  — open a door first.
 *   - `none`     — nothing reaches it; say so. */
export type PortAction =
  | { kind: "here" }
  | { kind: "viewer" }
  | { kind: "forward" }
  | { kind: "none" };

export function portAction(opts: {
  reach: PortReach;
  /** Is the port's host the machine this browser is running on? */
  viewerOnHost: boolean;
}): PortAction {
  // The viewer arm wins over `needs-forward`, and ONLY over it. A `direct` port
  // already answers on the page's own host, which is the link the user can also
  // paste elsewhere, so there is nothing to gain by rewriting it to `localhost`
  // — and `localhost` is the one hostname that means something different on
  // every machine, which is the trap this whole feature was built to avoid.
  if (opts.viewerOnHost && opts.reach.kind !== "direct") {
    return { kind: "viewer" };
  }
  if (opts.reach.kind === "direct") return { kind: "here" };
  if (opts.reach.kind === "needs-forward") return { kind: "forward" };
  return { kind: "none" };
}

const PortsSection: Component<{ terminalId: TerminalId }> = (props) => {
  const store = useTerminalStore();
  // "Is the inspected terminal on the machine serving this page?" has a named home
  // in the host layer (`isActiveHostLocal`), and reading it from there matters more
  // here than in a cosmetic caller: `portReach`s remote-host arm decides whether
  // kolu offers a link that would land on the WRONG machine.
  // Every pane of the tile: the scanner attributes a port to the pane whose
  // subtree holds it — correct and unavoidable, each pane being its own process
  // tree — but "run the dev server in the split, read the Inspector on the main
  // pane, see nothing" would then be the DEFAULT experience, because a split is
  // exactly where a long-running server goes. What a tile's panes ARE is the
  // store's to say (`getTilePaneIds`), not this section's.
  //
  // `foldPorts` is the vocabulary's own collapse (the same one the scanner applies
  // per terminal), so the widest-bind rule is stated once for both ends of the
  // wire rather than re-implemented here.
  // `knownPorts` is the ONE place "we never looked" reads as no ports, and calling
  // it here is deliberate: a pane whose first scan has not landed (or was blind)
  // contributes nothing to the tile rather than asserting it serves nothing. The
  // section then renders nothing at all for a tile with no KNOWN ports, so an
  // unknown pane never produces a claim on screen either way.
  // `equals` keeps the memo's IDENTITY across a recompute that produced the same
  // ports, which matters because `<For>` keys by item reference: `foldPorts` mints
  // fresh objects every run, so without this every host-wide terminal spawn, kill or
  // sleep would dispose and rebuild every port chip's DOM. Same remedy as
  // `sameTerminalIdOrder` and `sameParentSnapshot` elsewhere in the client.
  const ports = createMemo(
    () =>
      foldPorts(
        store.getTilePaneIds(props.terminalId).flatMap((id) => {
          const arm = activeArm(store.getMetadata(id));
          return arm ? knownPorts(arm.ports) : [];
        }),
      ),
    undefined,
    { equals: samePortList },
  );
  const host = () => activeHost();
  return (
    <Show when={ports().length > 0}>
      <Section title="Ports">
        <div class="flex flex-col gap-1" data-testid="inspector-ports">
          <For each={ports()}>
            {(port) => {
              const reach = () =>
                portReach({
                  scope: port.scope,
                  onKoluHost: isActiveHostLocal(),
                });
              /** The door kolu already holds for this port, if any — what turns the
               *  chip into a plain link and gives it its `⇄ :<localPort>` badge. */
              const forward = () => forwardFor(host(), port.port);
              /** What a click should do — the one decision, made in `portAction`
               *  so this render site reads it rather than restating it. */
              const action = () =>
                portAction({
                  reach: reach(),
                  // A `null` viewer host is "kolu cannot tell", which must read
                  // as NOT a match — that keeps the forward, which works.
                  viewerOnHost:
                    viewerHost() !== null && sameHost(viewerHost()!, host()),
                });
              /** WHERE the link points. `here` answers on the page's own host;
               *  `viewer` on the browser's own machine, which is the ONE place
               *  `localhost` is the right word rather than the trap; a forwarded
               *  port answers on its door. `undefined` means there is nothing to
               *  open YET — the click opens the door first. */
              const openAt = (): { host: string; port: number } | undefined => {
                const a = action();
                if (a.kind === "here") {
                  return { host: window.location.hostname, port: port.port };
                }
                if (a.kind === "viewer") {
                  return { host: "localhost", port: port.port };
                }
                const local = forward()?.localPort;
                return local === undefined
                  ? undefined
                  : { host: window.location.hostname, port: local };
              };
              return (
                <PortRow
                  port={port}
                  reach={reach()}
                  action={action()}
                  openAt={openAt()}
                  localPort={forward()?.localPort}
                  onForward={async () => {
                    // LAZY — this is the first click on this port, so the door is
                    // opened now rather than eagerly for every port the scanner
                    // ever saw. `auto`, because the user asked to open a chip, not
                    // to keep a forward: when the scanner sees the listener go, the
                    // door has nothing behind it and closes itself.
                    const created = await createForward({
                      host: host(),
                      port: port.port,
                      origin: "auto",
                    });
                    return created.localPort;
                  }}
                />
              );
            }}
          </For>
        </div>
      </Section>
    </Show>
  );
};

/** One port row. Split out because it holds the one piece of state in this file —
 *  "a forward is being opened right now" — and a component per row is how that
 *  stays per row rather than becoming a map keyed by port number. */
const PortRow: Component<{
  port: PortInfo;
  reach: PortReach;
  /** What a click should do — see {@link portAction}. */
  action: PortAction;
  /** WHERE the link points, or `undefined` when a door has to be opened first. */
  openAt: { host: string; port: number } | undefined;
  /** The door's port, when there is a door — rendered as the `⇄ :N` badge. */
  localPort: number | undefined;
  /** Open the door. Resolves with the local port it answers on. */
  onForward: () => Promise<number>;
}> = (props) => {
  const [opening, setOpening] = createSignal(false);

  /** Open the door, then the page. The window is opened SYNCHRONOUSLY inside the
   *  click — before the await — because a popup blocker judges a `window.open`
   *  by whether it descends from a user gesture, and one issued after an await
   *  does not. So the tab is claimed first and pointed at the URL once the door
   *  is up; a failure closes it again rather than leaving a blank tab behind.
   *
   *  Deliberately NOT `"noopener"` in the feature string, and the `opener = null`
   *  below is why: `window.open` with `noopener` returns **null** by spec, so
   *  there would be no handle to navigate once the forward is up — the flag and
   *  this flow are mutually exclusive. Severing `opener` on the blank tab (while
   *  it is still same-origin `about:blank`, the one moment this is possible)
   *  reaches the same posture the anchor path gets from `rel="noopener"`: the
   *  dev server cannot reach back into kolu's window. */
  const openThroughForward = async (): Promise<void> => {
    if (opening()) return;
    setOpening(true);
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    try {
      const localPort = await props.onForward();
      const url = portUrl(window.location.hostname, localPort);
      if (tab === null) {
        // The blocker ate it anyway (or the browser refuses popups outright).
        // The door IS open and listed, so say where it is rather than failing
        // silently — the user can click the row in Forwarded Ports.
        toast.info(`Forward open on port ${localPort}`, {
          description: "Your browser blocked the new tab.",
        });
        return;
      }
      tab.location.replace(url);
    } catch (err) {
      tab?.close();
      toast.error(
        `Could not forward port ${props.port.port}: ${(err as Error).message}`,
      );
    } finally {
      setOpening(false);
    }
  };

  const noMechanismReason = () =>
    props.reach.kind === "no-mechanism"
      ? NO_MECHANISM_REASON[props.reach.via]
      : undefined;
  const forwardReason = () =>
    props.reach.kind === "needs-forward"
      ? FORWARD_REASON[props.reach.via]
      : undefined;

  return (
    <div class="flex items-baseline gap-2 text-[11px] leading-snug">
      <span class="font-mono text-fg font-semibold tabular-nums">
        {props.port.port}
      </span>
      <span class="font-mono text-fg-3/80 truncate min-w-0">
        {props.port.name}
      </span>
      <span class="ml-auto shrink-0 flex items-baseline gap-1.5">
        <Show when={props.localPort !== undefined}>
          {/* The door, named by the port it answers on — the number in the URL
           *  that just opened, so a user who wants to paste it can read it off
           *  the row instead of the tab. */}
          <span
            class="font-mono text-[10px] rounded px-1 bg-accent/15 text-accent"
            data-testid="inspector-port-forward-badge"
            data-port={props.port.port}
            title={`forwarded to port ${props.localPort} on this host`}
          >
            ⇄ :{props.localPort}
          </span>
        </Show>
        <Show
          when={props.action.kind !== "none"}
          fallback={
            // No door exists and none can be built — the one arm with nothing to
            // offer. It states the situation rather than presenting an action
            // that would open a listener refusing every connection through it.
            <span
              class="text-fg-3/50 text-[10px] italic"
              data-testid="inspector-port-no-mechanism"
              data-port={props.port.port}
              title={noMechanismReason()}
            >
              not reachable
            </span>
          }
        >
          <Show
            when={props.openAt}
            fallback={
              // No door yet: a BUTTON, because the click has work to do before
              // there is a URL to point at. An anchor with no href would be a
              // link to nowhere, and one with a guessed href would open a tab at
              // a port nothing answers on.
              <button
                type="button"
                class="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                data-testid="inspector-port-forward-open"
                data-port={props.port.port}
                disabled={opening()}
                title={forwardReason()}
                onClick={() => void openThroughForward()}
              >
                <OpenIcon class="w-3 h-3" />
                {opening() ? "opening…" : "forward & open"}
              </button>
            }
          >
            {(at) => (
              /* An ANCHOR, matching the Pull Request row two sections up
               *  in this same panel — not a `window.open` button. The browser
               *  then gives middle-click, cmd-click, "copy link address" and a
               *  status-bar URL preview for free (that last one is why the
               *  button had to hand-roll a `title`), and a popup blocker
               *  cannot eat it. A `window.open` call stays right for the Code
               *  tab, where the URL arrives by `postMessage` and there is no
               *  element to hang an href on — and for the forward path above,
               *  where the URL does not exist until the door is open. */
              <a
                href={portUrl(at().host, at().port)}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline"
                data-testid="inspector-port-open"
                data-port={props.port.port}
              >
                <OpenIcon class="w-3 h-3" />
                open
              </a>
            )}
          </Show>
        </Show>
      </span>
    </div>
  );
};

export default PortsSection;
