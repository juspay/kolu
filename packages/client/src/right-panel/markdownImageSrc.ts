import { resolveRelativePath } from "@kolu/solid-browser";
import { buildTerminalFileUrl } from "kolu-common/preview";

export function resolveMarkdownImageSrc(
  host: string,
  terminalId: string,
  markdownFilePath: string,
  src: string,
): string | undefined {
  const repoRel = resolveRelativePath(markdownFilePath, src);
  if (repoRel === null) return undefined;
  return buildTerminalFileUrl(host, terminalId, repoRel);
}
