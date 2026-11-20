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

  const terminals = useHostTerminals();

  const ports = createMemo(
    () => terminals.tilePorts(props.terminalId),
    undefined,
    {
      equals: samePortList,
    },
  );

  const printedHere = createMemo(
    () => terminals.printedBy(props.terminalId),
    undefined,
    { equals: sameSet },
  );

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
      doorPorts: isActiveHostLocal() ? doorLocalPorts() : NO_PORTS,
    }),
  );

  const [elsewhereOpen, setElsewhereOpen] = createSignal(false);
  const elsewhereShown = createMemo(() =>
    elsewhereOpen()
      ? groups().elsewhere
      : groups().elsewhere.filter((row) => row.forward !== undefined),
  );
  const elsewhereFolded = () =>
    groups().elsewhere.length - elsewhereShown().length;

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
