/** Typed in-memory publisher for client-facing terminal events.
 *  EventEmitter stays for inter-provider chaining (git→github);
 *  publisher handles client subscriptions (metadata + activity streams). */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { TerminalMetadata } from "kolu-common";

export const publisher = new MemoryPublisher<{
  metadata: { terminalId: string; metadata: TerminalMetadata };
  activity: { terminalId: string; isActive: boolean };
}>();
