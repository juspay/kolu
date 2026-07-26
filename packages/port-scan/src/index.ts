/** `@kolu/port-scan` — "which processes in this subtree hold listening TCP
 *  sockets, and on what addresses?", answered without the caller learning how the
 *  OS was asked.
 *
 *  This barrel is the NODE-side surface: importing it pulls in the reader, which
 *  spawns the baked **osfacts** binary. A consumer that only RENDERS ports
 *  (a browser bundle) imports `@kolu/port-scan/ports` instead — same `PortInfo`,
 *  same fold, zero `node:` imports.
 *
 *  Deliberately NARROWER than what `./scan.ts` exports: the TSV parser, the
 *  U-row policy and the subtree partitioner are exported there for that
 *  module's own tests. A plug is a receptacle only if it is small. */

export {
  foldPorts,
  type PortFamily,
  PortFamilySchema,
  type PortInfo,
  PortInfoSchema,
  type PortScope,
  PortScopeSchema,
  preferredFamily,
  samePortList,
  widerScope,
} from "./ports.ts";
export {
  PortScanError,
  portScanSupported,
  scanSubtreePorts,
} from "./scan.ts";
