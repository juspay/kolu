import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import * as face from "./index.ts";
import * as wire from "./wire.ts";

const PACKAGES = path.join(import.meta.dirname, "..", "..");

const specifiersOf = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /(?:\bfrom\s*|^\s*import\s*|\bimport\(\s*|\brequire\(\s*)["']([^"'\n]+)["']/gm,
    ),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const valueSpecifiersOf = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /\bimport\s+(type\s+)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s*from\s*["']([^"'\n]+)["']|\bimport\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']|\brequire\(\s*["']([^"'\n]+)["']/g,
    ),
  ].flatMap((match) =>
    match[1] !== undefined
      ? []
      : [match[2] ?? match[3] ?? match[4] ?? match[5] ?? ""],
  );

interface Source {
  readonly file: string;
  readonly specifiers: ReadonlyArray<string>;
  readonly runtime: ReadonlyArray<string>;
}

const SKIP: Readonly<Record<string, true>> = {
  node_modules: true,
  dist: true,
  ".direnv": true,
  ".git": true,
  coverage: true,
};
const sourcesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return entry.name in SKIP ? [] : sourcesUnder(path.join(dir, entry.name));
    }
    return entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ? [path.join(dir, entry.name)]
      : [];
  });

const MEMBERS: ReadonlyArray<string> = (() => {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 2) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name in SKIP) continue;
      const here = path.join(dir, entry.name);
      try {
        readFileSync(path.join(here, "package.json"), "utf8");
        found.push(path.relative(PACKAGES, here).split(path.sep).join("/"));
      } catch {
        walk(here, depth + 1);
      }
    }
  };
  walk(PACKAGES, 1);
  if (found.length === 0) {
    throw new Error(
      "acp: no workspace member found under packages/ — a corpus that came " +
        "back short is a sweep that did not run.",
    );
  }
  return found.sort();
})();

const withoutShebang = (text: string): string =>
  text.replace(/^#![^\n]*\n/, "");

const tree: ReadonlyMap<string, ReadonlyArray<Source>> = new Map(
  MEMBERS.map((member) => [
    member as string,
    sourcesUnder(path.join(PACKAGES, member)).map((file): Source => {
      const text = withoutShebang(readFileSync(file, "utf8"));
      return {
        file,
        specifiers: specifiersOf(text),
        runtime: valueSpecifiersOf(text),
      };
    }),
  ]),
);

const sources = (pkg: string): ReadonlyArray<Source> => tree.get(pkg) ?? [];

const isSdk = (spec: string): boolean =>
  spec === "@agentclientprotocol/sdk" ||
  spec.startsWith("@agentclientprotocol/sdk/");

describe("the manifest", () => {
  test("the domain's words stay out: this package imports no @kolu sibling", () => {
    for (const source of sources("acp")) {
      const strangers = source.specifiers.filter((spec) =>
        spec.startsWith("@kolu/"),
      );
      expect(strangers, source.file).toEqual([]);
    }
  });

  test("this package speaks only ACP: effect, the SDK, and its own files", () => {
    const allowed = (spec: string): boolean =>
      spec === "effect" ||
      spec === "@agentclientprotocol/sdk" ||
      spec === "vitest" ||
      spec.startsWith("node:") || // the manifest's own reading of the tree
      spec.startsWith("./");
    for (const source of sources("acp")) {
      expect(
        source.specifiers.filter((spec) => !allowed(spec)),
        source.file,
      ).toEqual([]);
    }
  });

  test("the SDK is TYPES here: no import of it survives to runtime", () => {
    for (const source of sources("acp")) {
      expect(source.runtime.filter(isSdk), source.file).toEqual([]);
    }
  });

  test("the protocol enters the tree here and in the package that runs it", () => {
    const speaking = [...tree.keys()].filter((pkg) =>
      sources(pkg).some((source) => source.specifiers.some(isSdk)),
    );
    expect(speaking.sort()).toEqual(["acp", "acp-client"]);
  });

  test("what may cross is enumerated: the export lists are closed and disjoint", () => {
    expect(Object.keys(face).sort()).toEqual([
      "AUTH_STATUS_METHOD",
      "PERMISSION_FIELD",
      "Refused",
      "contentOf",
      "diffsOf",
      "formOf",
      "hostOf",
      "identityIn",
      "nativeActivity",
      "permissionFormOf",
      "relativeTo",
      "terminalMetaIn",
      "urlOf",
      "usageIn",
    ]);
    expect(Object.keys(wire).sort()).toEqual([
      "Armed",
      "Ask",
      "AskAnswer",
      "AskChoice",
      "AskField",
      "AskLink",
      "AskOutcome",
      "AuthAccount",
      "AuthMethod",
      "AuthStatus",
      "Command",
      "Delivery",
      "FileDiff",
      "Model",
      "Phase",
      "PlanStep",
      "Saying",
      "Server",
      "Setting",
      "SignIn",
      "SignInLink",
      "SignInReason",
      "SigningIn",
      "SigningInCause",
      "Spawned",
      "TerminalView",
      "ToolStatus",
      "Usage",
      "Watching",
      "YES_NO",
      "agentRowFields",
      "askRowFields",
      "noticeRowFields",
      "rowHead",
      "toolRowFields",
      "userRowFields",
    ]);
  });

  const MAY: Readonly<Record<string, ReadonlyArray<string>>> = {
    "acp-client": ["@kolu/acp", "@kolu/acp/engine", "@kolu/acp/wire"],
    "acp-harness": ["@kolu/acp/engine", "@kolu/acp/wire"],
    "integrations/claude-code": [],
    "acp-claude": ["@kolu/acp/engine"],
    common: ["@kolu/acp/wire"],
    "integrations/agents": ["@kolu/acp/engine"],
    conductor: ["@kolu/acp/engine"],
    client: ["@kolu/acp/wire"],
    server: ["@kolu/acp/engine"],
  };

  test("who may import which half is a table, and only the packages that run the protocol open all of them", () => {
    const imported = new Map<string, ReadonlySet<string>>(
      [...tree.keys()]
        .filter((pkg) => pkg !== "acp")
        .map((pkg) => [
          pkg,
          new Set(
            sources(pkg).flatMap((source) =>
              source.specifiers.filter(
                (spec) => spec === "@kolu/acp" || spec.startsWith("@kolu/acp/"),
              ),
            ),
          ),
        ]),
    );
    for (const [pkg, specs] of imported) {
      expect([...specs].sort(), pkg).toEqual([...(MAY[pkg] ?? [])]);
    }
    for (const pkg of Object.keys(MAY)) {
      expect([pkg, imported.has(pkg)]).toEqual([pkg, true]);
    }
  });
});
