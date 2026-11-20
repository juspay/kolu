import { type NonEmpty, nonEmpty } from "nonempty";
import wordsJson from "../words.json" with { type: "json" };

function wordList(words: readonly string[], kind: string): NonEmpty<string> {
  const list = nonEmpty(words);
  if (list === null) {
    throw new Error(`memorable-names: words.json has no ${kind}`);
  }
  return list;
}

const adjectives = wordList(wordsJson.adjectives, "adjectives");
const nouns = wordList(wordsJson.nouns, "nouns");

function pick(list: NonEmpty<string>): string {
  const idx = Math.floor(Math.random() * list.length);
  return list[idx] ?? list[0];
}

/** Generate a random ADJ-NOUN name (e.g. "bright-falcon"). */
export function randomName(): string {
  return `${pick(adjectives)}-${pick(nouns)}`;
}
