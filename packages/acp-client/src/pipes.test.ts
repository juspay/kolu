/**
 * The ACP pipe's close is load-bearing for every live subprocess, and the
 * one place a dying child's leftover stdout used to throw
 * `Controller is already closed` into the test (and into a stopped
 * conversation). `deliveries.test.ts` is where that showed under full-suite
 * load; this file is the cause, without a subprocess.
 */

import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import { streamOver } from "./pipes.ts";

/** Enough of a child's stdio for {@link streamOver}: stdout as an emitter
 *  we can fire `data`/`end`/`error` on in any order, stdin as a sink. */
const fake = (): { stdout: EventEmitter } => {
  const stdout = new EventEmitter();
  const stdin = {
    write: (_chunk: unknown, cb?: (err?: Error | null) => void) => {
      cb?.(null);
      return true;
    },
    end: () => {},
    destroy: () => {},
  };
  streamOver({
    stdin: stdin as Writable,
    stdout: stdout as unknown as Readable,
  });
  return { stdout };
};

describe("a child's stdout after the controller has closed", () => {
  test("a chunk before end still lands, and does not throw", () => {
    const { stdout } = fake();
    expect(() =>
      stdout.emit(
        "data",
        Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n'),
      ),
    ).not.toThrow();
    stdout.emit("end");
  });

  test("a chunk after end does not throw", () => {
    const { stdout } = fake();
    stdout.emit("end");
    expect(() =>
      stdout.emit("data", Buffer.from('{"jsonrpc":"2.0"}\n')),
    ).not.toThrow();
  });

  test("a chunk after error does not throw", () => {
    const { stdout } = fake();
    stdout.emit("error", new Error("the pipe broke"));
    expect(() =>
      stdout.emit("data", Buffer.from('{"jsonrpc":"2.0"}\n')),
    ).not.toThrow();
  });

  test("end then error is close twice, and that is harmless", () => {
    const { stdout } = fake();
    stdout.emit("end");
    expect(() =>
      stdout.emit("error", new Error("and then it broke")),
    ).not.toThrow();
  });
});
