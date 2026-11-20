import * as fs from "node:fs";
import * as path from "node:path";

function cwdKeyAsXyneWritesItOnDisk(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

const SESSION_ID = "00000000-0000-7000-8000-000000000099";

export interface XyneFixture {
  xyneDir: string;
  cwd: string;
  sessionId: string;
  transcriptPath: string;
  summaryPath: string;
}

function buildTranscript(opts: {
  sessionId: string;
  cwd: string;
  timestamp: string;
  model?: string;
}): string {
  const lines: object[] = [
    {
      type: "session",
      version: 3,
      id: opts.sessionId,
      timestamp: opts.timestamp,
      cwd: opts.cwd,
    },
  ];
  if (opts.model !== undefined) {
    const slash = opts.model.indexOf("/");
    lines.push({
      type: "model_change",
      id: "6b4cd891",
      parentId: null,
      timestamp: opts.timestamp,
      provider: opts.model.slice(0, slash),
      modelId: opts.model.slice(slash + 1),
    });
  }
  lines.push({
    type: "message",
    id: "0bec438c",
    parentId: null,
    timestamp: opts.timestamp,
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
  });
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

export function writeXyneFixture(opts: {
  xyneDir: string;
  cwd: string;
  tsName?: string;
  model?: string;
  title?: string;
}): XyneFixture {
  const tsName = opts.tsName ?? "2026-08-03T10-00-00-000Z";
  const timestamp = tsName.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
  const dir = path.join(
    opts.xyneDir,
    "agent",
    "sessions",
    cwdKeyAsXyneWritesItOnDisk(opts.cwd),
  );
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `${tsName}_${SESSION_ID}.jsonl`);
  fs.writeFileSync(
    transcriptPath,
    buildTranscript({
      sessionId: SESSION_ID,
      cwd: opts.cwd,
      timestamp,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    }),
  );
  const summaryPath = transcriptPath.replace(/\.jsonl$/, "_summary.json");
  if (opts.title !== undefined) {
    fs.writeFileSync(summaryPath, JSON.stringify({ title: opts.title }));
  }
  return {
    xyneDir: opts.xyneDir,
    cwd: opts.cwd,
    sessionId: SESSION_ID,
    transcriptPath,
    summaryPath,
  };
}
