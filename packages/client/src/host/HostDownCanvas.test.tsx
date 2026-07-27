// @vitest-environment happy-dom
/** The host-down card SURFACES the failed episode's retained output instead of dropping it —
 * the regression `HostDownCanvas.tsx`'s header tells in full.
 *
 * SCOPE (the `BootStalledCanvas.test.tsx` idiom): a COMPONENT render pin, not an App-`<Switch>`
 * integration test — `../wire` is mocked so the surface stack never boots. That App reads the
 * whole failed episode as one value is one accessor of wiring, deliberately not
 * integration-tested here (rendering App.tsx drags the whole live socket stack).
 */

import type { HostKey } from "kolu-common/hostKey";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { kind: "ssh", host: "zest" } as unknown as HostKey,
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: () => Promise.resolve() } },
}));

import type { LogLine } from "../ui/logTailChrome";

// Imported AFTER the mock so it binds the mocked `../wire`.
const { default: HostDownCanvas } = await import("./HostDownCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const TAIL = '[data-testid="host-down-log"]';

const mount = (props: {
  reason: string;
  log: readonly LogLine[] | undefined;
}): void => {
  dispose = render(
    () => (
      <HostDownCanvas
        failure={{ cause: "link-failed", reason: props.reason, log: props.log }}
      />
    ),
    document.body,
  );
};

describe("HostDownCanvas surfaces the failed episode's output", () => {
  it("renders every retained line, so the cause is readable without a rebuild", () => {
    // The real tail from the zest provisioning failure this fix came from: the one-line
    // `reason` says only that nix exited 1; the `nix log` pointer is what names the cause.
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: [
        { line: " ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  kolu-client typecheck" },
        { line: "For full logs, run:" },
        { line: "  nix log /nix/store/25f3nqdl-kolu-typecheck-2.0.0.drv" },
      ],
    });
    const tail = document.querySelector(TAIL);
    expect(tail).not.toBeNull();
    // Every line, not a truncated head — the useful one is usually last.
    expect(tail?.textContent).toContain("ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL");
    expect(tail?.textContent).toContain(
      "nix log /nix/store/25f3nqdl-kolu-typecheck-2.0.0.drv",
    );
  });

  it("still shows the one-line reason alongside the tail", () => {
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: [{ line: "error: Cannot build '/nix/store/i8wlxn7a-kolu.drv'." }],
    });
    expect(document.body.textContent).toContain(
      "zest: 'nix build' exited with code 1",
    );
  });

  it("renders no tail block when there is no output to show", () => {
    // Data absence, not a flag: a cause that never ran a build (a contract refusal)
    // renders exactly the pre-fix card. `[]` and `undefined` are ONE case here — they
    // differ in MEANING ("there was none" vs "we cannot see it") but not in pixels, and
    // happy-dom can observe only the pixels. The distinction itself is pinned where it is
    // real: the card's `log` prop type, which forbids collapsing one into the other.
    for (const log of [[], undefined] as const) {
      mount({ reason: "zest: another kolu owns this host", log });
      expect(document.querySelector(TAIL)).toBeNull();
      expect(
        document.querySelector('[data-testid="host-down-canvas"]'),
      ).not.toBeNull();
      dispose?.();
      dispose = undefined;
      document.body.innerHTML = "";
    }
  });

  it("keeps the recovery verbs reachable below a full tail", () => {
    mount({
      reason: "zest: 'nix build' exited with code 1",
      log: Array.from({ length: 20 }, (_, i) => ({ line: `line ${i}` })),
    });
    expect(
      document.querySelector('[data-testid="host-reconnect"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="switch-to-local"]'),
    ).not.toBeNull();
    // happy-dom does no layout, so "below" is not observable — assert the CLASSES that
    // encode the invariant instead, which is what actually keeps a 20-line tail from
    // pushing the verbs off-screen.
    const cls = document.querySelector(TAIL)?.className ?? "";
    expect(cls).toContain("max-h-40");
    expect(cls).toContain("overflow-y-auto");
  });
});
