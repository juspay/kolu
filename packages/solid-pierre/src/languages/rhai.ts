/// <reference path="./rhaiGrammar.d.ts" />

import { registerCustomLanguage } from "@pierre/diffs";
import type { LanguageRegistration } from "shiki";

let registered = false;

const loadRhai = async (): Promise<{ default: LanguageRegistration[] }> => {
  // biome-ignore lint/correctness/noUndeclaredDependencies: Vite resolves this Nix-backed virtual module.
  const { default: source } = await import("kolu-rhai-grammar");
  const grammar = source as LanguageRegistration;

  return {
    default: [
      {
        ...grammar,
        displayName: "Rhai",
        name: "rhai",
      },
    ],
  };
};

export const registerRhaiLanguage = (): void => {
  if (registered) return;

  registerCustomLanguage("rhai", loadRhai, ["rhai"]);
  registered = true;
};
