const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1", 10);

// Only set default paths if no feature files were passed as CLI args.
// CLI positional args (e.g. features/worktree.feature) are ignored when
// the profile hardcodes paths — so we omit paths to let CLI args win.
const cliHasFeatureArgs = process.argv
  .slice(2)
  .some((a) => a.endsWith(".feature"));

// Default tag filter: exclude @skip'd scenarios (regression harnesses for
// known-broken behavior) plus the platform-specific quarantine for the
// other OS. `@platform-linux` scenarios run only on Linux; `@platform-darwin`
// scenarios run only on macOS. `CUCUMBER_TAGS` fully replaces the default —
// e.g. `CUCUMBER_TAGS='@skip'` runs only skipped scenarios for local
// development, and `CUCUMBER_TAGS='@platform-linux'` runs only the
// linux-quarantined scenarios (useful when investigating the macOS bug).
const otherPlatformTag =
  process.platform === "darwin" ? "@platform-linux" : "@platform-darwin";
const tags =
  process.env.CUCUMBER_TAGS || `not @skip and not ${otherPlatformTag}`;

export const ui = {
  ...(!cliHasFeatureArgs && { paths: ["features/**/*.feature"] }),
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  tags,
  // progress-bar (stdout): % completion; pretty (stderr): inline failures as they happen
  format: ["progress-bar", "pretty:/dev/stderr", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
};

export default {};
