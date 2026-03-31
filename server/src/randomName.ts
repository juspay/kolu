/**
 * Random name generator — picks ADJ-NOUN from WordNet-derived word lists.
 * Word lists are loaded from KOLU_RANDOM_WORDS (set by Nix).
 */

import path from "node:path";
import fs from "node:fs";
import { log } from "./log.ts";

function readLines(filePath: string): string[] {
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((w) => w.length > 0);
}

let adjectives: string[] | null = null;
let nouns: string[] | null = null;

function loadWordLists(): { adjectives: string[]; nouns: string[] } {
  if (adjectives && nouns) return { adjectives, nouns };

  const dir = process.env.KOLU_RANDOM_WORDS;
  if (!dir) {
    throw new Error("KOLU_RANDOM_WORDS env var is not set");
  }
  const adjPath = path.join(dir, "adjectives.txt");
  const nounPath = path.join(dir, "nouns.txt");
  if (!fs.existsSync(adjPath) || !fs.existsSync(nounPath)) {
    throw new Error(`Word list files not found in ${dir}`);
  }
  adjectives = readLines(adjPath);
  nouns = readLines(nounPath);
  log.info(
    { adjectives: adjectives.length, nouns: nouns.length },
    "loaded word lists",
  );
  return { adjectives, nouns };
}

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)]!;
}

export function randomName(): string {
  const { adjectives: adj, nouns: n } = loadWordLists();
  return `${pick(adj)}-${pick(n)}`;
}
