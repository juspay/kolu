import { isContractVersionCompatible } from "@kolu/surface/define";
import { surfaces } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  CONTROL_CORE_VERSION,
  DEFAULT_PADI_VERSION,
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  padiControlCore,
  PadiHelloSchema,
  padiMemberKeys,
  padiSurface,
  PadiTerminalSchema,
  PadiVersionSchema,
  surfacesWithPadi,
} from "./surface.ts";

describe("padiSurface 1.0 contract", () => {
  it("builds the padi surface contract", () => {
    expect(padiSurface.contract).toBeTruthy();
  });

  it("is version 1.0, and DEFAULT_PADI_VERSION carries + validates it", () => {
    expect(PADI_SURFACE_VERSION).toBe("1.0");
    expect(DEFAULT_PADI_VERSION.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(PadiVersionSchema.parse(DEFAULT_PADI_VERSION)).toEqual(
      DEFAULT_PADI_VERSION,
    );
    // A newer additive minor (a future 1.x) still serves a 1.0 consumer; a
    // major bump is mutually incompatible in both directions.
    expect(isContractVersionCompatible("1.1", "1.0")).toBe(true);
    expect(isContractVersionCompatible("2.0", "1.0")).toBe(false);
    expect(isContractVersionCompatible("1.0", "2.0")).toBe(false);
  });

  it("pins the EXACT member list — every member from the surface section", () => {
    const spec = padiSurface.spec;
    expect(Object.keys(spec.cells ?? {})).toEqual(["version", "urgency"]);
    expect(Object.keys(spec.collections ?? {})).toEqual([
      "terminals",
      "daemonStatus",
    ]);
    expect(Object.keys(spec.streams ?? {})).toEqual([
      "activity",
      "subscribeRepoChange",
      "subscribeFileChange",
      "terminalAttach",
    ]);
    expect(Object.keys(spec.events ?? {})).toEqual(["terminalExit"]);
    expect(Object.keys(spec.procedures ?? {})).toEqual([
      "lifecycle",
      "chrome",
      "screen",
      "fs",
      "git",
      "scratch",
      "preview",
      "transcript",
      "session",
    ]);
  });

  it("pins the lifecycle + chrome + screen + fs + git procedure verbs", () => {
    const procs = padiSurface.spec.procedures ?? {};
    expect(Object.keys(procs.lifecycle ?? {})).toEqual([
      "create",
      "kill",
      "killAll",
      "sleep",
      "wake",
      "discardSleeping",
      "restoreSleeping",
      "resize",
      "sendInput",
    ]);
    expect(Object.keys(procs.chrome ?? {})).toEqual([
      "setTheme",
      "setIntent",
      "setParent",
      "setActive",
      "setCanvasLayout",
      "setSubPanel",
      "setRightPanel",
    ]);
    expect(Object.keys(procs.screen ?? {})).toEqual(["state", "text"]);
    expect(Object.keys(procs.fs ?? {})).toEqual([
      "listAll",
      "readFile",
      "statFileMtimeMs",
    ]);
    expect(Object.keys(procs.git ?? {})).toEqual([
      "getStatus",
      "getDiff",
      "worktreeCreate",
      "worktreeRemove",
    ]);
    expect(Object.keys(procs.scratch ?? {})).toEqual(["write"]);
    expect(Object.keys(procs.preview ?? {})).toEqual(["read"]);
    expect(Object.keys(procs.transcript ?? {})).toEqual(["exportHtml"]);
    expect(Object.keys(procs.session ?? {})).toEqual(["restore", "import"]);
  });

  it("annotates EVERY member with a forwarding policy — no gap, no orphan", () => {
    const members = new Set(padiMemberKeys());
    const annotated = new Set(Object.keys(PADI_FORWARDING_POLICY));
    // Every declared member has a policy AND every policy names a real member —
    // set equality proves both (no unannotated member, no orphan annotation).
    expect(annotated).toEqual(members);
  });

  it("value = hold-open vs delta = fail-through — only activity + terminalAttach are delta", () => {
    const delta = Object.entries(PADI_FORWARDING_POLICY)
      .filter(([, policy]) => policy === "delta")
      .map(([key]) => key)
      .sort();
    expect(delta).toEqual(["activity", "terminalAttach"]);
    // The delta members are exactly the two the note names; everything else
    // (cells, collections, pulses, procedures, the terminalExit event) is value.
    expect(PADI_FORWARDING_POLICY.activity).toBe("delta");
    expect(PADI_FORWARDING_POLICY.terminalAttach).toBe("delta");
    expect(PADI_FORWARDING_POLICY.subscribeRepoChange).toBe("value");
    expect(PADI_FORWARDING_POLICY.subscribeFileChange).toBe("value");
    expect(PADI_FORWARDING_POLICY.terminals).toBe("value");
    expect(PADI_FORWARDING_POLICY.terminalExit).toBe("value");
  });

  it("the terminals value carries the active | sleeping | parked union", () => {
    // The discriminated union accepts all three record states. `parked` is
    // reserved in the contract from 1.0 (W1.7 produces it).
    expect(
      PadiTerminalSchema.options.map((o) => o.shape.state.value).sort(),
    ).toEqual(["active", "parked", "sleeping"]);
  });

  it("the reserved host axis is optional on the terminals value — absent is valid", () => {
    // `host` is reserved for the cross-host dock (W4); a W1 record omits it and
    // still validates, so the axis exists in the contract without a break.
    expect(padiSurface.spec.collections?.terminals).toBeTruthy();
    const shape = PadiTerminalSchema.options[0].shape;
    expect(shape.host.isOptional()).toBe(true);
  });

  it("defines the frozen control core (hello · version · drain · clock.now)", () => {
    expect(CONTROL_CORE_VERSION).toBe("1.0");
    expect(padiControlCore.version).toBe(CONTROL_CORE_VERSION);
    // The four control-core members are present as schema shapes (served for
    // real in W2.2; W1.1 pins their existence).
    expect(padiControlCore.hello.output).toBeTruthy();
    expect(padiControlCore.controlVersion.output).toBeTruthy();
    expect(padiControlCore.drain).toEqual({});
    expect(padiControlCore.clockNow.output).toBeTruthy();
    // The hello handshake validates a well-formed identity.
    const hello = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
    };
    expect(PadiHelloSchema.parse(hello)).toEqual(hello);
  });

  it("serves BESIDE koluSurface — surfacesWithPadi adds `padi` to the sibling map", () => {
    // The padi-less `surfaces` map (what the client consumes) is unchanged; the
    // combined map kolu-server serves adds exactly the `padi` sibling.
    expect(Object.keys(surfaces)).not.toContain("padi");
    expect(Object.keys(surfacesWithPadi)).toEqual([
      ...Object.keys(surfaces),
      "padi",
    ]);
    expect(surfacesWithPadi.padi).toBe(padiSurface);
  });
});
