import type { ActivityUpdate } from "@kolu/acp";
import type { AgentEvent } from "./events.ts";

type Tool = Extract<AgentEvent, { _tag: "tool" }>;
const agentId = (session: string): string =>
  `acp-agent:${JSON.stringify(session)}`;
const taskKey = (session: string, task: string): string =>
  JSON.stringify([session, task]);
const tool = (id: string, move: Partial<Omit<Tool, "_tag" | "id">>): Tool => ({
  _tag: "tool",
  id,
  title: undefined,
  status: undefined,
  detail: undefined,
  asked: undefined,
  progress: undefined,
  rawInput: undefined,
  answer: undefined,
  mcp: [],
  asksThroughForm: undefined,
  diffs: undefined,
  locations: undefined,
  called: undefined,
  row: undefined,
  reply: undefined,
  parent: undefined,
  spawned: undefined,
  armed: undefined,
  provisional: undefined,
  ...move,
});
interface Child {
  readonly parent: string;
  report: string;
  ended: boolean;
}
interface Task {
  readonly row: string;
  status: "in_progress" | "completed" | "failed";
}

export class Activity {
  readonly #children = new Map<string, Child>();
  readonly #tasks = new Map<string, Task>();
  constructor(private readonly emit: (event: AgentEvent) => void) {}

  root(session: string): string {
    let at = session;
    while (this.#children.has(at)) at = this.#children.get(at)!.parent;
    return at;
  }
  parent(session: string): string | undefined {
    return this.#children.has(session) ? agentId(session) : undefined;
  }
  toolId(session: string, id: string): string {
    return `acp-tool:${JSON.stringify([session, id])}`;
  }
  clear(closed: Set<string>): void {
    for (const id of this.#children.keys()) closed.add(id);
    this.#children.clear();
    this.#tasks.clear();
  }
  taskStatusFor(id: string): Task["status"] | undefined {
    for (const task of this.#tasks.values())
      if (task.row === id) return task.status;
    return undefined;
  }
  report(session: string, text: string): void {
    const child = this.#children.get(session);
    if (!child || text === "") return;
    child.report += text;
    this.emit(tool(agentId(session), { progress: child.report }));
  }
  read(session: string, update: ActivityUpdate): void {
    const { id } = update;
    if (update.kind === "child") {
      if (id === this.root(session) || this.#children.has(id)) return;
      this.#children.set(id, { parent: session, report: "", ended: false });
      this.emit(
        tool(agentId(id), {
          title: update.name,
          status: "in_progress",
          parent: this.parent(session),
          spawned: { kind: update.name, said: update.task },
          detail: update.task,
        }),
      );
    } else if (update.kind === "childEnded") {
      const child = this.#children.get(id);
      if (!child || child.parent !== session || child.ended) return;
      child.ended = true;
      this.emit(
        tool(agentId(id), {
          status: update.state === "completed" ? "completed" : "failed",
        }),
      );
    } else if (update.kind === "task") {
      const key = taskKey(session, id);
      if (this.#tasks.has(key)) return;
      const row = update.tool
        ? this.toolId(session, update.tool)
        : `acp-task:${key}`;
      this.#tasks.set(key, { row, status: "in_progress" });
      this.emit(
        tool(row, {
          title: update.name,
          status: "in_progress",
          parent: this.parent(session),
          armed: {
            task: id,
            description: update.description ?? update.name,
            ended: null,
            report: null,
          },
        }),
      );
    } else {
      const task = this.#tasks.get(taskKey(session, id));
      if (!task || task.status !== "in_progress") return;
      if (update.kind === "taskProgress") {
        this.emit(
          tool(task.row, {
            progress: update.summary,
            armed: {
              task: id,
              description: update.description ?? null,
              ended: null,
              report: null,
            },
          }),
        );
      } else {
        task.status = update.state === "completed" ? "completed" : "failed";
        this.emit(
          tool(task.row, {
            status: task.status,
            armed: {
              task: id,
              description: null,
              ended: update.state,
              report: null,
            },
            progress: update.summary,
          }),
        );
      }
    }
  }
}
