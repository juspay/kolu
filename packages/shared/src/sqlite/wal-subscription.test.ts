import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_APPEND_POLL_MS } from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalSubscription } from "./wal-subscription.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const overOneInterval = () => sleep(DEFAULT_APPEND_POLL_MS + 400);

let tmp: string;
let restoreWatch: () => void;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-wal-floor-"));
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
    fs.writeFileSync(dbPath, "");
    fs.writeFileSync(walPath, "frame0\n");

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

    fs.appendFileSync(walPath, "frame1\n");
    await overOneInterval();

    expect(onChange).toHaveBeenCalled();
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
