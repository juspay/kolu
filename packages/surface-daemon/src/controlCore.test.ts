/**
 * The frozen fragment: what it serves, and what its bytes look like.
 *
 * The byte fixtures are the evidence behind PLAN D6's decision NOT to bump
 * {@link CONTROL_CORE_VERSION} across the Effect-4 flag day. That constant
 * versions the hello **payload**, and the payload did not move: `Schema.Struct`
 * + `Schema.optionalKey` encode the same six fields, in the same order, with an
 * absent optional simply absent — exactly what zod's `.optional()` produced. The
 * epoch (the framing) is what changed, and an epoch break is not something a
 * value carried *inside* the frame can describe.
 */

import { Effect, Schema } from "effect";
import { buildSurfaceFace, type UnaryEffect } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import { describe, expect, it, vi } from "vitest";
import {
  CONTROL_CORE_VERSION,
  type ControlCoreHello,
  ControlCoreHelloSchema,
  controlCoreFragment,
  controlCoreSurface,
} from "./controlCore.ts";

describe("controlCoreFragment", () => {
  it("serves the frozen identity fields and awaits the drain hook", async () => {
    const onDrain = vi.fn(async () => {});
    const runtime = implementSurface(
      controlCoreSurface,
      controlCoreFragment({
        stateRoot: "/state/pulse",
        surfaceVersion: "3.2",
        startedAt: 42,
        commit: "deadbee",
        buildId: "build-7",
        onDrain,
      }),
    );
    const face = buildSurfaceFace(controlCoreSurface, directDispatch(runtime));
    // `SurfaceFace` is deliberately structural (D2: per-member precision lives
    // in the spec-derived bound faces, which need Solid). This package has no
    // Solid dependency, so the frozen fragment's two verbs are named here at
    // their declared shapes — the point of the test is the SERVED behaviour, and
    // the fragment's types are pinned by `controlCoreFragment`'s own `satisfies`.
    const core = face.surface.core as Record<string, unknown>;
    const hello = core.hello as UnaryEffect<void, ControlCoreHello, never>;
    const drain = core.drain as UnaryEffect<void, void, never>;

    await expect(Effect.runPromise(hello())).resolves.toEqual({
      stateRoot: "/state/pulse",
      surfaceVersion: "3.2",
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 42,
      commit: "deadbee",
      buildId: "build-7",
    });
    await Effect.runPromise(drain());
    expect(onDrain).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("a rejecting drain hook is a DEFECT, not a member error (D4)", async () => {
    // The procedure declares no error schema, so an undeclared throw must not
    // become something a supervisor could narrow on and "handle".
    const boom = new Error("state write failed");
    const runtime = implementSurface(
      controlCoreSurface,
      controlCoreFragment({
        stateRoot: "/state/pulse",
        surfaceVersion: "3.2",
        startedAt: 42,
        commit: "deadbee",
        buildId: "build-7",
        onDrain: () => Promise.reject(boom),
      }),
    );
    const drain = runtime.handlers["surface/core/drain"];
    if (drain === undefined) throw new Error("drain handler not bound");
    const exit = await Effect.runPromiseExit(
      drain(undefined) as Effect.Effect<void, never>,
    );
    expect(exit._tag).toBe("Failure");
    expect(String(exit)).toContain("state write failed");
    await runtime.close();
  });
});

describe("ControlCoreHelloSchema — frozen payload bytes", () => {
  const encode = Schema.encodeUnknownSync(ControlCoreHelloSchema);

  it("encodes the baked identity pair byte-for-byte as the pre-Effect wire did", () => {
    expect(
      JSON.stringify(
        encode({
          stateRoot: "/state/pulse",
          surfaceVersion: "3.2",
          controlCoreVersion: "1.0",
          startedAt: 42,
          commit: "deadbee",
          buildId: "build-7",
        }),
      ),
    ).toBe(
      '{"stateRoot":"/state/pulse","surfaceVersion":"3.2","controlCoreVersion":"1.0","startedAt":42,"commit":"deadbee","buildId":"build-7"}',
    );
  });

  it("omits an absent identity pair — never encodes it as null (#17: optionalKey, not optional)", () => {
    expect(
      JSON.stringify(
        encode({
          stateRoot: "/state/pulse",
          surfaceVersion: "3.2",
          controlCoreVersion: "1.0",
          startedAt: 42,
        }),
      ),
    ).toBe(
      '{"stateRoot":"/state/pulse","surfaceVersion":"3.2","controlCoreVersion":"1.0","startedAt":42}',
    );
  });

  it("round-trips the off-nix empty pair (both empty is a legal observation)", () => {
    const offNix = {
      stateRoot: "/state/pulse",
      surfaceVersion: "3.2",
      controlCoreVersion: "1.0",
      startedAt: 42,
      commit: "",
      buildId: "",
    };
    expect(
      Schema.decodeUnknownSync(ControlCoreHelloSchema)(
        JSON.parse(JSON.stringify(encode(offNix))) as unknown,
      ),
    ).toEqual(offNix);
  });

  it("CONTROL_CORE_VERSION did not move across the Effect-4 epoch break", () => {
    // Load-bearing, not a tautology: the constant versions the PAYLOAD shape,
    // and the fixtures above are what license leaving it alone. If a field is
    // ever added, removed, or renamed, those fixtures fail first and this line
    // is the reminder that the bump belongs in the same commit.
    expect(CONTROL_CORE_VERSION).toBe("1.0");
  });
});
