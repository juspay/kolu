/**
 * Asking agent-distro which profile is in effect in a terminal — one run of
 * the package's `agent-distro --list --json` in the terminal's cwd and spawn
 * env, against the stand-in the e2e fixture uses too
 * (`@kolu/agent-distro/testing`).
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAND_IN_PROFILE, standInListJson } from "@kolu/agent-distro/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { probeProfileInEffect } from "./inEffect.ts";

const HARNESSES = [
  { name: "claude", title: "Claude Code", version: "2.1.291" },
] as const;

let bundle: string;

/** A package whose picker runs `script` (POSIX sh). */
function picker(script: string): void {
  writeFileSync(join(bundle, "bin", "agent-distro"), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
}

beforeEach(() => {
  bundle = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-probe-")));
  mkdirSync(join(bundle, "bin"));
  picker(`${standInListJson(HARNESSES)}\nexit 2`);
});

const probe = (env: Record<string, string>) =>
  probeProfileInEffect({ bundle, cwd: bundle, env, terminal: "T-probe" });

describe("probeProfileInEffect", () => {
  it("a terminal with an AI_PROFILE stack: the profile in effect, in upstream's words", async () => {
    expect(await probe({ AI_PROFILE: "/nix/store/p-juspay" })).toEqual({
      name: STAND_IN_PROFILE.name,
      description: STAND_IN_PROFILE.description,
      source: "from AI_PROFILE=/nix/store/p-juspay",
    });
  });

  it("no profile in effect (no AI_PROFILE): undefined", async () => {
    expect(await probe({})).toBeUndefined();
  });

  it("runs in the terminal's cwd", async () => {
    const cwd = join(bundle, "repo");
    mkdirSync(cwd);
    picker(
      `printf '{"harnesses":[{"name":"claude","tagline":"t","title":"Claude Code","version":"2.1.291"}],"profile":{"name":"repo","description":"d","source":"repository","origin":"%s"}}\\n' "$PWD"`,
    );
    const answer = await probeProfileInEffect({
      bundle,
      cwd,
      env: {},
      terminal: "T-probe",
    });
    expect(answer?.name).toBe("repo");
    expect(answer?.source).toBe(`from ${cwd}`);
  });

  it("a picker that fails, or cannot run: undefined, never a throw", async () => {
    picker("echo nope >&2; exit 3");
    expect(await probe({})).toBeUndefined();
    expect(
      await probeProfileInEffect({
        bundle: join(bundle, "missing"),
        cwd: bundle,
        env: {},
        terminal: "T-probe",
      }),
    ).toBeUndefined();
  });

  it("a picker that prints something kolu cannot read: undefined", async () => {
    picker("echo 'not json'");
    expect(await probe({})).toBeUndefined();
  });
});
