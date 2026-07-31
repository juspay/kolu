/**
 * The cross-language pin on the facet vocabulary.
 *
 * `osfacts/facets.json` is generated-by-hand-and-verified from the `Facet` enum
 * in `osfacts/src/schema.rs` (`tests/v2_contract.rs::facets_json_is_the_enum`
 * fails if they disagree). This file pins the TypeScript unions to that same
 * document. Adding a facet in Rust without adding it here — the drift that
 * previously surfaced as `unknown unreadable facet` in a consumer's parse, at
 * runtime, on one platform — now fails the fast unit lane on both sides.
 *
 * Deliberately NOT gated behind `KOLU_DAEMON_TESTS`: it needs no binary and no
 * fork, only the two lists, so the loop an author actually runs while editing
 * a sensor catches the drift.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOST_SOURCE_FACETS,
  SNAPSHOT_SOURCE_FACETS,
  SOCKET_HOLDERS_SOURCE_FACETS,
  UNREADABLE_FACETS,
  snapshotFacetNames,
  type SnapshotFacets,
} from "./client.ts";

const contract: {
  unreadable: string[];
  snapshotSource: string[];
  socketHoldersSource: string[];
  hostSource: string[];
} = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "facets.json"), "utf8"),
);

describe("the facet vocabulary is one declaration", () => {
  it("matches the Rust enum's unreadable projection", () => {
    expect([...UNREADABLE_FACETS]).toEqual(contract.unreadable);
  });

  it("matches the Rust enum's snapshot-source projection", () => {
    expect([...SNAPSHOT_SOURCE_FACETS]).toEqual(contract.snapshotSource);
  });

  it("matches the Rust enum's socket-holders-source projection", () => {
    expect([...SOCKET_HOLDERS_SOURCE_FACETS]).toEqual(
      contract.socketHoldersSource,
    );
  });

  it("matches the Rust enum's host-source projection", () => {
    expect([...HOST_SOURCE_FACETS]).toEqual(contract.hostSource);
  });
});

describe("snapshotFacetNames", () => {
  const ALL_FLAGS: Required<SnapshotFacets> = {
    procs: true,
    ports: true,
    mem: true,
    startTime: true,
    cpuTime: true,
    uid: true,
    cwd: true,
    status: true,
    argv: true,
  };

  it("covers every facet a snapshot can name, so a new one needs an entry", () => {
    const named = snapshotFacetNames(ALL_FLAGS);
    expect([...named.unreadable].sort()).toEqual([...UNREADABLE_FACETS].sort());
    expect([...named.source].sort()).toEqual(
      [...SNAPSHOT_SOURCE_FACETS].sort(),
    );
  });

  it("translates a flag to the facets it is actually reported against", () => {
    // The map is not mechanical, which is exactly why it lives in the client:
    // `procs` is singular on the wire, and `ports` names three facets.
    expect(snapshotFacetNames({ procs: true, ports: true })).toEqual({
      unreadable: ["proc", "ports"],
      source: ["proc", "ports", "ports_unclaimed", "ports_uid"],
    });
  });

  it("names nothing for an empty ask", () => {
    expect(snapshotFacetNames({})).toEqual({ unreadable: [], source: [] });
  });
});
