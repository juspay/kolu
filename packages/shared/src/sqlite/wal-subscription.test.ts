/**
 * WAL subscription — the append-robust floor recovers a dropped WAL edge
 * (juspay/kolu#1754, covering codex + opencode, which both route through
 * `createWalSubscription`).
 *
 * A SQLite WAL frame append is the same class of change as a transcript/events
 * append: if its `fs.watch` edge is dropped/coalesced and no further write
 * follows, the codex/opencode tile strands on its last state. Here we suppress
 * ALL `fs.watch` edges (both the direct WAL watch and the parent-dir rearm
 * watch) with a no-op shim, leaving the real `statSync` poll floor inside
 * `subscribeFileAppends` as the only recovery path — and prove it fires
 * `onChange` after a dropped WAL append with no edge.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testutil";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalSubscription } from "./wal-subscription.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** > one poll interval (DEFAULT_APPEND_POLL_MS = 1000 ms) + margin. */
const overOneInterval = () => sleep(1400);

let tmp: string;
let restoreWatch: () => void;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wal-floor-"));
  // Drop every fs.watch edge — the statSync poll floor must recover on its own.
  restoreWatch = suppressFsWatchEdges();
});

afterEach(() => {
  restoreWatch();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createWalSubscription — floor recovers a dropped WAL append", () => {
  it("fires onChange after a WAL append when every edge is dropped", async () => {
    const dbPath = path.join(tmp, "state.sqlite");
    const walPath = `${dbPath}-wal`;
    fs.writeFileSync(dbPath, ""); // the main DB
    fs.writeFileSync(walPath, "frame0\n"); // WAL exists at subscribe

    const onChange = vi.fn();
    const { subscribe } = createWalSubscription({
      dbPath,
      walPath,
      label: "test",
    });
    const unsubscribe = subscribe(
      onChange,
      (err) => {
        throw err;
      },
      undefined,
    );

    // A WAL frame lands after attach; its fs.watch edge is dropped.
    fs.appendFileSync(walPath, "frame1\n");
    await overOneInterval();

    expect(onChange).toHaveBeenCalled(); // the statSync poll floor recovered it
    unsubscribe();
  });

  it("does not fire on an idle WAL (no churn)", async () => {
    const dbPath = path.join(tmp, "idle.sqlite");
    const walPath = `${dbPath}-wal`;
    fs.writeFileSync(dbPath, "");
    fs.writeFileSync(walPath, "frame0\n");

    const onChange = vi.fn();
    const { subscribe } = createWalSubscription({
      dbPath,
      walPath,
      label: "test",
    });
    const unsubscribe = subscribe(onChange, () => {}, undefined);

    await overOneInterval();

    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });
});
