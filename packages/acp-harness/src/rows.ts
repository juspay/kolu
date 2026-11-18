/**
 * THE CONTRACT'S WORDS, imported once.
 *
 * Every row, frame and state shape this package writes is declared elsewhere and
 * NOT here: the harness is the WRITER of that contract, not a second author of
 * it. The row shapes both chat UIs draw (a tool's status, a delivery mark, a
 * streamed piece, an armed task, a spawned subagent, a plan step, what is being
 * watched) are `@kolu/acp/wire`'s, and everything else is the browser-safe
 * contract half's (`kolu-common/conductor`). This module exists so the rest of
 * the package names those types through one door — a file that grows a shape of
 * its own is immediately visible as the wrong thing to have done, and a renamed
 * member fails here rather than in nine places.
 *
 * Half the contract names a type beside its schema and half does not, so the
 * ones that do not are spelled `typeof …Schema.Type` HERE, once. The schema
 * consts are imported `import type`, which means the declaration is read and no
 * schema value — and no `effect` runtime — enters this package's closure
 * through this door: the harness validates nothing, because the host that
 * publishes these rows encodes them, and a second validation would be a second
 * place for the two to disagree.
 */

import type { AuthMethod } from "@kolu/acp/wire";
import type {
  ConductorAttachmentSchema,
  ConductorCommandSchema,
  ConductorModelSchema,
  ConductorOptionSchema,
  ConductorServerSchema,
  ConductorSignInSchema,
} from "kolu-common/conductor";

export type {
  ConductorAskRow,
  ConductorFrame,
  ConductorKoluCall,
  ConductorMention,
  ConductorPhase,
  ConductorRow,
  ConductorState,
  ConductorToolRow,
  ConductorUserRow,
  ConductorWakeEvent,
} from "kolu-common/conductor";

export type ConductorAttachment = typeof ConductorAttachmentSchema.Type;
export type ConductorOption = typeof ConductorOptionSchema.Type;
export type ConductorCommand = typeof ConductorCommandSchema.Type;
export type ConductorServer = typeof ConductorServerSchema.Type;
export type ConductorModel = typeof ConductorModelSchema.Type;
export type ConductorSignIn = typeof ConductorSignInSchema.Type;
/** The agent's offered sign-in methods are `@kolu/acp/wire`'s `AuthMethod` —
 *  the CLIENT's vocabulary, which this package re-exports under the product's
 *  name so nothing above here has to know which package owns it. */
export type ConductorAuthMethod = AuthMethod;
