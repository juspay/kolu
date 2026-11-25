/**
 * A WATCH'S ID IS ITS TERMINAL'S FLEET REF — the one grammar, never a second.
 *
 * A watch key holds its host and its id as two fields; its work id encodes
 * them joined the way `fleetTerminalRef` prints a terminal, and reading the
 * id back splits it the way `splitFleetTerminalRef` does: at the LAST `/`,
 * because a host key may hold one and a terminal id never does. Generated
 * hosts with slashes, colons and percent signs keep the two grammars honest.
 */

import { Option } from "effect";
import { workIdOf, workIdParts } from "kolu-work";
import { seeded } from "kolu-work/seeded";
import { describe, expect, it } from "vitest";
import { fleetTerminalRef, splitFleetTerminalRef } from "./ref.ts";

describe("a watch's id and the fleet ref grammar", () => {
  it("agree for any host and terminal id", () => {
    const PIECES = ["local", "remote:", "ssh://box", "/3", "%2F", "a b", "é"];
    for (let seed = 1; seed <= 300; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const host = `${among(PIECES)}${among(PIECES)}`.replace(/^\/+/, "h");
      const id = `${Math.floor(pick() * 1e12).toString(16)}-term`;
      const ref = fleetTerminalRef(host, id);
      expect(workIdOf({ kind: "watch", host, id }), `seed ${seed}`).toBe(
        `watch:${encodeURIComponent(ref)}`,
      );
      expect(splitFleetTerminalRef(ref), `seed ${seed}`).toEqual({ host, id });
      expect(
        Option.getOrThrow(workIdParts(workIdOf({ kind: "watch", host, id }))),
        `seed ${seed}`,
      ).toEqual({ kind: "watch", host, id });
    }
  });
});
