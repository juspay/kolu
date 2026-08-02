/** Wire-shape guards for the git schemas.
 *
 * These shapes cross process boundaries (browser ↔ kolu-server, and the
 * ssh-mirrored remote surface between builds), so the assertions here are on
 * the ENCODED BYTES — `JSON.stringify(Schema.encodeSync(S)(v))` — not just on
 * decode-equality. A field rename, a key-order change, or an `optionalKey`
 * silently becoming a nulled key would all pass a round-trip test and still
 * break a peer running a different build. */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  FsReadFileOutputSchema,
  GitChangedFileSchema,
  GitDiffOutputSchema,
  GitInfoSchema,
  GitStatusOutputSchema,
  isValidWorktreeName,
  WORKTREE_NAME_MESSAGE,
  WorktreeNameSchema,
} from "./schemas.ts";

/** Encode to the wire and render the exact bytes a peer would receive. */
function wire<A, E>(schema: Schema.Codec<A, E>, value: A): string {
  return JSON.stringify(Schema.encodeSync(schema)(value));
}

describe("GitInfo wire bytes", () => {
  it("encodes every field, with an explicit null remoteUrl", () => {
    expect(
      wire(GitInfoSchema, {
        repoRoot: "/repo",
        repoName: "repo",
        worktreePath: "/repo",
        branch: "master",
        isWorktree: false,
        mainRepoRoot: "/repo",
        remoteUrl: null,
      }),
    ).toBe(
      '{"repoRoot":"/repo","repoName":"repo","worktreePath":"/repo","branch":"master","isWorktree":false,"mainRepoRoot":"/repo","remoteUrl":null}',
    );
  });
});

describe("GitChangedFile wire bytes", () => {
  it("omits oldPath entirely when absent — never emits a null", () => {
    expect(wire(GitChangedFileSchema, { path: "a.ts", status: "M" })).toBe(
      '{"path":"a.ts","status":"M"}',
    );
  });

  it("carries oldPath for a rename", () => {
    expect(
      wire(GitChangedFileSchema, {
        path: "new.ts",
        status: "R",
        oldPath: "old.ts",
      }),
    ).toBe('{"path":"new.ts","status":"R","oldPath":"old.ts"}');
  });

  it("decodes a payload with no oldPath key at all", () => {
    expect(
      Schema.decodeUnknownSync(GitChangedFileSchema)({
        path: "a.ts",
        status: "?",
      }),
    ).toEqual({ path: "a.ts", status: "?" });
  });

  it("tolerates (and strips) a field a newer peer added — rolling deploy", () => {
    expect(
      Schema.decodeUnknownSync(GitChangedFileSchema)({
        path: "a.ts",
        status: "M",
        fieldFromANewerBuild: 1,
      }),
    ).toEqual({ path: "a.ts", status: "M" });
  });

  it("rejects an explicit `oldPath: undefined` — optionalKey means absent", () => {
    // Stricter than the zod schema this replaced, and deliberately so
    // (mapping law #17): an in-process caller must omit the key, not null
    // it out with `undefined`. Every producer here uses a conditional
    // spread, so no in-package path can hit this.
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(GitChangedFileSchema)({
          path: "a.ts",
          status: "M",
          oldPath: undefined,
        }),
      ),
    ).toBe(true);
  });

  it("rejects a status letter git never emits to the Code tab", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(GitChangedFileSchema)({
          path: "a.ts",
          status: "!",
        }),
      ),
    ).toBe(true);
  });
});

describe("GitStatusOutput wire bytes", () => {
  it("encodes the local arm with its branch header and section counts", () => {
    expect(
      wire(GitStatusOutputSchema, {
        mode: "local",
        files: [{ path: "a.ts", status: "M" }],
        branch: {
          name: "master",
          upstream: "origin/master",
          ahead: 1,
          behind: 0,
        },
        workingTree: { staged: 0, modified: 1, untracked: 2 },
      }),
    ).toBe(
      '{"mode":"local","files":[{"path":"a.ts","status":"M"}],"branch":{"name":"master","upstream":"origin/master","ahead":1,"behind":0},"workingTree":{"staged":0,"modified":1,"untracked":2}}',
    );
  });

  it("encodes the branch arm with a null base for a remote-less repo", () => {
    expect(
      wire(GitStatusOutputSchema, { mode: "branch", files: [], base: null }),
    ).toBe('{"mode":"branch","files":[],"base":null}');
  });

  it("decodes each arm back to the same discriminant", () => {
    const local = Schema.decodeUnknownSync(GitStatusOutputSchema)({
      mode: "local",
      files: [],
      branch: { name: "HEAD", upstream: null, ahead: 0, behind: 0 },
      workingTree: { staged: 0, modified: 0, untracked: 0 },
    });
    expect(local.mode).toBe("local");
    const branch = Schema.decodeUnknownSync(GitStatusOutputSchema)({
      mode: "branch",
      files: [],
      base: { ref: "origin/master", sha: "abc123" },
    });
    expect(branch.mode).toBe("branch");
  });

  it("rejects a local arm missing the branch header", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(GitStatusOutputSchema)({
          mode: "local",
          files: [],
          workingTree: { staged: 0, modified: 0, untracked: 0 },
        }),
      ),
    ).toBe(true);
  });

  it("rejects fractional section counts", () => {
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(GitStatusOutputSchema)({
          mode: "local",
          files: [],
          branch: { name: "master", upstream: null, ahead: 0, behind: 0 },
          workingTree: { staged: 1.5, modified: 0, untracked: 0 },
        }),
      ),
    ).toBe(true);
  });
});

describe("GitDiffOutput wire bytes", () => {
  it("encodes an added file (null oldFileName) with one hunk", () => {
    expect(
      wire(GitDiffOutputSchema, {
        oldFileName: null,
        newFileName: "a.ts",
        hunks: ["@@ -0,0 +1 @@\n+x\n"],
        binary: false,
      }),
    ).toBe(
      '{"oldFileName":null,"newFileName":"a.ts","hunks":["@@ -0,0 +1 @@\\n+x\\n"],"binary":false}',
    );
  });
});

describe("FsReadFileOutput wire bytes", () => {
  it("encodes the text arm", () => {
    expect(
      wire(FsReadFileOutputSchema, {
        kind: "text",
        content: "hello",
        truncated: false,
      }),
    ).toBe('{"kind":"text","content":"hello","truncated":false}');
  });

  it("encodes the binary arm", () => {
    expect(
      wire(FsReadFileOutputSchema, { kind: "binary", url: "/api/x?v=1" }),
    ).toBe('{"kind":"binary","url":"/api/x?v=1"}');
  });
});

describe("WorktreeName", () => {
  const decode = Schema.decodeUnknownResult(WorktreeNameSchema);

  it("accepts an ordinary branch name", () => {
    expect(Schema.decodeUnknownSync(WorktreeNameSchema)("feat/thing")).toBe(
      "feat/thing",
    );
  });

  it("rejects the empty string", () => {
    expect(Result.isFailure(decode(""))).toBe(true);
  });

  it.each([
    "a b",
    "a..b",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
  ])("rejects %j with the user-visible message", (name) => {
    const result = decode(name);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain(WORKTREE_NAME_MESSAGE);
    }
  });

  it("exposes the same rule as a bare predicate for live client validation", () => {
    expect(isValidWorktreeName("feat/thing")).toBe(true);
    expect(isValidWorktreeName("a..b")).toBe(false);
    expect(isValidWorktreeName("a b")).toBe(false);
  });
});
