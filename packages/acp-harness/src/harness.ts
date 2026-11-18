/**
 * THE DOOR — the names this package has always published, and nothing else.
 *
 * `./conversation.ts` is the file they live in: the transcript, the turns, the
 * state a caller reads, and every row written. The client it sits on
 * (`@kolu/acp-client`) is the half that speaks the protocol. This file exists
 * so that a caller — and `harness.test.ts` — keeps naming one module: the
 * split is an arrangement inside the package, not a change to what the package
 * hands out.
 */

export {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  HarnessUnavailable,
  type HttpServer,
  type PersonSaid,
  type PromptFile,
  type SignedIn,
  type StdioServer,
  startHarness,
  type ToolFrame,
} from "./conversation.ts";
