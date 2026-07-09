/**
 * TYPE-LEVEL pin (W6 review, item 1): the browser `connection` cell and the session
 * sum are ONE type family. `ConnectionInfo` is DEFINED as `SessionState<SshProv>`
 * (`./connection`), and the hand-written zod `ConnectionInfoSchema` — which MUST exist
 * (a wire cell needs a concrete browser-safe validator, which a TS-generic type is not)
 * — is pinned STRUCTURALLY EQUAL to it here: `z.infer<typeof ConnectionInfoSchema>` ≡
 * `SessionState<SshProv>`, both directions.
 *
 * So a drift — add a phase (e.g. `probing`) or a field (e.g. `sinceMs`) to the session
 * sum without matching the schema, or change the `failed`⇒`cause:"remote"` invariant on
 * one side only — is now a COMPILE error in this file, not a runtime zod throw at the
 * cell write. `tsc` GREEN over this file ⇒ the schema and the type agree.
 */

import type { z } from "zod";
import type { ConnectionInfoSchema } from "./connection";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

type Inferred = z.infer<typeof ConnectionInfoSchema>;

/** Mutual assignability (tuple-wrapped so a union operand doesn't distribute): `true`
 *  only when `A` and `B` are structurally interchangeable, else `never`. */
type Mutually<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

// If the schema and the session sum ever diverge, `Mutually<…>` is `never` and this
// assignment fails to compile.
const _identityPin: Mutually<Inferred, SessionState<SshProv>> = true;
void _identityPin;
