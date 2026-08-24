/**
 * The `kolu surface` face's pins — in-process, over the real tree, dialing
 * nothing but ONE dead socket each time.
 *
 * What is pinned here, and why each is here rather than left to the
 * e2eDaemon legs (`surface.e2e.test.ts` — the real-padi file):
 *
 *  - **The face is mounted and its EXIT MATRIX is the face's own.** The exit
 *    code rides the failure as data (`Runtime.errorExitCode`), so the three
 *    assertable-without-a-daemon arms (usage · unreachable · resolve-refusal)
 *    can be read off the squashed `Exit` — no process needed. The two matrix
 *    claims that DO need live wires (a refusal from a real padi, a real
 *    snapshot answer) are the e2e file's, so this file stays honest about
 *    which is which.
 *  - **The positional annotation names real verbs.** The projection refuses a
 *    positional that names no FIELD of its verb at BUILD — but a rename that
 *    removed the VERB would leave the annotation pointing at nothing, and the
 *    framework's check is per-verb, not per-table. This pin derives the verb
 *    set from the SAME source of truth the projection does (the `ExposeMap`
 *    + the tool table, through `toolName`) and asks containment, so the
 *    table's own grammar — not a spelled literal — is the yardstick.
 *  - **A hung-up reader is the SHARED reading.** `@kolu/surface-cli`'s
 *    `isConsumerHangup` is the one answer kolu-cli's verbs now read too (the
 *    recorded half-divergence — reading only the flat `code`, which is NOT
 *    the shape Node raises — is what the mount retired).
 *
 * `runKoluCliWith` runs the full tree in the test process; both dial legs aim
 * at a socket that cannot exist, so neither costs anything and neither
 * touches a live daemon.
 */

import { NodeServices } from "@effect/platform-node";
import { padiSurface } from "@kolu/padi/surface";
import { classifyExpose } from "@kolu/surface/expose";
import { toolName } from "@kolu/surface/verbs";
import { isConsumerHangup } from "@kolu/surface-cli";
import { Cause, Effect, Exit, Runtime } from "effect";
// The pin reads the table by the SAME addresses the production face does —
// the SDK-free subpaths, not the barrel: an accidental regression of the
// tools.ts home into the serve.ts path lands here, not in production.
import { KOLU_MCP_EXPOSE } from "kolu-mcp/expose";
import { KOLU_MCP_TOOLS } from "kolu-mcp/tools";
import { describe, expect, it } from "vitest";
import { runKoluCliWith } from "./cli.ts";
import { KOLU_SURFACE_POSITIONALS, KOLU_SURFACE_HELP } from "./surfaceFace.ts";

/** Run the real command tree against an argv, to an `Exit`. */
const run = (argv: string[]) =>
  Effect.runPromiseExit(
    runKoluCliWith(argv).pipe(Effect.provide(NodeServices.layer)),
  );

/** The squashed failure of an argv that must not succeed — a NAMED throw if it
 *  succeeded, never a silent undefined a vacuous assertion would read. */
const surfaceFailureOf = async (argv: string[]) => {
  const exit = await run(argv);
  if (!Exit.isFailure(exit)) {
    throw new Error(
      `expected \`kolu ${argv.join(" ")}\` to fail; it succeeded`,
    );
  }
  return Cause.squash(exit.cause) as {
    readonly _tag?: string;
    readonly message?: string;
    readonly stderr?: string;
    readonly [Runtime.errorExitCode]?: number;
  };
};

describe("the surface face's exit matrix, in-process", () => {
  it("a dead endpoint is exit 3, naming the socket as the user spelled it", async () => {
    const err = await surfaceFailureOf([
      "surface",
      "get",
      "identity",
      "--socket",
      "/definitely/dead.sock",
    ]);
    expect(err._tag).toBe("SurfaceCliFailure");
    expect(err[Runtime.errorExitCode]).toBe(3);
    expect(err.stderr).toBe(
      "kolu: no surface at /definitely/dead.sock — connect ENOENT /definitely/dead.sock\n",
    );
  });

  it("a contradictory endpoint spelling is exit 3, carrying the binary's own rule", async () => {
    for (const argv of [
      ["surface", "get", "identity", "--socket", "a", "--host", "b"],
      // Position-blind: the ROOT's shared flags, typed BEFORE the face —
      // the same parse.
      ["--socket", "a", "--host", "b", "surface", "get", "identity"],
    ]) {
      const err = await surfaceFailureOf(argv);
      expect(err._tag).toBe("SurfaceCliFailure");
      expect(err[Runtime.errorExitCode]).toBe(3);
      expect(err.stderr).toContain("no endpoint to dial");
      expect(err.stderr).toContain("mutually exclusive");
    }
  });

  it("an input that does not decode is exit 2 — it never left this process", async () => {
    // NOT the missing-required-flag arm (the library's brand): the verb
    // received `id`, and the value is not a UUID — surface-cli's own
    // usage arm, worded and coded by the face.
    const err = await surfaceFailureOf([
      "surface",
      "screen_text",
      "--input",
      '{"id":"not-a-uuid"}',
    ]);
    expect(err._tag).toBe("SurfaceCliFailure");
    expect(err[Runtime.errorExitCode]).toBe(2);
    expect(err.stderr).toContain("does not match what the verb declares");
  });

  it("`kolu surface list` dials NOTHING — a dead endpoint still lists the projection", async () => {
    const exit = await run([
      "surface",
      "list",
      "--socket",
      "/definitely/dead.sock",
    ]);
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});

describe("the positional annotation is honest about the table it annotates", () => {
  it("every annotated name is a verb the projection will actually mount", () => {
    // Derived through the projection's own grammar, not spelled: a rename in
    // either table lands HERE, loudly, rather than hiding a dead annotation.
    const fromProcedures = classifyExpose(
      padiSurface.spec,
      KOLU_MCP_EXPOSE,
      "surface-cli",
    )
      .filter((e) => e.kind === "procedure")
      .map((e) => toolName(e.ns, e.verb));
    const offered = new Set([
      ...fromProcedures,
      ...Object.keys(KOLU_MCP_TOOLS),
    ]);
    for (const name of Object.keys(KOLU_SURFACE_POSITIONALS)) {
      expect(offered.has(name)).toBe(true);
    }
  });

  it("the help page's groups name exactly the mounted verbs — none in `Other`, none phantom", () => {
    // The library drops an unGROUPED verb into a trailing "Other" section
    // and refuses a group naming a verb that does NOT exist — but both checks
    // are the LIBRARY's, run per tree-build; a rename (or a new verb) leaves
    // this app-authored page reflecting the old table until somebody mounts
    // the branch. Asking containment through the projection's own grammar
    // makes the page's completeness mechanical, like the positional pin's.
    const fromProcedures = classifyExpose(
      padiSurface.spec,
      KOLU_MCP_EXPOSE,
      "surface-cli",
    )
      .filter((e) => e.kind === "procedure")
      .map((e) => toolName(e.ns, e.verb));
    const offered = new Set([
      ...fromProcedures,
      ...Object.keys(KOLU_MCP_TOOLS),
    ]);
    const grouped = KOLU_SURFACE_HELP.groups.flatMap((g) => g.verbs);
    expect(new Set(grouped)).toEqual(offered);
    for (const name of Object.keys(KOLU_SURFACE_HELP.examples ?? {})) {
      expect(offered.has(name)).toBe(true);
    }
  });
});

describe("a hung-up reader is one reading, shared with @kolu/surface-cli", () => {
  it("reads the NESTED errno — the shape a wrapped sink failure actually raises", () => {
    // Node hands the sink an EPIPE, the sink wraps: the number lives one
    // level down, on the platform error's own `cause`.
    expect(isConsumerHangup({ cause: { code: "EPIPE" } })).toBe(true);
  });
  it("and the flat errno, for a platform that raises it flat", () => {
    expect(isConsumerHangup({ code: "EPIPE" })).toBe(true);
  });
  it("and a dying write is NOT a hang-up", () => {
    expect(isConsumerHangup({ cause: { code: "EIO" } })).toBe(false);
    expect(isConsumerHangup({ code: "EAGAIN" })).toBe(false);
    expect(isConsumerHangup(new Error("nope"))).toBe(false);
  });
});
