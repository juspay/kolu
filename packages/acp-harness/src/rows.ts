/**
 * THE CONTRACT'S WORDS, imported once.
 *
 * Every row, frame and state shape this package writes is declared by the
 * browser-safe contract half (`kolu-common/orchestrator`) and NOT here:
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
  OrchestratorArmedSchema,
  OrchestratorAttachmentSchema,
  OrchestratorAuthMethodSchema,
  OrchestratorCommandSchema,
  OrchestratorModelSchema,
  OrchestratorOptionSchema,
  OrchestratorPlanStepSchema,
  OrchestratorSayingSchema,
  OrchestratorServerSchema,
  OrchestratorSignInSchema,
  OrchestratorSpawnedSchema,
  OrchestratorToolStatusSchema,
  OrchestratorWatchingSchema,
} from "kolu-common/orchestrator";

export type {
  OrchestratorAskRow,
  OrchestratorFrame,
  OrchestratorKoluCall,
  OrchestratorMention,
  OrchestratorPhase,
  OrchestratorRow,
  OrchestratorState,
  OrchestratorToolRow,
  OrchestratorUserRow,
} from "kolu-common/orchestrator";

export type OrchestratorArmed = typeof OrchestratorArmedSchema.Type;
export type OrchestratorAttachment = typeof OrchestratorAttachmentSchema.Type;
export type OrchestratorSpawned = typeof OrchestratorSpawnedSchema.Type;
export type OrchestratorPlanStep = typeof OrchestratorPlanStepSchema.Type;
export type OrchestratorSaying = typeof OrchestratorSayingSchema.Type;
export type OrchestratorWatching = typeof OrchestratorWatchingSchema.Type;
export type OrchestratorToolStatus = typeof OrchestratorToolStatusSchema.Type;
export type OrchestratorOption = typeof OrchestratorOptionSchema.Type;
export type OrchestratorCommand = typeof OrchestratorCommandSchema.Type;
export type OrchestratorServer = typeof OrchestratorServerSchema.Type;
export type OrchestratorModel = typeof OrchestratorModelSchema.Type;
export type OrchestratorSignIn = typeof OrchestratorSignInSchema.Type;
export type OrchestratorAuthMethod = typeof OrchestratorAuthMethodSchema.Type;
