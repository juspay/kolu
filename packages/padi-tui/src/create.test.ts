/**
 * `runCreate`'s command reconstruction — the `-- <argv>` a `create` launches in the
 * new terminal. The shell RE-PARSES the line, so the argv the user passed must
 * survive the round-trip: `shellJoin` re-quotes each token, never a bare
 * `argv.join(" ")` that would let the shell re-split a spaces/quotes/metachar token.
 */

import { TOPLEVEL_PLACEMENT } from "@kolu/padi-client/surface";
import { shellSplit } from "@kolu/shell-quote";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { PadiTuiClient } from "./connect.ts";
import { placementGate, runCreate } from "./create.ts";

/** A stub `PadiTuiClient` exposing just the verbs `runCreate` touches. `sendInput`
 *  records the raw PTY `data` so a test can assert exactly what the shell receives,
 *  and `create` records its whole PAYLOAD so a test can assert which keys are
 *  present — not merely their values. */
function stubClient(): {
  client: PadiTuiClient;
  sent: string[];
  created: Array<Record<string, unknown>>;
} {
  const sent: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  // A member call is an EFFECT now, so each stub returns a lazy description
  // rather than a promise — `Effect.sync` so the recording still happens when
  // (and only when) `runCreate` runs the call.
  const client = {
    surface: {
      lifecycle: {
        create: vi.fn((input: Record<string, unknown>) =>
          Effect.sync(() => {
            created.push(input);
            return { id: "t-new" };
          }),
        ),
        sendInput: vi.fn(({ data }: { id: string; data: string }) =>
          Effect.sync(() => {
            sent.push(data);
          }),
        ),
      },
      git: {
        worktreeCreate: vi.fn(() =>
          Effect.succeed({ path: "/wt", branch: "feat" }),
        ),
      },
    },
  } as unknown as PadiTuiClient;
  return { client, sent, created };
}

/** The argv a shell re-parsing the launched line recovers — strip the trailing
 *  `\r` the PTY write carries, then `shellSplit` (the exact inverse of the
 *  `shellJoin` `runCreate` uses). */
function relaunchedArgv(sent: string[]): string[] {
  expect(sent).toHaveLength(1);
  const line = sent[0];
  if (line === undefined) throw new Error("no input was sent");
  expect(line.endsWith("\r")).toBe(true);
  return shellSplit(line.slice(0, -1));
}

describe("runCreate — the launched command round-trips the argv", () => {
  it("preserves a single argument that carries spaces (a prompt)", async () => {
    const { client, sent } = stubClient();
    const argv = ["claude", "review this PR"];
    const result = await Effect.runPromise(
      runCreate(client, { placement: TOPLEVEL_PLACEMENT, argv }),
    );

    // The shell recovers TWO tokens, not four — the prompt stays one argument.
    expect(relaunchedArgv(sent)).toEqual(argv);
    // `ran` is the quoted, copy-pasteable line (what `create` echoes to the user).
    expect(result.ran).toBe(`claude 'review this PR'`);
  });

  it("preserves quotes, `$`, `*`, `;` and other shell metacharacters", async () => {
    const { client, sent } = stubClient();
    const argv = ["sh", "-c", `echo "$HOME"/* ; rm -rf 'a b'`];
    await Effect.runPromise(
      runCreate(client, { placement: TOPLEVEL_PLACEMENT, argv }),
    );
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("preserves an empty argument", async () => {
    const { client, sent } = stubClient();
    const argv = ["cmd", "", "tail"];
    await Effect.runPromise(
      runCreate(client, { placement: TOPLEVEL_PLACEMENT, argv }),
    );
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("sends nothing when no argv was given (a bare terminal)", async () => {
    const { client, sent } = stubClient();
    const result = await Effect.runPromise(
      runCreate(client, { placement: TOPLEVEL_PLACEMENT, argv: [] }),
    );
    expect(sent).toHaveLength(0);
    expect(result.ran).toBeUndefined();
  });
});

describe("runCreate — the create payload states placement and OMITS absent optional keys", () => {
  // `PadiCreateInputSchema` spells `cwd` with `Schema.optionalKey`
  // (PLAN #17, the law for every wire field zod used to `.optional()`), which —
  // unlike zod — REFUSES an explicit `undefined` rather than round-tripping it
  // through `null`. So a `{ cwd }` shorthand here would encode-fail on
  // the wire for the commonest create of all. `Object.keys`, not
  // `toEqual`/`toHaveBeenCalledWith`: those treat an `undefined`-valued key as
  // absent, which is exactly the distinction under test.
  //
  // `placement` is the counter-case in the same test: it is REQUIRED, so it is
  // present on EVERY payload — including the bare create that carries nothing
  // else. That is the whole no-default rule, read off the wire payload.
  it("omits cwd when it was not chosen, and still states placement", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, { placement: TOPLEVEL_PLACEMENT, argv: [] }),
    );
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0] ?? {})).toEqual(["placement"]);
    expect(created[0]).toEqual({ placement: { kind: "toplevel" } });
  });

  it("carries a split's parent inside the placement, not as a loose key", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, {
        placement: { kind: "child-of", parentId: "t-parent" as TerminalId },
        argv: [],
      }),
    );
    expect(created[0]).toEqual({
      placement: { kind: "child-of", parentId: "t-parent" },
    });
  });

  it("takes cwd from the materialized worktree, not the caller's", async () => {
    const { client, created } = stubClient();
    await Effect.runPromise(
      runCreate(client, {
        placement: TOPLEVEL_PLACEMENT,
        argv: [],
        cwd: "/local",
        worktree: { repoPath: "/repo", name: "feat" },
      }),
    );
    expect(created[0]).toEqual({
      placement: { kind: "toplevel" },
      cwd: "/wt",
    });
  });
});

describe("placementGate — padi-tui's PRE-DIAL wiring of the shared rule", () => {
  /** The gate's refusal sentence, or `""` if it let the flags through. Driven as
   *  a value: the gate is pure, so `runSyncExit` settling it at all is the proof
   *  that no socket was needed to reach the answer. */
  const refusalOf = (flags: {
    toplevel: boolean;
    parent: string | undefined;
  }): string => {
    const exit = Effect.runSyncExit(placementGate(flags));
    return Exit.isFailure(exit)
      ? ((Cause.squash(exit.cause) as { readonly stderr?: string }).stderr ??
          "")
      : "";
  };

  // WHY this file and not `main.ts`: `main.ts` calls `cli(…)` at module scope, so
  // importing it parses `process.argv` and nothing in it is reachable from a test.
  // `kolu create`'s equivalent gate is pinned through its own `run`; this one was
  // pinned nowhere, which is the asymmetry these cases close. The DECISION itself
  // is `@kolu/padi/render`'s and is pinned in `placementFlags.test.ts` — what is
  // under test here is that this face is wired to it, with its own name on it.

  it("refuses a bare `padi-tui create`, naming THIS command", () => {
    const text = refusalOf({ toplevel: false, parent: undefined });
    expect(text).toContain("--toplevel");
    expect(text).toContain("--parent <id>");
    // The face's own name, not its sibling's — the one thing the shared parse
    // takes a parameter for. A padi-tui user told to type `kolu create` would be
    // told to run a different program.
    expect(text).toContain("`padi-tui create --toplevel`");
    expect(text).not.toContain("kolu create");
  });

  it("refuses BOTH flags", () => {
    expect(refusalOf({ toplevel: true, parent: "3f9c" })).toContain(
      "mutually exclusive",
    );
  });

  it("refuses a BLANK --parent BEFORE the dial — the `--host` case", () => {
    // The gap this closes: a blank `--parent` used to read as a `child-of` arm,
    // so padi-tui dialed — and over `--host` that means Nix-provisioning a cold
    // box — before failing to resolve an empty id. `kolu create` never showed it,
    // because its own blank-flag gate fires first.
    expect(refusalOf({ toplevel: false, parent: "" })).toContain(
      "--parent was passed with an empty value",
    );
  });

  it("passes exactly one flag through as its arm, touching no client", () => {
    // `runSyncExit` cannot complete an effect that awaits I/O, so a SUCCESS here
    // is itself the proof the gate is pure and pre-dial.
    expect(
      Effect.runSync(placementGate({ toplevel: true, parent: undefined })),
    ).toEqual({ kind: "toplevel" });
    expect(
      Effect.runSync(placementGate({ toplevel: false, parent: "3f9c" })),
    ).toEqual({ kind: "child-of", parentQuery: "3f9c" });
  });
});
