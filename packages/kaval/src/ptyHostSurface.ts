import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import {
  defineSurface,
  type SurfaceTypes,
  type WireSchema,
} from "@kolu/surface/define";
import { Option, Schema, SchemaGetter } from "effect";
import type {
  CellColor,
  SnapshotCell,
  SnapshotGrid,
  SnapshotRow,
} from "terminal-snapshot";

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const PTY_HOST_CONTRACT_VERSION = "9.0";

const PtyIdSchema = Schema.String;

const TerminalIdInputSchema = Schema.Struct({ id: PtyIdSchema });

const ScreenExtentSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("full") }),
  Schema.Struct({
    kind: Schema.Literal("range"),
    startLine: Schema.optionalKey(Schema.Int),
    endLine: Schema.optionalKey(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.Literal("tail"),
    lines: NonNegativeInt,
  }),
  Schema.Struct({ kind: Schema.Literal("viewport") }),
]);

const ScreenReadInputSchema = Schema.Struct({
  id: PtyIdSchema,
  extent: Schema.optionalKey(ScreenExtentSchema),
});

export const SCREEN_CELLS_MAX_ROWS = 200;

export const SCREEN_CELLS_MAX_CELLS = 26_000;

export function boundScreenCells(
  rows: number,
  cols: number,
): { readonly rows: number; readonly cols: number } {
  const served = Math.min(Math.max(0, rows), SCREEN_CELLS_MAX_ROWS);
  if (served === 0) return { rows: 0, cols };
  return {
    rows: served,
    cols: Math.min(cols, Math.floor(SCREEN_CELLS_MAX_CELLS / served)),
  };
}

const ScreenCellsInputSchema = Schema.Struct({
  id: PtyIdSchema,
  extent: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("viewport") }),
      Schema.Struct({
        kind: Schema.Literal("tail"),
        lines: PositiveInt.check(
          Schema.isLessThanOrEqualTo(SCREEN_CELLS_MAX_ROWS),
        ),
      }),
    ]),
  ),
});

const CellColorSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("default") }),
  Schema.Struct({
    kind: Schema.Literal("palette"),
    index: NonNegativeInt.check(Schema.isLessThanOrEqualTo(255)),
  }),
  Schema.Struct({ kind: Schema.Literal("rgb"), value: NonNegativeInt }),
]) satisfies WireSchema<CellColor>;

function omittedWhenDefault<T>(
  schema: Schema.Codec<T, T, never, never>,
  fallback: T,
) {
  const equivalent = Schema.toEquivalence(schema);
  return Schema.optionalKey(schema).pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transformOptional<T, T>((encoded) =>
        Option.isNone(encoded) ? Option.some(fallback) : encoded,
      ),
      encode: SchemaGetter.transformOptional<T, T>((value) =>
        Option.isSome(value) && equivalent(value.value, fallback)
          ? Option.none()
          : value,
      ),
    }),
  );
}

const AbsentWhenFalse = omittedWhenDefault(Schema.Boolean, false);
const AbsentWhenDefaultColor = omittedWhenDefault(CellColorSchema, {
  kind: "default",
});
const AbsentWhenSingleWidth = omittedWhenDefault(
  PositiveInt.check(Schema.isLessThanOrEqualTo(2)),
  1,
);

const SnapshotCellSchema = Schema.Struct({
  col: NonNegativeInt,
  chars: Schema.String,
  width: AbsentWhenSingleWidth,
  fg: AbsentWhenDefaultColor,
  bg: AbsentWhenDefaultColor,
  bold: AbsentWhenFalse,
  italic: AbsentWhenFalse,
  dim: AbsentWhenFalse,
  underline: AbsentWhenFalse,
  inverse: AbsentWhenFalse,
}) satisfies WireSchema<SnapshotCell>;

const SnapshotRowSchema = Schema.Struct({
  cells: Schema.Array(SnapshotCellSchema),
}) satisfies WireSchema<SnapshotRow>;

const SnapshotGridSchema = Schema.Struct({
  cols: PositiveInt,
  lines: Schema.Array(SnapshotRowSchema),
}) satisfies WireSchema<SnapshotGrid>;

export const PtyGridSchema = Schema.Struct({
  cols: PositiveInt,
  rows: PositiveInt,
});
export type PtyGrid = typeof PtyGridSchema.Type;

const TerminalAttachInputSchema = Schema.Struct({
  id: PtyIdSchema,
  resizeTo: Schema.optionalKey(PtyGridSchema),
});

/** A file the client wants present on the host before the shell starts — a
 *  wrapper rcfile (bash `--rcfile`, zsh `ZDOTDIR/.zshrc`), named relative to
 *  the host's `rcDir` (from `system.info`). The host writes each under its
 *  `rcDir`, rejecting any name that escapes it, and removes them when the PTY
 *  exits. The *content* is the client's shell arcana; the host treats it as an
 *  opaque blob. */
const InitFileSchema = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
});

const TerminalSpawnInputSchema = Schema.Struct({
  /** Caller-supplied PTY id. kolu-server mints the terminal id and passes it
   *  here so the pty-host's PTY id == kolu-server's terminal id — this is what
   *  makes reattach-by-id work across a kolu-server restart (later, once the
   *  pty-host is a surviving process). */
  id: Schema.optionalKey(PtyIdSchema),
  /** The fully resolved program + args — `argv[0]` is the shell, the rest its
   *  arguments (e.g. `["--rcfile", "<rcDir>/bashrc-<id>"]`). The host spawns it
   *  verbatim; it neither chooses the shell nor appends flags. */
  argv: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  /** True when `argv[0]` is the ROOT COMMAND itself, not a shell — a
   *  `kaval-tui create -- <cmd>` PTY (#1872). The host seeds `lastCommand` from
   *  the argv (no shell means no OSC 633;E mark) and
   *  reports the fact on the inventory row so the workspace sensors read
   *  `foreground === root` as a busy agent, not an idle shell prompt. Optional
   *  + absent = shell-rooted (today's reading) — see the contract-version note. */
  commandRooted: Schema.optionalKey(Schema.Boolean),
  /** The *resolved* working directory (the client applies its own
   *  `cwd || home || "/"` fallback — the host does not). */
  cwd: Schema.String,
  /** The complete child environment, composed by the client. The host passes
   *  it through untouched — it adds nothing from its own `process.env`. */
  env: Schema.Record(Schema.String, Schema.String),
  /** Wrapper rcfiles to materialise under the host's `rcDir` before spawn. */
  initFiles: Schema.Array(InitFileSchema),
  cols: Schema.optionalKey(PositiveInt),
  rows: Schema.optionalKey(PositiveInt),
  scrollback: Schema.optionalKey(PositiveInt),
});

const TerminalSpawnOutputSchema = Schema.Struct({
  id: PtyIdSchema,
  pid: Schema.Int,
  /** Echoes the resolved spawn cwd the client supplied — kolu-server seeds its
   *  per-terminal metadata + provider DAG from it. */
  cwd: Schema.String,
});

const TerminalWriteInputSchema = Schema.Struct({
  id: PtyIdSchema,
  data: Schema.String,
});

const TerminalResizeInputSchema = Schema.Struct({
  ...PtyGridSchema.fields,
  id: PtyIdSchema,
});

/** A PTY the pty-host still owns. The minimal shape kolu-server needs to
 *  reattach by id across its own restart. */
const TerminalListEntrySchema = Schema.Struct({
  id: PtyIdSchema,
  pid: Schema.Int,
  cwd: Schema.String,
  lastActivity: Schema.Number,
  title: Schema.optionalKey(Schema.String),
  foregroundProcess: Schema.optionalKey(Schema.String),
  commandRooted: Schema.optionalKey(Schema.Boolean),
});

const AttachSnapshotFrameSchema = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  data: Schema.String,
  topLine: NonNegativeInt,
  reflowEpoch: Schema.optionalKey(NonNegativeInt),
  grid: PtyGridSchema,
});
const AttachDeltaFrameSchema = Schema.Struct({
  kind: Schema.Literal("delta"),
  data: Schema.String,
});
const AttachOverflowFrameSchema = Schema.Struct({
  kind: Schema.Literal("overflow"),
});
const AttachResizedFrameSchema = Schema.Struct({
  kind: Schema.Literal("resized"),
  grid: PtyGridSchema,
});

const TerminalDataMsgSchema = Schema.Union([
  AttachSnapshotFrameSchema,
  AttachDeltaFrameSchema,
  AttachOverflowFrameSchema,
  AttachResizedFrameSchema,
]);

/** A membership change in the host's live-PTY set — the host-global inventory
 *  feed (contract 3.1). `snapshot` (the stream's first frame, snapshot-then-
 *  deltas) carries every live PTY; `created` / `exited` are the deltas as PTYs
 *  other clients spawn or end. A consumer subscribes once and discovers PTYs it
 *  did not spawn (a `kaval-tui create`) without polling `list`. Mirrors
 *  `TerminalDataMsgSchema`'s snapshot/delta discriminator so a client reducer
 *  replaces on snapshot and applies the deltas. */
const InventoryEventSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    entries: Schema.Array(TerminalListEntrySchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("created"),
    entry: TerminalListEntrySchema,
  }),
  Schema.Struct({ kind: Schema.Literal("exited"), id: PtyIdSchema }),
]);

/** One frame of the host-global `activity` stream — a PTY that just produced
 *  meaningful (non-resize) output. See the stream member below. */
const ActivityEdgeSchema = Schema.Struct({ id: PtyIdSchema });

/** Raw foreground sample (`tcgetpgrp(3)` pid + node-pty process name) — the
 *  one live PTY read agent detection needs that can't cross a wire as a
 *  synchronous getter, so the pty-host pushes it as a tap. */
const ForegroundMsgSchema = Schema.Struct({
  process: Schema.String,
  foregroundPid: Schema.optional(Schema.Int),
});

/** The running pty-host's self-declared build identity, surfaced on
 *  `system.version` for the ChromeBar's `kaval` readout. `staleKey` is the
 *  hash of the `kaval` source closure (nix bakes `KAVAL_BUILD_ID`) — it flips
 *  iff a restart would load different pty-host wire/behaviour code, the
 *  *reported* operand of B3.4's "update pending" currency nudge (compared at
 *  the read site against the *expected* axis on padiSurface's `status`
 *  cell, `status.expectedKaval`).
 *  `navigableCommit` is the git ref this kaval was built from
 *  (`KAVAL_COMMIT_HASH`), the GitHub-clickable identity. */
export const PtyHostIdentitySchema = Schema.Struct({
  staleKey: Schema.String,
  navigableCommit: Schema.String,
});
export type PtyHostIdentity = typeof PtyHostIdentitySchema.Type;

export const DaemonLifetimeInfoSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("forever") }),
  Schema.Struct({ kind: Schema.Literal("idleTimeout"), ms: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("boundToPid"), pid: Schema.Number }),
]) satisfies WireSchema<DaemonLifetimeInfo>;

export const SystemVersionOutputSchema = Schema.Struct({
  contractVersion: Schema.String,
  pid: Schema.Int,
  startedAt: Schema.Number,
  identity: Schema.optionalKey(PtyHostIdentitySchema),
  lifetime: Schema.optionalKey(DaemonLifetimeInfoSchema),
});

const SystemHeartbeatOutputSchema = Schema.Struct({
  ts: Schema.Number,
});

/** Host facts a client reads once per connection to compose spawn policy for
 *  *this* host — including one it isn't running on (the R-2 remote enabler).
 *  `shell`/`home` are the host's login shell and `$HOME`; `platform` is its
 *  `process.platform`; `rcDir` is the absolute directory under which the host
 *  materialises `spawn`'s `initFiles`, so the client can name them and point
 *  `argv`/`env` at their resolved paths; `path` is the host's `$PATH`, which a
 *  REMOTE client must put in the spawn env so the shell can find any command (a
 *  local client already has its own `$PATH`). `path` is optional so an older
 *  daemon a `--host` dial adopts (predating this field) degrades to a baseline
 *  rather than failing response validation — the same-build daemon `--host`
 *  provisions always carries it. */
const SystemInfoOutputSchema = Schema.Struct({
  shell: Schema.String,
  home: Schema.String,
  platform: Schema.String,
  rcDir: Schema.String,
  path: Schema.optionalKey(Schema.String),
});

/** The host owns no PTY with this id — it exited, or the caller invented the id.
 *
 *  The shape kaval-tui's re-attach loop reads as "the PTY is gone" (as opposed to
 *  "the stream dropped"), which is what makes it fall through to the exit
 *  tombstone for the real exit code instead of retrying forever.
 *
 *  DECLARED on the three read procedures that raise it (`getScreenState`,
 *  `getScreenText`, `getHistory`). The five per-terminal STREAMS raise the same
 *  class, but a `StreamSpec` has no error channel to declare it on, so there it is
 *  an undeclared failure — a DEFECT, opaque across a wire hop and narrowable only
 *  in-process. That asymmetry is the framework's, not this contract's, and the
 *  corpus already asserts only "it rejects" for the stream leg because of it. */
export class PtyNotFound extends Schema.TaggedError<PtyNotFound>(
  "kaval/PtyNotFound",
)("PtyNotFound", { id: Schema.String }) {
  override get message(): string {
    return `no PTY with id ${this.id}`;
  }
}

/** `spawn` was handed an empty `argv`. Unreachable through a schema-validating
 *  client (`argv` is `minLength(1)`), so this is the wire's own second line of
 *  defence: a malformed frame becomes a clean, named refusal rather than a spawn
 *  of `undefined`. Declared so a caller composing argv programmatically gets an
 *  answer it can branch on instead of a defect. */
export class SpawnArgvEmpty extends Schema.TaggedError<SpawnArgvEmpty>(
  "kaval/SpawnArgvEmpty",
)("SpawnArgvEmpty", {}) {
  override get message(): string {
    return "argv is empty";
  }
}

export const ptyHostSurface = defineSurface({
  streams: {
    /** Per-terminal output stream — snapshot then live deltas. */
    terminalAttach: {
      inputSchema: TerminalAttachInputSchema,
      outputSchema: TerminalDataMsgSchema,
    },
    /** OSC 7 cwd reports. */
    cwd: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ cwd: Schema.String }),
    },
    /** OSC 0/2 title changes (signals "foreground may have changed"). */
    title: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ title: Schema.String }),
    },
    /** OSC 633;E preexec command lines. Snapshot-then-deltas: the first frame
     *  replays the last command seen before subscribe, so a late/restarted sensor
     *  still learns it; subsequent frames are live marks. There is no `replayed`
     *  discriminator — no consumer branches on one.
     *
     *  SENSOR DATA. PTY output is a sensor: nothing that executes may read a
     *  value whose provenance is PTY bytes, so no consumer may turn `command`
     *  into a command kolu types. Its only sanctioned reads are the head
     *  basename (a shim hint) and a foreground re-sample trigger. */
    commandRun: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.String,
    },
    /** Foreground process name + pid, sampled at the tty (deduped). */
    foreground: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: ForegroundMsgSchema,
    },
    /** Child exit. Yields exactly once (the exit code), then ends. */
    exit: {
      inputSchema: TerminalIdInputSchema,
      outputSchema: Schema.Struct({ exitCode: Schema.Int }),
    },
    /** Host-global membership feed (contract 3.1) — a snapshot of every live PTY,
     *  then created/exited deltas. Takes no id (it spans the whole host), so a
     *  consumer subscribes once and discovers PTYs other clients spawned (a
     *  `kaval-tui create`) without polling `list`. */
    inventory: {
      inputSchema: Schema.Struct({}),
      outputSchema: InventoryEventSchema,
    },
    /** Host-global MEANINGFUL-OUTPUT edges (contract 5.3) — each frame names a PTY
     *  that just produced real output, with resize repaints EXCLUDED at the source.
     *  A consumer subscribes once and stamps ARRIVAL time on its own clock, deriving
     *  its own idle windows — so kaval never re-streams bytes just to maintain a
     *  boolean, and no consumer needs its own byte tap or a resize-mute hack. Purely
     *  live (no snapshot frame): a missed edge across a reconnect only delays a
     *  downstream finish (default-excluded). */
    activity: {
      inputSchema: Schema.Struct({}),
      outputSchema: ActivityEdgeSchema,
    },
  },
  procedures: {
    terminal: {
      spawn: {
        input: TerminalSpawnInputSchema,
        output: TerminalSpawnOutputSchema,
        error: SpawnArgvEmpty,
      },
      kill: {
        input: TerminalIdInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      killAll: {
        input: Schema.Struct({}),
        output: Schema.Struct({ killed: Schema.Int }),
      },
      write: {
        input: TerminalWriteInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      resize: {
        input: TerminalResizeInputSchema,
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
      list: {
        input: Schema.Struct({}),
        output: Schema.Struct({
          entries: Schema.Array(TerminalListEntrySchema),
        }),
      },
      getScreenState: {
        input: TerminalIdInputSchema,
        output: Schema.Struct({ data: Schema.String }),
        error: PtyNotFound,
      },
      getScreenText: {
        input: ScreenReadInputSchema,
        output: Schema.Struct({ text: Schema.String }),
        error: PtyNotFound,
      },
      /** The screen as ATTRIBUTED cells — what a rendered screenshot is drawn
       *  from (contract 7.1 · additive).
       *
       *  Its extent is a NARROWER union than `getScreenText`'s: viewport or a
       *  bounded tail, never the whole scrollback. See
       *  {@link SCREEN_CELLS_MAX_ROWS}.
       *
       *  Returns cells rather than an image on purpose. Rendering needs a
       *  theme, a font and a rasteriser; this daemon owns the PTYs and the
       *  screen mirror and should own none of those. Handing padi the cells
       *  keeps the hot process free of a wasm rasteriser and several megabytes
       *  of font, and puts the picture where the theme already lives. */
      getScreenCells: {
        input: ScreenCellsInputSchema,
        output: SnapshotGridSchema,
        error: PtyNotFound,
      },
      /** Older-scrollback read for the client's in-place backfill (contract
       *  5.1). `before` is the caller's absolute cursor (the attach snapshot's
       *  `topLine`, then each reply's `topLine`); the host serves up to `max`
       *  mirror rows immediately ABOVE it, VT-serialized for replay. Absolute
       *  addressing keeps the seam where backfill meets existing content
       *  race-free against live output (see `PtyHistoryChunk`). `max` is a
       *  positive count — a non-positive request is a caller bug, rejected at the
       *  wire rather than silently returning nothing. */
      getHistory: {
        input: Schema.Struct({
          id: PtyIdSchema,
          before: Schema.optionalKey(NonNegativeInt),
          max: PositiveInt,
          epoch: Schema.optionalKey(NonNegativeInt),
        }),
        output: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal("chunk"),
            chunk: Schema.String,
            topLine: NonNegativeInt,
            exhausted: Schema.Boolean,
          }),
          Schema.Struct({ kind: Schema.Literal("stale") }),
        ]),
        error: PtyNotFound,
      },
    },
    system: {
      version: {
        input: Schema.Struct({}),
        output: SystemVersionOutputSchema,
      },
      heartbeat: {
        input: Schema.Struct({}),
        output: SystemHeartbeatOutputSchema,
      },
      /** Host facts for client-side spawn-policy composition (B0). */
      info: { input: Schema.Struct({}), output: SystemInfoOutputSchema },
    },
  },
});

export type PtyHostSurface = SurfaceTypes<typeof ptyHostSurface.spec>;
export type PtyHostListEntry = typeof TerminalListEntrySchema.Type;
export type PtyHostDataMsg = typeof TerminalDataMsgSchema.Type;
export type PtyHostInventoryEvent = typeof InventoryEventSchema.Type;
export type PtyHostForegroundMsg = typeof ForegroundMsgSchema.Type;
export type PtyHostSystemVersion = typeof SystemVersionOutputSchema.Type;
export type PtyHostSystemInfo = typeof SystemInfoOutputSchema.Type;
export type PtyHostInitFile = typeof InitFileSchema.Type;
/** A `spawn` argument as it crosses the WIRE — the ENCODED side (D2/#13), which
 *  is what a caller passes to the client face. It is what `z.input<…>` used to
 *  mean here, and it is the side every composer (kaval-tui's `create`, the
 *  contract corpus, kolu-server's `kolu-pty`) actually holds. */
export type PtyHostSpawnInput = typeof TerminalSpawnInputSchema.Encoded;
/** The host's spawn result — `{ id, pid, cwd }`. The generative side of this
 *  shape, so a client consumes it rather than re-declaring it (and stays in sync
 *  if the host ever adds a field). */
export type PtyHostSpawnResult = typeof TerminalSpawnOutputSchema.Type;

/** The last-resort spawn shell when a client composing `spawn`'s `argv` finds
 *  no `$SHELL` to name. Matches the host's own terminal fallback
 *  (`inProcessPtyHost`'s `hostShell` ends in `/bin/sh`), so the bare client and
 *  the host agree on the same answer. One literal, shared by every composer that
 *  needs it (kaval-tui's `create`, the contract corpus) — so it can't drift. */
export const DEFAULT_SPAWN_SHELL = "/bin/sh";
