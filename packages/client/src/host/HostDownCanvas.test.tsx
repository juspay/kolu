// @vitest-environment happy-dom
import type { HostKey } from "kolu-common/hostKey";
import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogLine } from "@kolu/solid-logtail";

type FailedEntry = {
  kind: "failed";
  failure: { cause: EntryFailedCause; reason: string };
  evidence: readonly LogLine[];
};
type OtherEntry = { kind: "not-a-member" };

const h = vi.hoisted(() => ({
  host: { kind: "ssh", host: "zest" } as unknown as HostKey,
  entry: {
    kind: "failed",
    failure: { cause: "host-setup-failed", reason: "" },
    evidence: [],
  } as FailedEntry | OtherEntry,
}));
vi.mock("../wire", () => ({
  activeHost: () => h.host,
  setActiveHost: () => {},
  client: { hosts: { reconnect: () => Promise.resolve() } },
}));
vi.mock("../kaval/useDaemonStatus", () => ({
  activeEntryState: () => h.entry,
  failedEpisode: (entry: FailedEntry | OtherEntry) =>
    entry.kind !== "failed"
      ? undefined
      : {
          cause: entry.failure.cause,
          reason: entry.failure.reason,
          log: entry.evidence,
        },
}));

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
  log: readonly LogLine[];
  cause?: EntryFailedCause;
}): void => {
  h.entry = {
    kind: "failed",
    failure: {
      cause: props.cause ?? "host-setup-failed",
      reason: props.reason,
    },
    evidence: props.log,
  };
  dispose = render(() => <HostDownCanvas />, document.body);
};

describe("HostDownCanvas surfaces the failed episode's output", () => {
  it("renders every retained line, so the cause is readable without a rebuild", () => {
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

  it("renders no tail block when the failure produced no output", () => {
    mount({ reason: "zest: another kolu owns this host", log: [] });
    expect(document.querySelector(TAIL)).toBeNull();
    expect(
      document.querySelector('[data-testid="host-down-canvas"]'),
    ).not.toBeNull();
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
    const cls = document.querySelector(TAIL)?.className ?? "";
    expect(cls).toContain("max-h-40");
    expect(cls).toContain("overflow-y-auto");
  });

  it("throws if mounted while the active entry isn't failed (fail loud, same as requireKind)", () => {
    h.entry = { kind: "not-a-member" };
    expect(() => render(() => <HostDownCanvas />, document.body)).toThrowError(
      /HostDownCanvas: entry is not-a-member/,
    );
  });
});
