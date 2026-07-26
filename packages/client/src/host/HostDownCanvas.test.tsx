// @vitest-environment happy-dom
/** The host-down card SURFACES the failed episode's retained output instead of dropping it.
 *
 * The regression this pins: `'nix build' exited with code 1` was the ENTIRE diagnostic the
 * card showed for a remote host whose provisioning failed. The build's real error (a `tsc`
 * failure) had been collected by the session, retained in its bounded tail, deliberately
 * carried forward into the `failed` arm (`setDown`'s `log: prev.log`), and shipped to the
 * browser — and then dropped unread at the card, which took only `{cause, reason}`. So the
 * copy sent operators to check ssh reachability for what was a compile error.
 *
 * SCOPE (the `BootStalledCanvas.test.tsx` idiom): a COMPONENT render pin, not an App-`<Switch>`
 * integration test — `../wire` is mocked so the surface stack never boots. That App passes the
 * connection cell's `log` down is one line of wiring, deliberately not integration-tested here
 * (rendering App.tsx drags the whole live socket stack).
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

// Imported AFTER the mock so it binds the mocked `../wire`.
const { default: HostDownCanvas } = await import("./HostDownCanvas");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const mount = (props: {
  reason: string;
  log: readonly { readonly line: string }[];
}): void => {
  dispose = render(
    () => (
      <HostDownCanvas
        cause="link-failed"
        reason={props.reason}
        log={props.log}
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
    const tail = document.querySelector('[data-testid="failure-log"]');
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

  it("renders no tail block at all when the failure produced no output", () => {
    // Data absence, not a flag: a cause that never ran a build (a contract refusal)
    // renders exactly the pre-fix card.
    mount({ reason: "zest: another kolu owns this host", log: [] });
    expect(document.querySelector('[data-testid="failure-log"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="host-down-canvas"]'),
    ).not.toBeNull();
  });

  it("keeps the recovery verbs reachable below a full tail", () => {
    // The tail is bounded + scrollable precisely so it can never push these off-screen.
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
  });
});
