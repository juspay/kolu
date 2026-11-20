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

const spec = ptyHostSurface.spec;

// biome-ignore lint/suspicious/noExplicitAny: the spec's schemas are erased at the `SurfaceSpec` boundary (a `WireSchema<unknown>`); these helpers only encode/decode values the fixtures spell literally, and the assertion is the resulting STRING.
type AnySchema = Schema.Codec<any, any, never, never>;
const encodeJson = (schema: AnySchema, value: unknown): string =>
  JSON.stringify(Schema.encodeUnknownSync(schema)(value));

describe("PTY_HOST_CONTRACT_VERSION", () => {
  it("the protocol epoch is the MAJOR — a previous epoch is refused both ways", () => {
    expect(PTY_HOST_CONTRACT_VERSION.split(".")[0]).toBe("9");
    expect(isContractVersionCompatible("7.0", PTY_HOST_CONTRACT_VERSION)).toBe(
      false,
    );
    expect(isContractVersionCompatible(PTY_HOST_CONTRACT_VERSION, "7.0")).toBe(
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
    expect(isContractVersionCompatible("8.1", "8.0")).toBe(true);
    expect(isContractVersionCompatible("8.0", "8.1")).toBe(false);
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
    const grid = { cols: 80, rows: 24 };
    expect(
      encodeJson(schema, {
        kind: "snapshot",
        data: "hello",
        topLine: 12,
        grid,
      }),
    ).toBe(
      '{"kind":"snapshot","data":"hello","topLine":12,"grid":{"cols":80,"rows":24}}',
    );
    expect(
      encodeJson(schema, {
        kind: "snapshot",
        data: "hello",
        topLine: 12,
        reflowEpoch: 3,
        grid,
      }),
    ).toBe(
      '{"kind":"snapshot","data":"hello","topLine":12,"reflowEpoch":3,"grid":{"cols":80,"rows":24}}',
    );
    expect(encodeJson(schema, { kind: "delta", data: "x" })).toBe(
      '{"kind":"delta","data":"x"}',
    );
    expect(encodeJson(schema, { kind: "overflow" })).toBe(
      '{"kind":"overflow"}',
    );
    expect(encodeJson(schema, { kind: "resized", grid })).toBe(
      '{"kind":"resized","grid":{"cols":80,"rows":24}}',
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
    expect(encodeJson(schema, { id: "t-1", extent: { kind: "range" } })).toBe(
      '{"id":"t-1","extent":{"kind":"range"}}',
    );
  });

  it("encodes an ordinary cell as TWO keys — the omitted defaults are ~70% of the frame", () => {
    const schema = spec.procedures.terminal.getScreenCells.output;
    const plain = {
      col: 7,
      chars: "a",
      width: 1,
      fg: { kind: "default" },
      bg: { kind: "default" },
      bold: false,
      italic: false,
      dim: false,
      underline: false,
      inverse: false,
    };
    expect(encodeJson(schema, { cols: 80, lines: [{ cells: [plain] }] })).toBe(
      '{"cols":80,"lines":[{"cells":[{"col":7,"chars":"a"}]}]}',
    );
  });

  it("keeps every NON-default attribute on the wire, and round-trips the pair", () => {
    const schema = spec.procedures.terminal.getScreenCells.output;
    const styled = {
      col: 0,
      chars: "日",
      width: 2,
      fg: { kind: "palette", index: 4 },
      bg: { kind: "rgb", value: 0x78c8ff },
      bold: true,
      italic: true,
      dim: true,
      underline: true,
      inverse: true,
    };
    const grid = { cols: 80, lines: [{ cells: [styled] }] };
    expect(encodeJson(schema, grid)).toBe(
      '{"cols":80,"lines":[{"cells":[{"col":0,"chars":"日","width":2,' +
        '"fg":{"kind":"palette","index":4},"bg":{"kind":"rgb","value":7915775},' +
        '"bold":true,"italic":true,"dim":true,"underline":true,"inverse":true}]}]}',
    );
    expect(
      Schema.decodeUnknownSync(schema as AnySchema)(
        JSON.parse('{"cols":80,"lines":[{"cells":[{"col":7,"chars":"a"}]}]}'),
      ),
    ).toEqual({
      cols: 80,
      lines: [
        {
          cells: [
            {
              col: 7,
              chars: "a",
              width: 1,
              fg: { kind: "default" },
              bg: { kind: "default" },
              bold: false,
              italic: false,
              dim: false,
              underline: false,
              inverse: false,
            },
          ],
        },
      ],
    });
    expect(
      Schema.decodeUnknownSync(schema as AnySchema)(
        JSON.parse(encodeJson(schema, grid)),
      ),
    ).toEqual(grid);
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
