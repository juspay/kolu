/** The index read: which bundle a host pulls, read off agent-distro's index
 *  over HTTPS — a 200 is the paths, a 404 is a typed "not published", and
 *  anything else is loud. */

import { describe, expect, it, vi } from "vitest";
import { BundleUnpublishedError } from "./delivery.ts";
import { readPublishedBundle } from "./ops.ts";

const INDEX = "https://raw.githubusercontent.com/juspay/agent-distro/ca-index";
const ENTRY = {
  rev: "cb44dd8115ea07c3b80b263f3992c49a587a4e5f",
  ia: "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro-vanilla",
  ca: "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla",
};

const answering = (status: number, text: string) =>
  vi.fn(async (_url: string) => ({ status, text }));

describe("readPublishedBundle", () => {
  it("a 200 is the entry, read from latest/<system>/<profile>.json", async () => {
    const fetchText = answering(200, JSON.stringify(ENTRY));
    await expect(
      readPublishedBundle(INDEX, "x86_64-linux", "vanilla", fetchText),
    ).resolves.toEqual(ENTRY);
    expect(fetchText).toHaveBeenCalledWith(
      `${INDEX}/latest/x86_64-linux/vanilla.json`,
    );
  });

  it("a 404 is BundleUnpublishedError, naming the profile and system", async () => {
    const res = readPublishedBundle(
      INDEX,
      "armv7l-linux",
      "vanilla",
      answering(404, "404: Not Found"),
    );
    await expect(res).rejects.toBeInstanceOf(BundleUnpublishedError);
    await expect(res).rejects.toThrow(
      "agent-distro has not published the vanilla agents for armv7l-linux yet",
    );
  });

  it("a malformed entry is loud, never a path guessed", async () => {
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(200, JSON.stringify({ rev: ENTRY.rev, ia: ENTRY.ia })),
      ),
    ).rejects.toThrow(/is not \{ rev, ia, ca \}/);
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(200, "<html>"),
      ),
    ).rejects.toThrow(/is not \{ rev, ia, ca \}/);
  });

  it("any other status is loud, with the status and the URL", async () => {
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(503, "upstream down"),
      ),
    ).rejects.toThrow(
      `agent-distro's index answered HTTP 503 for ${INDEX}/latest/x86_64-linux/vanilla.json: upstream down`,
    );
  });
});
