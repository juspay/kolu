import { describe, expect, test } from "vitest";
import { Activity } from "./activity.ts";
import type { AgentEvent } from "./events.ts";

const setup = () => {
  const events: AgentEvent[] = [];
  const activity = new Activity((event) => events.push(event));
  const spawn = (parent = "root", child = "child") =>
    activity.read(parent, {
      kind: "child",
      id: child,
      name: "Explorer",
      task: "inspect files",
    });
  const task = (session = "root", linked: string | undefined = "command") =>
    activity.read(session, {
      kind: "task",
      id: "task",
      name: "watch files",
      tool: linked,
    });
  return { activity, events, spawn, task };
};

describe("native session activity", () => {
  test("nested sessions own independent rows even when tool IDs collide", () => {
    const { activity, events, spawn } = setup();
    spawn();
    spawn("child", "grandchild");
    expect(activity.root("grandchild")).toBe("root");
    expect(events[1]).toMatchObject({ parent: activity.parent("child") });
    expect(activity.toolId("root", "same")).not.toBe(
      activity.toolId("child", "same"),
    );
    spawn("grandchild", "root");
    spawn();
    expect(events).toHaveLength(2);
    expect(activity.root("grandchild")).toBe("root");
  });
  test("reports stay on their own agent and completion is scoped and idempotent", () => {
    const { activity, events, spawn } = setup();
    spawn();
    activity.report("child", "one ");
    activity.report("child", "two");
    expect(events.at(-1)).toMatchObject({
      id: activity.parent("child"),
      progress: "one two",
    });
    activity.read("stranger", {
      kind: "childEnded",
      id: "child",
      state: "completed",
    });
    expect(events).toHaveLength(3);
    for (let i = 0; i < 2; i++)
      activity.read("root", {
        kind: "childEnded",
        id: "child",
        state: "completed",
      });
    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ status: "completed" });
  });
  test.each([
    "failed",
    "cancelled",
    "disconnected",
  ] as const)("child %s extinguishes its live card", (state) => {
    const { activity, events, spawn } = setup();
    spawn();
    activity.read("root", { kind: "childEnded", id: "child", state });
    expect(events.at(-1)).toMatchObject({
      id: activity.parent("child"),
      status: "failed",
    });
  });
  test.each([
    "completed",
    "failed",
    "stopped",
  ] as const)("task %s wins over late command updates", (state) => {
    const { activity, events, task } = setup();
    task();
    const row = activity.toolId("root", "command");
    expect(activity.taskStatusFor(row)).toBe("in_progress");
    activity.read("root", {
      kind: "taskProgress",
      id: "task",
      summary: "still checking",
    });
    expect(events.at(-1)).toMatchObject({
      id: row,
      progress: "still checking",
      armed: { task: "task" },
    });
    activity.read("root", { kind: "taskEnded", id: "task", state });
    expect(events.at(-1)).toMatchObject({
      id: row,
      armed: { task: "task", ended: state },
    });
    expect(activity.taskStatusFor(row)).toBe(
      state === "completed" ? "completed" : "failed",
    );
    task();
    expect(events).toHaveLength(3);
  });
  test("task IDs are scoped, and unlinked restored tasks have their own rows", () => {
    const { activity, events, spawn, task } = setup();
    spawn();
    task("root");
    task("child", "");
    expect(events[2]).toMatchObject({
      parent: activity.parent("child"),
      armed: { task: "task" },
    });
    activity.read("stranger", {
      kind: "taskEnded",
      id: "task",
      state: "failed",
    });
    expect(events).toHaveLength(3);
  });
  test("leaving forgets ancestry and fences every former child; replay can restore it", () => {
    const { activity, events, spawn, task } = setup();
    spawn();
    spawn("child", "grandchild");
    task();
    const closed = new Set<string>();
    activity.clear(closed);
    expect([...closed]).toEqual(["child", "grandchild"]);
    expect(activity.parent("child")).toBeUndefined();
    activity.report("child", "late");
    activity.read("root", { kind: "taskEnded", id: "task", state: "failed" });
    expect(events).toHaveLength(3);
    spawn();
    task();
    expect(events).toHaveLength(5);
  });
});
