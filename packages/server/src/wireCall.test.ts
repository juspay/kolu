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
import { describe, expect, it } from "vitest";
import { servedGroup } from "./surface.ts";
import { parseArgs, rpcFor, wireGroup, wsUrlFor } from "./wireCall.ts";

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

describe("wsUrlFor", () => {
  it("derives the /rpc/ws path the browser dials, per scheme", () => {
    expect(wsUrlFor(BASE)).toBe("ws://127.0.0.1:7681/rpc/ws");
    expect(wsUrlFor("https://kolu.example:443/")).toBe(
      "wss://kolu.example/rpc/ws",
    );
  });
});

describe("the caller's group", () => {
  // `wireGroup` is ASSEMBLED from the three sources `surface.ts` merges, not imported
  // from it (importing `surface.ts` builds the Conf store, which a one-shot caller must
  // not do). That means it can silently fall BEHIND: a fourth source merged into
  // `servedGroup` would leave `kolu-rpc` answering "no member is served at tag" for a
  // tag the server does serve. A test may import `surface.ts` (the unit lane points
  // KOLU_STATE_DIR at a temp dir), so the equality is pinned here instead.
  it("spells exactly the tag set kolu-server serves", () => {
    expect([...wireGroup.requests.keys()].sort()).toEqual(
      [...servedGroup.requests.keys()].sort(),
    );
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
      "`kolu-rpc` is a harness-only debug caller — it must not enter the kolu app closure, `agentToolPackages`/`koluAgentTools` (a terminal's PATH), `padi-agent` (a remote host's closure), or `nix/home/module.nix`'s `home.packages`. Remove the reference, or move the consumer under `nix/home/example/adoption/`.",
    ).toEqual([]);
  });
});
