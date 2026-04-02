const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1");

// Only set default paths if no feature files were passed as CLI args.
// CLI positional args (e.g. features/worktree.feature) are ignored when
// the profile hardcodes paths — so we omit paths to let CLI args win.
const cliHasFeatureArgs = process.argv
  .slice(2)
  .some((a) => a.endsWith(".feature"));

export const ui = {
  ...(!cliHasFeatureArgs && { paths: ["features/**/*.feature"] }),
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  // progress-bar (stdout): % completion; pretty (stderr): inline failures as they happen
  format: ["progress-bar", "pretty:/dev/stderr", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
};

export default {};
