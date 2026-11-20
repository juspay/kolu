import { NodeServices } from "@effect/platform-node";
import { padiSurface } from "@kolu/padi-client/surface";
import { classifyExpose } from "@kolu/surface/expose";
import { toolName } from "@kolu/surface/verbs";
import { isConsumerHangup } from "@kolu/surface-cli";
import { Cause, Effect, Exit, Runtime } from "effect";
import { KOLU_MCP_EXPOSE } from "kolu-mcp/expose";
import { KOLU_MCP_TOOLS } from "kolu-mcp/tools";
import { describe, expect, it } from "vitest";
import { runKoluCliWith } from "./cli.ts";
import { KOLU_SURFACE_HELP, KOLU_SURFACE_POSITIONALS } from "./surfaceFace.ts";

const run = (argv: string[]) =>
  Effect.runPromiseExit(
    runKoluCliWith(argv).pipe(Effect.provide(NodeServices.layer)),
  );

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
  });
});

describe("a hung-up reader is one reading, shared with @kolu/surface-cli", () => {
  it("reads the NESTED errno — the shape a wrapped sink failure actually raises", () => {
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
