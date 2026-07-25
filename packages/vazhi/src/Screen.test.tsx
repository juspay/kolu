import { type Forward, targetKey } from "@kolu/port-forward";
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
    key: targetKey({ kind: "remote", host, port, loopback: "v4" }),
    target: { kind: "remote", host, port, loopback: "v4" },
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
      selectedKey={undefined}
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
        selectedKey: "remote:zest:8080",
      }),
    ).split("\n");
    expect(lines.filter((line) => line.includes("›"))).toHaveLength(1);
    expect(lines.find((line) => line.includes("›"))).toContain("zest:8080");
  });

  it("marks the row by identity, so a shrinking list cannot move the highlight", () => {
    // The selected forward keeps the `›` wherever it now sits; a position would
    // have handed it to whichever row happened to take that index.
    const lines = plain(
      frame({
        forwards: [forward("zest", 8080, 8080, 1000)],
        selectedKey: "remote:zest:8080",
      }),
    ).split("\n");
    expect(lines.find((line) => line.includes("›"))).toContain("zest:8080");
  });

  it("marks nothing when the selected forward is gone", () => {
    const text = plain(
      frame({
        forwards: [forward("pu-dev", 5173, 4123, 1000)],
        selectedKey: "remote:zest:8080",
      }),
    );
    expect(text).not.toContain("›");
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

describe("a table bigger than the terminal", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    forward(`h${i + 1}`, 5000 + i, 40000 + i, i * 1000),
  );

  it("keeps the selected row, the status line and the legend on screen", () => {
    const text = plain(
      frame({
        forwards: many,
        selectedKey: many[9]?.key,
        size: { columns: 90, rows: 10 },
        status: { kind: "info", text: "opening h10:5009…" },
      }),
    );
    expect(text).toContain("h10:5009");
    expect(text).toContain("opening h10:5009…");
    expect(text).toContain("a add · x cancel");
  });

  it("still shows the selected row in the smallest terminals", () => {
    for (const rows of [6, 7]) {
      const text = plain(
        frame({
          forwards: many,
          selectedKey: many[9]?.key,
          size: { columns: 90, rows },
        }),
      );
      expect(text).toContain("h10:5009");
    }
  });

  it("keeps a multi-kilobyte error inside its one row", () => {
    const lines = plain(
      frame({
        forwards: many.slice(0, 3),
        selectedKey: many[0]?.key,
        size: { columns: 60, rows: 12 },
        status: { kind: "error", text: `ssh said: ${"x".repeat(4000)}` },
      }),
    ).split("\n");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    // and the legend still made it
    expect(lines.at(-1)).toContain("a add");
  });

  it("shows a contiguous run and says how many it is hiding", () => {
    const text = plain(
      frame({
        forwards: many,
        selectedKey: many[9]?.key,
        size: { columns: 90, rows: 10 },
      }),
    );
    const shown = [...text.matchAll(/h(\d+):/g)].map((m) => Number(m[1]));
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]).toBe((shown[i - 1] ?? 0) + 1);
    }
    expect(text).toMatch(/↑ \d+ more/);
    expect(text).toMatch(/↓ \d+ more/);
  });
});
