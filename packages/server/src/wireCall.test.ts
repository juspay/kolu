import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { koluRootGroup } from "kolu-common/contract";
import {
  koluNonSiblingGroups,
  koluWireGroup,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { servedGroup } from "./surface.ts";
import { parseArgs, rpcFor } from "./wireCall.ts";

const BASE = "http://127.0.0.1:7681";

describe("parseArgs", () => {
  it("takes url + tag with no payload (a void root procedure)", () => {
    const args = parseArgs([BASE, "daemon/restart"]);
    expect(args).toEqual({
      baseUrl: BASE,
      tag: "daemon/restart",
      payload: undefined,
      timeoutMs: 30_000,
    });
  });

  it("parses the payload as JSON, on the ENCODED side", () => {
    const args = parseArgs([
      BASE,
      "surface/padi/lifecycle/create",
      '{"mapKey":"local","input":{}}',
    ]);
    expect(args.payload).toEqual({ mapKey: "local", input: {} });
  });

  it("reads a payload that follows the flag as the third positional", () => {
    const args = parseArgs([
      BASE,
      "surface/padi/lifecycle/sendInput",
      "--timeout-ms",
      "90000",
      '{"mapKey":"local","input":{"id":"t1","data":"echo hi\\r"}}',
    ]);
    expect(args.timeoutMs).toBe(90_000);
    expect(args.payload).toEqual({
      mapKey: "local",
      input: { id: "t1", data: "echo hi\r" },
    });
  });

  it("rejects a missing tag, a non-number timeout, a fourth positional, and non-JSON", () => {
    expect(() => parseArgs([BASE])).toThrow(/usage:/);
    expect(() =>
      parseArgs([BASE, "daemon/restart", "--timeout-ms", "nope"]),
    ).toThrow(/positive number/);
    expect(() => parseArgs([BASE, "a/b", "{}", "extra"])).toThrow(/too many/);
    expect(() => parseArgs([BASE, "a/b", "{not json}"])).toThrow(/not JSON/);
  });
});

describe("the caller's group", () => {
  it("dials the ONE wire assembly the server serves — the same value, not a copy", () => {
    expect(servedGroup).toBe(koluWireGroup);
    expect(Object.values(koluNonSiblingGroups)).toEqual([
      koluRootGroup,
      padiHostMap.group,
    ]);
  });
});

describe("rpcFor", () => {
  it.each([
    "daemon/restart",
    "surface/padi/lifecycle/create",
    "surface/padi/lifecycle/sendInput",
    "surface/padi/lifecycle/recycleKaval",
    "surface/padi/session/restore",
  ])("resolves %s", (tag) => {
    expect(rpcFor(tag)._tag).toBe(tag);
  });

  it("names the tag and lists what IS served when the tag is unknown", () => {
    expect(() => rpcFor("surface/padi/lifecycle/nope")).toThrow(
      /no member is served at tag "surface\/padi\/lifecycle\/nope"/,
    );
  });
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const HARNESS_DIR = join("nix", "home", "example", "adoption");

const PACKAGING_FILE = "default.nix";
const ALLOWED_IN_PACKAGING = [
  /^\s*kolu-rpc\s*=/,
  /^\s*name\s*=\s*"kolu-rpc";\s*$/,
  /^\s*inherit\b/,
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".direnv",
  ".worktrees",
  "dist",
  "target",
]);

function nixFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) nixFiles(full, out);
    } else if (entry.name.endsWith(".nix")) {
      out.push(full);
    }
  }
  return out;
}

const isComment = (line: string) => line.trimStart().startsWith("#");

describe("kolu-rpc's quarantine (harness-only, never a shipped closure)", () => {
  it("is named by nothing but its own definition, the flake export, and the VM tests", () => {
    const violations: string[] = [];

    for (const file of nixFiles(REPO_ROOT)) {
      const rel = relative(REPO_ROOT, file);
      if (rel.startsWith(HARNESS_DIR)) continue;

      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (isComment(line) || !line.includes("kolu-rpc")) return;
          if (
            rel === PACKAGING_FILE &&
            ALLOWED_IN_PACKAGING.some((re) => re.test(line))
          ) {
            return;
          }
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }

    expect(
      violations,
      "`kolu-rpc` is a harness-only debug caller — it must not enter the kolu app closure, `agentToolPackages`/`koluAgentTools` (a terminal's PATH), `padi-agent` (a remote host's closure), or either carrier in `nix/home/module.nix`: `home.packages` (a deploy's PATH) and `services.kolu.agentPackages` (the agent closures a deploy's generation carries and can ship to a remote — I1, juspay/kolu#2101). Remove the reference, or move the consumer under `nix/home/example/adoption/`.",
    ).toEqual([]);
  });
});
