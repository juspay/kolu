/**
 * kolu-cli dispatch pins (docs/atlas/src/content/atlas/kolu-cli.mdx): bare
 * `kolu` and `kolu web` are behaviorally IDENTICAL — one flag schema bound to
 * both spellings; `kolu mcp` parses to its face (host flag and all); and the
 * reserved face (`tui`) fails fast with the named message, exit non-zero.
 * Unit-level: parses only, no server boots, no MCP serve.
 */

import { Cause, Effect, Exit, Runtime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PORT } from "kolu-common/config";
import {
  type KoluCliFace,
  type KoluCliParse,
  koluFace,
  parseKoluCli,
  reservedFaceMessage,
} from "./cli.ts";

/** The all-flags argv — spelled ONCE, hand-written on purpose (a pin test is
 *  deliberately not derived from the schema it pins). */
const ALL_FLAGS_ARGV = [
  "--host",
  "::1",
  "--port",
  "9999",
  "--tls",
  "--tls-cert",
  "/tmp/c.pem",
  "--tls-key",
  "/tmp/k.pem",
  "--verbose",
  "--allow-nix-shell-with-env-whitelist",
  "FOO,BAR",
] as const;

/** Every web-face flag, exercised alone and all-at-once — the full matrix both
 *  spellings must parse identically. */
const FLAG_MATRIX: readonly (readonly string[])[] = [
  [],
  ["--host", "0.0.0.0"],
  ["--port", "8080"],
  ["--tls"],
  ["--tls-cert", "/tmp/cert.pem"],
  ["--tls-key", "/tmp/key.pem"],
  ["--verbose"],
  ["--allow-nix-shell-with-env-whitelist", "default"],
  ALL_FLAGS_ARGV,
] as const;

/** Narrow a parse to the web face's flags, failing with a NAMED error. */
function webFlagsOf(parsed: KoluCliParse) {
  if (parsed.face !== "web") {
    throw new Error(`expected web face, got ${parsed.face}`);
  }
  return parsed.flags;
}

/** Mock process.exit to THROW `exit(<code>)` so the exit is assertable. */
function mockExitThrow() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit(${code})`);
  }) as never);
}

describe("kolu subcommand dispatch (kolu-cli PR1)", () => {
  it("bare `kolu` and `kolu web` parse the full flag matrix identically", () => {
    for (const flagArgv of FLAG_MATRIX) {
      const bare = webFlagsOf(parseKoluCli([...flagArgv]));
      const web = webFlagsOf(parseKoluCli(["web", ...flagArgv]));
      expect(web).toEqual(bare);
    }
  });

  it("parses to the expected concrete config (not vacuously equal)", () => {
    // Guards the matrix test against a schema typo making BOTH spellings
    // wrong in the same way: pin the all-flags case to literal values.
    const expected = {
      host: "::1",
      port: 9999,
      tls: true,
      tlsCert: "/tmp/c.pem",
      tlsKey: "/tmp/k.pem",
      verbose: true,
      allowNixShellWithEnvWhitelist: "FOO,BAR",
    };
    for (const spelling of [[], ["web"]]) {
      const flags = webFlagsOf(parseKoluCli([...spelling, ...ALL_FLAGS_ARGV]));
      expect(flags).toEqual(expected);
    }
  });

  it("defaults match today's flag defaults in both spellings", () => {
    for (const spelling of [[], ["web"]]) {
      const flags = webFlagsOf(parseKoluCli([...spelling]));
      expect(flags.host).toBe("127.0.0.1");
      expect(flags.port).toBe(DEFAULT_PORT);
      expect(flags.tls).toBe(false);
      expect(flags.verbose).toBe(false);
      expect(flags.tlsCert).toBeUndefined();
      expect(flags.tlsKey).toBeUndefined();
      expect(flags.allowNixShellWithEnvWhitelist).toBeUndefined();
    }
  });

  it("the reserved subcommand parses to its face; mcp parses its host flag", () => {
    expect(parseKoluCli(["tui"])).toEqual({ face: "tui" });
    expect(parseKoluCli(["mcp"])).toEqual({ face: "mcp", host: undefined });
    expect(parseKoluCli(["mcp", "--host", "user@zest"])).toEqual({
      face: "mcp",
      host: "user@zest",
    });
  });

  it("a typo'd subcommand parses to unknown-command, never the web face", () => {
    // cleye has no strict-commands mode: an unrecognized first positional falls
    // through to the root parse. Without the guard, `kolu tuii` would silently
    // boot the web server.
    expect(parseKoluCli(["tuii"])).toEqual({
      face: "unknown-command",
      args: ["tuii"],
    });
    expect(parseKoluCli(["web", "foo"])).toEqual({
      face: "unknown-command",
      args: ["foo"],
    });
  });

  it("--version parity: both spellings print the same version and exit 0", () => {
    // cleye's --version is an IMPLICIT flag that exists only where a `version`
    // option is passed — the alias pin must cover implicit flags too, so the
    // web command carries the same version as the root CLI.
    for (const spelling of [[], ["web"]]) {
      const exitSpy = mockExitThrow();
      const logSpy = vi.spyOn(console, "log").mockReturnValue(undefined);
      expect(() => parseKoluCli([...spelling, "--version"])).toThrow("exit(0)");
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const printed = logSpy.mock.calls[0]?.[0];
      expect(printed).toMatch(/^\d+\.\d+\.\d+/);
      vi.restoreAllMocks();
    }
  });

  describe("koluFace", () => {
    /** Run the dispatch effect to an `Exit` — a fail-fast arm is now a VALUE on
     *  the error channel, so these assertions need no `process.exit` spy at
     *  all; the exit code they used to prove is carried by the error itself and
     *  read by `main.ts`'s teardown. */
    const faceExit = (
      argv: string[],
    ): Exit.Exit<KoluCliFace, { readonly message: string }> =>
      Effect.runSyncExit(koluFace(argv));

    /** The one failure a fail-fast arm produces, or a NAMED throw if the arm
     *  succeeded — never a silent `undefined` the assertions below would then
     *  vacuously pass against. */
    const failureOf = (argv: string[]) => {
      const exit = faceExit(argv);
      if (!Exit.isFailure(exit)) {
        throw new Error(`expected ${argv.join(" ")} to fail, it succeeded`);
      }
      return Cause.squash(exit.cause) as {
        readonly _tag: string;
        readonly message: string;
        readonly [Runtime.errorExitCode]?: number;
        readonly [Runtime.errorReported]?: boolean;
      };
    };

    it("kolu tui fails fast: the named message, tagged, exit code 1", () => {
      const err = failureOf(["tui"]);
      expect(err._tag).toBe("ReservedFaceError");
      expect(err.message).toBe(reservedFaceMessage("tui"));
      expect(err.message).toContain("not shipped yet");
      expect(err.message).toContain("kolu.dev/atlas/kolu-cli.html");
      // The exit-code map is the marker, read by `NodeRuntime.runMain`'s
      // default teardown — so THIS is what pins `kolu tui` exiting non-zero.
      expect(err[Runtime.errorExitCode]).toBe(1);
      // …and the CLI prints its own line, so Effect must not also dump the
      // cause on top of it.
      expect(err[Runtime.errorReported]).toBe(false);
    });

    it("kolu mcp dispatches as a real face now, carrying its host", () => {
      expect(faceExit(["mcp"])).toEqual(
        Exit.succeed({ face: "mcp", host: undefined }),
      );
      expect(faceExit(["mcp", "--host", "user@zest"])).toEqual(
        Exit.succeed({ face: "mcp", host: "user@zest" }),
      );
    });

    it("returns the parsed flags for bare and web spellings", () => {
      expect(faceExit(["--port", "7001"])).toEqual(
        faceExit(["web", "--port", "7001"]),
      );
    });

    it("an unknown command fails fast: named message, exit code 1", () => {
      const err = failureOf(["tuii"]);
      expect(err._tag).toBe("UnknownCommandError");
      expect(err.message).toContain('unknown command "tuii"');
      expect(err.message).toContain("web");
      expect(err[Runtime.errorExitCode]).toBe(1);
    });

    it("builds nothing until it is run — the parse is inside the effect", () => {
      // `koluFace` is suspended, so constructing it must not reach cleye (which
      // prints and exits for `--version`). A built-but-unrun effect that had
      // already parsed would show up here as an exit.
      const exitSpy = mockExitThrow();
      expect(() => koluFace(["--version"])).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });
});
