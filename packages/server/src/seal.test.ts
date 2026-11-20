import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { declaredDependencyClosure } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { Effect } from "effect";
import { parse } from "@babel/parser";
import { contract } from "kolu-common/contract";
import { describe, expect, it } from "vitest";
import { buildAppRouter } from "./router.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");

const WEB_SHELL_FILES = [
  "padi/attachTelemetry",
  "padi/daemonInventory",
  "padi/entryDispatch",
  "padi/newTerminalPolicy",
  "padi/padiCellPusher",
  "padi/padiBinding",
  "padi/padiConvergence",
  "padi/remotePadiBinding",
  "padi/reServeEviction",
  "padi/padiSession",
  "padi/padiLink",
  "padi/supervisorClaim",
  "portForward/forwards",
  "portForward/hostPorts",
  "portForward/resolveViewerHost",
  "agentDelivery/bake",
  "agentDelivery/delivery",
  "agentDelivery/install",
  "agentDelivery/ops",
  "agentDelivery/profiles",
  "agentDelivery/publishedAnswers",
  "agentDelivery/schedule",
  "agentDelivery/timer",
  "bootFlags",
  "agentDistroListing",
  "hostname",
  "hostPersistence",
  "healthRoute",
  "httpMiddleware",
  "iframePreviewRoute",
  "workFilesRoute",
  "index",
  "log",
  "memorySampler",
  "padiMemoryGate",
  "pwaIdentity",
  "router",
  "state",
  "stateBackups",
  "stateLadder",
  "stateShape",
  "surface",
  "tls",
  "wireCall",
  "wireCallMain",
  "conductor/koluOffer",
  "conductor/live",
  "conductor/watcher",
  "conductor/transcriptFile",
  "conductor/workFiles",
  "conductorRecovery",
  "fleet/fleetHosts",
  "fleet/mcpEndpoint",
].sort();

const FORBIDDEN_TERMINAL_MODULES = [
  "terminal-registry",
  "terminals",
  "session",
  "activity",
  "terminalScratch",
  "koluRoot",
  "reconcile",
  "publisher",
  "surfaceCtx",
  "padiSurfaceCtx",
  "workspaceSurfaceCtx",
  "servePadi",
  "urgency",
  "transcript",
  "preview",
  "sessionRestore",
];

function serverSrcTsFiles(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".ts"));
}

function serverSrcModules(): string[] {
  return serverSrcTsFiles()
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test-d.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

function serverTestFiles(): string[] {
  return serverSrcTsFiles()
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test-d.ts"))
    .map((f) => resolve(SRC, f));
}

const PADI_SRC = resolve(SRC, "..", "..", "padi", "src");
const PADI_CLIENT_SRC = resolve(SRC, "..", "..", "padi-client", "src");

function padiSrcFilesAll(): string[] {
  return [PADI_SRC, PADI_CLIENT_SRC].flatMap((root) =>
    readdirSync(root, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => resolve(root, f)),
  );
}

const CONDUCTOR_SRC = resolve(SRC, "..", "..", "conductor", "src");
const CONDUCTOR_PKG = resolve(CONDUCTOR_SRC, "..", "package.json");

function conductorSrcFiles(): string[] {
  return readdirSync(CONDUCTOR_SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => resolve(CONDUCTOR_SRC, f));
}

const PACKAGES_DIR = resolve(PADI_SRC, "..", "..");
const REPO_ROOT = resolve(PACKAGES_DIR, "..");
const PADI_PKG = resolve(PADI_SRC, "..", "package.json");
const PADI_CLIENT_PKG = resolve(PADI_CLIENT_SRC, "..", "package.json");

const APP_PACKAGES = ["kolu-common", "kolu-server", "kolu-client"];

function declaredDeps(pkgJsonPath: string): string[] {
  const p = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  return [
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.devDependencies ?? {}),
  ];
}

type AstNode = {
  type: string;
  [key: string]: unknown;
};

const isAstNode = (value: unknown): value is AstNode =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  typeof (value as { type?: unknown }).type === "string";

function parseTsFile(file: string): AstNode {
  return parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
}

function visitAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visitAst(item, visit);
    } else if (isAstNode(value)) {
      visitAst(value, visit);
    }
  }
}

const stringLiteralValue = (node: unknown): string | null =>
  isAstNode(node) &&
  (node.type === "StringLiteral" || node.type === "DirectiveLiteral") &&
  typeof node.value === "string"
    ? node.value
    : null;

const identifierName = (node: unknown): string | null =>
  isAstNode(node) && node.type === "Identifier" && typeof node.name === "string"
    ? node.name
    : stringLiteralValue(node);

const nodeList = (value: unknown): AstNode[] =>
  Array.isArray(value) ? value.filter(isAstNode) : [];

function koluSurfaceBindings(file: string): string[] {
  const hits: string[] = [];
  visitAst(parseTsFile(file), (node) => {
    if (node.type === "ImportDeclaration") {
      for (const specifier of nodeList(node.specifiers)) {
        if (
          specifier.type === "ImportSpecifier" &&
          identifierName(specifier.imported) === "koluSurface"
        ) {
          hits.push(
            `import { koluSurface } (as ${identifierName(specifier.local) ?? "?"})`,
          );
        }
      }
    }
    if (
      node.type === "TSTypeQuery" &&
      identifierName(node.exprName) === "koluSurface"
    ) {
      hits.push("typeof koluSurface");
    }
    if (
      (node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression") &&
      identifierName(node.property) === "koluSurface"
    ) {
      hits.push("ns.koluSurface (namespace member)");
    }
    if (
      node.type === "TSQualifiedName" &&
      identifierName(node.right) === "koluSurface"
    ) {
      hits.push("ns.koluSurface (qualified type)");
    }
    if (node.type === "ExportNamedDeclaration") {
      const spec = stringLiteralValue(node.source) ?? "";
      for (const el of nodeList(node.specifiers)) {
        if (
          el.type === "ExportSpecifier" &&
          identifierName(el.local) === "koluSurface"
        ) {
          hits.push(`export { koluSurface } from "${spec}"`);
        }
      }
    }
    if (
      node.type === "ExportAllDeclaration" &&
      stringLiteralValue(node.source) === "kolu-common/surface"
    ) {
      hits.push('export * from "kolu-common/surface"');
    }
  });
  return hits;
}

const TERMINAL_DOMAIN = ["@kolu/padi", "@kolu/padi-client"] as const;

function inTerminalDomain(spec: string): boolean {
  return TERMINAL_DOMAIN.some((n) => spec === n || spec.startsWith(`${n}/`));
}

const ALLOWED_PADI = [
  "@kolu/padi/agentDistroBake",
  "@kolu/padi/assembly",
  "@kolu/padi/convergence-policy",
  "@kolu/padi/log",
  "@kolu/padi/remote-dial",
  "@kolu/padi-client/dial",
  "@kolu/padi-client/surface",
];

function padiPublishedSubpaths(): Set<string> {
  const published = new Set<string>();
  for (const [pkgJson, name] of [
    [PADI_PKG, "@kolu/padi/"],
    [PADI_CLIENT_PKG, "@kolu/padi-client/"],
  ] as const) {
    const exportsMap = JSON.parse(readFileSync(pkgJson, "utf8"))
      .exports as Record<string, unknown>;
    for (const key of Object.keys(exportsMap)) {
      published.add(key.replace(/^\.\//, name));
    }
  }
  return published;
}

function importsOf(file: string): string[] {
  const specs = new Set<string>();
  visitAst(parseTsFile(file), (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "ImportExpression") {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "TSImportType") {
      const spec = stringLiteralValue(node.argument);
      if (spec) specs.add(spec);
    }
  });
  return [...specs];
}

function resolveRelative(from: string, spec: string): string {
  const p = resolve(dirname(from), spec);
  return p.endsWith(".ts") ? p : `${p}.ts`;
}

function externalsFromEntry(): Set<string> {
  const reached = new Set<string>();
  const externals = new Set<string>();
  const stack = [ENTRY];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    if (file.endsWith(".test.ts")) continue;
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) {
        const resolved = resolveRelative(file, spec);
        if (resolved.endsWith(".ts") && existsSync(resolved))
          stack.push(resolved);
      } else externals.add(spec);
    }
  }
  return externals;
}

describe("packages/server package-boundary seal (W1.R7)", () => {
  it("(a) contains exactly the web-shell modules — no terminal-domain file", () => {
    expect(serverSrcModules()).toEqual(WEB_SHELL_FILES);
  });

  it("(a) none of the relocated terminal-domain modules reappear under server/src", () => {
    const present = new Set(serverSrcModules());
    const leaked = FORBIDDEN_TERMINAL_MODULES.filter((m) => present.has(m));
    expect(
      leaked,
      `terminal-domain module(s) reappeared under packages/server/src: ${leaked.join(
        ", ",
      )} — they belong in @kolu/padi.`,
    ).toEqual([]);
  });

  it("(a) no hand-rolled setInterval sampler remains in the web shell (SR8.a — zero allowlist)", () => {
    const offenders: string[] = [];
    for (const rel of serverSrcTsFiles()) {
      if (rel.endsWith(".test.ts") || rel.endsWith(".test-d.ts")) continue;
      const src = readFileSync(resolve(SRC, rel), "utf8");
      if (/\bsetInterval\s*\(/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `a web-shell module drives a raw setInterval: ${offenders.join(", ")}. ` +
        `Sampler cadence rides the reactor's poll source (@kolu/surface's everyMs) ` +
        `since SR8.a — a hand-rolled setInterval sampler is the retired defect.`,
    ).toEqual([]);
    expect(serverSrcTsFiles().length).toBeGreaterThan(0);
  });

  it("(b) reaches the terminal domain only through its named doors — no deep src import", () => {
    const padiSpecs = [...externalsFromEntry()]
      .filter((s) => inTerminalDomain(s))
      .sort();
    const illegal = padiSpecs.filter((s) => !ALLOWED_PADI.includes(s));
    expect(
      illegal,
      `illegal terminal-domain import(s) from packages/server: ${illegal.join(
        ", ",
      )}. kolu-server must reach the terminal domain only via ` +
        `@kolu/padi/{assembly,convergence-policy,log,remote-dial} and ` +
        `@kolu/padi-client/{surface,dial}.`,
    ).toEqual([]);
    expect(padiSpecs.length).toBeGreaterThan(0);
  });

  it("(f) test files reach @kolu/padi only through PUBLISHED subpaths — no deep src bypass", () => {
    const published = padiPublishedSubpaths();

    const notPublished = ALLOWED_PADI.filter((s) => !published.has(s));
    expect(
      notPublished,
      `ALLOWED_PADI names a @kolu/padi subpath that padi/package.json no longer ` +
        `publishes: ${notPublished.join(", ")}. The production door must be a ` +
        `subset of the deliberate export set.`,
    ).toEqual([]);

    const offenders: string[] = [];
    let sawPadiImport = false;
    for (const file of serverTestFiles()) {
      for (const spec of importsOf(file)) {
        if (!inTerminalDomain(spec)) continue;
        sawPadiImport = true;
        if (!published.has(spec)) {
          offenders.push(
            `${file.replace(SRC, "packages/server/src")}: ${spec}`,
          );
        }
      }
    }
    expect(
      offenders,
      `a server test imports a @kolu/padi specifier that is not a published ` +
        `subpath (a deep @kolu/padi/src/... bypass, or an unpublished entry): ` +
        `${offenders.join(", ")}. Tests reach padi through its published exports, ` +
        `same as any consumer — never a deep src path.`,
    ).toEqual([]);
    expect(sawPadiImport).toBe(true);
  });

  it("(c) the root terminal/* and git/* tag namespaces are gone — only server, daemon, hosts beside surface/", () => {
    const roots = new Set(
      [...contract.requests.keys()].map((tag) => tag.split("/")[0]),
    );
    expect(roots.has("terminal")).toBe(false);
    expect(roots.has("git")).toBe(false);
    expect([...roots].sort()).toEqual(["daemon", "hosts", "server", "surface"]);

    const bound = new Set(
      Object.keys(
        buildAppRouter({
          drainBoundPadi: () => Effect.void,
          addHost: async () => {},
          removeHost: async () => {},
          reconnectHost: () => {},
          renewHostDaemon: () => Effect.void,
          listStateBackups: () => ({ backups: [] }),
          restoreStateBackup: async () => ({ hostFailures: [] }),
          viewerHost: async () => null,
        }).handlers,
      ).map((tag) => tag.split("/")[0]),
    );
    expect(bound.has("terminal")).toBe(false);
    expect(bound.has("git")).toBe(false);
  });

  it("(d) REVERSE seal — no @kolu/padi src file references koluSurface (import/type/namespace/re-export)", () => {
    const files = padiSrcFilesAll();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .map((f) => ({ f, refs: koluSurfaceBindings(f) }))
      .filter((x) => x.refs.length > 0);
    expect(
      offenders.map(
        (o) =>
          `${o.f
            .replace(PADI_SRC, "@kolu/padi/src")
            .replace(
              PADI_CLIENT_SRC,
              "@kolu/padi-client/src",
            )}: ${o.refs.join(", ")}`,
      ),
      "a @kolu/padi src file references the koluSurface SPEC/ctx — a reverse-" +
        "direction dependency the forward seal can't see. It's caught in ALL forms: " +
        "a named import, `typeof koluSurface`, a namespace member (`ns.koluSurface`), " +
        "or a re-export (`export { koluSurface } from …` / `export * from " +
        '"kolu-common/surface"`). padi serves its OWN padiSurface ctx and OWNS the ' +
        "terminal vocabulary now (arm e); it never reaches back into the app surface.",
    ).toEqual([]);
  });

  it("(g) the conductor package never reaches back into kolu-server", () => {
    const files = conductorSrcFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(file)) {
        if (
          spec === "kolu-server" ||
          spec.startsWith("kolu-server/") ||
          spec.includes("server/src/")
        ) {
          offenders.push(
            `${file.replace(CONDUCTOR_SRC, "kolu-conductor/src")}: ${spec}`,
          );
        }
      }
    }
    expect(
      offenders,
      "a kolu-conductor src file imports kolu-server. The arrow points OUT: " +
        "what the conversation needs from the server is PUSHED IN at the mount " +
        "(packages/server/src/conductor/live.ts), never pulled.",
    ).toEqual([]);
    expect(
      declaredDeps(CONDUCTOR_PKG).filter((d) => d === "kolu-server"),
      "kolu-conductor's package.json declares kolu-server — the mount is the " +
        "server's edge to the package, not the package's to the server.",
    ).toEqual([]);
  });

  it("(g) kolu-server reaches the conductor only through its published doors", () => {
    const published = new Set(
      Object.keys(
        JSON.parse(readFileSync(CONDUCTOR_PKG, "utf8")).exports ?? {},
      ).map((e) =>
        e === "." ? "kolu-conductor" : `kolu-conductor/${e.slice(2)}`,
      ),
    );
    const offenders: string[] = [];
    for (const relative of serverSrcTsFiles()) {
      const file = resolve(SRC, relative);
      for (const spec of importsOf(file)) {
        if (!spec.startsWith("kolu-conductor")) continue;
        if (!published.has(spec)) {
          offenders.push(`server/src/${relative}: ${spec}`);
        }
      }
    }
    expect(
      offenders,
      `kolu-server imports a kolu-conductor path that is not published (${[...published].join(", ")}). ` +
        "Reach the package through its doors; a deep import is a dependency on its insides.",
    ).toEqual([]);
  });

  it("(e) REVERSE seal — @kolu/padi's dependency cone excludes the app (packages/{common,server,client})", () => {
    for (const pkgJson of [PADI_PKG, PADI_CLIENT_PKG]) {
      expect(
        declaredDeps(pkgJson).filter((d) => APP_PACKAGES.includes(d)),
        `${pkgJson} lists an app package (kolu-common/server/client) as a ` +
          "dependency — padi owns its vocabulary; the app depends on padi, not the reverse.",
      ).toEqual([]);
    }

    const APP_SPEC = new RegExp(`^(${APP_PACKAGES.join("|")})($|/)`);
    const importOffenders: string[] = [];
    for (const file of padiSrcFilesAll()) {
      for (const spec of importsOf(file)) {
        if (APP_SPEC.test(spec)) {
          importOffenders.push(
            `${file
              .replace(PADI_SRC, "@kolu/padi/src")
              .replace(PADI_CLIENT_SRC, "@kolu/padi-client/src")}: ${spec}`,
          );
        }
      }
    }
    expect(importOffenders.length).toBeGreaterThanOrEqual(0);
    expect(padiSrcFilesAll().length).toBeGreaterThan(0);
    expect(
      importOffenders,
      "a @kolu/padi src file imports from the kolu app (kolu-common/server/client). " +
        "The terminal vocabulary lives in @kolu/padi now; import it locally, not from the app.",
    ).toEqual([]);

    const cone = declaredDependencyClosure({
      repoRoot: REPO_ROOT,
      entries: TERMINAL_DOMAIN,
    });
    const transitiveOffenders: string[] = [];
    for (const manifestPath of cone.manifestPaths) {
      const pkgJson = resolve(REPO_ROOT, manifestPath);
      for (const a of declaredDeps(pkgJson).filter((d) =>
        APP_PACKAGES.includes(d),
      )) {
        transitiveOffenders.push(`${manifestPath} → ${a}`);
      }
    }
    expect(
      transitiveOffenders,
      "a package in @kolu/padi's transitive dependency cone depends on the app — " +
        "padi's cone is polluted (this is why the flip matters for W2.2: padi's " +
        "staleKey/closure must not move when app-only code churns).",
    ).toEqual([]);
  });
});
