/** Pino logger — JSON in production, pretty-printed in development. */
import pino, { type Logger } from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const log = pino({
  level: "info",
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});

export type { Logger };
