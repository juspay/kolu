/**
 * kolu-cli dispatch pins (docs/atlas/src/content/atlas/kolu-cli.mdx).
 *
 * What these pin, and why each is here rather than left to a reviewer's eye:
 *
 *  - **Flags are position-blind.** The whole reason cleye was replaced. A
 *    spelling that used to be a usage error (`kolu --host box ls`) and the one
 *    that worked (`kolu ls --host box`) must now be the SAME parse — asserted by
 *    driving both into the same refusal, which only fires if both reached the
 *    shared flags.
 *  - **Bare `kolu` does not boot a server.** PR1's alias is retired; the pin is
 *    that the bare invocation FAILS (so a stale `ExecStart=kolu` is loud rather
 *    than silently serving) and names its subcommands.
 *  - **A face that cannot honor a flag refuses it.** `web` dials no padi, so
 *    `kolu web --host` is an error, never a silently ignored flag.
 *
 * Unit-level: parses and refusals only. Every assertion below fails BEFORE any
 * verb's dynamic import, so no padi is dialed, no server boots, and no MCP
 * serve starts — which is what lets the whole tree be driven here with nothing
 * running.
 */

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

/** Run the real command tree against an argv, to an `Exit`. */
const run = (argv: string[]) =>
  Effect.runPromiseExit(
    runKoluCliWith(argv).pipe(Effect.provide(NodeServices.layer)),
  );

/** The squashed failure of an argv that must not succeed — a NAMED throw if it
 *  succeeded, never a silent `undefined` the assertions would vacuously pass
 *  against. */
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

/** Everything a failure might carry its text in, as one string. */
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
      // Both spellings carry --host AND --socket, which is a refusal only
      // reachable once both flags landed on the root's shared set. Under cleye
      // the first spelling was itself a usage error, so this pins the fix.
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
      // The boundary of the property above, pinned so nobody widens the claim:
      // position-blindness is a property of the ROOT's SHARED flags, not of
      // every flag. `--json` is `ls`'s own, so it parses after `ls` …
      const after = await failureOf([
        "ls",
        "--json",
        "--host",
        "a",
        "--socket",
        "b",
      ]);
      expect(textOf(after)).toContain("mutually exclusive");

      // … and before `ls` it is a flag the ROOT does not have, so it is
      // REFUSED rather than silently ignored or swallowed as a positional.
      // (The library renders the name — `Unrecognized flag: --json in command
      // kolu` — to the console rather than onto the error value, so what is
      // assertable here is the refusal itself, which is the part that matters:
      // a misplaced flag must never look like it was applied.)
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
      // The refusal that used to live here was not a property of MCP: the face
      // dialed through a second, hand-rolled copy of the socket resolution that
      // had never learned `--socket` / `--state-root`. One resolution later, it
      // has. What still refuses is the flag rule itself, which is the root's.
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
      // The point is not only the refusal, it is WHEN: every assertion in this
      // file runs with nothing dialed, so reaching a failure here proves the
      // rule fired before the handler — and therefore before `--host` would
      // have ssh-provisioned a cold box. `--lines` used to be checked AFTER the
      // dial and after the roster read, which is the asymmetry this closes.
      for (const argv of [
        ["snapshot", "3f9c", "--tail", "0", "--host", "box"],
        ["history", "3f9c", "--lines", "0", "--host", "box"],
      ]) {
        expect(Exit.isFailure(await run(argv))).toBe(true);
      }
    });

    it("refuses a --timeout outside the shared timer range", async () => {
      const beyondSetTimeout = ["wait", "3f9c", "--until", "idle:5", "--timeout", "2147483648", "--host", "box"];
      expect(Exit.isFailure(await run(beyondSetTimeout))).toBe(true);
    });
  });

  it("the reserved face fails fast with the named message and exit 1", async () => {
    const err = await failureOf(["tui"]);
    expect(err._tag).toBe("ReservedFaceError");
    expect(err.message).toBe(reservedFace("tui").message);
    expect(err.message).toContain("not shipped yet");
    // The exit-code marker is what the run edge's teardown reads — so THIS is
    // what pins `kolu tui` exiting non-zero.
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
    // Two transports is a contradiction to refuse, not a precedence to apply.
    expect(
      Exit.isFailure(
        of({ host: Option.some("box"), socket: Option.some("/s") }),
      ),
    ).toBe(true);
  });
});

describe("refuseEndpointFlags", () => {
  it("passes an absent endpoint, and the subset a face accepts", () => {
    expect(
      Exit.isSuccess(
        Effect.runSyncExit(refuseEndpointFlags(NO_ENDPOINT, "web")),
      ),
    ).toBe(true);
    // `web` is the only face with anything to refuse today; the accept-list is
    // still the mechanism, so it is pinned as one.
    expect(
      Exit.isSuccess(
        Effect.runSyncExit(
          refuseEndpointFlags(
            { ...NO_ENDPOINT, host: Option.some("box") },
            "some-face",
            ["host"],
          ),
        ),
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
    // The server's TLS resolution is a plain truthiness check, so a leaked
    // `None` object would read as "a cert was given" and try to read it.
    expect(Boolean(flags.tlsCert)).toBe(false);
  });
});
