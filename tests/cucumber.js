const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1");

export const ui = {
  paths: ["features/**/*.feature"],
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  format: ["progress-bar", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
};

export default {};
