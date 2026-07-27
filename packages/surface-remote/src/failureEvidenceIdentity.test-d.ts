/**
 * TYPE-LEVEL pin: this package's session LOG vocabulary and `@kolu/surface-map`'s
 * FAILURE-EVIDENCE vocabulary are one structural type.
 *
 * `serveHostMap` stamps a failed entry's evidence by passing the session's retained tail
 * straight through — `state = { kind: "failed", failure, evidence: down.log }` — with no
 * mapping step. That assignment compiles ONLY because `SessionState.log`'s element type
 * (`LogEntry`, declared in `./connection`) is element-for-element identical to
 * surface-map's `EvidenceLine`. The identity is the whole design: evidence is "the
 * existing source of truth passed through", not a second evidence pipe to keep in sync.
 *
 * But nothing NAMED that identity, so a one-sided edit — adding a `ts` field to
 * `LogEntry`, widening `source` on `EvidenceLine`, changing either to a bare `string[]` —
 * would break the seam at a DISTANCE: the error would surface as a confusing assignment
 * failure inside `serveHostMap`, in a different package from whichever vocabulary was
 * edited, or (if the edit happened to stay assignable) not at all. Pinned here, a
 * divergence is a compile error in the file whose entire job is to say the two agree.
 *
 * Both imports are `import type` and this file emits nothing, so `./connection`'s
 * browser-bundle constraint (zod + type-only session shapes) is untouched — the pin adds
 * no runtime edge from surface-remote to surface-map beyond the one `serveHostMap`
 * already has.
 */

import type { EvidenceLine, FailureEvidence } from "@kolu/surface-map";
import type { Mutually } from "./connectionInfoIdentity.test-d";
import type { LogEntry } from "./connection";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

// The ELEMENT vocabulary: one retained output line, with its provenance as a field.
const _lineIdentity: Mutually<LogEntry, EvidenceLine> = true;
void _lineIdentity;

// The TAIL as a whole, read off the session shape `serveHostMap` actually projects from
// — so the pin covers the readonly-ness and the array shape, not just the element.
const _tailIdentity: Mutually<SessionState<SshProv>["log"], FailureEvidence> =
  true;
void _tailIdentity;
