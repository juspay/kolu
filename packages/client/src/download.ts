/** Trigger a browser download of an existing object URL via a synthetic
 *  anchor click. The caller owns the URL's lifecycle (creation and
 *  `URL.revokeObjectURL`) — revoke timing depends on the caller's delivery
 *  path, so it stays out of here. Shared by `sessionTransfer` (JSON export)
 *  and `exportSessionAsHtml` (popup-blocked fallback). */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
