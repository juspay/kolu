const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1");

export const ui = {
  paths: ["features/**/*.feature"],
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  // progress-bar (stdout): % completion; pretty (stderr): inline failures as they happen
  format: ["progress-bar", "pretty:/dev/stderr", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
};

export default {};
