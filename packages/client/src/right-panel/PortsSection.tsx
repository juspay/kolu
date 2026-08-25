/** The Inspector's **Ports** section — "what is this terminal serving?", and one
 *  click from the page.
 *
 *  ONE list. Every row is a listening TCP port padi's scanner attributed to this
 *  terminal's process subtree, joined to the door kolu holds for it if there is
 *  one; this host's other doors — a ⌘K forward, or one whose listener died
 *  before the reap — trail the list rather than getting a heading of their own.
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

import { activeArm } from "@kolu/padi-client/surface";
import { hostKeysEqual as sameHost } from "kolu-common/hostKey";
import {
  foldPorts,
  knownPorts,
  samePortList,
  type TerminalId,
} from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { rowAction } from "../forwards/portAction";
import { portRows } from "../forwards/portRows";
import { servingLink } from "../forwards/terminalServingPort";
import { forwardsForHost, viewerHost } from "../forwards/useForwards";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Section from "../ui/Section";
import { activeHost } from "../wire";
import { PortRow } from "./PortRow";

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

  /** Every PANE of every tile on this host, as the port join needs them — panes
   *  and not tiles, because a dev server almost always runs in a split and the
   *  scanner attributes the port to the split's own subtree.
   *  `servingLink` folds the answer back to the tile.
   *
   *  A memo, not a plain function: it is read once per row inside a `<For>`, and
   *  rebuilding every pane's metadata read per row is O(rows × terminals). */
  const servingCandidates = createMemo(() =>
    store.terminalIds().flatMap((tileId) =>
      store.getTilePaneIds(tileId).flatMap((paneId) => {
        const arm = activeArm(store.getMetadata(paneId));
        // `parentId` here is the CONTAINING TILE (root), not the true one-hop
        // parent — the port join returns the tile the user can activate.
        return arm === undefined
          ? []
          : [
              {
                id: paneId,
                parentId: paneId === tileId ? null : tileId,
                ports: arm.ports,
              },
            ];
      }),
    ),
  );

  /** Is the browser sitting at the machine this host IS? One fact about the
   *  PAGE, so it is derived once per host change rather than inside every row.
   *  A `null` viewer host is "kolu cannot tell", which must read as NOT a match
   *  — that keeps the forward, which works. */
  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  /** WHICH terminal an "also forwarded on this host" row belongs to, and how to
   *  reach it. Only the TRAILING group gets this: a main port row is already a
   *  port of the terminal you are inspecting, so naming it would name the thing
   *  on screen and the jump would go nowhere you are not. */
  const servingFor = (port: number) =>
    servingLink({
      port,
      candidates: servingCandidates(),
      armOf: (id) => {
        const arm = activeArm(store.getMetadata(id));
        return arm === undefined
          ? undefined
          : { git: arm.git ?? null, cwd: arm.cwd };
      },
      activate: (id) => store.activate(id),
    });

  /** The ONE list: what this terminal serves, joined to the doors kolu holds,
   *  plus this host's doors that match no scanned port. Two titled groups used
   *  to render a forwarded port twice; the join is in `portRows` so its ordering
   *  and host scoping are pinned without a DOM. */
  const rows = createMemo(() =>
    portRows({
      ports: ports(),
      forwards: forwardsForHost(host()),
    }),
  );
  return (
    <Show when={rows().length > 0}>
      <Section title="Ports">
        <div class="flex flex-col" data-testid="inspector-ports">
          <For each={rows()}>
            {(row) => {
              const decided = () =>
                rowAction({
                  row,
                  onKoluHost: isActiveHostLocal(),
                  viewerOnHost: viewerOnHost(),
                });
              return (
                <PortRow
                  row={row}
                  host={host()}
                  serving={
                    row.kind === "orphan" ? servingFor(row.port) : undefined
                  }
                  action={decided().action}
                  forwardReason={decided().reason}
                />
              );
            }}
          </For>
        </div>
      </Section>
    </Show>
  );
};

export default PortsSection;
