/** Pino logger — JSON in production, pretty-printed in development. */
import pino, { type Logger } from "pino";

export const log = pino(
  process.env.NODE_ENV === "production"
    ? { level: "info" }
    : {
        level: "info",
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        },
      },
);

export type { Logger };
