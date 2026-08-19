import { describe, expect, it } from "vitest";
import { createXtermBridge } from "./xtermBridge";

describe("createXtermBridge", () => {
  it("does not publish at construct — onReady is not a snapshot", () => {
    const el = document.createElement("div");
    const term = { cols: 80, rows: 24 };
    const bridge = createXtermBridge(el, term);
    expect(bridge.published).toBe(false);
    expect(
      (el as HTMLElement & { __xterm?: typeof term }).__xterm,
    ).toBeUndefined();
  });

  it("publishes the live term only after a snapshot has landed", () => {
    const el = document.createElement("div");
    const term = { cols: 100, rows: 15 };
    const bridge = createXtermBridge(el, term);
    // A delta / stale refusal / pre-attach tick must not publish.
    expect(
      (el as HTMLElement & { __xterm?: typeof term }).__xterm,
    ).toBeUndefined();
    bridge.onSnapshotLanded();
    expect(bridge.published).toBe(true);
    expect((el as HTMLElement & { __xterm?: typeof term }).__xterm).toBe(term);
    expect((el as HTMLElement & { __xterm?: typeof term }).__xterm?.cols).toBe(
      100,
    );
  });

  it("is idempotent across overflow re-attach snapshots", () => {
    const el = document.createElement("div");
    const term = { cols: 80 };
    const bridge = createXtermBridge(el, term);
    bridge.onSnapshotLanded();
    bridge.onSnapshotLanded();
    expect((el as HTMLElement & { __xterm?: typeof term }).__xterm).toBe(term);
    bridge.clear();
    expect(
      (el as HTMLElement & { __xterm?: typeof term }).__xterm,
    ).toBeUndefined();
    expect(bridge.published).toBe(false);
  });
});
