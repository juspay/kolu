/**
 * The pty-host wire, pinned two ways.
 *
 * 1. `PTY_HOST_CONTRACT_VERSION` — the in-epoch skew lever.
 * 2. **Byte fixtures** for the shapes `recon/zod.md`'s hit list marks WIRE-CRITICAL
 *    (PLAN #17): the kolu↔kaval socket carries these across builds, so the pin
 *    that matters is the encoded JSON STRING, not decode-equality. A schema whose
 *    decoded values are right but whose bytes moved would pass every other test in
 *    this package and break a live daemon adoption.
 *
 * The fixtures are also the EVIDENCE behind the 7.0 note's claim that the epoch
 * break moved the framing and not the payloads. If a field is ever added,
 * removed, renamed, or turned from an absent-key optional into a nullable, these
 * fail first — before anything reaches a socket.
 */

import { isContractVersionCompatible } from "@kolu/surface/define";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  PTY_HOST_CONTRACT_VERSION,
  PtyHostIdentitySchema,
  PtyNotFound,
  ptyHostSurface,
  SpawnArgvEmpty,
} from "./ptyHostSurface.ts";

/** The wire schemas, reached through the SURFACE rather than re-imported — so a
 *  fixture can only ever pin what the surface actually serves. */
const spec = ptyHostSurface.spec;

// biome-ignore lint/suspicious/noExplicitAny: the spec's schemas are erased at the `SurfaceSpec` boundary (a `WireSchema<unknown>`); these helpers only encode/decode values the fixtures spell literally, and the assertion is the resulting STRING.
type AnySchema = Schema.Codec<any, any, never, never>;
const encodeJson = (schema: AnySchema, value: unknown): string =>
  JSON.stringify(Schema.encodeUnknownSync(schema)(value));

describe("PTY_HOST_CONTRACT_VERSION", () => {
  it("the Effect-4 protocol epoch is the 7.x breaking wire", () => {
    // The MAJOR is the epoch and is what this case is about; the MINOR moves
    // with each additive member (7.1 added `terminal.getScreenCells`), so
    // pinning the whole string here would make every additive change edit a
    // test about the EPOCH.
    expect(PTY_HOST_CONTRACT_VERSION.split(".")[0]).toBe("7");
    // Both directions are refused, which is what a MAJOR buys. Not because a 6.0
    // peer would mis-parse a payload — it cannot be spoken to at all — but so
    // that no in-epoch comparison ever waves a previous-epoch version string
    // through as compatible.
    expect(isContractVersionCompatible("6.0", PTY_HOST_CONTRACT_VERSION)).toBe(
      false,
    );
    expect(isContractVersionCompatible(PTY_HOST_CONTRACT_VERSION, "6.0")).toBe(
      false,
    );
  });

  it("the shipped contract version is self-compatible", () => {
    expect(
      isContractVersionCompatible(
        PTY_HOST_CONTRACT_VERSION,
        PTY_HOST_CONTRACT_VERSION,
      ),
    ).toBe(true);
  });

  it("a same-major, NEWER-minor daemon stays adoptable — the in-epoch skew mechanism still works", () => {
    // The reason D6 bumps this constant at all rather than letting it rot: from
    // the flag day forward, minor additions must keep their old graceful arm.
    expect(isContractVersionCompatible("7.1", "7.0")).toBe(true);
    expect(isContractVersionCompatible("7.0", "7.1")).toBe(false);
  });
});

describe("wire byte fixtures — spawn input (the z.record env row of the hit list)", () => {
  const schema = spec.procedures.terminal.spawn.input;

  it("encodes a fully-specified spawn exactly", () => {
    expect(
      encodeJson(schema, {
        id: "t-1",
        argv: ["/bin/sh", "--rcfile", "/rc/bashrc-t-1"],
        cwd: "/home/u",
        env: { HOME: "/home/u", PATH: "/usr/bin", TERM: "xterm-256color" },
        initFiles: [{ name: "bashrc-t-1", content: "# hi\n" }],
        cols: 80,
        rows: 24,
      }),
    ).toBe(
      '{"id":"t-1","argv":["/bin/sh","--rcfile","/rc/bashrc-t-1"],"cwd":"/home/u",' +
        '"env":{"HOME":"/home/u","PATH":"/usr/bin","TERM":"xterm-256color"},' +
        '"initFiles":[{"name":"bashrc-t-1","content":"# hi\\n"}],"cols":80,"rows":24}',
    );
  });

  it("OMITS every absent optional rather than nulling it — the minimal spawn is four keys", () => {
    expect(
      encodeJson(schema, {
        argv: ["/bin/sh"],
        cwd: "/tmp",
        env: {},
        initFiles: [],
      }),
    ).toBe('{"argv":["/bin/sh"],"cwd":"/tmp","env":{},"initFiles":[]}');
  });

  it("keeps an arbitrary env KEY verbatim — the record is not a fixed struct", () => {
    // `z.record(z.string(), z.string())` → `Schema.Record`. A struct would strip
    // every key it did not declare, silently spawning a shell with no env.
    expect(
      encodeJson(schema, {
        argv: ["/bin/sh"],
        cwd: "/tmp",
        env: { KAVAL_SOCKET: "/run/k.sock", "weird-key": "v" },
        initFiles: [],
      }),
    ).toBe(
      '{"argv":["/bin/sh"],"cwd":"/tmp","env":{"KAVAL_SOCKET":"/run/k.sock","weird-key":"v"},"initFiles":[]}',
    );
  });

  it("rejects an empty argv at the wire boundary (minLength(1)), so no host is asked to spawn nothing", () => {
    expect(() =>
      Schema.decodeUnknownSync(schema as AnySchema)({
        argv: [],
        cwd: "/tmp",
        env: {},
        initFiles: [],
      }),
    ).toThrow();
  });
});

describe("wire byte fixtures — the attach frame union", () => {
  const schema = spec.streams.terminalAttach.outputSchema;

  it("encodes each arm on the `kind` discriminant, never `_tag`", () => {
    expect(
      encodeJson(schema, { kind: "snapshot", data: "hello", topLine: 12 }),
    ).toBe('{"kind":"snapshot","data":"hello","topLine":12}');
    expect(
      encodeJson(schema, {
        kind: "snapshot",
        data: "hello",
        topLine: 12,
        reflowEpoch: 3,
      }),
    ).toBe('{"kind":"snapshot","data":"hello","topLine":12,"reflowEpoch":3}');
    expect(encodeJson(schema, { kind: "delta", data: "x" })).toBe(
      '{"kind":"delta","data":"x"}',
    );
    // The 5.0 control frame is payload-less BY DESIGN — a `data` key here would
    // make it indistinguishable from a delta for a consumer that only looks at
    // shape.
    expect(encodeJson(schema, { kind: "overflow" })).toBe(
      '{"kind":"overflow"}',
    );
  });
});

describe("wire byte fixtures — inventory, list entry, getHistory, extent", () => {
  it("encodes an inventory snapshot with a fully-populated entry", () => {
    expect(
      encodeJson(spec.streams.inventory.outputSchema, {
        kind: "snapshot",
        entries: [
          {
            id: "t-1",
            pid: 42,
            cwd: "/w",
            lastActivity: 1700,
            title: "vim",
            foregroundProcess: "vim",
            commandRooted: true,
          },
        ],
      }),
    ).toBe(
      '{"kind":"snapshot","entries":[{"id":"t-1","pid":42,"cwd":"/w","lastActivity":1700,' +
        '"title":"vim","foregroundProcess":"vim","commandRooted":true}]}',
    );
  });

  it("encodes a sparse list entry with every optional absent — four keys, no nulls", () => {
    expect(
      encodeJson(spec.streams.inventory.outputSchema, {
        kind: "created",
        entry: { id: "t-2", pid: 7, cwd: "/w", lastActivity: 1 },
      }),
    ).toBe(
      '{"kind":"created","entry":{"id":"t-2","pid":7,"cwd":"/w","lastActivity":1}}',
    );
    expect(
      encodeJson(spec.streams.inventory.outputSchema, {
        kind: "exited",
        id: "t-2",
      }),
    ).toBe('{"kind":"exited","id":"t-2"}');
  });

  it("encodes both getHistory arms — a served chunk and the stale-reflow halt", () => {
    const schema = spec.procedures.terminal.getHistory.output;
    expect(
      encodeJson(schema, {
        kind: "chunk",
        chunk: "old\n",
        topLine: 0,
        exhausted: true,
      }),
    ).toBe('{"kind":"chunk","chunk":"old\\n","topLine":0,"exhausted":true}');
    expect(encodeJson(schema, { kind: "stale" })).toBe('{"kind":"stale"}');
  });

  it("encodes the getScreenText extent union, and omits it when absent", () => {
    const schema = spec.procedures.terminal.getScreenText.input;
    expect(encodeJson(schema, { id: "t-1" })).toBe('{"id":"t-1"}');
    expect(
      encodeJson(schema, { id: "t-1", extent: { kind: "tail", lines: 50 } }),
    ).toBe('{"id":"t-1","extent":{"kind":"tail","lines":50}}');
    expect(
      encodeJson(schema, { id: "t-1", extent: { kind: "viewport" } }),
    ).toBe('{"id":"t-1","extent":{"kind":"viewport"}}');
    // A `range` with both bounds absent stays a bare discriminant — the
    // "everything" reading, not `{startLine: null, endLine: null}`.
    expect(encodeJson(schema, { id: "t-1", extent: { kind: "range" } })).toBe(
      '{"id":"t-1","extent":{"kind":"range"}}',
    );
  });

  it("encodes the build identity pair exactly (padi's `expectedKaval` reads these bytes)", () => {
    expect(
      JSON.stringify(
        Schema.encodeUnknownSync(PtyHostIdentitySchema)({
          staleKey: "abc",
          navigableCommit: "deadbeef",
        }),
      ),
    ).toBe('{"staleKey":"abc","navigableCommit":"deadbeef"}');
  });
});

describe("wire byte fixtures — the foreground tap's absent pid (#17 audit)", () => {
  // The one field on this wire spelled `Schema.optional` rather than
  // `optionalKey`. `readForegroundPid` collapses `tcgetpgrp`'s transient `0` to
  // `undefined`, `ForegroundSample` declares that as a REQUIRED `number |
  // undefined` key, and the tap forwards whole samples verbatim — so the frame
  // that reaches this encode genuinely carries the key present-with-`undefined`.
  // Under `optionalKey` the RPC chunk encode rejected it and took the whole
  // foreground tap down (invisible in-process, where nothing encodes).
  const foreground = spec.streams.foreground.outputSchema;

  it("ACCEPTS a present-but-undefined pid and OMITS it — the zod-era bytes, exactly", () => {
    expect(
      encodeJson(foreground, { process: "bash", foregroundPid: undefined }),
    ).toBe('{"process":"bash"}');
  });

  it("an ABSENT key emits the same bytes — `optional` never nulls", () => {
    expect(encodeJson(foreground, { process: "bash" })).toBe(
      '{"process":"bash"}',
    );
  });

  it("a real pid still rides, and a non-integer is still rejected", () => {
    expect(
      encodeJson(foreground, { process: "claude", foregroundPid: 4242 }),
    ).toBe('{"process":"claude","foregroundPid":4242}');
    expect(() =>
      encodeJson(foreground, { process: "claude", foregroundPid: "4242" }),
    ).toThrow();
  });
});

describe("the declared error vocabulary (PLAN D4)", () => {
  it("PtyNotFound survives encode → JSON → decode with its tag, data and message intact", () => {
    const schema = spec.procedures.terminal.getScreenState.error as AnySchema;
    const encoded = Schema.encodeUnknownSync(schema)(
      new PtyNotFound({ id: "t-9" }),
    );
    expect(JSON.stringify(encoded)).toBe('{"_tag":"PtyNotFound","id":"t-9"}');
    const back = Schema.decodeUnknownSync(schema)(
      JSON.parse(JSON.stringify(encoded)),
    );
    expect(back).toBeInstanceOf(PtyNotFound);
    expect((back as PtyNotFound).id).toBe("t-9");
    expect((back as PtyNotFound).message).toBe("no PTY with id t-9");
  });

  it("SpawnArgvEmpty carries no data — the tag IS the whole answer", () => {
    const schema = spec.procedures.terminal.spawn.error as AnySchema;
    const encoded = Schema.encodeUnknownSync(schema)(new SpawnArgvEmpty());
    expect(JSON.stringify(encoded)).toBe('{"_tag":"SpawnArgvEmpty"}');
    expect(new SpawnArgvEmpty().message).toBe("argv is empty");
  });

  it("declares an error on EXACTLY the members that can raise one", () => {
    // The negative half: a member with no declared error must stay undeclared, so
    // an undeclared throw there remains a DEFECT (D4) rather than quietly
    // acquiring an error channel a caller could branch on.
    const declaring = Object.entries(spec.procedures).flatMap(([ns, verbs]) =>
      Object.entries(verbs)
        .filter(([, p]) => "error" in p)
        .map(([verb]) => `${ns}.${verb}`),
    );
    expect(declaring.sort()).toEqual([
      "terminal.getHistory",
      "terminal.getScreenCells",
      "terminal.getScreenState",
      "terminal.getScreenText",
      "terminal.spawn",
    ]);
  });
});
