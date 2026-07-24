import type { Forward } from "@kolu/port-forward";
import { describe, expect, it } from "vitest";
import {
  clampSelection,
  formatUptime,
  renderScreen,
  type Screen,
} from "./render.ts";

const NOW = 1_700_000_000_000;

function forward(
  host: string,
  port: number,
  localPort: number,
  upMs: number,
): Forward {
  return {
    key: `${host}:${port}`,
    target: { kind: "remote", host, port },
    localPort,
    createdAt: NOW - upMs,
  };
}

function screen(overrides: Partial<Screen> = {}): Screen {
  return {
    forwards: [],
    selected: 0,
    mode: { kind: "table" },
    status: undefined,
    now: NOW,
    width: 80,
    hostname: "pureintent",
    ...overrides,
  };
}

/** Everything a terminal reads as an attribute rather than as text. */
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** The frame with every escape sequence removed — what a human actually reads. */
function plain(state: Screen): string {
  return renderScreen(state).join("\n").replace(ANSI, "");
}

describe("the forward table", () => {
  it("shows one row per forward: target → listener · uptime", () => {
    const text = plain(
      screen({
        forwards: [forward("pu-dev", 5173, 61010, 12 * 60_000)],
      }),
    );
    expect(text).toContain("pu-dev:5173");
    expect(text).toContain("0.0.0.0:61010");
    expect(text).toContain("up 12m");
  });

  it("names the machine the forwards answer on", () => {
    // The URL to open is `<this machine>:<localPort>` — never "localhost",
    // which would mean the viewer's own laptop.
    expect(plain(screen())).toContain("answering on pureintent");
  });

  it("aligns the arrows whatever the host names are", () => {
    const lines = plain(
      screen({
        forwards: [
          forward("pu-dev", 5173, 61010, 1000),
          forward("a-much-longer-hostname", 8080, 61011, 1000),
        ],
      }),
    )
      .split("\n")
      .filter((line) => line.includes("→"));
    expect(lines).toHaveLength(2);
    expect(lines[0]?.indexOf("→")).toBe(lines[1]?.indexOf("→"));
  });

  it("marks the selected row and only that row", () => {
    const lines = plain(
      screen({
        forwards: [
          forward("pu-dev", 5173, 61010, 1000),
          forward("zest", 8080, 61011, 1000),
        ],
        selected: 1,
      }),
    ).split("\n");
    expect(lines.filter((line) => line.includes("›"))).toHaveLength(1);
    expect(lines.find((line) => line.includes("›"))).toContain("zest:8080");
  });

  it("counts the forwards in the header", () => {
    expect(plain(screen({ forwards: [forward("pu-dev", 1, 2, 0)] }))).toContain(
      "1 forward ",
    );
    expect(
      plain(
        screen({
          forwards: [forward("pu-dev", 1, 2, 0), forward("zest", 3, 4, 0)],
        }),
      ),
    ).toContain("2 forwards");
  });

  it("tells a first-time user what to press when there is nothing yet", () => {
    const text = plain(screen());
    expect(text).toContain("nothing forwarded yet");
    expect(text).toContain("host:port");
  });

  it("clips rows to the terminal width so nothing wraps", () => {
    const lines = renderScreen(
      screen({
        forwards: [forward("a".repeat(200), 5173, 61010, 1000)],
        width: 40,
      }),
    );
    for (const line of lines) {
      const visible = line.replace(ANSI, "");
      expect(visible.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("the bottom line", () => {
  it("lists the keybinds in table mode", () => {
    expect(plain(screen())).toContain("a add · x cancel · j/k move · q quit");
  });

  it("echoes what is being typed in add mode", () => {
    const text = plain(screen({ mode: { kind: "add", input: "pu-dev:51" } }));
    expect(text).toContain("host:port ▸ pu-dev:51");
    expect(text).toContain("enter to add");
  });
});

describe("the status line", () => {
  it("shows an error where the user is looking", () => {
    const state = screen({
      status: {
        kind: "error",
        text: "ssh exited 255: Host key verification failed",
      },
    });
    expect(plain(state)).toContain("Host key verification failed");
    // Errors are the one thing that must not read like ordinary chatter.
    expect(renderScreen(state).join("\n")).toContain("\x1b[31m");
  });
});

describe("formatUptime", () => {
  it.each([
    [0, "0s"],
    [999, "0s"],
    [1_000, "1s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [12 * 60_000, "12m"],
    [59 * 60_000 + 59_000, "59m"],
    [60 * 60_000, "1h 0m"],
    [63 * 60_000, "1h 3m"],
    [25 * 3600_000, "1d 1h"],
  ])("renders %ims as %s", (ms, expected) => {
    expect(formatUptime(ms)).toBe(expected);
  });

  it("never renders a negative age (a clock step is not an error to crash on)", () => {
    expect(formatUptime(-5_000)).toBe("0s");
  });
});

describe("clampSelection", () => {
  it("keeps the highlight on a real row as the list shrinks", () => {
    expect(clampSelection(5, 2)).toBe(1);
    expect(clampSelection(-3, 2)).toBe(0);
    expect(clampSelection(0, 0)).toBe(0);
  });
});
