/** Pino logger — JSON in production, pretty-printed in development.
 *
 * Default level is `info`. Override via `LOG_LEVEL` env var (e.g. `debug`,
 * `warn`, `trace`). The CLI's `--verbose` flag is a hard override applied
 * after construction in `index.ts` and trumps both. */
import pino, { type Logger } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const log = pino(
  process.env.NODE_ENV === "production"
    ? { level }
    : {
        level,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        },
      },
);

export type { Logger };
