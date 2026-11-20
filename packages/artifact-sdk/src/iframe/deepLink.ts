import {
  isCrossOriginHttpUrl,
  isDeepLinkHash,
  parseHttpUrl,
} from "../core/url";

export function isPlainPrimaryClick(
  event: Pick<
    MouseEvent,
    "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export type AnchorAction =
  | { kind: "external"; url: string }
  | { kind: "deep-link"; hash: string }
  | { kind: "in-frame" };

export function classifyAnchor(
  anchor: Pick<HTMLAnchorElement, "href">,
  loc: Pick<Location, "origin" | "pathname">,
): AnchorAction {
  const url = parseHttpUrl(anchor.href);
  if (url === null) return { kind: "in-frame" };
  if (isCrossOriginHttpUrl(url, loc.origin))
    return { kind: "external", url: url.href };
  if (!isDeepLinkHash(url.hash)) return { kind: "in-frame" };
  const isFileNav = url.pathname !== "/" && url.pathname !== loc.pathname;
  return isFileNav
    ? { kind: "in-frame" }
    : { kind: "deep-link", hash: url.hash };
}
