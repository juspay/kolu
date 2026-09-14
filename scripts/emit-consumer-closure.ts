#!/usr/bin/env -S node --import tsx
/** Regenerate `nix/consumer-closure.json` — see
 *  `packages/tests/governance/consumerClosure.ts` for what it is and why it is
 *  an emitted artifact rather than a script a consumer runs. */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSUMER_CLOSURE_PATH,
  emitConsumerClosure,
  renderConsumerClosure,
} from "../packages/tests/governance/consumerClosure";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = join(repoRoot, CONSUMER_CLOSURE_PATH);
writeFileSync(out, renderConsumerClosure(emitConsumerClosure(repoRoot)));
console.log(`wrote ${CONSUMER_CLOSURE_PATH}`);
