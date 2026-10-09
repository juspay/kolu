/**
 * Whether the setting's profile resolves on this host — one run of the
 * bundle's `agent-distro --list --json` from `$HOME`, against the stand-in the
 * e2e fixture uses too (`@kolu/agent-distro/testing`).
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STAND_IN_REFERENCE_PROFILE,
  standInListJson,
} from "@kolu/agent-distro/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveProfileOnHost } from "./inEffect.ts";

let bundle: string;

beforeEach(() => {
  bundle = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-resolve-")));
  mkdirSync(join(bundle, "bin"));
  writeFileSync(
    join(bundle, "bin", "agent-distro"),
    `#!/bin/sh\n${standInListJson("vanilla", ["vanilla"])}\nexit 2\n`,
    { mode: 0o755 },
  );
});

describe("resolveProfileOnHost", () => {
  it("a reference that resolves: agent-distro's name and description for it", async () => {
    expect(
      await resolveProfileOnHost({ bundle, profile: "github:juspay/skills" }),
    ).toEqual({
      kind: "resolved",
      profile: "github:juspay/skills",
      name: STAND_IN_REFERENCE_PROFILE.name,
      description: STAND_IN_REFERENCE_PROFILE.description,
    });
  });

  it("a built-in resolves to itself", async () => {
    expect(await resolveProfileOnHost({ bundle, profile: "vanilla" })).toEqual({
      kind: "resolved",
      profile: "vanilla",
      name: "vanilla",
      description: "Fixture profile vanilla",
    });
  });

  it("one that does not: agent-distro's own words, on one line", async () => {
    expect(
      await resolveProfileOnHost({ bundle, profile: "github:nobody/nothing" }),
    ).toEqual({
      kind: "failed",
      profile: "github:nobody/nothing",
      message:
        "agent-distro: AI_PROFILE=github:nobody/nothing: cannot fetch github:nobody/nothing: error: unable to download: HTTP error 404",
    });
  });

  it("a picker that cannot run is a failure too, never a throw", async () => {
    const answer = await resolveProfileOnHost({
      bundle: join(bundle, "missing"),
      profile: "vanilla",
    });
    expect(answer.kind).toBe("failed");
  });
});
