const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1");

// Only set default paths if no feature files were passed as CLI args.
// CLI positional args (e.g. features/worktree.feature) are ignored when
// the profile hardcodes paths — so we omit paths to let CLI args win.
const cliHasFeatureArgs = process.argv
  .slice(2)
  .some((a) => a.endsWith(".feature"));

// Default tag filter: exclude @skip'd scenarios (regression harnesses for
// known-broken behavior). `CUCUMBER_TAGS` fully replaces the default — e.g.
// `CUCUMBER_TAGS='@skip'` runs only skipped scenarios for local development.
const tags = process.env.CUCUMBER_TAGS || "not @skip";

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
