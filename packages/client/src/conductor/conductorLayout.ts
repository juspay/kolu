import { createMediaQuery } from "@solid-primitives/media";

function breakpoint(token: string, fallback: string): string {
  const declared =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(token)
          .trim()
      : "";
  return declared || fallback;
}

export const CONDUCTOR_WIDE_FALLBACK = "69rem";

export const CONDUCTOR_HELP_FALLBACK = "87rem";

export const conductorWide = createMediaQuery(
  `(width >= ${breakpoint("--breakpoint-conductor-wide", CONDUCTOR_WIDE_FALLBACK)})`,
);

export const conductorHelpColumn = createMediaQuery(
  `(width >= ${breakpoint("--breakpoint-conductor-help", CONDUCTOR_HELP_FALLBACK)})`,
);
