import { createMediaQuery } from "@solid-primitives/media";

const TAILWIND_DEFAULT_SM = "40rem";

const SM_BREAKPOINT =
  (typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
        .getPropertyValue("--breakpoint-sm")
        .trim()
    : "") || TAILWIND_DEFAULT_SM;

const belowSm = createMediaQuery(`(width < ${SM_BREAKPOINT})`);

const handheld = createMediaQuery("(pointer: coarse) and (hover: none)");

type LayoutMode = "phone" | "compact" | "desktop";

export const layoutMode = (): LayoutMode =>
  belowSm() ? "phone" : handheld() ? "compact" : "desktop";

export const isDesktop = () => layoutMode() === "desktop";

export const isTouch = createMediaQuery("(pointer: coarse)");
