/**
 * A FAILED CALL SAYS WHY ONCE.
 *
 * The adapter reports a call twice: the arming frame carries its arguments, the
 * settling frame its answer — and for a failed call that answer is the error,
 * which the call's content already carries as the reason the card shows. So
 * the folded JSON under a failed call is what was ASKED, never the error again.
 */

import type { ConductorRow } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { Transcript } from "./transcript";

const ASKED = JSON.stringify({ command: "false" }, null, 2);
const ANSWER = JSON.stringify("exit 1", null, 2);

const detailOf = (rows: ReadonlyArray<ConductorRow>): string | undefined => {
  const row = rows.find((one) => one.kind === "tool");
  return row?.kind === "tool" ? row.detail : undefined;
};

/** One call, armed with its input, then settled with `status` and its answer. */
const settle = (
  status: "completed" | "failed",
  progress: string | undefined,
): ReadonlyArray<ConductorRow> => {
  const transcript = new Transcript();
  transcript.tool("c1", {
    title: "Bash",
    status: "in_progress",
    detail: ASKED,
    asked: ASKED,
  });
  transcript.tool("c1", {
    status,
    detail: ANSWER,
    progress,
  });
  return transcript.rows();
};

describe("the folded JSON of a call", () => {
  it("is what was asked once the call FAILED with a reason", () => {
    expect(detailOf(settle("failed", "```\nexit 1\n```"))).toBe(ASKED);
  });

  it("keeps the answer for a failure that said nothing else", () => {
    // Its answer is then the only place the error is.
    expect(detailOf(settle("failed", undefined))).toBe(ANSWER);
  });

  it("is the newest report for a call that did not fail", () => {
    expect(detailOf(settle("completed", "done"))).toBe(ANSWER);
  });
});
