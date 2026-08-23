/**
 * Sibling-process entry for `armBindPidWatchdog`. Kept out of the library
 * module so importing `bindPidWatchdog.ts` has no argv / process.exit side
 * effect.
 */
import { BIND_WATCH_FLAG, runBindPidWatch } from "./bindPidWatchdog.ts";

const i = process.argv.indexOf(BIND_WATCH_FLAG);
const bindPid = Number(process.argv[i + 1]);
const targetPid = Number(process.argv[i + 2]);
if (!Number.isInteger(bindPid) || bindPid <= 0) {
  process.stderr.write("bindPidWatchdog: bind pid is not a single process\n");
  process.exit(2);
}
if (!Number.isInteger(targetPid) || targetPid <= 0) {
  process.stderr.write("bindPidWatchdog: target pid is not a single process\n");
  process.exit(2);
}
runBindPidWatch({ bindPid, targetPid });
