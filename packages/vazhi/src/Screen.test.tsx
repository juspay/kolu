import type { Forward } from "@kolu/port-forward";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Screen } from "./Screen.tsx";

const NOW = 1_700_000_000_000;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

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

function frame(props: Partial<Parameters<typeof Screen>[0]> = {}): string {
  const { lastFrame } = render(
    <Screen
      forwards={[]}
      hostname="pureintent"
      mode={{ kind: "table" }}
      now={NOW}
      onInputChange={() => {}}
      onInputSubmit={() => {}}
      selected={0}
      size={{ columns: 80, rows: 24 }}
      status={undefined}
      {...props}
    />,
  );
  return lastFrame() ?? "";
}

/** The frame with every escape sequence removed — what a human reads. */
function plain(text: string): string {
  return text
    .replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "g"), "")
    .replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
}

describe("the forward table", () => {
  it("shows one row per forward: target → URL · uptime", () => {
    const text = plain(
      frame({ forwards: [forward("pu-dev", 5173, 4123, 12 * 60_000)] }),
    );
    expect(text).toContain("pu-dev:5173");
    expect(text).toContain("http://pureintent:4123");
    expect(text).toContain("up 12m");
  });

  it("makes each URL a clickable OSC 8 hyperlink", () => {
    const text = frame({ forwards: [forward("pu-dev", 5173, 4123, 1000)] });
    expect(text).toContain(`${ESC}]8;;http://pureintent:4123${BEL}`);
  });

  it("names the machine the forwards answer on", () => {
    // The URL to open is `<this machine>:<localPort>` — never "localhost",
    // which would mean the viewer's own laptop.
    expect(plain(frame())).toContain("answering on pureintent");
  });

  it("aligns the arrows whatever the host names are", () => {
    const lines = plain(
      frame({
        forwards: [
          forward("pu-dev", 5173, 4123, 1000),
          forward("a-much-longer-hostname", 8080, 8080, 1000),
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
      frame({
        forwards: [
          forward("pu-dev", 5173, 4123, 1000),
          forward("zest", 8080, 8080, 1000),
        ],
        selected: 1,
      }),
    ).split("\n");
    expect(lines.filter((line) => line.includes("›"))).toHaveLength(1);
    expect(lines.find((line) => line.includes("›"))).toContain("zest:8080");
  });

  it("counts the forwards in the header", () => {
    expect(plain(frame({ forwards: [forward("pu-dev", 1, 2, 0)] }))).toContain(
      "1 forward ",
    );
    expect(
      plain(
        frame({
          forwards: [forward("pu-dev", 1, 2, 0), forward("zest", 3, 4, 0)],
        }),
      ),
    ).toContain("2 forwards");
  });

  it("tells a first-time user what to press when there is nothing yet", () => {
    const text = plain(frame());
    expect(text).toContain("nothing forwarded yet");
    expect(text).toContain("host:port");
  });
});

describe("the frame", () => {
  it("fills the terminal — the keybind bar sits on the last line", () => {
    const lines = plain(frame({ size: { columns: 80, rows: 12 } })).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toContain("a add · x cancel");
  });

  it("refills a resized terminal", () => {
    const lines = plain(frame({ size: { columns: 60, rows: 30 } })).split("\n");
    expect(lines).toHaveLength(30);
  });
});

describe("the bottom line", () => {
  it("lists the keybinds in table mode", () => {
    expect(plain(frame())).toContain("a add · x cancel · ↑/↓ move · q quit");
  });

  it("echoes what is being typed in add mode", () => {
    const text = plain(frame({ mode: { kind: "add", input: "pu-dev:51" } }));
    expect(text).toContain("host:port ▸ pu-dev:51");
    expect(text).toContain("enter to add");
  });
});

describe("the status line", () => {
  it("shows an error where the user is looking, in red", () => {
    const text = frame({
      status: {
        kind: "error",
        text: "ssh exited 255: Host key verification failed",
      },
    });
    expect(plain(text)).toContain("Host key verification failed");
    // Errors are the one thing that must not read like ordinary chatter.
    expect(text).toContain(`${ESC}[31m`);
  });
});
