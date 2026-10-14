/** Pins the boot-stalled copy authority — a sibling of `hostDownCopy.test.ts`. The
 *  `satisfies Record<ClientStalledLeg, …>` in `bootStalledCopy.ts` already fails the build if
 *  a client leg is missing; this asserts every client leg's copy is non-empty and distinct, the
 *  connector card's copy is non-empty and NON-terminal, and the phase detail narrates every
 *  connect phase — so the card never renders a blank, a duplicate, or a terminal lie. */

import { describe, expect, it } from "vitest";
import type { ClientStalledLeg } from "./canvasModeResolver";
import {
  BOOT_STALLED_COPY,
  bootStalledCopy,
  bootStalledPhaseDetail,
  CONNECTOR_STALLED_COPY,
} from "./bootStalledCopy";

const CLIENT_LEGS: ClientStalledLeg[] = ["membership", "session", "daemon"];

describe("bootStalledCopy (client card)", () => {
  it("has non-empty title + body for every client leg", () => {
    for (const leg of CLIENT_LEGS) {
      const copy = bootStalledCopy(leg);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the client legs (no orphan keys, no `provisioning` — that is the connector card)", () => {
    expect(new Set(Object.keys(BOOT_STALLED_COPY))).toEqual(
      new Set(CLIENT_LEGS),
    );
  });

  it("each client leg's title is distinct — no leg silently reuses another's card", () => {
    const titles = CLIENT_LEGS.map((leg) => bootStalledCopy(leg).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("CONNECTOR_STALLED_COPY (connector card, #1908 D2)", () => {
  it("has non-empty title + body", () => {
    expect(CONNECTOR_STALLED_COPY.title.length).toBeGreaterThan(0);
    expect(CONNECTOR_STALLED_COPY.body.length).toBeGreaterThan(0);
  });

  it("is NON-terminal — names the ongoing retry, never claims the host failed", () => {
    const text =
      `${CONNECTOR_STALLED_COPY.title} ${CONNECTOR_STALLED_COPY.body}`.toLowerCase();
    expect(text).toMatch(/retry|retrying|still|hasn't given up/);
    expect(text).not.toMatch(/failed|isn't responding|gave up/);
  });
});

describe("bootStalledPhaseDetail", () => {
  it("narrates every connect phase with a distinct, non-empty 'still …' detail line", () => {
    const details = (["probing", "provisioning", "connecting"] as const).map(
      (p) => bootStalledPhaseDetail(p),
    );
    for (const d of details) {
      expect(d).toBeTruthy();
      expect(d).toMatch(/^Still /);
    }
    expect(new Set(details).size).toBe(details.length);
  });

  it("has no detail for the pre-frame gap (undefined)", () => {
    expect(bootStalledPhaseDetail(undefined)).toBeUndefined();
  });

  const LAST = "ci@croissant: copying path '/nix/store/abc-kolu-2.2.0'…";

  it("names the campaign's last line and how long nothing has followed it", () => {
    expect(
      bootStalledPhaseDetail("provisioning", {
        lastLine: LAST,
        silentMs: 14 * 60_000 + 59_000,
      }),
    ).toBe(
      `Still provisioning the agent on the host… No new output in the last 14 min. Last line: ${LAST}`,
    );
  });

  it("states the silence only from a full minute — shorter is not a stall", () => {
    expect(
      bootStalledPhaseDetail("probing", { lastLine: LAST, silentMs: 59_999 }),
    ).toBe(
      `Still checking whether this host already has the agent… Last line: ${LAST}`,
    );
  });

  it("spells hours for a long silence", () => {
    const detail = (min: number) =>
      bootStalledPhaseDetail("connecting", {
        lastLine: LAST,
        silentMs: min * 60_000,
      });
    expect(detail(60)).toContain("No new output in the last 1 h.");
    expect(detail(125)).toContain("No new output in the last 2 h 5 min.");
  });

  it("no phase, no detail — even with a quiet tail", () => {
    expect(
      bootStalledPhaseDetail(undefined, { lastLine: LAST, silentMs: 600_000 }),
    ).toBeUndefined();
  });
});
