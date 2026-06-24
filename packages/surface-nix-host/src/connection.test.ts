import { describe, expect, it } from "vitest";
import {
  CONNECTION_STATES,
  connectionCell,
  ConnectionInfoSchema,
  DEFAULT_CONNECTION,
} from "./connection.ts";
import { projectConnection } from "./connectionPipe.ts";
import type { HostSessionState } from "./hostSession.ts";

describe("connection cell", () => {
  it("is gate-closed by default (connecting) — a fresh cell never reads connected", () => {
    // The load-bearing invariant: a composed cell starts `connecting`, so
    // "healthy-empty before the first frame" is structurally unrepresentable.
    expect(DEFAULT_CONNECTION.state).toBe("connecting");
    expect(ConnectionInfoSchema.parse(DEFAULT_CONNECTION)).toEqual(
      DEFAULT_CONNECTION,
    );
    expect(connectionCell.default).toBe(DEFAULT_CONNECTION);
    expect(connectionCell.schema).toBe(ConnectionInfoSchema);
  });

  it("CONNECTION_STATES mirrors the HostSession lifecycle 1:1", () => {
    expect([...CONNECTION_STATES]).toEqual([
      "copying",
      "connecting",
      "connected",
      "disconnected",
      "failed",
    ]);
  });

  it("projectConnection keeps the browser-facing four, dropping the remote-only field", () => {
    const s: HostSessionState = {
      connection: "failed",
      progressLines: ["[local] gave up", "[remote] kaval 3.2 vs pulam 3.3"],
      remoteProgressLines: ["kaval 3.2 vs pulam 3.3"],
      lastError: "exited with code 1",
      failureCause: "remote",
    };
    const info = projectConnection(s);
    expect(info).toEqual({
      state: "failed",
      lastError: "exited with code 1",
      failureCause: "remote",
      progressLines: ["[local] gave up", "[remote] kaval 3.2 vs pulam 3.3"],
    });
    // The projection NARROWED `HostSessionState` — `remoteProgressLines` is not
    // on the browser-facing shape (and the result validates against the schema).
    expect("remoteProgressLines" in info).toBe(false);
    expect(ConnectionInfoSchema.parse(info)).toEqual(info);
  });
});
