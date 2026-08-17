/**
 * CLI entry for `just _reap-ci-run` — this-run runtime roots + bind-pid-gone
 * ci daemons. Always prints what it did; a thrown error is a janitor bug.
 */

import { reapCiRun } from "./ciReap.ts";

const result = await reapCiRun();
process.stdout.write(
  `ci-reap: removed ${String(result.removedDirs.length)} runtime roots, reaped ${String(result.reaped.length)} orphans\n`,
);
for (const dir of result.removedDirs) {
  process.stdout.write(`  dir ${dir}\n`);
}
for (const pid of result.reaped) {
  process.stdout.write(`  pid ${String(pid)}\n`);
}
