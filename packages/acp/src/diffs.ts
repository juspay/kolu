/**
 * The protocol's diff blocks, read as data.
 *
 * A tool call's content is a list of blocks and this file is about exactly one
 * kind of them: `diff`, which is a file being rewritten — a path, what was
 * there, and what is there now. Every other kind is somebody else's (the
 * harness's `progressOf`, which reads them for the one thing a line of a
 * transcript can show).
 *
 * It used to be read the same way as the rest and that is what this file
 * replaces: a diff block was flattened into the sentence `— <path>` in the
 * progress string, deliberately — "a unified diff in a folded frame is a page
 * of text where a line was wanted". That is the half that stopped being true
 * the moment a chat was the place a person watched an agent work: an edit the
 * agent makes shows up NOWHERE else in the panel, so the transcript naming the
 * path was the whole of what a person got, and the answer to "what did it
 * change" was a terminal.
 *
 * So the wire carries the diff STRUCTURED ({@link FileDiff}) and the panel
 * draws it. Nothing here computes a line diff: the two texts are what the
 * protocol sends and what a browser derives its rendering from, which keeps
 * this side free of a second diff implementation and keeps the client's one
 * where every other view-time derivation lives.
 *
 * PURE, and tested as such — the {@link ./asks.ts} pattern, for the same
 * reason: a reading of somebody else's payload is a function over a value, not
 * a branch reachable only by talking a subprocess into sending one.
 */

import type { ToolCallContent } from "@agentclientprotocol/sdk";

import type { FileDiff } from "./wire.ts";

/**
 * Every file this report says was rewritten, or `undefined` for a report that
 * rewrote none.
 *
 * `undefined` rather than an empty list, because that is what the tool event's
 * fields mean: a report carries the call's content AS IT STANDS, and a report
 * that carries no content at all is saying nothing about the diffs a previous
 * one announced. An empty array would say the opposite — that the call has
 * stopped rewriting anything — and the row would lose a diff somebody was
 * reading.
 */
export const diffsOf = (
  content: ReadonlyArray<ToolCallContent> | null | undefined,
  /** The served directory, so a path under it reads the way every other
   *  `file:line` in kolu does. */
  cwd: string,
): ReadonlyArray<FileDiff> | undefined => {
  if (content == null) return undefined;
  const diffs = content.flatMap((block) =>
    block.type === "diff"
      ? [
          {
            path: relativeTo(cwd, block.path),
            // The protocol's `oldText` is absent OR null for a file that did not
            // exist. One `null` on the wire, because "there was nothing here" is
            // one piece of news and a browser should not have to know two
            // spellings of it.
            oldText: block.oldText ?? null,
            newText: block.newText,
          },
        ]
      : [],
  );
  return diffs.length === 0 ? undefined : diffs;
};

/**
 * A path as a reader of THIS directory should see it: root-relative when it is
 * under the served directory, and exactly as it came otherwise.
 *
 * The protocol's paths are absolute, and an absolute one in a 26rem drawer is
 * mostly the reader's home directory. Untouched when it is somewhere else,
 * because a file outside the directory kolu serves is genuinely elsewhere and
 * shortening it would say it was not.
 *
 * String work rather than `node:path`: both sides are already absolute and
 * already normalised by whoever produced them, and the only question being
 * asked is whether one is under the other. Trailing slashes are counted off
 * rather than `replace(/\/+$/, "")` — the same linear spelling the chat
 * package uses for a stored session's `cwd`. An agent keeps the spelling it
 * was handed, and that spelling is protocol input (`js/polynomial-redos`).
 */
export const relativeTo = (cwd: string, path: string): string => {
  let end = cwd.length;
  while (end > 0 && cwd.charAt(end - 1) === "/") end -= 1;
  const root = cwd.slice(0, end);
  if (root === "" || !path.startsWith(`${root}/`)) return path;
  return path.slice(root.length + 1);
};
