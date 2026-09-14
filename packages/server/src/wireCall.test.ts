/**
 * `kolu-rpc`'s two silent seams: the argv parse and the tag lookup.
 *
 * Everything else in `wireCall.ts` is the wire itself, which only a running server
 * can prove — the NixOS adoption VM tests do that. What CANNOT be proven up there
 * cheaply is a harness bug that reads as a product failure: a payload the parse
 * dropped, or a tag that no longer exists. Both are pinned here, where a rename in
 * the contract fails a unit lane in seconds instead of a 40-minute VM lane.
 */

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

  // The form `adopt.nix` / `padi-upgrade.nix` use: the helper bakes `--timeout-ms`
  // in, then the site appends its jq-built body. If the flag ate the trailing word,
  // sendInput would silently go out with NO payload.
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

// The dial URL is `surfaceWsUrl` (`@kolu/surface-app`) now — one derivation for
// the browser wire, this CLI, the e2e harness and the example — and it is tested
// where it lives (`packages/surface-app/src/index.test.ts`).

describe("the caller's group", () => {
  // This used to pin two independently-assembled copies of one merge EQUAL — a rule
  // a test remembered, because `wireCall.ts` re-derived the group rather than
  // importing `surface.ts` (whose import builds the Conf store, which a one-shot
  // caller must not do). Both now alias the ONE assembly, `koluWireGroup`
  // (`kolu-common/surfacesWithPadi`), so "the caller can spell exactly what the
  // server serves" is true by construction and a tag-set comparison would be `x ===
  // x`. What is worth pinning instead is that the two modules still READ the one
  // constant rather than growing a second derivation: identity, not equality.
  it("dials the ONE wire assembly the server serves — the same value, not a copy", () => {
    // `kolu-rpc` reads `koluWireGroup` directly (it kept no local alias — a second
    // NAME for one value is the thing that drifts), so what is left to pin is that
    // the SERVER still reads the same value rather than growing a derivation of its
    // own, and that the browser's `extraGroups` come from the same list.
    expect(servedGroup).toBe(koluWireGroup);
    expect(Object.values(koluNonSiblingGroups)).toEqual([
      koluRootGroup,
      padiHostMap.group,
    ]);
  });
});

describe("rpcFor", () => {
  // Every tag `nix/home/example/adoption/*.nix` spells. A contract rename that
  // orphaned one of these would otherwise surface as a VM-lane poll timeout.
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

// ── The quarantine guard ──────────────────────────────────────────────────────
// `kolu-rpc` can place ANY call on kolu's wire, so it is a harness tool, not a
// product face: it must be reachable ONLY as a flake package output the VM tests
// name. Nothing but a comment kept it out of `agentToolPackages` / `padi-agent` /
// `home.packages`, and a comment does not fail a build — so the rule is read off
// the nix sources here, where it costs a unit lane rather than a shipped closure.
//
// Runs in the unit suite (full checkout — the nix tree is present) and needs no nix.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The sanctioned consumer: the NixOS adoption VM tests, which put the binary on a
 *  guest's PATH. Everything under here may name `kolu-rpc` freely. */
const HARNESS_DIR = join("nix", "home", "example", "adoption");

/** The one file that may DEFINE and EXPORT it, and the only three shapes allowed
 *  there: the attr binding, the wrapper's own `name`, and the flake `packages`
 *  export. Any other code mention is a composition site — i.e. a user-facing
 *  closure — which is exactly what this rejects. */
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
    // Never follow a symlink: `result*` points into the store, where a built
    // closure would read as a source mention of every package name.
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

/** Whole-line `#` comments are prose and are skipped — which is why the packaging
 *  site keeps its mentions of the name on their own comment lines. A trailing
 *  comment on a code line is deliberately NOT stripped: this scanner would rather
 *  fail loud on a mention it cannot classify than learn to parse nix strings. */
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
