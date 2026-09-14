/** Fixture builder for the Oh My Pi mock e2e tests.
 *
 *  Real `omp` records, for each terminal, WHICH session file it is writing —
 *  `<agent dir>/terminal-sessions/<tty id>` — and kolu finds the session by
 *  reading exactly that. So the mock has two halves, and both are pinned here to
 *  the real on-disk wire format (never imported from the producer: a wrong
 *  rename would then pass on both sides silently):
 *
 *   1. The **session transcript** — an append-only JSONL whose line 1 is omp's
 *      fixed 256-byte title slot and whose line 2 is the `session` header. Fresh
 *      scenarios write it directly; transitions APPEND (never rewrite — the
 *      append-robust watcher is the channel under test).
 *   2. The **breadcrumb** — written by the fake `omp` process ITSELF (see
 *      `ompMockPayload`), exactly as real omp writes it: omp derives the tty id
 *      from its own stdin, so the fixture must not guess it from the test
 *      process.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const SESSION_ID = "01a0a0e3-1843-701b-bfde-c9c816e3e92f";
const TITLE_SLOT_BYTES = 256;

export interface OmpFixture {
  transcriptPath: string;
  sessionId: string;
}

/** Encode a cwd to omp's session-directory key (`computeDefaultSessionDir` /
 *  `getDefaultSessionDirName`): home-relative under `$HOME` (`-code-proj`),
 *  `-tmp-` + relative under the temp root, else the legacy absolute form.
 *  Canonicalized (symlinks resolved) the way omp does it — which is why the
 *  `-tmp-` arm is the one a fixture under `mkdtemp` lands in.
 *
 *  This is the fixture's own approximation of a key omp computes inside its
 *  OWN process (from that process's `$HOME`/`$TMPDIR`, which the test process
 *  cannot read); here it is derived from the test process's roots. Nothing
 *  asserts on it: kolu never computes this key — the breadcrumb carries the
 *  session's ABSOLUTE path, which is the whole point of omp's anchor — so the
 *  fixture's only requirement is that the file land somewhere a real omp could
 *  have put it. */
export function ompSessionDirName(cwd: string): string {
  const canonical = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const canonicalCwd = canonical(cwd);
  const encode = (prefix: string, relative: string): string => {
    const encoded = relative.replace(/[/\\:]/g, "-");
    if (!encoded) return prefix;
    return prefix.endsWith("-")
      ? `${prefix}${encoded}`
      : `${prefix}-${encoded}`;
  };
  for (const [root, prefix] of [
    [canonical(os.homedir()), "-"],
    [canonical(os.tmpdir()), "-tmp"],
  ] as const) {
    const relative = path.relative(root, canonicalCwd);
    if (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    ) {
      return encode(prefix, relative);
    }
  }
  return `--${canonicalCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** The transcript path a real `omp` launched in `cwd` would write, plus the
 *  session id its filename carries. Nothing is created. */
export function ompTranscriptPath(opts: {
  ompDir: string;
  cwd: string;
}): OmpFixture {
  const dir = path.join(opts.ompDir, "sessions", ompSessionDirName(opts.cwd));
  return {
    transcriptPath: path.join(
      dir,
      `2026-09-14T17-07-12-579Z_${SESSION_ID}.jsonl`,
    ),
    sessionId: SESSION_ID,
  };
}

/** omp's line-1 title slot: one JSON object whose `pad` fills the fixed-width
 *  slot, exactly what omp writes (and rewrites in place) at the head of every
 *  session file. */
function titleSlot(title: string): string {
  const base = {
    type: "title",
    v: 1,
    title,
    source: "auto",
    updatedAt: "2026-09-14T17-07-12-579Z",
  };
  let pad = "";
  for (;;) {
    const rendered = JSON.stringify({ ...base, pad });
    const room = TITLE_SLOT_BYTES - 1 - Buffer.byteLength(rendered);
    if (room <= 0) return `${rendered}\n`;
    pad += " ".repeat(room);
  }
}

/** omp's `model_change` entry — note the field is `model` (pi's fork spells it
 *  `modelId`). */
function modelChange(): object {
  return {
    type: "model_change",
    id: "m1",
    parentId: null,
    timestamp: "2026-09-14T17:07:13.000Z",
    model: "deepseek-v4.1-flash",
  };
}

function userEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-14T17:07:14.000Z",
    message: { role: "user", content: [{ type: "text", text: "mock prompt" }] },
  };
}

function assistantEntry(id: string, stopReason: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-14T17:07:15.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "mock reply" }],
      model: "deepseek-v4.1-flash",
      stopReason,
      usage: {
        input: 1200,
        output: 42,
        cacheRead: 3400,
        cacheWrite: 3,
        totalTokens: 4645,
        cost: { input: 0, output: 0, total: 0 },
      },
    },
  };
}

function toolResultEntry(id: string): object {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-14T17:07:16.000Z",
    message: {
      role: "toolResult",
      toolCallId: `bash:${id}`,
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  };
}

/** The entry sequence that STARTS a transcript already in `state`. */
function initialLines(state: AgentLifecycleState): object[] {
  const header = {
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-09-14T17:07:12.579Z",
    cwd: "/irrelevant",
    title: "Run echo hello bash command",
    titleSource: "auto",
  };
  switch (state) {
    case "thinking":
      return [header, modelChange(), userEntry("u1")];
    case "tool_use":
      return [
        header,
        modelChange(),
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
      ];
    case "waiting":
      return [
        header,
        modelChange(),
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
        toolResultEntry("r1"),
        assistantEntry("a2", "stop"),
      ];
    case "awaiting_user":
      // The dialog is on SCREEN, not in the transcript: while an approval gate
      // or an `ask` question is up, omp's tail still reads the in-flight tool
      // call. The screen-scrape step paints the dialog; the file stays here.
      return [
        header,
        modelChange(),
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
      ];
  }
}

/** The appended entries moving a LIVE transcript INTO `state`. */
function transitionLines(state: AgentLifecycleState, n: number): object[] {
  switch (state) {
    case "thinking":
      return [userEntry(`u${n}`)];
    case "tool_use":
      return [userEntry(`u${n}`), assistantEntry(`a${n}`, "toolUse")];
    case "waiting":
      return [toolResultEntry(`r${n}`), assistantEntry(`a${n}b`, "stop")];
    case "awaiting_user":
      return [userEntry(`u${n}`), assistantEntry(`a${n}`, "toolUse")];
  }
}

/** Create the session file at `ompFixture.transcriptPath`, already in `state`.
 *  Idempotent: rewrites from scratch, so scenarios start each other's states
 *  cleanly. */
export function writeOmpFixture(
  fixture: OmpFixture,
  state: AgentLifecycleState,
): void {
  fs.mkdirSync(path.dirname(fixture.transcriptPath), { recursive: true });
  fs.writeFileSync(
    fixture.transcriptPath,
    `${titleSlot("Run echo hello bash command")}${initialLines(state)
      .map((l) => JSON.stringify(l))
      .join("\n")}\n`,
  );
}

let transitionCounter = 0;

/** Move the live transcript into a new state by APPENDING entries — the honest
 *  production channel: no rewrite, no mtime-only nudge. */
export function updateOmpFixture(
  fixture: OmpFixture,
  state: AgentLifecycleState,
): void {
  transitionCounter += 1;
  const lines = transitionLines(state, transitionCounter);
  fs.appendFileSync(
    fixture.transcriptPath,
    `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
  );
}

/** The fake `omp` process's payload: write the breadcrumb the way omp writes it
 *  (from its OWN tty), then stay resident, painting an approval dialog or
 *  clearing the screen on request.
 *
 *  Two things make this faithful rather than convenient:
 *
 *   - The crumb's NAME comes from `tty` inside the process — the same source
 *     `omp`'s `getTerminalId()` reads — so kolu's `/proc/<pid>/fd/0` derivation
 *     is tested against the real thunk, not against a guess made in the test
 *     process. (The path arithmetic is bash parameter expansion rather than a
 *     `sed` pipe: this payload runs under the fake binary, a bash copy.)
 *   - The crumb is written `fresh`, as omp writes a brand-new session's crumb
 *     before its JSONL materializes. A scenario that points at a file it has
 *     not written yet is therefore exercising the real lazy-session race.
 *
 *  The resident `read` loop is what lets a scenario paint the approval dialog or
 *  clear it mid-scenario (omp's own dialogs appear while the process holds the
 *  terminal). A compound command keeps bash itself as the foreground process
 *  (no `execve` optimisation), so `/proc/<pid>/comm` stays `omp`.
 *
 *  Quoting: the caller wraps this in single quotes, so the payload uses only
 *  double quotes inside, and every backslash below is literal bash. */
export function ompMockPayload(opts: {
  breadcrumbDir: string;
  transcriptPath: string;
}): string {
  const approval = [
    "╭─ Allow tool: bash ────────────────────────────╮",
    "│ Command: echo hello                           │",
    "│  ❯ Approve                                    │",
    "│    Deny                                       │",
    "│ up/down navigate  enter select  esc cancel     │",
    "╰───────────────────────────────────────────────╯",
  ]
    .map((line) => `"${line}"`)
    .join(" ");
  const writeCrumb = String.raw`printf "%s\n%s\nfresh\n" "$PWD" "${opts.transcriptPath}" > "${opts.breadcrumbDir}/$t"`;
  // omp's `getTerminalId()`: the tty path with `/dev/` stripped and `/` → `-`.
  // Built by concatenation because the linter reads a literal `${` inside a
  // template string as a mistaken placeholder.
  const stripDevPrefix = "t=$" + "{t#/dev/}";
  const slashesToDashes = "t=$" + String.raw`{t//\//-}`;
  return [
    `mkdir -p "${opts.breadcrumbDir}"`,
    "t=$(tty)",
    stripDevPrefix,
    slashesToDashes,
    writeCrumb,
    String.raw`printf "\033]0;omp\007"`,
    `while IFS= read -r ompcmd; do case "$ompcmd" in approval) printf "%s\\n" ${approval} ;; clear) for i in {1..40}; do printf "omp-clear %s\\n" "$i"; done ;; esac; done`,
    ":",
  ].join(" ; ");
}
