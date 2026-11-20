export type { Logger } from "./log.ts";
export {
  type AppendedLineConfig,
  type AppendedLineReader,
  createAppendedLineReader,
} from "./appended-lines.ts";
export { readTailLines, type TailReadConfig } from "./tail-lines.ts";
