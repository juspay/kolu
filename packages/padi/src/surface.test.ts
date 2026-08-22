import { isContractVersionCompatible, surfaceTag } from "@kolu/surface/define";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CONTROL_CORE_VERSION,
  DEFAULT_PADI_IDENTITY,
  DEFAULT_PADI_VERSION,
  KavalContractSkew,
  PADI_DAEMON_TAG_COUNT,
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  PadiHelloSchema,
  PadiIdentitySchema,
  PadiPreviewReadInputSchema,
  PadiPreviewReadOutputSchema,
  PadiStatusSchema,
  PadiTerminalSchema,
  PadiUrgencySchema,
  PadiVersionSchema,
  padiControlSibling,
  padiControlSurface,
  padiDaemonContract,
  padiDaemonGroup,
  padiDaemonSurfaces,
  padiMemberKeys,
  padiSurface,
  padiSurfaceSibling,
  PreviewTooLarge,
  ScratchWriteRejected,
  TerminalNotFound,
  TerminalParentCycle,
  TranscriptNoAgent,
  TranscriptNotFound,
} from "./surface.ts";

/** zod's `.safeParse(x).success`, in Effect terms. */
const accepts = (
  schema: Parameters<typeof Schema.decodeUnknownResult>[0],
  value: unknown,
): boolean => Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

const decodeIdentity = Schema.decodeUnknownSync(PadiIdentitySchema);

/** A minimal PARKED record — the arm that exists only on the wire side. */
const parkedRecord = (): Record<string, unknown> => ({
  cwd: "/repo",
  git: null,
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

  it("is version 5.1 — a minor over the D6 protocol epoch — and DEFAULT_PADI_VERSION carries + validates it", () => {
    // 1.1–1.3 were additive minors over 1.0 (recycleKaval, hostInventory, identity).
    // 2.0 was the first MAJOR: (a) it ADDED the per-terminal right-panel `collapsed`
    // field (the panel follows the terminal, #959) — a major because an older client's
    // whole-record `chrome.setRightPanel` write omits it and the REPLACE clobbers a
    // newer client's `collapsed:true`; and (b) it REMOVED `fs.statFileMtimeMs` for
    // `fs.filePreviewTag` — a shape-breaking rename. 3.0 was the second MAJOR
    // (scrollback-backfill): the `terminalAttach` stream output was RESHAPED from a
    // bare string to a discriminated `{ kind, data, topLine? }` union frame —
    // breaking in BOTH skew directions. 3.1 (additive minor) added the reflow guard
    // (F3): OPTIONAL `reflowEpoch` + `epoch`/`stale`, both skew directions graceful.
    // 4.0 was the third MAJOR: it REMOVED the dead `lifecycle.restoreSleeping`
    // procedure (retired per #1784's W12 disposition — no production caller).
    // 4.1–4.7 were additive/reshaping minors (the `incompatible` status arm,
    // `ports`, `scope`, `fs.listIgnored`, the session-restore intent reshape,
    // `fs.listDirectory`, the `newTerminalPolicy` cell).
    //
    // 5.0 is the fourth MAJOR, and it is the PROTOCOL-EPOCH flag day (PLAN D6). No
    // payload shape moved — the byte fixtures below assert that directly — but the
    // FRAMING beneath every member did (oRPC peer protocol → Effect RPC ndjson), and
    // the declared error channel stopped being a code map and became tagged classes.
    // The bump is not cosmetic even though the lever is inert across that break: two
    // mutually undecodable epochs must never report the SAME string, or a survivor
    // reporting "4.7" would compare EQUAL to this build's expectation and be adopted
    // as wire-compatible — the version lever silently disarmed across the one break
    // it most needed to name.
    //
    // 5.1 is the first additive minor of this epoch: `session.restore` gained an
    // OUTPUT — the active-terminal marker it settled on — so the client stops
    // reading a restore's active tile off the `session` cell's next snapshot. That
    // was a race the client cannot win: the snapshot publishes behind a
    // synchronous disk write while the restored terminals publish as they spawn.
    expect(PADI_SURFACE_VERSION).toBe("5.4");
    expect(DEFAULT_PADI_VERSION.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(
      Schema.decodeUnknownSync(PadiVersionSchema)(DEFAULT_PADI_VERSION),
    ).toEqual(DEFAULT_PADI_VERSION);
    // The epoch guard, stated as the predicate sees it: a previous-epoch string
    // is a MAJOR mismatch, refused in both directions, so no 4.x peer is ever
    // adopted by this build and no 4.x binder adopts this padi.
    expect(isContractVersionCompatible("4.7", PADI_SURFACE_VERSION)).toBe(
      false,
    );
    expect(isContractVersionCompatible(PADI_SURFACE_VERSION, "4.7")).toBe(
      false,
    );
    // The IN-EPOCH mechanism still works and must keep working from here on: a
    // binder that expects a future additive minor refuses a padi still reporting
    // 5.1, so convergence drains-and-respawns it BEFORE the new client touches a
    // member padi does not serve.
    expect(isContractVersionCompatible("5.2", "5.3")).toBe(false);
    // A newer additive minor still serves a 5.2 consumer.
    expect(isContractVersionCompatible("5.3", "5.2")).toBe(true);
    // 5.4 is `screen.image`: a binder expecting it refuses a 5.3 padi that
    // cannot serve it, which is the whole point of the bump — a gate-only
    // CLI/MCP face would otherwise adopt that padi and die on the member.
    expect(isContractVersionCompatible("5.3", "5.4")).toBe(false);
    expect(isContractVersionCompatible("5.4", "5.3")).toBe(true);
    // A major bump is mutually incompatible in both directions.
    expect(isContractVersionCompatible("6.0", "5.0")).toBe(false);
    expect(isContractVersionCompatible("5.0", "6.0")).toBe(false);
  });

  it("pins the EXACT member list — every member from the surface section", () => {
    const spec = padiSurface.spec;
    expect(Object.keys(spec.cells ?? {})).toEqual([
      "version",
      "identity",
      "urgency",
      "status",
      "newTerminalPolicy",
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
      "session",
      "backups",
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
    // `commit: null` is a legitimate, DECLARED value on the wire (a dev/off-nix
    // build with no commit) — schema-valid, unlike an absent field.
    const declaredNoCommit = {
      commit: null,
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "forever" as const },
    };
    expect(decodeIdentity(declaredNoCommit)).toEqual(declaredNoCommit);
    // A real commit round-trips too.
    const withCommit = { ...declaredNoCommit, commit: "abc1234" };
    expect(decodeIdentity(withCommit)).toEqual(withCommit);
    // `commit` is REQUIRED-but-nullable on the wire shape — an absent `commit` key
    // fails validation (it must be an explicit `null`, never an omitted field) —
    // the schema-level half of "pending ≠ declared-null": the client's OWN
    // pending state is the SUBSCRIPTION never having yielded this shape at all,
    // never a value that validates with the field missing.
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
    // A padi predating the lifetime field carries no `lifetime` key. It must parse
    // (optional + additive — no PADI_SURFACE_VERSION bump that would force a drain),
    // leaving `lifetime` undefined so the dialog row falls back to "—".
    const survivor = decodeIdentity({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
    });
    expect(survivor.lifetime).toBeUndefined();
    // A live padi's projected policy survives the parse verbatim.
    const live = decodeIdentity({
      commit: "abc1234",
      surfaceVersion: PADI_SURFACE_VERSION,
      startedAt: 1_700_000_000_000,
      lifetime: { kind: "boundToPid", pid: 4321 },
    });
    expect(live.lifetime).toEqual({ kind: "boundToPid", pid: 4321 });
    // `optionalKey`, never `optional` (PLAN #17): an ABSENT key is the only
    // spelling of absence on this wire, and it re-encodes ABSENT — never `null`,
    // which is what `Schema.optional` would have silently produced.
    const encoded = Schema.encodeUnknownSync(PadiIdentitySchema)(
      survivor,
    ) as Record<string, unknown>;
    expect("lifetime" in encoded).toBe(false);
  });

  it("annotates EVERY member with a forwarding policy — no gap, no orphan", () => {
    const members = new Set(padiMemberKeys());
    const annotated = new Set(Object.keys(PADI_FORWARDING_POLICY));
    // Every declared member has a policy AND every policy names a real member —
    // set equality proves both (no unannotated member, no orphan annotation).
    expect(annotated).toEqual(members);
  });

  it("value = hold-open vs delta = fail-through — the three streams whose first frame is a fresh snapshot", () => {
    const delta = Object.entries(PADI_FORWARDING_POLICY)
      .filter(([, policy]) => policy === "delta")
      .map(([key]) => key)
      .sort();
    expect(delta).toEqual(["activity", "terminalAttach", "watchStates"]);
    // The delta members are exactly the three the note names; everything else
    // (cells, collections, pulses, procedures, the terminalExit event) is value.
    expect(PADI_FORWARDING_POLICY.activity).toBe("delta");
    expect(PADI_FORWARDING_POLICY.terminalAttach).toBe("delta");
    // A supervision batch is an EVENT list, not a level: replaying one on a
    // rebind would re-report a nag the consumer already acted on, and its
    // subscribe-time snapshot is only ever a fresh stream's first frame.
    expect(PADI_FORWARDING_POLICY.watchStates).toBe("delta");
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
    // The union accepts all three record states. `parked` is reserved in the
    // contract from 1.0 (W1.R produces it). Read off the schema's own members —
    // `Schema.Union`'s `.members`, the successor of zod's `.options`.
    expect(
      PadiTerminalSchema.members
        .map((member) => member.fields.state.literal)
        .sort(),
    ).toEqual(["active", "parked", "sleeping"]);
  });

  it("the reserved host axis is optional on the terminals value — absent is valid", () => {
    // `host` is reserved for the cross-host dock (W4); a W1 record omits it and
    // still validates, so the axis exists in the contract without a break.
    // Asserted BEHAVIOURALLY (a record without the key decodes) rather than by
    // introspecting the field wrapper — the property that matters is the parse.
    expect(padiSurface.spec.collections?.terminals).toBeTruthy();
    expect(accepts(PadiTerminalSchema, parkedRecord())).toBe(true);
    expect(
      accepts(PadiTerminalSchema, { ...parkedRecord(), host: "zest" }),
    ).toBe(true);
  });

  it("preview.read is RANGE-CAPABLE and serve-dir-shaped — not a whole-file blob", () => {
    // The input carries an OPTIONAL raw HTTP `range`, so a `<video>` can seek and
    // a multi-GB file is never forced whole through the heap; absent = whole file.
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
    // The output mirrors `@kolu/serve-dir`'s `ServeResult` — {status, headers}
    // verbatim + a base64 body — NOT a `{contentBase64, contentType, mtimeMs}`
    // blob, so a 206/416/Content-Range rides the contract unchanged.
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
    // The frozen `version` cell echoes the control-core version, distinct from
    // padiSurface's own version cell (which may move; this one never does).
    expect(padiControlSurface.spec.cells?.version.default).toEqual({
      controlCoreVersion: CONTROL_CORE_VERSION,
    });
    // The frozen control verbs live under the single `control` namespace.
    // `clockNow` is a frozen member kept FOREVER for cross-version skew, beside
    // the new framework `system.clockNow` measurement path.
    expect(
      Object.keys(padiControlSurface.spec.procedures?.core ?? {}).sort(),
    ).toEqual(["clockNow", "controlVersion", "drain", "hello"]);
    // The daemon serves BOTH surfaces on one socket, keyed `padi` + `control`, so
    // a binder reaches the frozen core even when padiSurface is version-skewed.
    expect(Object.keys(padiDaemonSurfaces).sort()).toEqual(["control", "padi"]);
    expect(Object.keys(padiDaemonContract.siblings).sort()).toEqual([
      "control",
      "padi",
    ]);
    // The hello handshake validates a well-formed identity — including the additive
    // `startedAt` boot time the binder reads for honest uptime, the additive `commit`
    // (the RUNNING padi's build the Padi dialog surfaces), and the additive `buildId`
    // (padi's staleKey — the binder's build-convergence key, #1670). All additive to
    // the never-served frozen core, so CONTROL_CORE_VERSION stays "1.0".
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
    // `commit` AND `buildId` are OPTIONAL as one pair — a survivor predating the pair
    // omits both and its wire shape still validates. The shared hello reader rejects a
    // one-sided pair before convergence; the schema remains the frozen decoder.
    const helloNoBuildFields = {
      stateRoot: "/home/u/.local/state/padi",
      surfaceVersion: PADI_SURFACE_VERSION,
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 1_700_000_000_000,
    };
    expect(decodeHello(helloNoBuildFields)).toEqual(helloNoBuildFields);
  });
});

// ── D1 / review #16: the composed daemon's TAG SET ────────────────────────
//
// `RpcGroup.make`/`merge` are last-writer-wins `Map.set`s with zero collision
// detection, so a tag minted twice would vanish without a word. The replacement
// for the deleted oRPC router-path tests is this: assert the literal tags, on
// both axes, so a collision is a red test rather than a 404 in production.

describe("padiDaemonContract — the composed tag set (D1 / #16)", () => {
  it("composes the two siblings WITHOUT losing a tag", () => {
    expect(padiDaemonGroup.requests.size).toBe(PADI_DAEMON_TAG_COUNT);
    expect(PADI_DAEMON_TAG_COUNT).toBe(
      padiSurface.group.requests.size + padiControlSurface.group.requests.size,
    );
  });

  it("each sibling's tags carry its OWN prefix, and the two sets are DISJOINT", () => {
    const padi = [...padiSurfaceSibling.group.requests.keys()];
    const control = [...padiControlSibling.group.requests.keys()];
    expect(padi.every((t) => t.startsWith("surface/padi/"))).toBe(true);
    expect(control.every((t) => t.startsWith("surface/control/"))).toBe(true);
    expect(padi.filter((t) => control.includes(t))).toEqual([]);
    // Every tag the composed group carries comes from exactly one sibling.
    expect([...padiDaemonGroup.requests.keys()].sort()).toEqual(
      [...padi, ...control].sort(),
    );
  });

  it("the three reserved system/* tags exist ONCE PER SIBLING — the collision a bare merge would have eaten", () => {
    // Both surfaces declare `system/live`, `system/identity`, `system/clockNow`.
    // A bare `RpcGroup.merge` would have silently left ONE sibling's liveness
    // probe answering for the other's. The sibling prefix makes that
    // unrepresentable; this asserts it rather than assuming it.
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
      "surface/control/core/hello",
      "surface/control/core/drain",
      "surface/control/core/clockNow",
      "surface/control/version/get",
    ]) {
      expect(padiDaemonGroup.requests.has(tag)).toBe(true);
    }
    // The tag algebra is read off the surface value, never re-spelled by hand —
    // this is the same expression `buildSurfaceFace` mints with.
    expect(surfaceTag(padiSurfaceSibling.tagPrefix, "lifecycle", "kill")).toBe(
      "surface/padi/lifecycle/kill",
    );
  });

  it("a READ-ONLY cell carries no write verb", () => {
    // `identity` declares `verbs: ["get"]`, so a `set` tag must NOT exist — a
    // typed-but-unserved write is an API-facing falsehood.
    expect(padiDaemonGroup.requests.has("surface/padi/identity/get")).toBe(
      true,
    );
    expect(padiDaemonGroup.requests.has("surface/padi/identity/set")).toBe(
      false,
    );
  });
});

// ── D4: the declared error vocabulary ─────────────────────────────────────

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
    // A NEGATIVE test as much as a positive one: a member cannot quietly acquire
    // an error channel, and a quiet-drop member (`resize`, `sendInput`, `sleep`,
    // `setActive`, `killAll`, `discardSleeping`,
    // `preview.repoRootForTerminal`, `session.*`) cannot quietly lose one.
    expect(declared.sort()).toEqual(
      [
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
        "lifecycle.wake",
        "preview.read",
        "screen.history",
        "screen.image",
        "screen.state",
        "screen.text",
        "scratch.write",
        "transcript.exportHtml",
        // `watch.drain` and `watch.close` both refuse an unopened name, with the
        // SAME declared error: `open` creates what it names, so it is the only
        // watch verb with no refusal to declare. "No such subscription" is
        // declared rather than answered with an empty batch (or a `false`)
        // precisely so a supervisor cannot read a typo'd name as a quiet
        // workspace, or as "there was nothing to close".
        "watch.close",
        "watch.drain",
      ].sort(),
    );
  });

  it("every error round-trips encode → JSON → decode with its tag, data and message intact", () => {
    // D4's relay-rehydration requirement, proven rather than asserted: a padi
    // error crosses the binder hop by being decoded and re-encoded, and a
    // consumer narrows the REHYDRATED value.
    const cases = [
      new TerminalNotFound({ id: "t-1" }),
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
      // The class IS the schema — a `Schema.TaggedError` is both. The cast
      // erases only the per-class type parameter, which this loop deliberately
      // does not name (the point is that EVERY member behaves the same way).
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
});

// ── #17: byte fixtures for the rolling-deploy defaults ────────────────────

describe("PadiUrgency — the rolling-deploy defaults, in BYTES", () => {
  const decode = Schema.decodeUnknownSync(PadiUrgencySchema);
  const encode = Schema.encodeUnknownSync(PadiUrgencySchema);
  const ID = "123e4567-e89b-12d3-a456-426614174000";

  it("ACCEPT-MISSING: an OLDER padi's frame (awaitingIds only) decodes with empty lists", () => {
    // The documented rolling-deploy tolerance: a newer client reading an older
    // padi's `urgency` frame parses it rather than failing validation and
    // breaking the whole cell.
    expect(decode({ awaitingIds: [ID] })).toEqual({
      awaitingIds: [ID],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
    });
  });

  it("EMIT-KEY: a frame this build serves carries all four keys, in declaration order", () => {
    // The half decode-equality cannot see — and the half that makes the encoded
    // bytes identical to what zod's `.default([])` produced.
    expect(JSON.stringify(encode(decode({ awaitingIds: [] })))).toBe(
      '{"awaitingIds":[],"finishedIds":[],"workingIds":[],"lingerIds":[]}',
    );
    expect(
      JSON.stringify(
        encode(
          decode({
            awaitingIds: [ID],
            finishedIds: [ID],
            workingIds: [],
            lingerIds: [ID],
          }),
        ),
      ),
    ).toBe(
      `{"awaitingIds":["${ID}"],"finishedIds":["${ID}"],"workingIds":[],"lingerIds":["${ID}"]}`,
    );
  });

  it("an EXPLICIT undefined is REJECTED — an older padi OMITS the key, it never sends undefined", () => {
    // `withDecodingDefaultKey` is stricter than zod's `.default()` on in-memory
    // `undefined` (PLAN #17), deliberately: on a wire, absent and `undefined`
    // are not two spellings of one fact — only absent ever crosses.
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

describe("the two optional-key spellings on this wire, in BYTES (#17 audit)", () => {
  // `status.expectedKaval` and the attach frame's `reflowEpoch` are the two
  // fields the `optionalKey` audit judged differently, and the difference is
  // load-bearing rather than stylistic — so both verdicts are pinned here.
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
      // The tightening is a FEATURE here: `servePadi` has the only producer, and
      // it now spreads. Falsify by restoring `expectedKaval: … : undefined` there
      // — every `status` subscribe then fails to encode with the string below.
      expect(accepts(PadiStatusSchema, { expectedKaval: undefined })).toBe(
        false,
      );
    });
  });

  describe("the attach snapshot's reflowEpoch is `optional` — five verbatim hops", () => {
    // Unlike `expectedKaval`, this value is FORWARDED across kaval's decoded
    // frame → `OpenedAttach` → `TerminalAttachment` → the re-attach frame → here.
    // Reading an absent optional key yields `undefined`, so every hop re-creates
    // the key; `Schema.optional` restores exactly zod's tolerance while leaving
    // the emitted bytes key-omitted.
    const frame = padiSurface.spec.streams.terminalAttach.outputSchema;
    const encode = Schema.encodeUnknownSync(frame);

    it("ACCEPTS a present-but-undefined reflowEpoch, and OMITS it from the bytes", () => {
      expect(
        JSON.stringify(
          encode({
            kind: "snapshot",
            data: "hi",
            topLine: 0,
            reflowEpoch: undefined,
          }),
        ),
      ).toBe('{"kind":"snapshot","data":"hi","topLine":0}');
    });

    it("an ABSENT key emits the same bytes — `optional` never nulls", () => {
      expect(
        JSON.stringify(encode({ kind: "snapshot", data: "hi", topLine: 0 })),
      ).toBe('{"kind":"snapshot","data":"hi","topLine":0}');
    });

    it("still emits a real epoch, and still REJECTS a non-integer one", () => {
      expect(
        JSON.stringify(
          encode({ kind: "snapshot", data: "", topLine: 3, reflowEpoch: 7 }),
        ),
      ).toBe('{"kind":"snapshot","data":"","topLine":3,"reflowEpoch":7}');
      expect(
        accepts(frame, {
          kind: "snapshot",
          data: "",
          topLine: 0,
          reflowEpoch: "7",
        }),
      ).toBe(false);
    });

    it("a delta frame is untouched by any of this", () => {
      expect(JSON.stringify(encode({ kind: "delta", data: ID }))).toBe(
        `{"kind":"delta","data":"${ID}"}`,
      );
    });
  });
});
