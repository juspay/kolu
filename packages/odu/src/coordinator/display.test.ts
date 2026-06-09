import { describe, expect, it } from "vitest";
import type { NodeState, PipelineState } from "../common/surface";
import { renderRunFrame } from "./display";

function node(
  id: string,
  status: NodeState["status"],
  durationMs: number | null = null,
  startedAt: number | null = null,
): NodeState {
  return {
    id,
    name: id,
    command: `just --no-deps ${id}`,
    needs: [],
    status,
    exitCode: null,
    startedAt,
    durationMs,
  };
}

const state: PipelineState = {
  name: "ci::default",
  order: [
    "_ci-setup@x86_64-linux",
    "ci::install@x86_64-linux",
    "ci::e2e@x86_64-linux",
    "_ci-setup@aarch64-darwin",
    "ci::install@aarch64-darwin",
    "ci::e2e@aarch64-darwin",
  ],
  nodes: {
    "_ci-setup@x86_64-linux": node("_ci-setup@x86_64-linux", "ok", 41_000),
    "ci::install@x86_64-linux": node("ci::install@x86_64-linux", "ok", 11_000),
    "ci::e2e@x86_64-linux": node(
      "ci::e2e@x86_64-linux",
      "running",
      null,
      1_000_000,
    ),
    "_ci-setup@aarch64-darwin": node("_ci-setup@aarch64-darwin", "ok", 44_000),
    "ci::install@aarch64-darwin": node(
      "ci::install@aarch64-darwin",
      "failed",
      76_000,
    ),
    "ci::e2e@aarch64-darwin": node("ci::e2e@aarch64-darwin", "pending"),
  },
};

const header = {
  pipeline: "ci::default",
  sha7: "3cbac86",
  dirty: false,
  commitUrl: "https://github.com/juspay/kolu/commit/3cbac86f",
  lanes: [
    { platform: "x86_64-linux", host: "kolu-ci-5" },
    { platform: "aarch64-darwin", host: "rasam" },
  ],
  hostsSource: "~/.config/odu/hosts.json",
};

// ANSI is auto-disabled off-TTY (vitest), so frames are plain strings here.
describe("renderRunFrame", () => {
  const frame = renderRunFrame({
    state,
    header,
    tick: 4,
    startedAt: 940_000,
    now: 1_540_000,
    lastLog: { id: "ci::e2e@x86_64-linux", text: "Scenario: canvas maximize" },
    columns: 100,
  });

  it("renders one row per recipe with a cell per lane", () => {
    expect(frame).toContain("x86_64-linux");
    expect(frame).toContain("aarch64-darwin");
    // ci:: prefix is stripped in the matrix; lanes carry the platform.
    expect(frame).toMatch(/^ {2}e2e\s/m);
    expect(frame).toMatch(/^ {2}install\s/m);
    expect(frame).toContain("_ci-setup");
  });

  it("shows ticking elapsed for running cells, durations for terminal ones", () => {
    expect(frame).toContain("✔ 41s");
    expect(frame).toContain("✗ 1m16s");
    expect(frame).toContain("9m0s"); // running e2e: now - startedAt
  });

  it("summarizes counts and tails the busiest node's log", () => {
    expect(frame).toContain("3 ok");
    expect(frame).toContain("1 running");
    expect(frame).toContain("1 failed");
    expect(frame).toContain("› ci::e2e@x86_64-linux");
    expect(frame).toContain("Scenario: canvas maximize");
  });

  it("ends the header with the run's elapsed wall clock", () => {
    expect(frame.split("\n")[0]).toContain("10m0s");
  });

  it("names the commit, marking a dirty live-tree run loudly", () => {
    expect(frame.split("\n")[0]).toContain("@ 3cbac86");
    const dirtyFrame = renderRunFrame({
      state,
      header: { ...header, dirty: true },
      tick: 0,
      startedAt: 940_000,
      now: 1_540_000,
      columns: 100,
    });
    expect(dirtyFrame.split("\n")[0]).toContain("@ 3cbac86+dirty");
  });
});
