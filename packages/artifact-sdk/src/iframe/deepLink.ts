import {
  isCrossOriginHttpUrl,
  isDeepLinkHash,
  parseHttpUrl,
} from "../core/url";

export type ClickGesture = Pick<
  MouseEvent,
  "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

const PRIMARY_BUTTON = 0;
const MIDDLE_BUTTON = 1;

function isLinkFollowingClick(gesture: ClickGesture): boolean {
  return gesture.button === PRIMARY_BUTTON || gesture.button === MIDDLE_BUTTON;
}

function isPlainPrimaryClick(gesture: ClickGesture): boolean {
  return (
    gesture.button === PRIMARY_BUTTON &&
    !gesture.ctrlKey &&
    !gesture.metaKey &&
    !gesture.shiftKey &&
    !gesture.altKey
  );
}

export type AnchorAction =
  | { kind: "external"; url: string }
  | { kind: "deep-link"; hash: string }
  | { kind: "in-frame" };

export function classifyAnchor(
  anchor: Pick<HTMLAnchorElement, "href">,
  loc: Pick<Location, "origin" | "pathname">,
  gesture: ClickGesture,
): AnchorAction {
  if (!isLinkFollowingClick(gesture)) return { kind: "in-frame" };
  const url = parseHttpUrl(anchor.href);
  if (url === null) return { kind: "in-frame" };
  if (isCrossOriginHttpUrl(url, loc.origin))
    return { kind: "external", url: url.href };
  if (!isDeepLinkHash(url.hash)) return { kind: "in-frame" };
  if (!isPlainPrimaryClick(gesture)) return { kind: "in-frame" };
  const isFileNav = url.pathname !== "/" && url.pathname !== loc.pathname;
  return isFileNav
    ? { kind: "in-frame" }
    : { kind: "deep-link", hash: url.hash };
}
