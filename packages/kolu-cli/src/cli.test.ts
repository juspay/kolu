import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Option, Runtime } from "effect";
import { DEFAULT_PORT } from "kolu-common/config";
import { describe, expect, it } from "vitest";
import { runKoluCliWith } from "./cli.ts";
import {
  type EndpointFlagValues,
  endpointOf,
  refuseEndpointFlags,
} from "./endpoint.ts";
import { reservedFace } from "./exit.ts";
import { bootFlagsOf } from "./webFlags.ts";

const run = (argv: string[]) =>
  Effect.runPromiseExit(
    runKoluCliWith(argv).pipe(Effect.provide(NodeServices.layer)),
  );

const failureOf = async (argv: string[]) => {
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

const textOf = (e: {
  readonly message?: string;
  readonly stderr?: string;
}): string => `${e.stderr ?? ""}${e.message ?? ""}`;

const NO_ENDPOINT: EndpointFlagValues = {
  socket: Option.none(),
  stateRoot: Option.none(),
  host: Option.none(),
};

describe("kolu command tree", () => {
  describe("flags are position-blind (the cleye replacement's whole point)", () => {
    it("a shared flag reaches the root from BEFORE or AFTER the verb", async () => {
      for (const argv of [
        ["--host", "box", "--socket", "/tmp/p.sock", "ls"],
        ["ls", "--host", "box", "--socket", "/tmp/p.sock"],
        ["--host", "box", "ls", "--socket", "/tmp/p.sock"],
      ]) {
        const err = await failureOf(argv);
        expect(textOf(err)).toContain("mutually exclusive");
      }
    });

    it("a verb's OWN flag still belongs after the verb name — and says so", async () => {
      const after = await failureOf([
        "ls",
        "--json",
        "--host",
        "a",
        "--socket",
        "b",
      ]);
      expect(textOf(after)).toContain("mutually exclusive");

      const before = await run([
        "--json",
        "ls",
        "--host",
        "a",
        "--socket",
        "b",
      ]);
      expect(Exit.isFailure(before)).toBe(true);
    });
  });

  describe("an omitted switch is its OFF position, not a missing flag", () => {
    it("`ls` without `--json` still reaches the endpoint check", async () => {
      const err = await failureOf(["ls", "--host", "a", "--socket", "b"]);
      expect(textOf(err)).toContain("mutually exclusive");
    });
  });

  describe("bare `kolu` lists its subcommands instead of booting a server", () => {
    it("fails (so a stale `ExecStart=kolu` is loud, not silently serving)", async () => {
      const exit = await run([]);
      expect(Exit.isFailure(exit)).toBe(true);
    });

    it("a typo'd subcommand fails too, never falling through to a face", async () => {
      const exit = await run(["lss"]);
      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe("a face refuses the endpoint flags it cannot honor", () => {
    it("`kolu web --host` is an error — web dials no padi", async () => {
      const err = await failureOf(["web", "--host", "box"]);
      expect(textOf(err)).toContain("--host");
      expect(textOf(err)).toContain("web");
    });

    it("`kolu mcp --socket` is NOT refused — every face resolves one padi the same way", async () => {
      const err = await failureOf([
        "mcp",
        "--socket",
        "/tmp/p.sock",
        "--host",
        "box",
      ]);
      expect(textOf(err)).toContain("mutually exclusive");
    });
  });

  describe("a numeric flag's range is part of the PARSE, not of a verb body", () => {
    it("refuses a non-positive --tail / --lines before any verb module loads", async () => {
      for (const argv of [
        ["snapshot", "3f9c", "--tail", "0", "--host", "box"],
        ["history", "3f9c", "--lines", "0", "--host", "box"],
      ]) {
        expect(Exit.isFailure(await run(argv))).toBe(true);
      }
    });

    it("refuses a --timeout outside the shared timer range", async () => {
      const beyondSetTimeout = [
        "wait",
        "3f9c",
        "--until",
        "idle:5",
        "--timeout",
        "2147483648",
        "--host",
        "box",
      ];
      expect(Exit.isFailure(await run(beyondSetTimeout))).toBe(true);
    });

    it("holds `wait`'s two modifiers and `debrief`'s sugar to the same rules", async () => {
      for (const argv of [
        ["wait", "3f9c", "--until", "waiting", "--settled", "0"],
        ["wait", "3f9c", "--until", "waiting", "--settled", "2147483648"],
        ["wait", "3f9c", "--until", "waiting", "--snapshot", "0"],
        ["debrief", "3f9c", "--quiet", "0"],
        ["debrief", "3f9c", "--quiet", "2147483648"],
        ["debrief", "3f9c", "--tail", "0"],
      ]) {
        expect(Exit.isFailure(await run([...argv, "--host", "box"]))).toBe(
          true,
        );
      }
    });
  });

  describe("`kolu debrief` — the composed protocol as a verb", () => {
    it("is a real subcommand whose flags all parse", async () => {
      const err = await failureOf([
        "debrief",
        "3f9c",
        "--quiet",
        "1000",
        "--tail",
        "5",
        "--timeout",
        "2000",
        "--json",
        "--socket",
        "/tmp/definitely-no-padi-here.sock",
      ]);
      expect(textOf(err)).toContain("/tmp/definitely-no-padi-here.sock");
    });

    it("`--quiet` and `--tail` have defaults, so the bare verb IS the protocol", async () => {
      const err = await failureOf([
        "debrief",
        "3f9c",
        "--socket",
        "/tmp/definitely-no-padi-here.sock",
      ]);
      expect(textOf(err)).toContain("/tmp/definitely-no-padi-here.sock");
    });
  });

  it("the reserved face fails fast with the named message and exit 1", async () => {
    const err = await failureOf(["tui"]);
    expect(err._tag).toBe("ReservedFaceError");
    expect(err.message).toBe(reservedFace("tui").message);
    expect(err.message).toContain("not shipped yet");
    expect(err[Runtime.errorExitCode]).toBe(1);
  });
});

describe("endpointOf", () => {
  it("names exactly one padi, or refuses", async () => {
    const of = (f: Partial<typeof NO_ENDPOINT>) =>
      Effect.runSyncExit(endpointOf({ ...NO_ENDPOINT, ...f }));

    expect(of({})).toEqual(Exit.succeed({ kind: "auto" }));
    expect(of({ socket: Option.some("/s") })).toEqual(
      Exit.succeed({ kind: "socket", path: "/s" }),
    );
    expect(of({ stateRoot: Option.some("/d") })).toEqual(
      Exit.succeed({ kind: "stateRoot", dir: "/d" }),
    );
    expect(of({ host: Option.some("box") })).toEqual(
      Exit.succeed({ kind: "host", ssh: "box" }),
    );
    expect(
      Exit.isFailure(
        of({ host: Option.some("box"), socket: Option.some("/s") }),
      ),
    ).toBe(true);
  });
});

describe("refuseEndpointFlags", () => {
  it("passes an absent endpoint — the spelling that names no padi at all", () => {
    expect(
      Exit.isSuccess(
        Effect.runSyncExit(refuseEndpointFlags(NO_ENDPOINT, "web")),
      ),
    ).toBe(true);
  });

  it("refuses a flag the face would otherwise silently ignore", () => {
    expect(
      Exit.isFailure(
        Effect.runSyncExit(
          refuseEndpointFlags(
            { ...NO_ENDPOINT, host: Option.some("box") },
            "web",
          ),
        ),
      ),
    ).toBe(true);
  });
});

describe("bootFlagsOf", () => {
  it("projects the parser's Options onto the server's undefined-shaped contract", () => {
    expect(
      bootFlagsOf({
        bind: "::1",
        port: 9999,
        tls: true,
        tlsCert: Option.some("/tmp/c.pem"),
        tlsKey: Option.some("/tmp/k.pem"),
        verbose: true,
        allowNixShellWithEnvWhitelist: Option.some("FOO,BAR"),
      }),
    ).toEqual({
      bind: "::1",
      port: 9999,
      tls: true,
      tlsCert: "/tmp/c.pem",
      tlsKey: "/tmp/k.pem",
      verbose: true,
      allowNixShellWithEnvWhitelist: "FOO,BAR",
    });
  });

  it("an absent optional flag lands as undefined, not as a None object", () => {
    const flags = bootFlagsOf({
      bind: "127.0.0.1",
      port: DEFAULT_PORT,
      tls: false,
      tlsCert: Option.none(),
      tlsKey: Option.none(),
      verbose: false,
      allowNixShellWithEnvWhitelist: Option.none(),
    });
    expect(flags.tlsCert).toBeUndefined();
    expect(flags.tlsKey).toBeUndefined();
    expect(flags.allowNixShellWithEnvWhitelist).toBeUndefined();
    expect(Boolean(flags.tlsCert)).toBe(false);
  });
});
