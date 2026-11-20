import { describe, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import { streamOver } from "./pipes.ts";

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
