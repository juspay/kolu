/**
 * `@kolu/surface-app/connect` — the two PURE pieces of the client transport
 * assembly both kolu and drishti used to hand-roll: the `pid`-echo (URL-param
 * threading) and the stale-close → retire listener. These carry the real logic
 * and the footguns; `createSurfaceSocket` itself is thin glue over them plus one
 * `new PartySocket(...)` (verified by typecheck + the #410 e2e reconnect test —
 * a live partysocket in a Node unit test only flakes, so it's not constructed
 * here). Solid-free, like the kernel suite.
 */

import { shouldNotRetryORPCError } from "@kolu/surface/client";
import { describe, expect, it } from "vitest";
import { createProcessIdEcho, retireOnStaleClose } from "./connect";
import { STALE_PROCESS_CLOSE_CODE } from "./index";

describe("createProcessIdEcho", () => {
  it("is a no-op until an id is observed (the first-ever connect omits `pid`)", () => {
    const echo = createProcessIdEcho();
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws");
  });

  it("appends `?pid=` to a bare URL once an id is remembered", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p1");
  });

  it("appends `&pid=` when the base URL already carries a query (drishti's ?host=)", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    expect(echo.appendTo("ws://h/rpc/ws?host=zest")).toBe(
      "ws://h/rpc/ws?host=zest&pid=p1",
    );
  });

  it("url-encodes the id", () => {
    const echo = createProcessIdEcho();
    echo.remember("a b/c");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=a%20b%2Fc");
  });

  it("re-presents the LATEST observed id (each reconnect re-reads it)", () => {
    const echo = createProcessIdEcho();
    echo.remember("p1");
    echo.remember("p2");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p2");
  });

  it("its `remember` is safe to detach (closure-based, no `this`)", () => {
    const echo = createProcessIdEcho();
    const remember = echo.remember; // kolu re-exports this as `rememberServerProcessId`
    remember("p9");
    expect(echo.appendTo("ws://h/rpc/ws")).toBe("ws://h/rpc/ws?pid=p9");
  });
});

/** A socket reduced to what `retireOnStaleClose` touches: a single close listener
 *  we fire by hand, plus the `{ close, send }` `retireSocket` overwrites. */
function fakeSocket() {
  let listener: ((event: { code?: number }) => void) | undefined;
  let closed = 0;
  const ws = {
    addEventListener: (
      _type: "close",
      fn: (event: { code?: number }) => void,
    ) => {
      listener = fn;
    },
    close: () => {
      closed++;
    },
    send: (() => {}) as unknown,
  };
  return {
    ws,
    fire: (code?: number) => listener?.({ code }),
    closed: () => closed,
  };
}

describe("retireOnStaleClose", () => {
  it("retires the socket on the stale-close code (stop reconnect + fail sends)", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(STALE_PROCESS_CLOSE_CODE);
    expect(t.closed()).toBe(1);
    // `retireSocket` replaced `send` with a throwing stub — a post-stale send
    // rejects instead of buffering forever behind the reload overlay.
    expect(() => (t.ws.send as (d: string) => void)("x")).toThrow(/stale tab/);
  });

  it("ignores ordinary transient close codes (partysocket reconnects through them)", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(1006); // abnormal closure — a normal drop, not a restart
    expect(t.closed()).toBe(0);
    // send untouched — still the original no-op, does NOT throw.
    expect(() => (t.ws.send as (d: string) => void)("x")).not.toThrow();
  });

  it("retires with a NON-retriable error so STREAM_RETRY consumers settle", () => {
    const t = fakeSocket();
    retireOnStaleClose(t.ws, STALE_PROCESS_CLOSE_CODE);
    t.fire(STALE_PROCESS_CLOSE_CODE);
    let thrown: unknown;
    try {
      (t.ws.send as (d: string) => void)("x");
    } catch (err) {
      thrown = err;
    }
    const fence = shouldNotRetryORPCError as (a: { error: unknown }) => boolean;
    expect(fence({ error: thrown })).toBe(false);
  });
});
