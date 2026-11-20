import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  planSend,
  resolveSendInput,
  sourceIsStream,
  sourceLabel,
  type StdinSource,
} from "./send.ts";

const resolve = (opts: {
  hasPositional?: boolean;
  file?: string | undefined;
  stdin?: StdinSource;
  hasKeys?: boolean;
}) =>
  Effect.runSyncExit(
    resolveSendInput({
      hasPositional: opts.hasPositional ?? false,
      file: opts.file,
      stdin: opts.stdin ?? "none",
      hasKeys: opts.hasKeys ?? false,
    }),
  );

const refusalOf = <A>(exit: Exit.Exit<A, { stderr: string }>): string => {
  if (!Exit.isFailure(exit))
    throw new Error("expected a refusal; it succeeded");
  return (Cause.squash(exit.cause) as { stderr: string }).stderr;
};

describe("resolveSendInput — exactly one text source", () => {
  it("names each single source", () => {
    expect(resolve({ hasPositional: true })).toEqual(
      Exit.succeed({ kind: "positional" }),
    );
    expect(resolve({ file: "/tmp/brief.md" })).toEqual(
      Exit.succeed({ kind: "file", path: "/tmp/brief.md" }),
    );
    expect(resolve({ stdin: "fifo" })).toEqual(Exit.succeed({ kind: "stdin" }));
    expect(resolve({ hasKeys: true })).toEqual(Exit.succeed({ kind: "none" }));
  });

  it("refuses two sources rather than letting one silently win", () => {
    const both = refusalOf(resolve({ hasPositional: true, file: "/tmp/b.md" }));
    expect(both).toContain("positional text");
    expect(both).toContain('--file "/tmp/b.md"');
    expect(both).toContain("pass exactly one source");
    expect(refusalOf(resolve({ file: "/tmp/b.md", stdin: "file" }))).toContain(
      "piped stdin",
    );
  });

  it("refuses text + --key — the dropped-Enter trap, made unspellable", () => {
    const refusal = refusalOf(resolve({ hasPositional: true, hasKeys: true }));
    expect(refusal).toContain("text and --key can't be combined");
    expect(refusal).toContain("kolu send <id> --key Enter");
  });

  it("refuses a BLANK --file by name, before it is ever opened", () => {
    for (const file of ["", " "]) {
      const refusal = refusalOf(resolve({ file }));
      expect(refusal).toContain("--file");
      expect(refusal).toContain("empty value");
    }
  });

  it("refuses a send with nothing to do", () => {
    expect(refusalOf(resolve({}))).toContain("nothing to send");
  });
});

describe("the source descriptor", () => {
  it("marks --file and piped stdin as STREAM payloads, the other two not", () => {
    expect(sourceIsStream({ kind: "file", path: "/tmp/b.md" })).toBe(true);
    expect(sourceIsStream({ kind: "stdin" })).toBe(true);
    expect(sourceIsStream({ kind: "positional" })).toBe(false);
    expect(sourceIsStream({ kind: "none" })).toBe(false);
  });

  it("names each source the same way in every message it appears in", () => {
    expect(sourceLabel({ kind: "positional" })).toBe("positional text");
    expect(sourceLabel({ kind: "file", path: "/tmp/b.md" })).toBe(
      '--file "/tmp/b.md"',
    );
    expect(sourceLabel({ kind: "stdin" })).toBe("piped stdin");
    expect(sourceLabel({ kind: "none" })).toBe("no text source");
  });
});

describe("planSend — this face's wiring into the shared policy", () => {
  it("refuses an empty payload with the SOURCE-named argv sentence", () => {
    const exit = Effect.runSyncExit(
      planSend({
        kind: "text",
        text: "",
        sourceLabel: sourceLabel({ kind: "file", path: "/tmp/b.md" }),
        paste: undefined,
        fromStream: true,
      }),
    );
    expect(refusalOf(exit)).toBe(
      'kolu: nothing to send — --file "/tmp/b.md" is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use --key to send a key.\n',
    );
  });
});
