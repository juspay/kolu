/**
 * THE CONTRACT'S WORDS, imported once.
 *
 * Every row, frame and state shape this package writes is declared by the
 * browser-safe contract half (`kolu-common/conductor`) and NOT here:
 * the harness is the WRITER of that contract, not a second author of it. This
 * module exists so the rest of the package names those types through one door —
 * a file that grows a shape of its own is immediately visible as the wrong
 * thing to have done, and a renamed member fails here rather than in nine
 * places.
 *
 * Half the contract names a type beside its schema and half does not, so the
 * ones that do not are spelled `typeof …Schema.Type` HERE, once. The schema
 * consts are imported `import type`, which means the declaration is read and no
 * schema value — and no `effect` runtime — enters this package's closure
 * through this door: the harness validates nothing, because the host that
 * publishes these rows encodes them, and a second validation would be a second
 * place for the two to disagree.
 */

import type {
  ConductorArmedSchema,
  ConductorAttachmentSchema,
  ConductorAuthMethodSchema,
  ConductorCommandSchema,
  ConductorModelSchema,
  ConductorOptionSchema,
  ConductorPlanStepSchema,
  ConductorSayingSchema,
  ConductorServerSchema,
  ConductorSignInSchema,
  ConductorSpawnedSchema,
  ConductorToolStatusSchema,
  ConductorWatchingSchema,
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

export type ConductorArmed = typeof ConductorArmedSchema.Type;
export type ConductorAttachment = typeof ConductorAttachmentSchema.Type;
export type ConductorSpawned = typeof ConductorSpawnedSchema.Type;
export type ConductorPlanStep = typeof ConductorPlanStepSchema.Type;
export type ConductorSaying = typeof ConductorSayingSchema.Type;
export type ConductorWatching = typeof ConductorWatchingSchema.Type;
export type ConductorToolStatus = typeof ConductorToolStatusSchema.Type;
export type ConductorOption = typeof ConductorOptionSchema.Type;
export type ConductorCommand = typeof ConductorCommandSchema.Type;
export type ConductorServer = typeof ConductorServerSchema.Type;
export type ConductorModel = typeof ConductorModelSchema.Type;
export type ConductorSignIn = typeof ConductorSignInSchema.Type;
export type ConductorAuthMethod = typeof ConductorAuthMethodSchema.Type;
