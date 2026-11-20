#!/usr/bin/env -S node --import tsx
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
