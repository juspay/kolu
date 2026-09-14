/** The Inspector's **Ports** section — "what is this terminal serving?", what
 *  else is serving on its host, and one click from the page.
 *
 *  Two groups, each port in exactly one, each row carrying its door inline
 *  (`forwards/portRows.ts` is the join and says why):
 *
 *   - **From this terminal** — ports in this tile's process subtrees, plus
 *     servers whose URL the tile PRINTED that listen elsewhere on the host (a
 *     server that detached, marked so). Always shown.
 *   - **Elsewhere on this host** — the user's other listeners, printed or
 *     forwarded foreign sockets, and doors with nothing behind them. Folded
 *     behind a count by default: a busy dev box runs dozens of servers, and the
 *     section's subject is still this terminal. A row with an open door stays
 *     visible while folded — an open door must never be out of reach.
 *
 *  Which affordance a row gets is decided by facts, never by a guess:
 *
 *   - **Openable** — the port answers on every interface of the KOLU SERVER's own
 *     host, including the name in the viewer's address bar. The row links.
 *   - **Forwardable** — a loopback-bound port (invisible from any other machine)
 *     or a port on a REMOTE host. The row offers "forward & open", which opens a
 *     door LAZILY on click and then the page.
 *   - **Not reachable** — an interface-bound listener. `scope` records that the
 *     bind is interface-specific without recording WHICH address, so there is no
 *     URL kolu can honestly build and no door that reaches it either.
 *
 *  **The URL is always built from `location.hostname`, never a literal
 *  "localhost".** kolu's real deployment shape is a server on a headless linux box
 *  viewed from a laptop, so "localhost" in a link means the LAPTOP — the one machine
 *  that certainly isn't running the dev server. The host in the address bar is the
 *  one name that is reachable by construction: the page loaded from it.
 *
 *  The DECISION each row rests on is `forwards/portAction.ts`; the open flow is
 *  the three-layer composition in `forwards/openPort.ts` (decision · act ·
 *  effect at the row edge). This file is the section; `PortRow.tsx` is the row.
 */

import { Key } from "@solid-primitives/keyed";
import { hostKeysEqual as sameHost } from "kolu-common/hostKey";
import { samePortList, type TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { rowAction } from "../forwards/portAction";
import {
  type PortRow as PortRowData,
  portGroups,
  rowGroup,
} from "../forwards/portRows";
import {
  doorLocalPorts,
  forwardsForHost,
  viewerHost,
} from "../forwards/useForwards";
import { useHostListeners } from "../forwards/useHostListeners";
import { sameSet, useHostTerminals } from "../forwards/useHostTerminals";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { isTouch } from "../useMobile";
import { ChevronRightIcon } from "../ui/Icons";
import Section from "../ui/Section";
import { activeHost } from "../wire";
import { PortRow } from "./PortRow";

const NO_PORTS: ReadonlySet<number> = new Set();

const PortsSection: Component<{ terminalId: TerminalId }> = (props) => {
  const host = () => activeHost();

  /** WHICH terminal serves a port, and how to reach it — asked only for rows
   *  that are not this tile's own subtree ports: naming the terminal on screen
   *  would name the thing you are looking at, and the jump would go nowhere.
   *  Also the one source of every pane walk the join below reads. */
  const terminals = useHostTerminals();

  // Every pane of the tile: the scanner attributes a port to the pane whose
  // subtree holds it — correct and unavoidable, each pane being its own process
  // tree — but "run the dev server in the split, read the Inspector on the main
  // pane, see nothing" would then be the DEFAULT experience, because a split is
  // exactly where a long-running server goes. `HostTerminals.tilePorts` folds
  // them. `equals` keeps the memo's IDENTITY across a recompute that produced
  // the same ports, so an unrelated terminal tick does not re-run the join below.
  const ports = createMemo(
    () => terminals.tilePorts(props.terminalId),
    undefined,
    {
      equals: samePortList,
    },
  );

  /** The ports this tile's panes printed a loopback URL for. */
  const printedHere = createMemo(
    () => terminals.printedBy(props.terminalId),
    undefined,
    { equals: sameSet },
  );

  /** Is the browser sitting at the machine this host IS? One fact about the
   *  PAGE, so it is derived once per host change rather than inside every row.
   *  A `null` viewer host is "kolu cannot tell", which must read as NOT a match
   *  — that keeps the forward, which works. */
  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  const hostListeners = useHostListeners();
  const groups = createMemo(() =>
    portGroups({
      terminals: {
        tilePorts: ports(),
        printedHere: printedHere(),
        printedOnHost: terminals.printedOnHost(),
      },
      host: hostListeners(),
      forwards: forwardsForHost(host()),
      // kolu's relay listeners live on the kolu server's own machine, so only
      // that host's list can contain them.
      doorPorts: isActiveHostLocal() ? doorLocalPorts() : NO_PORTS,
    }),
  );

  const [elsewhereOpen, setElsewhereOpen] = createSignal(false);
  /** The elsewhere rows on screen: all of them when open, and only the rows
   *  with an open door when folded. */
  const elsewhereShown = createMemo(() =>
    elsewhereOpen()
      ? groups().elsewhere
      : groups().elsewhere.filter((row) => row.forward !== undefined),
  );
  const elsewhereFolded = () =>
    groups().elsewhere.length - elsewhereShown().length;

  /** One row, KEYED by port (`<Key by={port}>`): the join rebuilds its row
   *  objects whenever the host reading, a terminal's ports or a forward ticks,
   *  and a reference-keyed `<For>` would tear down every row's DOM — and its
   *  in-flight "opening…" state — on each of them. Keyed, a row updates in place. */
  const renderRow = (row: () => PortRowData): JSX.Element => {
    const decided = () =>
      rowAction({
        row: row(),
        onKoluHost: isActiveHostLocal(),
        viewerOnHost: viewerOnHost(),
      });
    return (
      <PortRow
        row={row()}
        host={host()}
        serving={
          // Only rows that are not this tile's name a terminal: a subtree row is
          // the terminal on screen, and a printed row is held by none.
          rowGroup(row()) === "elsewhere"
            ? terminals.servingFor(row().port)
            : undefined
        }
        action={decided().action}
        forwardReason={decided().reason}
      />
    );
  };

  return (
    <Show when={groups().here.length + groups().elsewhere.length > 0}>
      <Section title="Ports">
        <div class="flex flex-col" data-testid="inspector-ports">
          <Key each={groups().here} by={(row) => row.port}>
            {renderRow}
          </Key>
          <Show when={groups().elsewhere.length > 0}>
            <div
              class="flex flex-col"
              classList={{ "mt-1.5": groups().here.length > 0 }}
              data-testid="inspector-ports-elsewhere"
            >
              <button
                type="button"
                class="-mx-1 flex items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-fg-3/70 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none"
                aria-expanded={elsewhereOpen()}
                // A coarse pointer gets the WCAG 2.2 24px tap floor, like the
                // Code-tab toolbar; a mouse keeps the compact header.
                classList={{ "min-h-6": isTouch() }}
                data-testid="inspector-ports-elsewhere-toggle"
                onClick={() => setElsewhereOpen((open) => !open)}
              >
                <ChevronRightIcon
                  class={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${elsewhereOpen() ? "rotate-90" : ""}`}
                />
                <span>elsewhere on this host</span>
                <span class="tabular-nums text-fg-3/50">
                  · {groups().elsewhere.length}
                </span>
              </button>
              <Key each={elsewhereShown()} by={(row) => row.port}>
                {renderRow}
              </Key>
              <Show when={elsewhereFolded() > 0 && elsewhereShown().length > 0}>
                <span class="pl-4 text-[10px] text-fg-3/50">
                  +{elsewhereFolded()} more
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </Section>
    </Show>
  );
};

export default PortsSection;
