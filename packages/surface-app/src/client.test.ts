/// <reference path="./client.d.ts" />
/**
 * The third copy of the shell-commit global name — the `Window` augmentation in
 * `client.d.ts` — is a bare string LITERAL (`__SURFACE_APP_COMMIT__`), keyed
 * that way because an ambient declaration can't index by a `const`. So nothing
 * structurally ties it to `SHELL_COMMIT_GLOBAL`; this pins it the way
 * `vite.test.ts` pins the vite plugin's literal, closing the same lockstep gap.
 *
 * NOTE: `shellCommit()` reads the global keyed by the CONSTANT, not this
 * augmentation, and is correct as-is (the literal-keyed augmentation can't serve
 * a constant-keyed index anyway). This test only proves the names agree.
 */

import { expectTypeOf } from "vitest";
import { describe, it } from "vitest";
import { SHELL_COMMIT_GLOBAL } from "./index";

describe("client.d.ts Window augmentation", () => {
  it("augments the property under exactly SHELL_COMMIT_GLOBAL", () => {
    // Indexing `Window` by the constant resolves to the augmented
    // `string | undefined` ONLY if the constant equals the literal property
    // name the augmentation declares. If the two drift, this index is an error.
    expectTypeOf<
      Window[typeof SHELL_COMMIT_GLOBAL]
    >().toEqualTypeOf<string | undefined>();

    // And an object keyed by the constant is assignable to the augmented shape —
    // a second proof the names are the same string.
    const w: Pick<Window, typeof SHELL_COMMIT_GLOBAL> = {
      [SHELL_COMMIT_GLOBAL]: "0fab0cc",
    };
    expectTypeOf(w).toMatchTypeOf<{ __SURFACE_APP_COMMIT__?: string }>();
  });
});
