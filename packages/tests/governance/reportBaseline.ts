import { readFileSync, writeFileSync } from "node:fs";
import { summarizeBaseline, type BaselineSample } from "./baseline";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error(
    "usage: pnpm baseline:report <baseline-samples.json> <baseline-summary.json>",
  );
}
const value = JSON.parse(readFileSync(input, "utf8")) as {
  schemaVersion: number;
  samples: BaselineSample[];
};
if (value.schemaVersion !== 1 || !Array.isArray(value.samples)) {
  throw new Error(`${input}: invalid baseline samples`);
}
const summary = summarizeBaseline(value.samples);
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`baseline report: ${output}`);
