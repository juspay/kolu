import { isContractVersionCompatible, surfaceTag } from "@kolu/surface/define";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { oduServiceSurface } from "@odu/service-client/surface";
import {
  CONTROL_CORE_VERSION,
  DEFAULT_PADI_IDENTITY,
  DEFAULT_PADI_VERSION,
  KavalContractSkew,
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  PadiHelloSchema,
  PadiIdentitySchema,
  PadiPreviewReadInputSchema,
  PadiPreviewReadOutputSchema,
  PadiStatusSchema,
  PadiScreenTextInputSchema,
  PadiTerminalSchema,
  PadiUrgencySchema,
  PadiVersionSchema,
  padiControlSibling,
  padiControlSurface,
  padiDaemonContract,
  padiDaemonGroup,
  padiDaemonSurfaces,
  padiServedSurfaces,
  oduCarriedSurface,
  ODU_FORWARDING_POLICY,
  oduMemberKeys,
  oduSibling,
  padiMemberKeys,
  padiSurface,
  padiSurfaceSibling,
  PreviewTooLarge,
  ScratchWriteRejected,
  TerminalNotActive,
  TerminalNotFound,
  TerminalParentCycle,
  TranscriptNoAgent,
  TranscriptNotFound,
  WorktreeBaseBranchMissing,
  urgencyEqual,
} from "./surface.ts";

const accepts = (
  schema: Parameters<typeof Schema.decodeUnknownResult>[0],
  value: unknown,
): boolean => Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

const decodeIdentity = Schema.decodeUnknownSync(PadiIdentitySchema);

const parkedRecord = (): Record<string, unknown> => ({
  cwd: "/repo",
  git: { kind: "none" },
  pr: { kind: "absent" },
  location: { kind: "local" },
  lastActivityAt: null,
  state: "parked",
  parkedAt: 1_700_000_000_000,
});

describe("padiSurface contract", () => {
  it("builds the padi surface group", () => {
    expect(padiSurface.group.requests.size).toBeGreaterThan(0);
    expect(padiSurface.tagPrefix).toBe("surface/");
  });

  it("declares its surface contract version — DEFAULT_PADI_VERSION carries + validates it", () => {
    expect(PADI_SURFACE_VERSION).toBe("7.12");
    expect(DEFAULT_PADI_VERSION.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(
      Schema.decodeUnknownSync(PadiVersionSchema)(DEFAULT_PADI_VERSION),
    ).toEqual(DEFAULT_PADI_VERSION);
    expect(isContractVersionCompatible("4.7", PADI_SURFACE_VERSION)).toBe(
      false,
    );
    expect(isContractVersionCompatible(PADI_SURFACE_VERSION, "4.7")).toBe(
      false,
    );
    expect(isContractVersionCompatible("5.2", "5.3")).toBe(false);
    expect(isContractVersionCompatible("5.3", "5.2")).toBe(true);
    expect(isContractVersionCompatible("5.3", "5.4")).toBe(false);
    expect(isContractVersionCompatible("5.4", "5.3")).toBe(true);
    expect(isContractVersionCompatible("5.5", "5.6")).toBe(false);
    expect(isContractVersionCompatible("5.6", "5.5")).toBe(true);
    expect(isContractVersionCompatible("5.6", "5.7")).toBe(false);
    expect(isContractVersionCompatible("5.7", "5.6")).toBe(true);
    expect(isContractVersionCompatible("5.7", "5.8")).toBe(false);
    expect(isContractVersionCompatible("5.8", "5.7")).toBe(true);
    expect(isContractVersionCompatible("5.8", "5.9")).toBe(false);
    expect(isContractVersionCompatible("5.9", "5.8")).toBe(true);
    expect(isContractVersionCompatible("5.9", "5.10")).toBe(false);
    expect(isContractVersionCompatible("5.10", "5.9")).toBe(true);
    expect(isContractVersionCompatible("7.0", "7.1")).toBe(false);
    expect(isContractVersionCompatible("7.1", "7.0")).toBe(true);
    expect(isContractVersionCompatible("6.0", "5.0")).toBe(false);
    expect(isContractVersionCompatible("5.0", "6.0")).toBe(false);
  });

  it("pins the EXACT member list — every member from the surface section", () => {
    const spec = padiSurface.spec;
    expect(Object.keys(spec.cells ?? {})).toEqual([
      "version",
      "identity",
      "roster",
      "urgency",
      "status",
      "newTerminalPolicy",
      "agentDistro",
      "agentDistroStatus",
      "agentDistroReceipt",
      "hostListeners",
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
      "watchStates",
      "watchPulse",
      "subscribeRepoChange",
      "subscribeFileChange",
      "pullRequest",
      "terminalAttach",
    ]);
    expect(Object.keys(spec.events ?? {})).toEqual(["terminalExit"]);
    expect(Object.keys(spec.procedures ?? {})).toEqual([
      "watch",
      "lifecycle",
      "chrome",
      "screen",
      "fs",
      "git",
      "scratch",
      "preview",
      "transcript",
      "agentDistro",
      "session",
      "backups",
      "diagnostics",
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
      "restart",
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
      "image",
    ]);
    expect(Object.keys(procs.fs ?? {})).toEqual([
      "listAll",
      "listIgnored",
      "listDirectory",
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
    const declaredNoCommit = {
      commit: null,
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "forever" as const },
    };
    expect(decodeIdentity(declaredNoCommit)).toEqual(declaredNoCommit);
    const withCommit = { ...declaredNoCommit, commit: "abc1234" };
    expect(decodeIdentity(withCommit)).toEqual(withCommit);
    expect(() =>
      decodeIdentity({
        surfaceVersion: PADI_SURFACE_VERSION,
        startedAt: 0,
        lifetime: { kind: "forever" },
      }),
    ).toThrow();
    expect(DEFAULT_PADI_IDENTITY.commit).toBeNull();
  });

  it("the `lifetime` field is OPTIONAL — a survivor padi predating it still parses (→ undefined, the row reads '—'), and a live one round-trips its policy", () => {
    const survivor = decodeIdentity({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
    });
    expect(survivor.lifetime).toBeUndefined();
    const live = decodeIdentity({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
    const encoded = Schema.encodeUnknownSync(PadiIdentitySchema)(
      survivor,
    ) as Record<string, unknown>;
    expect("lifetime" in encoded).toBe(false);
  });

  it("annotates EVERY member with a forwarding policy — no gap, no orphan", () => {
    const members = new Set(padiMemberKeys());
    const annotated = new Set(Object.keys(PADI_FORWARDING_POLICY));
    expect(annotated).toEqual(members);
  });

  it("annotates every ODU SIBLING member too — its own policy, its own gate", () => {
    const members = new Set(oduMemberKeys());
    const annotated = new Set(Object.keys(ODU_FORWARDING_POLICY));
    expect(annotated).toEqual(members);
  });

  it("carries odu's OWN declarations, not a copy of them", () => {
    expect(oduCarriedSurface.spec.cells?.service).toBe(
      oduServiceSurface.spec.cells.service,
    );
    expect(oduCarriedSurface.spec.streams?.checkout).toBe(
      oduServiceSurface.spec.streams.checkout,
    );
  });

  it("serves odu beside padi, at its own tag prefix", () => {
    const tags = [...padiDaemonGroup.requests.keys()];
    expect(tags).toContain("surface/odu/checkout/get");
    expect(tags).toContain("surface/odu/service/get");
    expect(tags).toContain("surface/padi/terminals/keys");
  });

  it("value = hold-open vs delta = fail-through — the three streams whose first frame is a fresh snapshot", () => {
    const delta = Object.entries(PADI_FORWARDING_POLICY)
      .filter(([, policy]) => policy === "delta")
      .map(([key]) => key)
      .sort();
    expect(delta).toEqual(["activity", "terminalAttach", "watchStates"]);
    expect(PADI_FORWARDING_POLICY.activity).toBe("delta");
    expect(PADI_FORWARDING_POLICY.terminalAttach).toBe("delta");
    expect(PADI_FORWARDING_POLICY.watchStates).toBe("delta");
    expect(PADI_FORWARDING_POLICY.subscribeRepoChange).toBe("value");
    expect(PADI_FORWARDING_POLICY.subscribeFileChange).toBe("value");
    expect(PADI_FORWARDING_POLICY.terminals).toBe("value");
    expect(PADI_FORWARDING_POLICY.terminalExit).toBe("value");
    expect(PADI_FORWARDING_POLICY.session).toBe("value");
    expect(PADI_FORWARDING_POLICY.activityFeed).toBe("value");
    expect(PADI_FORWARDING_POLICY.hostInventory).toBe("value");
    expect(PADI_FORWARDING_POLICY.hostListeners).toBe("value");
    expect(PADI_FORWARDING_POLICY.roster).toBe("value");
    expect(PADI_FORWARDING_POLICY.pullRequest).toBe("value");
  });

  it("the terminals value carries the active | sleeping | parked union", () => {
    expect(
      PadiTerminalSchema.members
        .map((member) => member.fields.state.literal)
        .sort(),
    ).toEqual(["active", "parked", "sleeping"]);
  });

  it("the reserved host axis is optional on the terminals value — absent is valid", () => {
    expect(padiSurface.spec.collections?.terminals).toBeTruthy();
    expect(accepts(PadiTerminalSchema, parkedRecord())).toBe(true);
    expect(
      accepts(PadiTerminalSchema, { ...parkedRecord(), host: "zest" }),
    ).toBe(true);
  });

  it("preview.read is RANGE-CAPABLE and serve-dir-shaped — not a whole-file blob", () => {
    const decodeIn = Schema.decodeUnknownSync(PadiPreviewReadInputSchema);
    const noRange = decodeIn({ repoPath: "/repo", filePath: "a.png" });
    expect(noRange.range).toBeUndefined();
    expect(
      decodeIn({
        repoPath: "/repo",
        filePath: "clip.mp4",
        range: "bytes=0-1023",
      }).range,
    ).toBe("bytes=0-1023");
    expect(Object.keys(PadiPreviewReadOutputSchema.fields).sort()).toEqual([
      "bodyBase64",
      "headers",
      "status",
    ]);
    const out = Schema.decodeUnknownSync(PadiPreviewReadOutputSchema)({
      status: 206,
      headers: { "Content-Range": "bytes 0-1023/4096" },
      bodyBase64: "",
    });
    expect(out.status).toBe(206);
    expect(out.headers["Content-Range"]).toBe("bytes 0-1023/4096");
  });

  it("serves the frozen control core surface (hello · version · drain · clock.now)", () => {
    expect(CONTROL_CORE_VERSION).toBe("1.0");
    expect(padiControlSurface.spec.cells?.version.default).toEqual({
      controlCoreVersion: CONTROL_CORE_VERSION,
    });
    expect(
      Object.keys(padiControlSurface.spec.procedures?.core ?? {}).sort(),
    ).toEqual(["clockNow", "controlVersion", "drain", "hello"]);
    expect(Object.keys(padiDaemonSurfaces).sort()).toEqual(["control", "padi"]);
    expect(Object.keys(padiServedSurfaces).sort()).toEqual([
      "control",
      "odu",
      "padi",
    ]);
    expect(Object.keys(padiDaemonContract.siblings).sort()).toEqual([
      "control",
      "odu",
      "padi",
    ]);
    const decodeHello = Schema.decodeUnknownSync(PadiHelloSchema);
    const hello = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 1_700_000_000_000,
      commit: "abc1234",
      buildId: "cafef00d",
    };
    expect(decodeHello(hello)).toEqual(hello);
    const helloNoBuildFields = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 1_700_000_000_000,
    };
    expect(decodeHello(helloNoBuildFields)).toEqual(helloNoBuildFields);
  });
});

describe("padiDaemonContract — the composed tag set (D1 / #16)", () => {
  it("composes the three siblings WITHOUT losing a tag", () => {
    expect(padiDaemonGroup.requests.size).toBe(
      padiSurface.group.requests.size +
        padiControlSurface.group.requests.size +
        oduCarriedSurface.group.requests.size,
    );
  });

  it("each sibling's tags carry its OWN prefix, and the three sets are DISJOINT", () => {
    const padi = [...padiSurfaceSibling.group.requests.keys()];
    const control = [...padiControlSibling.group.requests.keys()];
    const odu = [...oduSibling.group.requests.keys()];
    expect(padi.every((t) => t.startsWith("surface/padi/"))).toBe(true);
    expect(control.every((t) => t.startsWith("surface/control/"))).toBe(true);
    expect(odu.every((t) => t.startsWith("surface/odu/"))).toBe(true);
    expect(padi.filter((t) => control.includes(t) || odu.includes(t))).toEqual(
      [],
    );
    expect([...padiDaemonGroup.requests.keys()].sort()).toEqual(
      [...padi, ...control, ...odu].sort(),
    );
  });

  it("the three reserved system/* tags exist ONCE PER SIBLING — the collision a bare merge would have eaten", () => {
    for (const verb of ["live", "identity", "clockNow"]) {
      expect(padiDaemonGroup.requests.has(`surface/padi/system/${verb}`)).toBe(
        true,
      );
      expect(
        padiDaemonGroup.requests.has(`surface/control/system/${verb}`),
      ).toBe(true);
    }
  });

  it("pins the wire tags a consumer addresses, literally", () => {
    for (const tag of [
      "surface/padi/lifecycle/create",
      "surface/padi/lifecycle/recycleKaval",
      "surface/padi/terminals/keys",
      "surface/padi/terminals/get",
      "surface/padi/terminalAttach/get",
      "surface/padi/terminalExit/get",
      "surface/padi/identity/get",
      "surface/padi/newTerminalPolicy/set",
      "surface/padi/agentDistro/set",
      "surface/padi/agentDistroStatus/get",
      "surface/padi/agentDistroReceipt/get",
      "surface/padi/agentDistro/report",
      "surface/padi/diagnostics/read",
      "surface/control/core/hello",
      "surface/control/core/drain",
      "surface/control/core/clockNow",
      "surface/control/version/get",
    ]) {
      expect(padiDaemonGroup.requests.has(tag)).toBe(true);
    }
    for (const gone of ["checkNow", "retryDownload"]) {
      expect(
        padiDaemonGroup.requests.has(`surface/padi/agentDistro/${gone}`),
      ).toBe(false);
    }
    expect(surfaceTag(padiSurfaceSibling.tagPrefix, "lifecycle", "kill")).toBe(
      "surface/padi/lifecycle/kill",
    );
  });

  it("a READ-ONLY cell carries no write verb", () => {
    expect(padiDaemonGroup.requests.has("surface/padi/identity/get")).toBe(
      true,
    );
    expect(padiDaemonGroup.requests.has("surface/padi/identity/set")).toBe(
      false,
    );
  });
});

describe("the declared error vocabulary (PLAN D4)", () => {
  it("names exactly the procedures that CAN refuse — and no others", () => {
    const declared: string[] = [];
    for (const [ns, verbs] of Object.entries(
      padiSurface.spec.procedures ?? {},
    )) {
      for (const [verb, spec] of Object.entries(verbs)) {
        if ((spec as { error?: unknown }).error !== undefined) {
          declared.push(`${ns}.${verb}`);
        }
      }
    }
    expect(declared.sort()).toEqual(
      [
        "agentDistro.launch",
        "agentDistro.models",
        "chrome.setCanvasLayout",
        "chrome.setIntent",
        "chrome.setParent",
        "chrome.setRightPanel",
        "chrome.setSubPanel",
        "chrome.setTheme",
        "fs.filePreviewTag",
        "fs.listAll",
        "fs.listDirectory",
        "fs.listIgnored",
        "fs.readFile",
        "git.getDiff",
        "git.getStatus",
        "git.worktreeCreate",
        "git.worktreeRemove",
        "lifecycle.create",
        "lifecycle.kill",
        "lifecycle.recycleKaval",
        "lifecycle.restart",
        "lifecycle.wake",
        "preview.read",
        "screen.history",
        "screen.image",
        "screen.state",
        "screen.text",
        "scratch.write",
        "transcript.exportHtml",
        "watch.close",
        "watch.drain",
      ].sort(),
    );
  });

  it("every error round-trips encode → JSON → decode with its tag, data and message intact", () => {
    const cases = [
      new TerminalNotFound({ id: "t-1" }),
      new TerminalNotActive({ id: "t-2", state: "sleeping" }),
      new TerminalNotActive({ id: "t-3", state: "parked" }),
      new TerminalParentCycle({
        childId: "a",
        parentId: "b",
        reason: "wouldCycle",
      }),
      new ScratchWriteRejected({ reason: "too big" }),
      new PreviewTooLarge({ limitBytes: 67_108_864 }),
      new TranscriptNoAgent(),
      new TranscriptNotFound({ agentKind: "claude-code", sessionId: "s-1" }),
      new KavalContractSkew({ daemonVersion: "6.0", requiredVersion: "7.0" }),
    ];
    for (const original of cases) {
      const schema = original.constructor as unknown as Schema.Codec<
        unknown,
        unknown
      >;
      const bytes = JSON.stringify(Schema.encodeUnknownSync(schema)(original));
      const back = Schema.decodeUnknownSync(schema)(JSON.parse(bytes)) as {
        _tag: string;
        message: string;
      };
      expect(back._tag).toBe(original._tag);
      expect(back.message).toBe(original.message);
      expect(JSON.stringify(Schema.encodeUnknownSync(schema)(back))).toBe(
        bytes,
      );
    }
  });

  it("the skew refusal carries BOTH versions as typed data — nothing re-parses prose", () => {
    const err = new KavalContractSkew({
      daemonVersion: "6.0",
      requiredVersion: "7.0",
    });
    expect(err._tag).toBe("KavalContractSkew");
    expect({
      daemonVersion: err.daemonVersion,
      requiredVersion: err.requiredVersion,
    }).toEqual({ daemonVersion: "6.0", requiredVersion: "7.0" });
    expect(err.message).toContain("6.0");
    expect(err.message).toContain("7.0");
  });

  it("a missing base branch crosses git.getStatus and git.getDiff with its sentence", () => {
    const sentence =
      "No base branch found — origin/master doesn't exist. Run: git fetch origin && git remote set-head origin --auto";
    const original = new WorktreeBaseBranchMissing({ detail: sentence });
    const git = padiSurface.spec.procedures.git;
    for (const error of [git.getStatus.error, git.getDiff.error]) {
      const schema = error as Schema.Codec<unknown, unknown>;
      const bytes = JSON.stringify(Schema.encodeUnknownSync(schema)(original));
      const back = Schema.decodeUnknownSync(schema)(JSON.parse(bytes));
      expect(back).toBeInstanceOf(WorktreeBaseBranchMissing);
      expect((back as WorktreeBaseBranchMissing).message).toBe(sentence);
    }
  });
});

describe("PadiUrgency — the rolling-deploy defaults, in BYTES", () => {
  const decode = Schema.decodeUnknownSync(PadiUrgencySchema);
  const encode = Schema.encodeUnknownSync(PadiUrgencySchema);
  const ID = "123e4567-e89b-12d3-a456-426614174000";

  it("ACCEPT-MISSING: an OLDER padi's frame (awaitingIds only) decodes with empty lists", () => {
    expect(decode({ awaitingIds: [ID] })).toEqual({
      awaitingIds: [ID],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
      settled: true,
    });
  });

  it("a frame from a 7.11 padi, which never says `settled`, reads as settled — what it always meant", () => {
    expect(
      decode({ awaitingIds: [], finishedIds: [ID], workingIds: [] }).settled,
    ).toBe(true);
  });

  it("EMIT-KEY: a frame this build serves carries every key, in declaration order", () => {
    expect(JSON.stringify(encode(decode({ awaitingIds: [] })))).toBe(
      '{"awaitingIds":[],"finishedIds":[],"workingIds":[],"lingerIds":[],"settled":true}',
    );
    expect(
      JSON.stringify(
        encode(
          decode({
            awaitingIds: [ID],
            finishedIds: [ID],
            workingIds: [],
            lingerIds: [ID],
            settled: false,
          }),
        ),
      ),
    ).toBe(
      `{"awaitingIds":["${ID}"],"finishedIds":["${ID}"],"workingIds":[],"lingerIds":["${ID}"],"settled":false}`,
    );
  });

  it("an EXPLICIT undefined is REJECTED — an older padi OMITS the key, it never sends undefined", () => {
    expect(
      accepts(PadiUrgencySchema, { awaitingIds: [], finishedIds: undefined }),
    ).toBe(false);
  });

  it("each decode gets its OWN default array — never one shared mutable instance", () => {
    const a = decode({ awaitingIds: [] });
    const b = decode({ awaitingIds: [] });
    expect(a.finishedIds).not.toBe(b.finishedIds);
  });
});

describe("urgencyEqual — the one wire dedup point", () => {
  const empty = {
    awaitingIds: [],
    finishedIds: [],
    workingIds: [],
    lingerIds: [],
  };

  it("tells a frame nobody has looked at from an empty fleet that was looked at", () => {
    expect(
      urgencyEqual({ ...empty, settled: false }, { ...empty, settled: true }),
    ).toBe(false);
    expect(
      urgencyEqual({ ...empty, settled: true }, { ...empty, settled: true }),
    ).toBe(true);
  });
});

describe("the two optional-key spellings on this wire, in BYTES (#17 audit)", () => {
  const ID = "123e4567-e89b-12d3-a456-426614174000";
  const KAVAL = { staleKey: "abc123", navigableCommit: "deadbeef" };

  describe("status.expectedKaval stays optionalKey — one producer, disciplined", () => {
    const encode = Schema.encodeUnknownSync(PadiStatusSchema);

    it("omits the key entirely off-nix, where there is no baked identity", () => {
      expect(JSON.stringify(encode({}))).toBe("{}");
    });

    it("carries the identity when nix baked one", () => {
      expect(JSON.stringify(encode({ expectedKaval: KAVAL }))).toBe(
        `{"expectedKaval":{"staleKey":"${KAVAL.staleKey}","navigableCommit":"${KAVAL.navigableCommit}"}}`,
      );
    });

    it("REJECTS a present-but-undefined key — the shape `servePadi` used to seed", () => {
      expect(accepts(PadiStatusSchema, { expectedKaval: undefined })).toBe(
        false,
      );
    });
  });

  describe("the attach snapshot's reflowEpoch is `optional` — five verbatim hops", () => {
    const frame = padiSurface.spec.streams.terminalAttach.outputSchema;
    const encode = Schema.encodeUnknownSync(frame);
    const GRID = { cols: 80, rows: 24 } as const;
    const SNAPSHOT_BYTES =
      '{"kind":"snapshot","data":"hi","topLine":0,"grid":{"cols":80,"rows":24}}';

    it("ACCEPTS a present-but-undefined reflowEpoch, and OMITS it from the bytes", () => {
      expect(
        JSON.stringify(
          encode({
            kind: "snapshot",
            data: "hi",
            topLine: 0,
            reflowEpoch: undefined,
            grid: GRID,
          }),
        ),
      ).toBe(SNAPSHOT_BYTES);
    });

    it("an ABSENT key emits the same bytes — `optional` never nulls", () => {
      expect(
        JSON.stringify(
          encode({ kind: "snapshot", data: "hi", topLine: 0, grid: GRID }),
        ),
      ).toBe(SNAPSHOT_BYTES);
    });

    it("still emits a real epoch, and still REJECTS a non-integer one", () => {
      expect(
        JSON.stringify(
          encode({
            kind: "snapshot",
            data: "",
            topLine: 3,
            reflowEpoch: 7,
            grid: GRID,
          }),
        ),
      ).toBe(
        '{"kind":"snapshot","data":"","topLine":3,"reflowEpoch":7,"grid":{"cols":80,"rows":24}}',
      );
      expect(
        accepts(frame, {
          kind: "snapshot",
          data: "",
          topLine: 0,
          reflowEpoch: "7",
        }),
      ).toBe(false);
    });

    it("REFUSES a snapshot that states no grid — there is no sizing it", () => {
      expect(accepts(frame, { kind: "snapshot", data: "hi", topLine: 0 })).toBe(
        false,
      );
      expect(
        accepts(frame, {
          kind: "snapshot",
          data: "hi",
          topLine: 0,
          grid: undefined,
        }),
      ).toBe(false);
    });

    it("emits a real grid, and REJECTS a malformed one", () => {
      expect(
        JSON.stringify(
          encode({
            kind: "snapshot",
            data: "",
            topLine: 0,
            grid: { cols: 80, rows: 24 },
          }),
        ),
      ).toBe(
        '{"kind":"snapshot","data":"","topLine":0,"grid":{"cols":80,"rows":24}}',
      );
      expect(
        accepts(frame, {
          kind: "snapshot",
          data: "",
          topLine: 0,
          grid: { cols: 80 },
        }),
      ).toBe(false);
      expect(
        accepts(frame, {
          kind: "snapshot",
          data: "",
          topLine: 0,
          grid: { cols: 0, rows: 24 },
        }),
      ).toBe(false);
    });

    it("a delta frame is untouched by any of this", () => {
      expect(JSON.stringify(encode({ kind: "delta", data: ID }))).toBe(
        `{"kind":"delta","data":"${ID}"}`,
      );
    });

    it("a resized frame carries nothing but the grid", () => {
      expect(
        JSON.stringify(
          encode({ kind: "resized", grid: { cols: 80, rows: 24 } }),
        ),
      ).toBe('{"kind":"resized","grid":{"cols":80,"rows":24}}');
      expect(accepts(frame, { kind: "resized" })).toBe(false);
      expect(
        accepts(frame, { kind: "resized", grid: { cols: 0, rows: 24 } }),
      ).toBe(false);
    });
  });
});

describe("PadiScreenTextInputSchema — one bound, never two", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("refuses `tail` beside either line bound — no precedence picks one", () => {
    expect(
      accepts(PadiScreenTextInputSchema, { id, tail: 5, startLine: 0 }),
    ).toBe(false);
    expect(
      accepts(PadiScreenTextInputSchema, { id, tail: 5, endLine: 9 }),
    ).toBe(false);
  });

  it("refuses a tail of zero lines", () => {
    expect(accepts(PadiScreenTextInputSchema, { id, tail: 0 })).toBe(false);
  });

  it("decodes a tail alone, a range alone, and no bound at all", () => {
    expect(accepts(PadiScreenTextInputSchema, { id, tail: 1 })).toBe(true);
    expect(
      accepts(PadiScreenTextInputSchema, { id, startLine: 2, endLine: 9 }),
    ).toBe(true);
    expect(accepts(PadiScreenTextInputSchema, { id })).toBe(true);
  });
});
