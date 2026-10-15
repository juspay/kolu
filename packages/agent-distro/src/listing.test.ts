/** The harnesses kolu offers, read off its floor package's versions file. */

import { describe, expect, it } from "vitest";
import { versionsFile } from "./bundle.ts";
import { floorListing } from "./listing.ts";
import type { AgentDistroManifest } from "./manifest.ts";
import { packageFiles, readFrom } from "./testing.ts";

const MANIFEST: AgentDistroManifest = { dir: "/s/p", bin: "/s/p/bin" };

const HARNESSES = [
  { name: "claude", title: "Claude Code", version: "2.1.292" },
  { name: "codex", title: "Codex", version: "0.160.1" },
  { name: "opencode", title: "OpenCode", version: "1.18.35+53d1eab" },
];

describe("floorListing", () => {
  it("reads the package's harnesses, in menu order, with their full versions", () => {
    expect(
      floorListing(MANIFEST, readFrom(packageFiles("/s/p", HARNESSES))),
    ).toEqual({ kind: "available", harnesses: HARNESSES });
  });

  it("reads upstream's format verbatim — a real versions file", () => {
    const real =
      "claude\tClaude Code\t2.1.292\nomp\tOh My Pi\t18.7.0\npi\tPi\t1.0.4\n";
    expect(
      floorListing(MANIFEST, readFrom({ [versionsFile("/s/p")]: real })),
    ).toEqual({
      kind: "available",
      harnesses: [
        { name: "claude", title: "Claude Code", version: "2.1.292" },
        { name: "omp", title: "Oh My Pi", version: "18.7.0" },
        { name: "pi", title: "Pi", version: "1.0.4" },
      ],
    });
  });

  it("throws when the versions file is missing — a package that does not describe itself is a broken build", () => {
    expect(() => floorListing(MANIFEST, readFrom({}))).toThrow(/ENOENT/);
  });

  it("throws on a versions file that names no harness", () => {
    expect(() =>
      floorListing(MANIFEST, readFrom({ [versionsFile("/s/p")]: "" })),
    ).toThrow();
  });

  it("throws on a line out of upstream's format", () => {
    expect(() =>
      floorListing(
        MANIFEST,
        readFrom({ [versionsFile("/s/p")]: "claude Claude Code 2.1.292\n" }),
      ),
    ).toThrow(/versions line/);
  });
});
