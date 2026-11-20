const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1", 10);

const FEATURE_PATH_WITH_OPTIONAL_LINES = /\.feature(?::\d+)*$/;
const cliSpecifiesFeaturePaths = process.argv
  .slice(2)
  .some((a) => FEATURE_PATH_WITH_OPTIONAL_LINES.test(a));

const excludeSkipped = "not @skip";
const excludeRecordingsUnlessX11Capture = process.env.KOLU_X11CAP
  ? []
  : ["not @recording"];
const excludeDarwinUnreliable =
  process.platform === "darwin" ? ["not @skip-darwin"] : [];

const requestedTags =
  process.env.CUCUMBER_TAGS ||
  [excludeSkipped, ...excludeRecordingsUnlessX11Capture].join(" and ");
const tags = [`(${requestedTags})`, ...excludeDarwinUnreliable].join(" and ");

const cucumberScenarioRetries = parseInt(process.env.CUCUMBER_RETRY || "0", 10);

const shard = process.env.CUCUMBER_SHARD || "";

export const ui = {
  ...(!cliSpecifiesFeaturePaths && { paths: ["features/**/*.feature"] }),
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  tags,
  format: [
    "progress-bar",
    "pretty:/dev/stderr",
    "html:reports/report.html",
    "message:reports/messages.ndjson",
  ],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
  ...(cucumberScenarioRetries > 0 && { retry: cucumberScenarioRetries }),
  ...(shard !== "" && { shard }),
};

export default {};
