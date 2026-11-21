/**
 * THE FRAME'S TRACKS, by state: the works the wide side and the chat a panel
 * of fixed measure on a desktop, a file taking the works' track, the chat put
 * aside only when the file fills the screen — and on a phone, one thing at a
 * time. The measures are `index.css`'s, and the chat's must grow with the
 * window, never shrink.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatPutAside, frameTracks } from "./conductorFrame";

// `fileURLToPath` + `node:path`, not `new URL(…, import.meta.url)`: the test
// env's global `URL` is the browser one, which rejects a `file:` base.
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

function rem(token: string): number {
  const found = CSS.match(new RegExp(`${token}:\\s*([0-9.]+)rem;`));
  if (found?.[1] === undefined) {
    throw new Error(`${token} is not declared in rem in index.css`);
  }
  return Number(found[1]);
}

const desk = { phone: false, reading: false, filled: false };

/** The base (unprefixed) track list of a class list. */
const base = (classes: string): string =>
  classes.split(" ").find((one) => one.startsWith("grid-cols-")) ?? "";

describe("the Conductor's frame", () => {
  it("gives a desktop the works, then the chat at its measure, at every width", () => {
    const tracks = frameTracks(desk);
    expect(base(tracks)).toBe(
      "grid-cols-[minmax(0,1fr)_var(--container-conductor-chat)]",
    );
    expect(tracks).toContain(
      "conductor-md:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-md)]",
    );
    expect(tracks).toContain(
      "conductor-lg:grid-cols-[minmax(0,1fr)_var(--container-conductor-chat-lg)]",
    );
    expect(chatPutAside(desk)).toBe(false);
  });

  it("puts a file where the works were, and keeps the chat beside it", () => {
    const reading = { ...desk, reading: true };
    expect(base(frameTracks(reading))).toBe(
      "grid-cols-[0px_minmax(0,1fr)_var(--container-conductor-chat)]",
    );
    expect(chatPutAside(reading)).toBe(false);
  });

  it("puts the chat aside only while the file fills the screen", () => {
    const filled = { ...desk, reading: true, filled: true };
    expect(frameTracks(filled)).toBe("grid-cols-[0px_minmax(0,1fr)_0px]");
    expect(chatPutAside(filled)).toBe(true);
  });

  it("gives a phone one thing at a time", () => {
    const phone = { ...desk, phone: true };
    expect(frameTracks(phone)).toBe("grid-cols-[minmax(0,1fr)]");
    expect(chatPutAside(phone)).toBe(false);
    const reading = { ...phone, reading: true };
    expect(frameTracks(reading)).toBe("grid-cols-[minmax(0,1fr)_0px]");
    expect(chatPutAside(reading)).toBe(true);
  });

  it("widens the chat as the window widens, and never past a third of it", () => {
    const sm = rem("--container-conductor-chat");
    const md = rem("--container-conductor-chat-md");
    const lg = rem("--container-conductor-chat-lg");
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
    // The narrowest desktop window that holds the chat at -md is the -md
    // breakpoint, and the same for -lg: the works keep two thirds of each.
    expect(md / rem("--breakpoint-conductor-md")).toBeLessThanOrEqual(1 / 3);
    expect(lg / rem("--breakpoint-conductor-lg")).toBeLessThanOrEqual(1 / 3);
    expect(rem("--breakpoint-conductor-md")).toBeLessThan(
      rem("--breakpoint-conductor-lg"),
    );
  });
});
