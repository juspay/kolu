import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatE2eVerdict, reduceMessageFile } from "./timing";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const reports = path.join(packageRoot, "reports");
const messages = path.join(reports, "messages.ndjson");
const timing = path.join(reports, "e2e-timing.json");
mkdirSync(reports, { recursive: true });
rmSync(messages, { force: true });
rmSync(timing, { force: true });

const cucumber = path.join(
  packageRoot,
  "node_modules/@cucumber/cucumber/bin/cucumber-js",
);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", cucumber, "--profile", "ui", ...process.argv.slice(2)],
  { cwd: packageRoot, env: process.env, stdio: "inherit" },
);

let reductionFailed = false;
try {
  const report = reduceMessageFile(messages, timing);
  // writeSync: CI stdout is not a TTY so console.log is block-buffered
  // and process.exit() discards the verdict (odu then looks like a
  // mid-suite death).
  writeSync(
    1,
    `e2e timing: ${report.totals.executions} executions, ${report.totals.attempts} attempts, ${report.totals.retries} retries, ${Math.round(report.suiteDurationMs)} ms -> reports/e2e-timing.json\n${formatE2eVerdict(report)}\n`,
  );
} catch (error) {
  reductionFailed = true;
  writeSync(
    2,
    `e2e timing reduction failed ${error instanceof Error ? error.stack : String(error)}\n`,
  );
}

if (result.error) throw result.error;
if (result.signal) {
  writeSync(2, `cucumber terminated by ${result.signal}\n`);
  process.exit(1);
}
process.exit(result.status === 0 && !reductionFailed ? 0 : result.status || 1);
