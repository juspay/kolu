#!/usr/bin/env bun
/**
 * THE COMMAND a `terminal` auth method hands over, in the bench's own shape: it
 * RECORDS that it was spawned (which is what a test counts — one process per
 * attempt, never two), says a URL, and exits 0.
 *
 * The pause before the exit is the whole of the timing: a sign-in that ended
 * the instant it started would let a second press in the same tick find an
 * empty slot by luck rather than by the claim, and this bench is about the
 * claim (`../agent.test.ts`).
 */

import { appendFileSync } from "node:fs";

const [log] = process.argv.slice(2);
if (log !== undefined && log !== "") appendFileSync(log, "spawned\n");

process.stdout.write("https://example.test/login\n");
process.stdout.write("Paste code here if prompted > ");
setTimeout(() => process.exit(0), 150);
