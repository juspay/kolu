// @vitest-environment happy-dom
/**
 * "GO TO THIS WORK" COSTS ONE FLUSH.
 *
 * Every face that sends a person to a work goes through one request
 * (`showWork`), and the card that work belongs to answers it: it scrolls
 * itself into view and flashes once. The card's effect TRACKS that request —
 * it has to, that is how it hears about it — so acknowledging by clearing the
 * request writes the very signal the effect reads, and every card in the
 * column runs a second time to learn there is nothing left to do.
 *
 * What is pinned here: the request is answered without writing anything the
 * cards read (`EFFECT_WRITES_OWN_SOURCE` is what Solid calls the alternative),
 * the card is brought into view ONCE for one ask, and asking again for the
 * same work brings it in again.
 */

import { openWork, type Work, type WorkId, workIdOf } from "kolu-work";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAdvisorySolidDiagnostic,
  takeSolidDiagnostics,
} from "@kolu/solid-test-setup/setup";

vi.mock("../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({ kind: "gone" }),
}));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map(),
  // No records in this fixture: a card's work arrives as a prop here.
  useWorkAt: () => undefined,
  useWorkMembers: () => () => new Map(),
  useWorkPrs: () => () => new Map(),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
vi.mock("./WorkTerminals", () => ({ default: () => <div /> }));
vi.mock("./WorkSubtitle", () => ({ default: () => <p /> }));

import { Shown } from "../ui/shown";
import WorkCard from "./WorkCard";
import { showWork, unpickWork } from "./workListing";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "wanted",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);

const work = (): Work =>
  openWork({
    key: KEY,
    title: "The work a route points at",
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  });

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;
/** Every time any element was brought into view — happy-dom lays nothing out,
 *  so the CALL is the fact. */
let scrolled = 0;

Object.defineProperty(Element.prototype, "scrollIntoView", {
  writable: true,
  value: () => {
    scrolled += 1;
  },
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  scrolled = 0;
  unpickWork();
});

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

/** The frame the card waits for before it scrolls — a card the listing has
 *  just opened has no box until then. */
const nextFrames = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 20);
    await promise;
  }
  flush();
};

describe("a route that asks for a work's card", () => {
  it("answers the request without writing what the cards read", async () => {
    root = document.createElement("div");
    document.body.append(root);
    dispose = render(
      () => (
        <Shown value={() => true}>
          <WorkCard id={ID} work={work()} shape="card" />
        </Shown>
      ),
      root,
    );
    flush();
    takeSolidDiagnostics();

    showWork(ID);
    flush();
    await nextFrames();
    expect(scrolled).toBe(1);
    // The acknowledgement is the cards' own bookkeeping: nothing the effect
    // tracks was written, so no card ran a second time for this ask.
    expect(findings()).toEqual([]);

    // Asking again for the same work brings it in again.
    showWork(ID);
    flush();
    await nextFrames();
    expect(scrolled).toBe(2);
    expect(findings()).toEqual([]);
  });
});
