// @vitest-environment happy-dom
/** The elsewhere list is a FILTER over the port join's rows, and the join
 *  re-runs on every host-listener, tile-port and forward tick. A filter that
 *  selects the same rows (the common case: none) still allocates a new array,
 *  so without an equality gate the memo republishes an equal-but-new value on
 *  every tick — which Solid's dev attribution reports as UNSTABLE_MEMO_OUTPUT
 *  (array) once four consecutive runs do it, and which re-checks the whole
 *  `<For>` downstream in the browser. */

import type { PortInfo, TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type * as HostTerminals from "../forwards/useHostTerminals";

const fixture = vi.hoisted(() => ({
  listeners: (() => ({ status: "unknown" })) as () => unknown,
  rowRenders: 0,
}));

const TILE = "tile-1" as TerminalId;
const PORT: PortInfo = {
  port: 5173,
  name: "node",
  command: "node",
  scope: "any",
  family: "v4",
};

// `sameSet` and `sameRows` are the REAL comparators — the two gates under
// test — so only the host reading is stubbed.
vi.mock("../forwards/useHostTerminals", async (importOriginal) => ({
  ...(await importOriginal<typeof HostTerminals>()),
  useHostTerminals: () => ({
    servingFor: () => undefined,
    tilePorts: () => [PORT],
    printedBy: () => new Set<number>(),
    printedOnHost: () => new Set<number>(),
  }),
}));
vi.mock("../forwards/useHostListeners", () => ({
  useHostListeners: () => () => fixture.listeners(),
}));
vi.mock("../forwards/useForwards", () => ({
  doorLocalPorts: () => new Set<number>(),
  forwardsForHost: () => [],
  viewerHost: () => null,
}));
vi.mock("../kaval/useDaemonStatus", () => ({ isActiveHostLocal: () => true }));
vi.mock("../useMobile", () => ({ isTouch: () => false }));
vi.mock("../wire", () => ({ activeHost: () => ({ kind: "local" }) }));
vi.mock("./PortRow", () => ({
  PortRow: (props: { row: { port: number } }) => {
    fixture.rowRenders++;
    return <div data-testid="port-row" data-port={props.row.port} />;
  },
}));

import PortsSection from "./PortsSection";

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("a host-listener tick that finds the same ports republishes no rows", () => {
  // Each tick is a FRESH reading with the same content — what the scanner
  // publishes every pass.
  const [tick, setTick] = createSignal(0);
  fixture.listeners = () => {
    tick();
    return {
      status: "known",
      claimed: [],
      unclaimed: { status: "known", list: [] },
    };
  };
  fixture.rowRenders = 0;

  const host = document.createElement("div");
  dispose = render(() => <PortsSection terminalId={TILE} />, host);
  expect(host.querySelectorAll('[data-testid="port-row"]').length).toBe(1);
  expect(fixture.rowRenders).toBe(1);

  for (let pass = 1; pass <= 5; pass++) {
    setTick(pass);
    flush();
  }

  // The tile's own row stays; nothing downstream re-rendered for a reading
  // that said the same thing.
  expect(host.querySelectorAll('[data-testid="port-row"]').length).toBe(1);
  expect(fixture.rowRenders).toBe(1);
});
