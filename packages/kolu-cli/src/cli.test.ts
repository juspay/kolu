/**
 * kolu-cli PR1 pin (docs/atlas/src/content/atlas/kolu-cli.mdx): bare `kolu`
 * and `kolu web` are behaviorally IDENTICAL — one flag schema bound to both
 * spellings — and the reserved faces (`tui`, `mcp`) fail fast with the named
 * message, exit non-zero. Unit-level: parses only, no server boots.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PORT } from "kolu-common/config";
import {
  type KoluCliParse,
  koluWebFlagsOrExit,
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

  it("reserved subcommands parse to their face", () => {
    expect(parseKoluCli(["tui"])).toEqual({ face: "tui" });
    expect(parseKoluCli(["mcp"])).toEqual({ face: "mcp" });
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

  describe("koluWebFlagsOrExit", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      "tui",
      "mcp",
    ] as const)("kolu %s fails fast: the named message on stderr, exit non-zero", (face) => {
      const exitSpy = mockExitThrow();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      expect(() => koluWebFlagsOrExit([face])).toThrow("exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const written = String(stderrSpy.mock.calls[0]?.[0]);
      expect(written).toBe(`${reservedFaceMessage(face)}\n`);
      expect(written).toContain("not shipped yet");
      expect(written).toContain("kolu.dev/atlas/kolu-cli.html");
    });

    it("returns the parsed flags for bare and web spellings", () => {
      expect(koluWebFlagsOrExit(["--port", "7001"])).toEqual(
        koluWebFlagsOrExit(["web", "--port", "7001"]),
      );
    });

    it("an unknown command fails fast: named message, exit non-zero", () => {
      const exitSpy = mockExitThrow();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      expect(() => koluWebFlagsOrExit(["tuii"])).toThrow("exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
      const written = String(stderrSpy.mock.calls[0]?.[0]);
      expect(written).toContain('unknown command "tuii"');
      expect(written).toContain("web");
    });
  });
});
