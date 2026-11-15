/// <reference path="./rhaiGrammar.d.ts" />

import { registerCustomLanguage } from "@pierre/diffs";
// `@pierre/diffs@1.6` stopped re-exporting Shiki's grammar type, so it comes
// from its owner. Pinned to the exact Shiki the Pierre build resolves, as a
// devDependency — the type is all that is used; nothing from Shiki ships.
import type { LanguageRegistration } from "shiki";

let registered = false;

const loadRhai = async (): Promise<{ default: LanguageRegistration[] }> => {
  // biome-ignore lint/correctness/noUndeclaredDependencies: Vite resolves this Nix-backed virtual module.
  const { default: source } = await import("kolu-rhai-grammar");
  // The Nix-fetched JSON enters through a virtual Vite alias. Validate the
  // actual grammar by loading it through Shiki (covered by rhai.test.ts), and
  // make that untyped data boundary explicit here.
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

/** Register the official Rhai TextMate grammar with Pierre and teach its
 * filename resolver that `.rhai` files use it. The loader stays lazy: opening
 * any other language does not pull the grammar into the highlight worker. */
export const registerRhaiLanguage = (): void => {
  if (registered) return;

  registerCustomLanguage("rhai", loadRhai, ["rhai"]);
  registered = true;
};
