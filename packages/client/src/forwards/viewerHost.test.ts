import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = vi.fn();

const answers = (value: unknown): void => {
  viewer.mockImplementation(() => Effect.succeed(value));
};
const refuses = (error: Error): void => {
  viewer.mockImplementation(() => Effect.fail(error));
};
const cell: { value: () => unknown[] } = { value: () => [] };

vi.mock("../wire", () => ({
  hostKeys: () => [
    { kind: "local" },
    { kind: "remote", target: "zest" },
    { kind: "remote", target: "pu-dev" },
  ],
  client: { hosts: { viewer } },
  app: { cells: { forwards: { use: () => ({ value: () => cell.value() }) } } },
}));

afterEach(() => {
  vi.resetModules();
  viewer.mockReset();
  cell.value = () => [];
});

async function loadViewerHost() {
  const mod = await import("./useForwards");
  await new Promise((r) => setTimeout(r, 0));
  return mod.viewerHost;
}

describe("viewerHost", () => {
  it("reads the host the server names", async () => {
    answers({ host: { kind: "remote", target: "zest" } });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toEqual({ kind: "remote", target: "zest" });
  });

  it("is `null`, not a throw, when the server cannot tell", async () => {
    answers({ host: null });
    const viewerHost = await loadViewerHost();
    expect(viewerHost()).toBeNull();
  });

  it("is `null`, not a throw, when the read FAILS", async () => {
    refuses(new Error("websocket closed"));
    const viewerHost = await loadViewerHost();
    expect(() => viewerHost()).not.toThrow();
    expect(viewerHost()).toBeNull();
  });
});

describe("forwardsForHost", () => {
  const door = (key: string, host: { kind: string; target?: string }) => ({
    key,
    host,
    remotePort: 5173,
    localPort: 5173,
    origin: "auto",
    createdAt: 0,
  });

  it("keeps only the doors on the host asked for", async () => {
    cell.value = () => [
      door("remote:zest:5173", { kind: "remote", target: "zest" }),
      door("local:5173", { kind: "local" }),
      door("remote:pu-dev:3000", { kind: "remote", target: "pu-dev" }),
    ];
    const { forwardsForHost } = await import("./useForwards");

    expect(
      forwardsForHost({ kind: "remote", target: "zest" }).map((f) => f.key),
    ).toEqual(["remote:zest:5173"]);
    expect(forwardsForHost({ kind: "local" }).map((f) => f.key)).toEqual([
      "local:5173",
    ]);
  });
});
