/**
 * pesu — the XS chat bridge (B0: the round trip). A public barrel for the
 * pieces tests and future phases consume; `bin.ts` is the runnable entry.
 */

export { attribute } from "./attribution.ts";
export {
  createEngine,
  type Engine,
  type EngineDeps,
  extractMessage,
  MIN_UPDATE_INTERVAL_MS,
  RELAYABLE_EVENTS,
  type RelayMessage,
} from "./bin.ts";
export {
  DEFAULT_COORDINATOR_TITLE,
  DEFAULT_PORT,
  isOperatorEmail,
  loadConfig,
  type PesuConfig,
} from "./config.ts";
export {
  assistantCount,
  type CoordinatorDriver,
  KavalPadiCoordinator,
  loadCoordinatorTranscript,
  pickTerminalByTitle,
  replySince,
} from "./coordinator.ts";
export { Inbox, type InboxJob } from "./inbox.ts";
export { createLogger, type Logger } from "./log.ts";
export {
  createWebhookApp,
  SIGNATURE_HEADER,
  verifySignature,
  type WebhookDeps,
  type XyneEvent,
  XyneEventSchema,
} from "./webhook.ts";
export {
  createXyneApi,
  MESSAGE_CAP,
  splitMessage,
  type XyneApi,
  type XyneApiConfig,
} from "./xyneApi.ts";
