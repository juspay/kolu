/**
 * The diff blocks, over values.
 *
 * The payloads are the protocol's own (`ToolCallContent`), as the Claude Code
 * adapter sends them for an `Edit` or a `Write`: an absolute path, the text
 * that was there — absent for a file being created — and the text that is there
 * now. What is worth testing without a subprocess is the reading itself, which
 * is the one place a file being rewritten can be lost: the wire carries what
 * this returns, and a diff dropped here is a change the panel never hears about.
 */

import type { ToolCallContent } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";

import { diffsOf, relativeTo } from "./diffs.ts";

const ROOT = "/home/somebody/notes";

const edit = (
  path: string,
  oldText: string | null,
  newText: string,
): ToolCallContent =>
  ({
    type: "diff",
    path,
    ...(oldText === null ? {} : { oldText }),
    newText,
  }) as ToolCallContent;

const said = (text: string): ToolCallContent =>
  ({ type: "content", content: { type: "text", text } }) as ToolCallContent;

describe("the files a call rewrote", () => {
  test("a diff block travels as a path and two texts", () => {
    expect(diffsOf([edit(`${ROOT}/plan.md`, "one\n", "two\n")], ROOT)).toEqual([
      { path: "plan.md", oldText: "one\n", newText: "two\n" },
    ]);
  });

  test("a file that did not exist says so, rather than reading as empty", () => {
    // The protocol omits `oldText` for a new file. `null` is the one spelling
    // that reaches the panel, and it is what lets the panel say NEW rather
    // than draw a diff against an empty file that never existed.
    expect(
      diffsOf([edit(`${ROOT}/new.md`, null, "hello\n")], ROOT)?.[0]?.oldText,
    ).toBeNull();
  });

  test("every diff in one report travels, in the order it was sent", () => {
    const diffs = diffsOf(
      [
        edit(`${ROOT}/a.md`, "a", "A"),
        said("working"),
        edit(`${ROOT}/b.md`, "b", "B"),
      ],
      ROOT,
    );
    expect(diffs?.map((diff) => diff.path)).toEqual(["a.md", "b.md"]);
  });

  test("a report with no diff in it says nothing rather than nothing-changed", () => {
    // `undefined` is "this report did not mention diffs", which is what keeps
    // a completion frame — status and nothing else — from taking the diff off
    // a row somebody is reading. An empty array would say the opposite.
    expect(diffsOf([said("still working")], ROOT)).toBeUndefined();
    expect(diffsOf([], ROOT)).toBeUndefined();
    expect(diffsOf(null, ROOT)).toBeUndefined();
  });
});

describe("how a path reads", () => {
  test("a file under the served directory is root-relative", () => {
    expect(relativeTo(ROOT, `${ROOT}/docs/chat.md`)).toBe("docs/chat.md");
    expect(relativeTo(`${ROOT}/`, `${ROOT}/docs/chat.md`)).toBe("docs/chat.md");
    expect(relativeTo(`${ROOT}///`, `${ROOT}/docs/chat.md`)).toBe(
      "docs/chat.md",
    );
  });

  test("a file somewhere else is left exactly as it came", () => {
    // Shortening it would say it was in the directory being served, which is
    // the one thing the reader would be relying on it not to say.
    expect(relativeTo(ROOT, "/etc/hosts")).toBe("/etc/hosts");
    // A sibling directory whose name merely starts the same way.
    expect(relativeTo(ROOT, `${ROOT}-old/plan.md`)).toBe(`${ROOT}-old/plan.md`);
  });

  test("the empty root leaves the path exactly as it came", () => {
    // Trimmed to nothing — `/`, `///`, or already empty — is not a prefix of
    // anything, so the path is untouched. The doc comment is the contract.
    expect(relativeTo("", "/foo/bar.md")).toBe("/foo/bar.md");
    expect(relativeTo("/", "/foo/bar.md")).toBe("/foo/bar.md");
    expect(relativeTo("///", "/foo/bar.md")).toBe("/foo/bar.md");
  });

  test("a long run of slashes that does not end the cwd is answered at once", () => {
    // The reason this counts rather than matching: `replace(/\/+$/, "")` is
    // polynomial on a string of many slashes that do not end it, and cwd is
    // protocol input (`js/polynomial-redos`, CodeQL alert 15). A tenth of a
    // second here would be a finding.
    const started = performance.now();
    const cwd = "/".repeat(50_000) + "x";
    expect(relativeTo(cwd, `${ROOT}/plan.md`)).toBe(`${ROOT}/plan.md`);
    expect(performance.now() - started).toBeLessThan(100);
  }, 500);
});
