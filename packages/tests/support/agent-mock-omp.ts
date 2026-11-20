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
      return [
        header,
        modelChange(),
        userEntry("u1"),
        assistantEntry("a1", "toolUse"),
      ];
  }
}

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

export function stageOmpPrompt(
  stagePath: string,
  state: AgentLifecycleState,
): void {
  fs.mkdirSync(path.dirname(stagePath), { recursive: true });
  fs.writeFileSync(
    stagePath,
    `${titleSlot("Run echo hello bash command")}${initialLines(state)
      .map((l) => JSON.stringify(l))
      .join("\n")}\n`,
  );
}

let transitionCounter = 0;

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

let todoCounter = 0;

export function appendOmpTodoList(
  fixture: OmpFixture,
  total: number,
  done: number,
): void {
  todoCounter += 1;
  const callId = `todo:${todoCounter}`;
  const tasks = Array.from({ length: total }, (_, i) => ({
    content: `Mock task ${i + 1}`,
    status: i < done ? "completed" : i === done ? "in_progress" : "pending",
  }));
  const call = {
    type: "message",
    id: `todo-call-${todoCounter}`,
    parentId: null,
    timestamp: "2026-09-14T17:07:17.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: callId,
          name: "todo",
          arguments: { op: "done", task: `Mock task ${done}` },
        },
      ],
      model: "deepseek-v4.1-flash",
      stopReason: "toolUse",
    },
  };
  const result = {
    type: "message",
    id: `todo-result-${todoCounter}`,
    parentId: null,
    timestamp: "2026-09-14T17:07:18.000Z",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "todo",
      content: [
        {
          type: "text",
          text: `Overall: ${done}/${total} done, ${total - done} open.`,
        },
      ],
      details: {
        op: "done",
        phases: [{ name: "Tasks", tasks }],
        storage: "session",
      },
      isError: false,
    },
  };
  fs.appendFileSync(
    fixture.transcriptPath,
    `${JSON.stringify(call)}\n${JSON.stringify(result)}\n`,
  );
}

export const OMP_UP_MARKER = "omp-stand-in-is-up";
export const OMP_HEARD_MARKER = "omp-stand-in-heard";
export const OMP_GONE_MARKER = "omp-stand-in-is-gone";

export function ompMockPayload(opts: {
  breadcrumbDir: string;
  transcriptPath: string;
  stagePath: string;
  bootPaintUntil?: string;
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
  const stripDevPrefix = "t=$" + "{t#/dev/}";
  const slashesToDashes = "t=$" + String.raw`{t//\//-}`;
  const onPrompt = [
    `if [ -f "${opts.stagePath}" ]`,
    `then cat "${opts.stagePath}" >> "${opts.transcriptPath}"`,
    `rm -f "${opts.stagePath}"`,
    "fi",
    String.raw`printf "%s %s\n" "${OMP_HEARD_MARKER}" "$ompcmd"`,
  ].join("; ");
  const boot = opts.bootPaintUntil;
  const cases = [
    `approval) printf "%s\\n" ${approval} ;;`,
    `clear) for i in {1..40}; do printf "omp-clear %s\\n" "$i"; done ;;`,
    ...(boot === undefined ? [] : [`settle) touch "${boot}" ;;`]),
    "quit) break ;;",
    `*) ${onPrompt} ;;`,
  ].join(" ");
  return [
    `mkdir -p "${opts.breadcrumbDir}"`,
    `mkdir -p "${path.dirname(opts.transcriptPath)}"`,
    "t=$(tty)",
    stripDevPrefix,
    slashesToDashes,
    writeCrumb,
    String.raw`printf "\033]0;omp\007"`,
    String.raw`printf "%s\n" "${OMP_UP_MARKER}"`,
    `${
      boot === undefined
        ? ""
        : `( b=1; while [ ! -f "${boot}" ]; do printf "%s%s\\n" "omp-boot " "$b"; b=$((b+1)); sleep 1; done ) & `
    }while IFS= read -r ompcmd; do case "$ompcmd" in ${cases} esac; done`,
    ":",
    String.raw`printf "%s\n" "${OMP_GONE_MARKER}"`,
  ].join(" ; ");
}
