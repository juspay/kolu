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
  if (dir && fs.existsSync(path.join(dir, "adjectives.txt"))) {
    adjectives = readLines(path.join(dir, "adjectives.txt"));
    nouns = readLines(path.join(dir, "nouns.txt"));
    log.info(
      { adjectives: adjectives.length, nouns: nouns.length },
      "loaded word lists",
    );
  } else {
    adjectives = ["calm", "bold", "warm", "keen", "swift"];
    nouns = ["brook", "ridge", "vale", "peak", "cove"];
    log.warn("KOLU_RANDOM_WORDS not set, using fallback word lists");
  }
  return { adjectives, nouns };
}

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)]!;
}

export function randomName(): string {
  const { adjectives: adj, nouns: n } = loadWordLists();
  return `${pick(adj)}-${pick(n)}`;
}
