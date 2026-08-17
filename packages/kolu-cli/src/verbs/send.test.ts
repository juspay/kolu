/**
 * `kolu send`'s SOURCE-resolution matrix, pinned.
 *
 * `send.ts` exports its pure halves with the stated reason that "the whole
 * matrix is testable without a socket, a filesystem or a tty" — a boundary
 * drawn FOR a property, which until now nothing checked. This cashes it.
 *
 * What is pinned here is the half that is genuinely argv's: which of the three
 * text sources (a positional, `--file`, piped stdin) a run reads, and the two
 * refusals that judgement carries. The other half — text-XOR-keys, the
 * unknown-key refusal, the auto-paste decision — is the shared send policy and
 * is pinned in `@kolu/terminal-protocol`'s `sendPolicy.test.ts`, beside the
 * implementation both faces call.
 */

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  planSend,
  resolveSendInput,
  sourceIsStream,
  sourceLabel,
} from "./send.ts";

const resolve = (opts: {
  hasPositional?: boolean;
  file?: string | undefined;
  stdinIsPayload?: boolean;
  hasKeys?: boolean;
  submit?: boolean;
  settleMs?: number;
  submitTimeout?: number;
}) =>
  Effect.runSyncExit(
    resolveSendInput({
      hasPositional: opts.hasPositional ?? false,
      file: opts.file,
      stdinIsPayload: opts.stdinIsPayload ?? false,
      hasKeys: opts.hasKeys ?? false,
      submit: opts.submit ?? false,
      settleMs: opts.settleMs,
      submitTimeout: opts.submitTimeout,
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
    expect(resolve({ stdinIsPayload: true })).toEqual(
      Exit.succeed({ kind: "stdin" }),
    );
    // Keys-only is a legal send with NO text source.
    expect(resolve({ hasKeys: true })).toEqual(Exit.succeed({ kind: "none" }));
  });

  it("refuses two sources rather than letting one silently win", () => {
    // Each of the three fully specifies the text; a precedence rule here would
    // be a guess the caller cannot see.
    const both = refusalOf(resolve({ hasPositional: true, file: "/tmp/b.md" }));
    expect(both).toContain("positional text");
    expect(both).toContain('--file "/tmp/b.md"');
    expect(both).toContain("pass exactly one source");
    expect(
      refusalOf(resolve({ file: "/tmp/b.md", stdinIsPayload: true })),
    ).toContain("piped stdin");
  });

  it("refuses text + --key — the dropped-Enter trap, made unspellable", () => {
    const refusal = refusalOf(resolve({ hasPositional: true, hasKeys: true }));
    expect(refusal).toContain("text and --key can't be combined");
    // The fix has to be runnable, not just described.
    expect(refusal).toContain("kolu send <id> --key Enter");
  });

  it("refuses a BLANK --file by name, before it is ever opened", () => {
    // `--file "$BRIEF"` with `$BRIEF` unset. Read instead of refused, it comes
    // back as `--file "": no such file` — which sends the reader looking for a
    // file rather than for the variable that did not expand. The whitespace case
    // is the same accident with a quoted space, and `isBlank` (shared with
    // `endpointOf`'s blank-endpoint refusal) says so for both.
    for (const file of ["", " "]) {
      const refusal = refusalOf(resolve({ file }));
      expect(refusal).toContain("--file");
      expect(refusal).toContain("empty value");
    }
  });

  it("refuses a send with nothing to do", () => {
    // A 0-byte no-op that exited 0 would read, to the loop above it, exactly
    // like a send that worked.
    expect(refusalOf(resolve({}))).toContain("nothing to send");
  });
});

describe("the source descriptor", () => {
  it("marks --file and piped stdin as STREAM payloads, the other two not", () => {
    // This is what makes a single-line `--file` still auto-paste: a file is one
    // payload, not a line typed at a prompt.
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
    // The refusal itself is the shared policy's (rule 4, pinned in
    // `sendPolicy.test.ts` for both faces). What is argv's — and what this pins —
    // is the wiring that makes it read the way it always has: the `--file` label
    // with its path, and `--key` rather than the MCP face's bare `key`. An empty
    // `--file` / pipe / `kolu send <id> ""` must not become a 0-byte "sent".
    const exit = Effect.runSyncExit(
      planSend({
        kind: "text",
        text: "",
        sourceLabel: sourceLabel({ kind: "file", path: "/tmp/b.md" }),
        paste: undefined,
        fromStream: true,
      }),
    );
    // The WHOLE stderr line, prefix and newline included — this sentence is
    // pinned, so a paraphrase of it is a defect.
    expect(refusalOf(exit)).toBe(
      'kolu: nothing to send — --file "/tmp/b.md" is empty. A 0-byte send is a no-op that would hide whatever produced the empty payload; pass non-empty text, or use --key to send a key.\n',
    );
  });
});

describe("resolveSendInput — the --submit gates", () => {
  // Both refuse a flag the user SPELLED that would otherwise have been ignored
  // — the same rule `--repo` without `--worktree` obeys one verb over — and both
  // fire BEFORE the dial, so a typo never provisions a cold `--host`.
  it("--submit with a text source resolves", () => {
    expect(Exit.isSuccess(resolve({ hasPositional: true, submit: true }))).toBe(
      true,
    );
    expect(
      Exit.isSuccess(
        resolve({ file: "/tmp/brief.md", submit: true, settleMs: 3000 }),
      ),
    ).toBe(true);
  });

  it("--submit with no text is refused — a key press has nothing to submit", () => {
    expect(refusalOf(resolve({ hasKeys: true, submit: true }))).toMatch(
      /--submit has nothing to submit/,
    );
    // …and a `--submit` with NOTHING at all keeps the older, more useful
    // sentence: the missing piece is a text source, not the submit flag, and
    // that gate names all four ways to supply one.
    expect(refusalOf(resolve({ submit: true }))).toMatch(/nothing to send/);
  });

  it("--settle-ms without --submit is refused, never ignored", () => {
    expect(refusalOf(resolve({ hasPositional: true, settleMs: 3000 }))).toMatch(
      /--settle-ms is --submit's quiet window/,
    );
  });

  it("the older combination rules still decide first", () => {
    // `--submit` must not become a second door around the text-XOR-key trap or
    // the two-sources conflict: those are refused before the submit gates run.
    expect(
      refusalOf(resolve({ hasPositional: true, hasKeys: true, submit: true })),
    ).toMatch(/can't be combined/);
  });
});

describe("resolveSendInput — --submit-timeout obeys the same rule as --settle-ms", () => {
  it("is legal with --submit and refused without it", () => {
    expect(
      Exit.isSuccess(
        resolve({ hasPositional: true, submit: true, submitTimeout: 5000 }),
      ),
    ).toBe(true);
    expect(
      refusalOf(resolve({ hasPositional: true, submitTimeout: 5000 })),
    ).toMatch(/--submit-timeout is --submit's give-up bound/);
  });
});
