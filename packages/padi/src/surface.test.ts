import { isContractVersionCompatible } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import {
  CONTROL_CORE_VERSION,
  DEFAULT_PADI_IDENTITY,
  DEFAULT_PADI_VERSION,
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  PadiHelloSchema,
  PadiIdentitySchema,
  PadiPreviewReadInputSchema,
  PadiPreviewReadOutputSchema,
  PadiTerminalSchema,
  PadiVersionSchema,
  padiControlSurface,
  padiDaemonContract,
  padiDaemonSurfaces,
  padiMemberKeys,
  padiSurface,
} from "./surface.ts";

describe("padiSurface contract", () => {
  it("builds the padi surface contract", () => {
    expect(padiSurface.contract).toBeTruthy();
  });

  it("is version 4.2, and DEFAULT_PADI_VERSION carries + validates it", () => {
    // 1.1–1.3 were additive minors over 1.0 (recycleKaval, hostInventory, identity).
    // 2.0 was the first MAJOR: (a) it ADDED the per-terminal right-panel `collapsed`
    // field (the panel follows the terminal, #959) — a major because an older client's
    // whole-record `chrome.setRightPanel` write omits it and the REPLACE clobbers a
    // newer client's `collapsed:true`; and (b) it REMOVED `fs.statFileMtimeMs` for
    // `fs.filePreviewTag` — a shape-breaking rename. 3.0 was the second MAJOR
    // (scrollback-backfill): the `terminalAttach` stream output was RESHAPED from a
    // bare `z.string()` to a discriminated `{ kind, data, topLine? }` union frame —
    // breaking in BOTH skew directions. 3.1 (additive minor) added the reflow guard
    // (F3): OPTIONAL `reflowEpoch` + `epoch`/`stale`, both skew directions graceful.
    // 4.0 is the third MAJOR: it REMOVES the dead `lifecycle.restoreSleeping` procedure
    // (retired per #1784's W12 disposition — no production caller). A removed procedure
    // is a shape-break, so an old binder that still called it must refuse a 4.0 padi
    // rather than hit a missing proc — only a major closes that skew in both directions.
    // 4.1 (minor): `daemonStatus` gained the `incompatible` emitted variant
    // (SK4) — an additive arm, so a minor per the versioning doctrine in
    // surface.ts (the mirror of #1865, which folded a bump BACK because
    // nothing emitted had changed; here something did).
    // 4.2 (minor): the ACTIVE terminal arm gained `ports` — the listening TCP
    // ports padi's port sensor attributes to each terminal (PRT1). A new required
    // field on an emitted value, so the same rule applies: the emitted SHAPE
    // changed, therefore the version says so.
    // 4.3 (minor): `PortInfo` traded `wildcard: boolean` for the three-way
    // `scope` (PRT2) — a RESHAPED field rather than an additive one, still a
    // minor because the version gate drains a straddling padi in BOTH
    // directions before either parser meets the other's frame. See surface.ts.
    expect(PADI_SURFACE_VERSION).toBe("4.3");
    expect(DEFAULT_PADI_VERSION.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(PadiVersionSchema.parse(DEFAULT_PADI_VERSION)).toEqual(
      DEFAULT_PADI_VERSION,
    );
    // A newer additive minor (a future 4.x) still serves a 4.0 consumer; a
    // major bump is mutually incompatible in both directions.
    expect(isContractVersionCompatible("4.1", "4.0")).toBe(true);
    expect(isContractVersionCompatible("5.0", "4.0")).toBe(false);
    expect(isContractVersionCompatible("4.0", "5.0")).toBe(false);
    // The 4.0 major gate closes BOTH skew directions against any 3.x peer: a new
    // client (needs 4.0) REFUSES an older 3.x padi, AND an older 3.x client REFUSES
    // this 4.0 padi rather than calling the removed `restoreSleeping`.
    expect(isContractVersionCompatible("3.4", "4.0")).toBe(false);
    expect(isContractVersionCompatible("4.0", "3.4")).toBe(false);
  });

  it("pins the EXACT member list — every member from the surface section", () => {
    const spec = padiSurface.spec;
    expect(Object.keys(spec.cells ?? {})).toEqual([
      "version",
      "identity",
      "urgency",
      "status",
      "hostInventory",
      "processMemory",
      "activityFeed",
      "session",
    ]);
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
      "resize",
      "sendInput",
      "recycleKaval",
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
    expect(Object.keys(procs.screen ?? {})).toEqual([
      "state",
      "text",
      "history",
    ]);
    expect(Object.keys(procs.fs ?? {})).toEqual([
      "listAll",
      "readFile",
      "filePreviewTag",
    ]);
    expect(Object.keys(procs.git ?? {})).toEqual([
      "getStatus",
      "getDiff",
      "worktreeCreate",
      "worktreeRemove",
    ]);
    expect(Object.keys(procs.scratch ?? {})).toEqual(["write"]);
    expect(Object.keys(procs.preview ?? {})).toEqual([
      "read",
      "repoRootForTerminal",
    ]);
    expect(Object.keys(procs.transcript ?? {})).toEqual(["exportHtml"]);
    expect(Object.keys(procs.session ?? {})).toEqual([
      "restore",
      "import",
      "forfeit",
    ]);
  });

  it("the 1.3 `identity` cell DECLARES a nullable commit — never conflated with cell-pending (absence)", () => {
    // `commit: null` is a legitimate, DECLARED value on the wire (a dev/off-nix
    // build with no commit) — schema-valid, unlike an absent field.
    const declaredNoCommit = {
      commit: null,
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "forever" as const },
    };
    expect(PadiIdentitySchema.parse(declaredNoCommit)).toEqual(
      declaredNoCommit,
    );
    // A real commit round-trips too.
    const withCommit = { ...declaredNoCommit, commit: "abc1234" };
    expect(PadiIdentitySchema.parse(withCommit)).toEqual(withCommit);
    // `commit` is REQUIRED-but-nullable on the wire shape — an absent `commit` key
    // fails validation (it must be an explicit `null`, never an omitted field) —
    // the schema-level half of "pending ≠ declared-null": the client's OWN
    // pending state is the SUBSCRIPTION never having yielded this shape at all,
    // never a value that validates with the field missing.
    expect(() =>
      PadiIdentitySchema.parse({
        surfaceVersion: PADI_SURFACE_VERSION,
        startedAt: 0,
        lifetime: { kind: "forever" },
      }),
    ).toThrow();
    expect(DEFAULT_PADI_IDENTITY.commit).toBeNull();
  });

  it("the `lifetime` field is OPTIONAL — a survivor padi predating it still parses (→ undefined, the row reads '—'), and a live one round-trips its policy", () => {
    // A padi predating the lifetime field carries no `lifetime` key. It must parse
    // (optional + additive — no PADI_SURFACE_VERSION bump that would force a drain),
    // leaving `lifetime` undefined so the dialog row falls back to "—".
    const survivor = PadiIdentitySchema.parse({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
    });
    expect(survivor.lifetime).toBeUndefined();
    // A live padi's projected policy survives the parse verbatim.
    const live = PadiIdentitySchema.parse({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
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
    // The two cells that relocated off koluSurface (W1 padi seam) are value —
    // a rebind replays the current session / activity-feed snapshot.
    expect(PADI_FORWARDING_POLICY.session).toBe("value");
    expect(PADI_FORWARDING_POLICY.activityFeed).toBe("value");
    // The 1.2 host-inventory cell is value — a rebind replays the current daemon
    // scan snapshot (so the re-served surface hands the dialog the bound host's
    // list identically local and remote).
    expect(PADI_FORWARDING_POLICY.hostInventory).toBe("value");
  });

  it("the terminals value carries the active | sleeping | parked union", () => {
    // The discriminated union accepts all three record states. `parked` is
    // reserved in the contract from 1.0 (W1.R produces it).
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

  it("preview.read is RANGE-CAPABLE and serve-dir-shaped — not a whole-file blob", () => {
    // The input carries an OPTIONAL raw HTTP `range`, so a `<video>` can seek and
    // a multi-GB file is never forced whole through the heap; absent = whole file.
    expect(PadiPreviewReadInputSchema.shape.range.isOptional()).toBe(true);
    const noRange = PadiPreviewReadInputSchema.parse({
      repoPath: "/repo",
      filePath: "a.png",
    });
    expect(noRange.range).toBeUndefined();
    expect(
      PadiPreviewReadInputSchema.parse({
        repoPath: "/repo",
        filePath: "clip.mp4",
        range: "bytes=0-1023",
      }).range,
    ).toBe("bytes=0-1023");
    // The output mirrors `@kolu/serve-dir`'s `ServeResult` — {status, headers}
    // verbatim + a base64 body — NOT a `{contentBase64, contentType, mtimeMs}`
    // blob, so a 206/416/Content-Range rides the contract unchanged.
    expect(Object.keys(PadiPreviewReadOutputSchema.shape).sort()).toEqual([
      "bodyBase64",
      "headers",
      "status",
    ]);
    const out = PadiPreviewReadOutputSchema.parse({
      status: 206,
      headers: { "Content-Range": "bytes 0-1023/4096" },
      bodyBase64: "",
    });
    expect(out.status).toBe(206);
    expect(out.headers["Content-Range"]).toBe("bytes 0-1023/4096");
  });

  it("serves the frozen control core surface (hello · version · drain · clock.now)", () => {
    expect(CONTROL_CORE_VERSION).toBe("1.0");
    // The frozen `version` cell echoes the control-core version, distinct from
    // padiSurface's own version cell (which may move; this one never does).
    expect(padiControlSurface.spec.cells?.version.default).toEqual({
      controlCoreVersion: CONTROL_CORE_VERSION,
    });
    // The frozen control verbs live under the single `control` namespace — served
    // for real in W2.2 (W1.C pinned their existence as schema shapes). `clockNow`
    // is a frozen member kept FOREVER for cross-version skew, beside the new
    // framework `system.clockNow` measurement path.
    expect(
      Object.keys(padiControlSurface.spec.procedures?.core ?? {}).sort(),
    ).toEqual(["clockNow", "controlVersion", "drain", "hello"]);
    // The daemon serves BOTH surfaces on one socket, keyed `padi` + `control`, so
    // a binder reaches the frozen core even when padiSurface is version-skewed.
    expect(Object.keys(padiDaemonSurfaces).sort()).toEqual(["control", "padi"]);
    expect(padiDaemonContract.surface.control).toBeTruthy();
    expect(padiDaemonContract.surface.padi).toBeTruthy();
    // The hello handshake validates a well-formed identity — including the additive
    // `startedAt` boot time the binder reads for honest uptime, the additive `commit`
    // (the RUNNING padi's build the Padi dialog surfaces), and the additive `buildId`
    // (padi's staleKey — the binder's build-convergence key, #1670). All additive to
    // the never-served frozen core, so CONTROL_CORE_VERSION stays "1.0".
    const hello = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 1_700_000_000_000,
      commit: "abc1234",
      buildId: "cafef00d",
    };
    expect(PadiHelloSchema.parse(hello)).toEqual(hello);
    // `commit` AND `buildId` are OPTIONAL — a survivor padi predating either field
    // omits it and STILL handshakes (its hello validates), so the bind never breaks.
    // (An absent `buildId` is read by a nix-built binder as an older build → drained;
    // that policy lives in padiBinding, not the schema — the schema only proves the
    // handshake never fails on the missing field.)
    const helloNoBuildFields = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 1_700_000_000_000,
    };
    expect(PadiHelloSchema.parse(helloNoBuildFields)).toEqual(
      helloNoBuildFields,
    );
  });
});
