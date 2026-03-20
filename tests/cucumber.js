export const ui = {
  paths: ['features/**/*.feature'],
  import: ['step_definitions/**/*.ts', 'support/**/*.ts'],
  format: ['progress-bar', 'html:reports/report.html'],
  formatOptions: { snippetInterface: 'async-await' },
};

export default {};
