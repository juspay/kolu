/** Activity remembered for one conversation. Explicit child-session ancestry
 * owns agent cards, tools and questions; task lifecycles own command status.
 * Wire decoding and negotiation are @kolu/acp's; row policy is chat's. */
import type { ActivityUpdate } from "@kolu/acp";
import type { Turn } from "./answering.ts";
import type { AgentEvent, Said } from "./events.ts";

type Tool = Said<Extract<AgentEvent, { _tag: "tool" }>>;
const agentId = (session: string): string =>
  `acp-agent:${JSON.stringify(session)}`;
const taskKey = (session: string, task: string): string =>
  JSON.stringify([session, task]);
/** A tool event, and the prompt the frame it came from belongs to — said by
 *  every caller, because a frame of this channel is a frame of a turn like any
 *  other (`./answering.ts` stamps it), and an event that left it out would
 *  read as one nobody could place. */
const tool = (
  id: string,
  turn: Turn,
  move: Partial<Omit<Tool, "_tag" | "id" | "turn">>,
): Tool => ({
  _tag: "tool",
  id,
  turn,
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
  constructor(private readonly emit: (event: Said<AgentEvent>) => void) {}

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
  /** Only the task's terminal event can extinguish a background command row. */
  status(id: string, reported: Tool["status"]): Tool["status"] {
    for (const task of this.#tasks.values())
      if (task.row === id) return task.status;
    return reported;
  }
  report(session: string, text: string, turn: Turn): void {
    const child = this.#children.get(session);
    if (!child || text === "") return;
    child.report += text;
    this.emit(tool(agentId(session), turn, { progress: child.report }));
  }
  read(session: string, update: ActivityUpdate, turn: Turn): void {
    const { id } = update;
    if (update.kind === "child") {
      if (id === this.root(session) || this.#children.has(id)) return;
      this.#children.set(id, { parent: session, report: "", ended: false });
      this.emit(
        tool(agentId(id), turn, {
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
        tool(agentId(id), turn, {
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
        tool(row, turn, {
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
          tool(task.row, turn, {
            progress: update.summary,
            // `null` is "this frame says nothing" — a report REFINES the task
            // and a consumer keeps what an earlier one said.
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
          tool(task.row, turn, {
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
