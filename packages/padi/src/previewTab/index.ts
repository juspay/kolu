/**
 * Preview tab (PRT3) — open a door-backed port inside kolu's right panel.
 *
 * Distinct from `../preview.ts` (file-byte iframe preview for the Code tab).
 * This package is the chrome/location side: validate `(port, path)`, write
 * server-authored `rightPanel.preview`, and collect host scanned ports.
 */

export {
  collectHostScannedPorts,
  previewClose,
  previewOpen,
} from "./open.ts";
export {
  assertPreviewPath,
  assertPreviewPortAllowed,
  assertPreviewTarget,
  type PreviewLocation,
  type PreviewPathReject,
  previewPathReject,
  previewPathRejectMessage,
} from "./target.ts";
