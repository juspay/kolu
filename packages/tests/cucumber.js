const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1", 10);

// Only set default paths if no feature files were passed as CLI args.
// CLI positional args (e.g. features/worktree.feature) are ignored when
// the profile hardcodes paths — so we omit paths to let CLI args win.
// Match both `foo.feature` and `foo.feature:42[:56...]` line-targeted forms;
// missing the line form would inject `paths` and silently broaden the run.
const cliHasFeatureArgs = process.argv
  .slice(2)
  .some((a) => /\.feature(?::\d+)*$/.test(a));

// Default tag filter: exclude @skip'd scenarios (regression harnesses for
// known-broken behavior). `CUCUMBER_TAGS` fully replaces the default — e.g.
// `CUCUMBER_TAGS='@skip'` runs only skipped scenarios for local development.
const tags = process.env.CUCUMBER_TAGS || "not @skip";

// Scenario-level retry budget. Defaults to 0 (off) so local `just
// test-quick` surfaces real failures on the first attempt — only CI sets
// `CUCUMBER_RETRY=1` to absorb residual darwin-runner-load flakes after
// the structural fixes in #955. Distinct volatility axis from
// `support/hooks.ts::retryTransient`, which retries TCP-setup hiccups
// only; the two coexist.
const retry = parseInt(process.env.CUCUMBER_RETRY || "0", 10);

export const ui = {
  ...(!cliHasFeatureArgs && { paths: ["features/**/*.feature"] }),
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  tags,
  // progress-bar (stdout): % completion; pretty (stderr): inline failures as they happen
  format: ["progress-bar", "pretty:/dev/stderr", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
  ...(retry > 0 && { retry }),
};

export default {};
