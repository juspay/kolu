/** The Conductor's bell: when a question the conversation asks rings. Each case
 *  is one a person would notice — a stray ring for an old question, or a new
 *  one that stayed silent. */

import { describe, expect, it } from "vitest";
import { type ConductorAskHooks, createConductorAsks } from "./conductorAsks";

function harness() {
  const rang: number[] = [];
  const gates = { alerts: true, watched: false };
  const hooks: ConductorAskHooks = {
    alertsEnabled: () => gates.alerts,
    isWatched: () => gates.watched,
    deliver: (open) => rang.push(open),
  };
  return { bell: createConductorAsks(hooks), rang, gates };
}

describe("conductorAsks — when the Conductor's question rings", () => {
  it("the first reading never rings, even with questions already open (a reload)", () => {
    const { bell, rang } = harness();
    bell.observe(["ask:1", "ask:2"]);
    expect(rang).toEqual([]);
  });

  it("a new question rings once, with the open count", () => {
    const { bell, rang } = harness();
    bell.observe(["ask:1"]);
    bell.observe(["ask:1", "ask:2"]);
    bell.observe(["ask:1", "ask:2"]);
    expect(rang).toEqual([2]);
  });

  it("a question being settled does not ring", () => {
    const { bell, rang } = harness();
    bell.observe(["ask:1", "ask:2"]);
    bell.observe(["ask:2"]);
    bell.observe([]);
    expect(rang).toEqual([]);
  });

  it("one settled and a different one opened in the same reading rings", () => {
    const { bell, rang } = harness();
    bell.observe(["ask:1"]);
    bell.observe(["ask:2"]);
    expect(rang).toEqual([1]);
  });

  it("alerts off: silent, and turning them on afterwards does not ring for that question", () => {
    const { bell, rang, gates } = harness();
    bell.observe([]);
    gates.alerts = false;
    bell.observe(["ask:1"]);
    gates.alerts = true;
    bell.observe(["ask:1"]);
    expect(rang).toEqual([]);
    bell.observe(["ask:1", "ask:2"]);
    expect(rang).toEqual([2]);
  });

  it("watched: silent, and looking away afterwards does not ring for that question", () => {
    const { bell, rang, gates } = harness();
    bell.observe([]);
    gates.watched = true;
    bell.observe(["ask:1"]);
    gates.watched = false;
    bell.observe(["ask:1"]);
    expect(rang).toEqual([]);
    bell.observe(["ask:1", "ask:2"]);
    expect(rang).toEqual([2]);
  });
});
