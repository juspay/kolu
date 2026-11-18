import { describe, expect, test } from "vitest";
import { Terminals, tailBytes } from "./terminals.ts";

describe("terminal output", () => {
  test("byte limits do not split a UTF-8 code point", () => {
    expect(tailBytes("old 🌍éEND", 7)).toEqual({
      output: "éEND",
      truncated: true,
    });
    expect(tailBytes("🌍", 4)).toEqual({ output: "🌍", truncated: false });
    expect(tailBytes("abc", 0)).toEqual({ output: "", truncated: true });
  });
  test("the client retains output after release and rejects stale or foreign handles", async () => {
    const terms = new Terminals(() => {}, process.cwd());
    const { terminalId } = terms.create({
      sessionId: "one",
      command: process.execPath,
      args: [
        "-e",
        'process.stdout.write("hello"); process.stderr.write("error"); process.exitCode=7',
      ],
    });
    const params = { sessionId: "one", terminalId };
    try {
      expect(() => terms.output({ ...params, sessionId: "two" })).toThrow();
      expect(await terms.wait(params)).toEqual({ exitCode: 7, signal: null });
      expect(terms.output(params).output).toContain("hello");
      expect(terms.output(params).output).toContain("error");
      expect(terms.clientOwned(terminalId)).toBe(true);
      await terms.release(params);
      expect(terms.clientOwned(terminalId)).toBe(true);
      expect(() => terms.output(params)).toThrow();
      expect(terms.view(terminalId).exitCode).toBe(7);
      expect(terms.view(terminalId).output).toContain("hello");
    } finally {
      await terms.clear();
    }
    expect(terms.clientOwned(terminalId)).toBe(false);
  });
  test("cancel stops a running command but leaves the handle available", async () => {
    const terms = new Terminals(() => {}, process.cwd());
    const params = {
      sessionId: "one",
      ...terms.create({
        sessionId: "one",
        command: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      }),
    };
    try {
      await terms.cancel();
      expect((await terms.wait(params)).signal).toBe("SIGTERM");
      expect(terms.output(params).exitStatus?.signal).toBe("SIGTERM");
    } finally {
      await terms.clear();
    }
  });
  test("failed spawns terminate and expose the reason", async () => {
    const terms = new Terminals(() => {}, process.cwd());
    const params = {
      sessionId: "one",
      ...terms.create({
        sessionId: "one",
        command: "/nonexistent/olai-command",
      }),
    };
    try {
      await terms.wait(params);
      expect(terms.output(params).output).toContain("ENOENT");
      expect(terms.view(params.terminalId).running).toBe(false);
    } finally {
      await terms.clear();
    }
  });
  test("clearing a session prevents late process output from recreating its views", async () => {
    const terms = new Terminals(() => {}, process.cwd());
    const params = {
      sessionId: "one",
      ...terms.create({
        sessionId: "one",
        command: process.execPath,
        args: ["-e", 'process.stdout.write("old"); setInterval(()=>{},1000)'],
      }),
    };
    await terms.clear();
    expect(() => terms.output(params)).toThrow();
    expect(terms.view(params.terminalId).output).toBe(
      "Terminal output is unavailable.",
    );
  });
});
