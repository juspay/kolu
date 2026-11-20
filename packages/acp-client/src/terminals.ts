import type {
  CreateTerminalRequest,
  TerminalOutputRequest,
} from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { start, type Child } from "@kolu/child";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { TerminalView } from "@kolu/acp/wire";

const DEFAULT_LIMIT = 64 * 1024;
const MAX_LIMIT = 1024 * 1024;

export const tailBytes = (
  text: string,
  limit: number,
): { output: string; truncated: boolean } => {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return { output: text, truncated: false };
  let from = bytes.length - limit;
  while (from < bytes.length && (bytes[from]! & 0xc0) === 0x80) from++;
  return { output: bytes.subarray(from).toString("utf8"), truncated: true };
};

export class Terminals {
  private generation = 0;
  private readonly records = new Map<
    string,
    {
      view: TerminalView;
      limit: number;
      client?: { readonly session: string; child: Child | null };
    }
  >();
  constructor(
    private readonly changed: (id: string) => void,
    private readonly cwd: string,
  ) {}

  view(id: string): TerminalView {
    return (
      this.records.get(id)?.view ?? {
        id,
        output: "Terminal output is unavailable.",
        truncated: false,
        exitCode: null,
        signal: null,
        running: false,
      }
    );
  }

  clientOwned(id: string): boolean {
    return this.records.get(id)?.client !== undefined;
  }

  begin(id: string, limit = DEFAULT_LIMIT): void {
    if (this.records.has(id)) return;
    this.records.set(id, {
      limit,
      view: {
        id,
        output: "",
        truncated: false,
        exitCode: null,
        signal: null,
        running: true,
      },
    });
  }

  append(id: string, data: string): void {
    this.begin(id);
    const record = this.records.get(id)!;
    const tail = tailBytes(record.view.output + data, record.limit);
    record.view = {
      ...record.view,
      ...tail,
      truncated: record.view.truncated || tail.truncated,
    };
    this.changed(id);
  }

  finish(id: string, exitCode: number | null, signal: string | null): void {
    this.begin(id);
    const record = this.records.get(id)!;
    record.view = { ...record.view, running: false, exitCode, signal };
    this.changed(id);
  }

  create(params: CreateTerminalRequest): { terminalId: string } {
    const cwd = params.cwd ?? this.cwd;
    if (!isAbsolute(cwd))
      throw RequestError.invalidParams("terminal cwd must be absolute");
    const wanted = params.outputByteLimit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(wanted) || wanted < 0)
      throw RequestError.invalidParams("invalid terminal output limit");
    const id = randomUUID();
    this.begin(id, Math.min(wanted, MAX_LIMIT));
    const env = { ...process.env };
    for (const pair of params.env ?? []) env[pair.name] = pair.value;
    const child = start(params.command, params.args ?? [], {
      cwd,
      env,
      processGroup: true,
      drain: { stdout: false, stderr: false },
    });
    this.records.get(id)!.client = { session: params.sessionId, child };
    const generation = this.generation;
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding("utf8");
      stream?.on("data", (chunk: string) => {
        if (generation === this.generation) this.append(id, chunk);
      });
    }
    void child.unstartable.then((why) => {
      if (generation === this.generation) this.append(id, why + "\n");
    });
    void child.closed.then(({ code, signal }) => {
      if (generation === this.generation) this.finish(id, code, signal);
    });
    return { terminalId: id };
  }

  private handle(params: TerminalOutputRequest): Child {
    const at = this.records.get(params.terminalId)?.client;
    if (
      at === undefined ||
      at.child === null ||
      at.session !== params.sessionId
    )
      throw RequestError.invalidParams("unknown terminal in this session");
    return at.child;
  }

  output(params: TerminalOutputRequest) {
    this.handle(params);
    const view = this.view(params.terminalId);
    return {
      output: view.output,
      truncated: view.truncated,
      ...(view.running
        ? {}
        : { exitStatus: { exitCode: view.exitCode, signal: view.signal } }),
    };
  }

  async wait(params: TerminalOutputRequest) {
    const close = await this.handle(params).closed;
    return { exitCode: close.code, signal: close.signal };
  }

  async kill(params: TerminalOutputRequest) {
    await this.handle(params).stop();
    return {};
  }

  async release(params: TerminalOutputRequest) {
    const child = this.handle(params);
    this.records.get(params.terminalId)!.client!.child = null;
    await child.stop();
    return {};
  }

  async cancel(): Promise<void> {
    await Promise.all(this.children().map((child) => child.stop()));
  }

  private children(): Child[] {
    return [...this.records.values()].flatMap((record) =>
      record.client?.child ? [record.client.child] : [],
    );
  }

  async clear(): Promise<void> {
    const children = this.children();
    for (const [id, { view }] of this.records)
      if (view.running) this.finish(id, null, "SIGTERM");
    this.generation++;
    this.records.clear();
    await Promise.all(children.map((child) => child.stop()));
  }
}
