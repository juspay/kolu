import { describe, expect, it } from "vitest";
import { failureDocument } from "./childFailure.ts";

/**
 * The document-bearing-failure rule, at the one point two rules disagreed.
 *
 * The binary's total-failure path is "write the V line and its E rows, then
 * exit 1", and that document is the only place the answer to *which source
 * went blind* exists. It must survive the non-zero exit — and it must NOT
 * survive a child that a signal cut off mid-write, whose stdout is a fragment.
 */
describe("failureDocument", () => {
  const document = "V\t2\nE\tproc_readdir\tproc\tEACCES\n";

  it("keeps a COMPLETE exit-1 document that the timeout also flagged as killed", () => {
    // The race: the command timeout fires and calls `kill()`, but the child had
    // ALREADY exited 1 on its own. Node then reports `killed: true` with
    // `signal: null` and a whole document on stdout. A `killed` rule discards
    // it — losing exactly the E rows this function exists to preserve.
    expect(
      failureDocument({
        code: 1,
        killed: true,
        signal: null,
        stdout: document,
      }),
    ).toBe(document);
  });

  it("discards a document from a child a SIGNAL ended — it may be truncated", () => {
    expect(
      failureDocument({
        code: null,
        killed: true,
        signal: "SIGKILL",
        stdout: document,
      }),
    ).toBeUndefined();
    // The sync twin's spelling of the same fact.
    expect(
      failureDocument({ status: null, signal: "SIGKILL", stdout: document }),
    ).toBeUndefined();
  });

  it("refuses a usage-error document (exit 2), which is the CLI refusing the ask", () => {
    expect(failureDocument({ code: 2, stdout: "V\t2\n" })).toBeUndefined();
  });
});
