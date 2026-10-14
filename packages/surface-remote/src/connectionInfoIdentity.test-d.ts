/**
 * TYPE-LEVEL pin (W6 review, item 1): the browser `ConnectionInfo` value and the session
 * sum are ONE type family. `ConnectionInfo` is DEFINED as `SessionState<SshProv>` minus
 * the `absent` arm (`./connection`), and the hand-written Effect `ConnectionInfoSchema` —
 * which MUST exist (the wire value needs a concrete browser-safe validator, which a
 * TS-generic type is not) — is pinned STRUCTURALLY EQUAL to it here, both directions.
 *
 * **Why `absent` is subtracted rather than carried.** Only a connector that can TELL
 * nothing is serving produces that arm — a unix path, whose `connect(2)` answers
 * ENOENT/ECONNREFUSED. A HOST is reached over ssh or over the local endpoint, and
 * neither can distinguish absence from unreachability, so no producer of this wire
 * value can ever construct the arm. Putting it on the browser's sum would be a state
 * every reader has to handle and nothing can ever send.
 *
 * So a drift — add a phase (e.g. `probing`) or a field (e.g. `sinceMs`) to the session
 * sum without matching the schema, or change a down arm's `cause` shape (both carry
 * `"network" | "remote"`) on one side only — is now a COMPILE error in this file, not a
 * runtime decode throw at the seam. `tsc` GREEN over this file ⇒ the schema and the type agree.
 */

import type { ConnectionInfoSchema } from "./connection";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

type Inferred = typeof ConnectionInfoSchema.Type;

/** Mutual assignability (tuple-wrapped so a union operand doesn't distribute): `true`
 *  only when `A` and `B` are structurally interchangeable, else `never`. Local to this
 *  pin — a `.test-d.ts` is a leaf, never another pin's vocabulary owner. Type-only, so
 *  nothing is emitted. */
type Mutually<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

// If the schema and the session sum ever diverge, `Mutually<…>` is `never` and this
// assignment fails to compile.
const _identityPin: Mutually<
  Inferred,
  Exclude<SessionState<SshProv>, { phase: "absent" }>
> = true;
void _identityPin;
