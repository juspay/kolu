/**
 * `runCreate`'s command reconstruction — the `-- <argv>` a `create` launches in the
 * new terminal. The shell RE-PARSES the line, so the argv the user passed must
 * survive the round-trip: `shellJoin` re-quotes each token, never a bare
 * `argv.join(" ")` that would let the shell re-split a spaces/quotes/metachar token.
 */

import { shellSplit } from "@kolu/shell-quote";
import { describe, expect, it, vi } from "vitest";
import type { PadiTuiClient } from "./connect.ts";
import { runCreate } from "./create.ts";

/** A stub `PadiTuiClient` exposing just the verbs `runCreate` touches. `sendInput`
 *  records the raw PTY `data` so a test can assert exactly what the shell receives. */
function stubClient(): { client: PadiTuiClient; sent: string[] } {
  const sent: string[] = [];
  const client = {
    surface: {
      lifecycle: {
        create: vi.fn(async () => ({ id: "t-new" })),
        sendInput: vi.fn(async ({ data }: { id: string; data: string }) => {
          sent.push(data);
        }),
      },
      git: {
        worktreeCreate: vi.fn(async () => ({ path: "/wt", branch: "feat" })),
      },
    },
  } as unknown as PadiTuiClient;
  return { client, sent };
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
    const result = await runCreate(client, { argv });

    // The shell recovers TWO tokens, not four — the prompt stays one argument.
    expect(relaunchedArgv(sent)).toEqual(argv);
    // `ran` is the quoted, copy-pasteable line (what `create` echoes to the user).
    expect(result.ran).toBe(`claude 'review this PR'`);
  });

  it("preserves quotes, `$`, `*`, `;` and other shell metacharacters", async () => {
    const { client, sent } = stubClient();
    const argv = ["sh", "-c", `echo "$HOME"/* ; rm -rf 'a b'`];
    await runCreate(client, { argv });
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("preserves an empty argument", async () => {
    const { client, sent } = stubClient();
    const argv = ["cmd", "", "tail"];
    await runCreate(client, { argv });
    expect(relaunchedArgv(sent)).toEqual(argv);
  });

  it("sends nothing when no argv was given (a bare terminal)", async () => {
    const { client, sent } = stubClient();
    const result = await runCreate(client, { argv: [] });
    expect(sent).toHaveLength(0);
    expect(result.ran).toBeUndefined();
  });
});
