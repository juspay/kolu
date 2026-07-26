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
  samePortList,
  type TerminalId,
} from "kolu-common/surface";
import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import {
  ForwardCancelButton,
  ForwardCopyButton,
} from "../forwards/ForwardRows";
import {
  createForward,
  forwardsForHost,
  viewerHost,
} from "../forwards/useForwards";
import { sameHost } from "../host/hostChipTone";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { OpenIcon } from "../ui/Icons";
import Section from "../ui/Section";
import {
  FORWARD_PILL,
  originTooltip,
  originWord,
} from "../forwards/forwardTone";
import { pasteableAddress } from "../forwards/ForwardRows";
import { ServingTerminalLink } from "../forwards/ServingTerminalLink";
import {
  servingTerminalName,
  terminalServingPort,
} from "../forwards/terminalServingPort";
import { portUrl } from "../forwards/portUrl";
import { type PortRow as PortRowData, portRows } from "../forwards/portRows";
import { activeHost } from "../wire";

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
  // The viewer arm wins over `needs-forward`, and ONLY over it — which is what
  // this now says, having previously said "not `direct`" and so caught
  // `no-mechanism` too.
  //
  // `direct` is excluded because the port already answers on the page's own
  // host: a link the user can paste elsewhere, where `localhost` is the one
  // hostname that means something different on every machine — the trap this
  // whole feature was built to avoid.
  //
  // `no-mechanism` is excluded for a harder reason. An interface-bound listener
  // is bound to ONE address, so `localhost` does not reach it even from that
  // machine, and `scope: "interface"` records that the bind is interface-specific
  // WITHOUT recording which address — so there is no URL kolu can honestly build.
  // "Not reachable" is the true answer for the viewer too.
  if (opts.viewerOnHost && opts.reach.kind === "needs-forward") {
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
  /** The ONE list: what this terminal serves, joined to the doors kolu holds,
   *  plus this host's doors that match no scanned port (a ⌘K forward, or one
   *  whose listener died before the reap). Two titled groups used to render a
   *  forwarded port twice; the join is in `portRows` so its ordering and host
   *  scoping are pinned without a DOM. */
  /** Every PANE of every tile on this host, as the port join needs them — panes
   *  and not tiles, because a dev server almost always runs in a split and the
   *  scanner attributes the port to the split's own subtree.
   *  `terminalServingPort` folds the answer back to the tile. */
  const servingCandidates = () =>
    store.terminalIds().flatMap((tileId) =>
      store.getTilePaneIds(tileId).flatMap((paneId) => {
        const arm = activeArm(store.getMetadata(paneId));
        return arm === undefined
          ? []
          : [{ id: paneId, parentId: arm.parentId ?? null, ports: arm.ports }];
      }),
    );

  /** WHICH terminal an "also forwarded on this host" row belongs to, and how to
   *  reach it. Only the TRAILING group gets this: a main port row is already a
   *  port of the terminal you are inspecting, so naming it would name the thing
   *  on screen and the jump would go nowhere you are not. */
  const servingFor = (
    port: number,
  ): { name: string; jump: () => void } | undefined => {
    const found = terminalServingPort({ port, terminals: servingCandidates() });
    if (found === undefined) return undefined;
    const meta = store.getMetadata(found);
    const arm = activeArm(meta);
    // No arm means the tile the join pointed at has no live metadata to name it
    // by. Rendering an unnamed link would put "go somewhere" on screen, which is
    // the affordance-without-an-answer this whole pass exists to remove.
    if (arm === undefined) return undefined;
    return {
      name: servingTerminalName({ git: arm.git ?? null, cwd: arm.cwd }),
      jump: () => store.activate(found),
    };
  };

  const rows = createMemo(() =>
    portRows({
      ports: ports(),
      forwards: forwardsForHost(host()),
      host: host(),
    }),
  );
  return (
    <Show when={rows().length > 0}>
      <Section title="Ports">
        <div class="flex flex-col" data-testid="inspector-ports">
          <For each={rows()}>
            {(row) => {
              const reach = () =>
                row.kind === "orphan"
                  ? // An orphan has no bind to judge — it is a door, not a
                    // listener. It always has a forward, so its link is the door.
                    ({ kind: "needs-forward", via: "loopback" } as PortReach)
                  : portReach({
                      scope: row.info.scope,
                      onKoluHost: isActiveHostLocal(),
                    });
              const action = () =>
                portAction({
                  reach: reach(),
                  // A `null` viewer host is "kolu cannot tell", which must read
                  // as NOT a match — that keeps the forward, which works.
                  viewerOnHost:
                    viewerHost() !== null && sameHost(viewerHost()!, host()),
                });
              const openAt = (): { host: string; port: number } | undefined => {
                const a = action();
                if (a.kind === "here") {
                  return { host: window.location.hostname, port: row.port };
                }
                if (a.kind === "viewer") {
                  return { host: "localhost", port: row.port };
                }
                const local = row.forward?.localPort;
                return local === undefined
                  ? undefined
                  : { host: window.location.hostname, port: local };
              };
              return (
                <PortRow
                  row={row}
                  serving={
                    row.kind === "orphan" ? servingFor(row.port) : undefined
                  }
                  action={action()}
                  openAt={openAt()}
                  forwardReason={
                    reach().kind === "needs-forward"
                      ? FORWARD_REASON[
                          (reach() as { via: "loopback" | "remote-host" }).via
                        ]
                      : reach().kind === "no-mechanism"
                        ? NO_MECHANISM_REASON["interface-bind"]
                        : undefined
                  }
                  onForward={async () => {
                    // LAZY — this is the first click on this port, so the door is
                    // opened now rather than eagerly for every port the scanner
                    // ever saw. `auto`, because the user asked to open a chip, not
                    // to keep a forward: when the scanner sees the listener go, the
                    // door has nothing behind it and closes itself.
                    const created = await createForward({
                      host: host(),
                      port: row.port,
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

/** One row of the ports section — a port this terminal serves, or a door on this
 *  host with no scanned port behind it.
 *
 *  Hierarchy is deliberate and is the whole of the "look nicer" ask: the NUMBER
 *  and the program name are the subject and carry the weight; everything else —
 *  the door it answers on, copy, cancel — is quiet until the row is hovered or
 *  focused, and reachable by keyboard regardless. An orphan row is dimmer still,
 *  because it is a footnote about the host rather than an answer about this
 *  terminal.
 *
 *  It holds the one piece of state in this file — "a forward is being opened
 *  right now" — and a component per row is how that stays per row rather than
 *  becoming a map keyed by port number. */
export const PortRow: Component<{
  row: PortRowData;
  action: PortAction;
  /** WHERE the link points, or `undefined` when a door has to be opened first. */
  openAt: { host: string; port: number } | undefined;
  /** Why this port is not open-as-is, when it is not. */
  forwardReason: string | undefined;
  /** WHICH terminal serves this port, and how to get to it — the trailing
   *  group's affordance. Absent for a main port row (you are already there) and
   *  for a forward no terminal serves. */
  serving?: { name: string; jump: () => void };
  /** Open the door. Resolves with the local port it answers on. */
  onForward: () => Promise<number>;
}> = (props) => {
  const [opening, setOpening] = createSignal(false);
  const forward = () => props.row.forward;

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
   *  reaches the same posture the anchor path gets from `rel="noopener"`. */
  const openThroughForward = async (): Promise<void> => {
    if (opening()) return;
    setOpening(true);
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    try {
      const localPort = await props.onForward();
      const url = portUrl(window.location.hostname, localPort);
      if (tab === null) {
        toast.info(`Forward open on port ${localPort}`, {
          description: "Your browser blocked the new tab.",
        });
        return;
      }
      tab.location.replace(url);
    } catch (err) {
      tab?.close();
      toast.error(
        `Could not forward port ${props.row.port}: ${(err as Error).message}`,
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div
      class="group/port flex items-baseline gap-2 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60"
      classList={{ "opacity-70": props.row.kind === "orphan" }}
      data-testid="inspector-port-row"
      data-port={props.row.port}
      data-forwarded={forward() ? "yes" : undefined}
      data-origin={forward()?.origin}
      data-orphan={props.row.kind === "orphan" ? "" : undefined}
    >
      <span class="shrink-0 font-mono tabular-nums text-fg">
        {props.row.port}
      </span>
      {/* What is behind the number — and, in the trailing group, the way to it.
       *  That group is where the question is sharpest: a port in it is by
       *  definition served by some terminal OTHER than the one on screen, so the
       *  row NAMES that terminal instead of saying "this host" and leaving the
       *  user to guess which of its terminals. When the join finds nothing the
       *  old sentence stands, unlinked: honest copy about a door whose server
       *  kolu cannot point at. */}
      <Show
        when={props.serving}
        fallback={
          <span class="min-w-0 flex-1 truncate font-mono text-fg-3/80">
            {props.row.kind === "port"
              ? props.row.name
              : "also forwarded on this host"}
          </span>
        }
      >
        {(s) => (
          <span class="min-w-0 flex-1 truncate">
            <ServingTerminalLink name={s().name} onJump={s().jump} />
          </span>
        )}
      </Show>

      {/* The door, as a teal pill. A bare `⇄` answered no question — forwarded
       *  WHERE? — so the pill always names the local port it answers on, and its
       *  tooltip carries the whole address to paste. Teal, never the connection
       *  green: one colour per meaning. */}
      <Show when={forward()}>
        {(f) => (
          <span
            class={`shrink-0 text-[10px] tabular-nums ${FORWARD_PILL}`}
            data-testid="inspector-port-forward-badge"
            data-port={props.row.port}
            title={`${pasteableAddress(f())} · ${originWord(f().origin)} — ${originTooltip(f().origin)}`}
          >
            ⇄ :{f().localPort}
          </span>
        )}
      </Show>

      <span class="ml-auto flex shrink-0 items-baseline gap-1.5">
        <Show
          when={props.action.kind !== "none"}
          fallback={
            <span
              class="text-[10px] italic text-fg-3/50"
              data-testid="inspector-port-no-mechanism"
              data-port={props.row.port}
              title={props.forwardReason}
            >
              not reachable
            </span>
          }
        >
          <Show
            when={props.openAt}
            fallback={
              <button
                type="button"
                class="inline-flex items-center gap-1 text-fg-3/70 transition-colors hover:text-accent hover:underline focus-visible:text-accent disabled:opacity-50 motion-reduce:transition-none"
                data-testid="inspector-port-forward-open"
                data-port={props.row.port}
                disabled={opening()}
                title={props.forwardReason}
                onClick={() => void openThroughForward()}
              >
                <OpenIcon class="h-3 w-3" />
                {opening() ? "opening…" : "forward & open"}
              </button>
            }
          >
            {(at) => (
              <a
                href={portUrl(at().host, at().port)}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline"
                data-testid="inspector-port-open"
                data-port={props.row.port}
              >
                <OpenIcon class="h-3 w-3" />
                open
              </a>
            )}
          </Show>
        </Show>

        {/* Copy and cancel belong to the DOOR, so they appear only on a row that
         *  has one. Quiet until the row is hovered or something in it is
         *  focused — always reachable by keyboard, never shouting on a list
         *  the user is only reading. */}
        <Show when={forward()}>
          {(f) => (
            <span class="flex items-baseline gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/port:opacity-100">
              <ForwardCopyButton forward={f()} />
              <ForwardCancelButton forward={f()} />
            </span>
          )}
        </Show>
      </span>
    </div>
  );
};

export default PortsSection;
