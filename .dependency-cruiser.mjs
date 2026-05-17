// Architecture & complecting guard for the Kolu pnpm monorepo.
//
// Goals:
//   1. High-level architecture graph — `just depcruise-graph` emits a
//      mermaid diagram (one node per package) suitable for inlining in
//      docs/README. Mermaid renders natively in GitHub.
//   2. Layer-boundary ratchet — `just depcruise` validates against the
//      forbidden rules below. CI runs the same validation so PRs that
//      add a new cross-layer edge surface in the review.
//
// All rules land as `warn` so the first run reports current state
// without breaking CI. Flip individual rules to `error` once their
// findings are addressed — that's the "ratchet" the tool earns its
// keep on. Two pre-existing circulars exist as of this commit (see
// `just depcruise`); fixing them is a follow-up.

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "warn",
      comment:
        "Circular dependencies couple modules into a single unit of change.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-app-imported",
      severity: "warn",
      comment:
        "kolu-client and kolu-server are entry-point apps. Nothing should import them — they import everything.",
      from: { pathNot: "^packages/(client|server)/" },
      to: { path: "^packages/(client|server)/" },
    },
    {
      name: "client-no-integration-runtime",
      severity: "warn",
      comment:
        "The browser bundle must not pull in integration runtime modules (sqlite, fs.watch, gh CLI wrappers). Allowed: `/schemas` subpaths (pure Zod) and the `anyagent` contract package (pure types + agent-cli parser).",
      from: { path: "^packages/client/" },
      to: {
        path: "^packages/integrations/[^/]+/src/",
        pathNot: [
          "^packages/integrations/[^/]+/src/schemas(\\.ts$|/)",
          "^packages/integrations/anyagent/",
        ],
      },
    },
    {
      name: "common-no-integration-runtime",
      severity: "warn",
      comment:
        "kolu-common is bundled into the client too, so the same browser-bundle constraint applies: re-exports from integrations must come through `/schemas` subpaths (pure Zod) or `anyagent`. Without this rule, a single non-schema import in kolu-common silently pulls integration runtime into the browser bundle.",
      from: { path: "^packages/common/" },
      to: {
        path: "^packages/integrations/[^/]+/src/",
        pathNot: [
          "^packages/integrations/[^/]+/src/schemas(\\.ts$|/)",
          "^packages/integrations/anyagent/",
        ],
      },
    },
    {
      name: "integrations-no-siblings",
      severity: "warn",
      comment:
        "Integration packages (claude-code, codex, opencode, git, github) must stay independent. Shared agent contract lives in `anyagent`; shared utilities in `kolu-shared`. The `$1` in `to.pathNot` is back-substituted from `from.path` so each integration is exempt from importing itself (without this, every intra-package edge fires).",
      from: { path: "^packages/integrations/([^/]+)/" },
      to: {
        path: "^packages/integrations/[^/]+/",
        pathNot: [
          "^packages/integrations/$1/", // self
          "^packages/integrations/anyagent/", // shared contract is allowed
        ],
      },
    },
    {
      name: "anyagent-leaf",
      severity: "warn",
      comment:
        "anyagent is the shared agent contract. It must not depend on any concrete integration.",
      from: { path: "^packages/integrations/anyagent/" },
      to: {
        path: "^packages/integrations/",
        pathNot: "^packages/integrations/anyagent/",
      },
    },
    {
      name: "transcript-core-leaf",
      severity: "warn",
      comment:
        "kolu-transcript-core is the vendor-neutral IR. The static-export renderer (kolu-transcript-html) depends on it; never the other way.",
      from: { path: "^packages/transcript-core/" },
      to: { path: "^packages/transcript-html/" },
    },
    {
      name: "surface-leaf",
      severity: "warn",
      comment:
        "@kolu/surface is the reactive framework. It must not depend on any other workspace package — consumers wire it up, not the other way.",
      from: { path: "^packages/surface/src/" },
      to: { path: "^packages/(?!surface/)" },
    },
    {
      name: "solid-pierre-leaf",
      severity: "warn",
      comment:
        "@kolu/solid-pierre is a thin Solid wrapper around upstream Pierre libraries. No workspace dependencies.",
      from: { path: "^packages/solid-pierre/src/" },
      to: { path: "^packages/(?!solid-pierre/)" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Modules that nothing imports tend to rot. Either delete, wire them up, or add to the pathNot exception list (test entries, build configs, package subpath exports).",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$", // dotfiles
          "\\.d\\.ts$",
          "(^|/)(tsconfig|package)\\.json$",
          "(^|/)(vite|vitest)\\.config\\.[jt]s$",
          "(^|/)vitest\\.setup\\.[jt]s$",
          "\\.test\\.[jt]sx?$", // unit tests are entry points themselves
          "^packages/tests/", // e2e harness
          "^packages/[^/]+/src/(index|main)\\.tsx?$", // package entries
          "^packages/integrations/[^/]+/src/(index|schemas)\\.ts$",
          "^packages/common/src/", // every file is a public subpath export
          "^packages/surface/example/",
          "^packages/terminal-themes/src/color\\.ts$", // ./color subpath
          "^packages/transcript-html/src/script\\.js$", // emitted runtime script
        ],
      },
      to: {},
    },
  ],

  options: {
    // Resolve workspace deps as project source, not as external packages.
    // Required for pnpm monorepos so `import "kolu-common"` from the client
    // is followed into `packages/common/src/` instead of treated as an npm dep.
    combinedDependencies: true,

    // Only report on workspace sources. node_modules dependencies are
    // still resolved (so `combinedDependencies` works) but won't appear
    // as nodes in the graph or as rule targets.
    includeOnly: "^packages/",

    // Don't crawl into node_modules during validation; treat npm deps as terminal.
    doNotFollow: { path: "node_modules" },

    // Keep TypeScript-only imports (type-only) in the graph. Catches
    // dependencies that compile away but still couple modules conceptually.
    tsPreCompilationDeps: true,

    tsConfig: { fileName: "./tsconfig.base.json" },

    // Honour each package's `exports` map. Required so imports of subpath
    // exports (e.g. `kolu-common/contract`, `@kolu/surface/solid`) resolve
    // through the symlinked workspace package's package.json — without
    // this, depcruise's resolver short-circuits to `couldNotResolve` and
    // every cross-package edge silently disappears from the graph.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
    },

    // The website/ Astro app has its own lockfile and tsconfig and is
    // not part of the kolu workspace — keep it out of this cruise.
    exclude: { path: "^(website|node_modules|.*/dist/|.*/node_modules/)" },

    reporterOptions: {
      // Used by `just depcruise-graph` — see justfile.
      mermaid: { minify: false },
    },
  },
};
