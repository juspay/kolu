/** Front door for "open this file in the mobile Files drawer". The
 *  desktop analog is `openInCodeTab` (right-panel scope); on mobile
 *  the right panel doesn't exist and `MobileCodeSheet` is the viewer.
 *
 *  Why a parallel module instead of an `isMobile()` branch inside
 *  `openInCodeTab`: that helper encapsulates the desktop right-panel
 *  paired writes (preferences-uncollapse + tab + browse-mode + pending
 *  request). Smuggling a mobile branch into it would complect platform
 *  dispatch with desktop-navigation policy. Producers that fire on
 *  both surfaces (today: the terminal `path:line` link provider) branch
 *  on `isMobile()` at the call site and route to whichever front door
 *  matches the surface.
 *
 *  The "pending open" token is an incrementing counter, not a request
 *  object: the only consumer is `MobileTileView`'s `filesOpen` setter,
 *  which doesn't need any payload beyond "a click happened, open the
 *  drawer". The selection slot (`useRightPanel.setSelectedFile`) is
 *  the durable bit and is set in the same batch — duplicate clicks
 *  on the same path still re-open the drawer because the counter
 *  changes even when the path doesn't. */

import { batch, createSignal } from "solid-js";
import { useRightPanel } from "./right-panel/useRightPanel";

const [pending, setPending] = createSignal(0);

/** Subscribe to this in `MobileTileView` to open the Files drawer when
 *  a producer requests navigation. */
export const pendingMobileOpen = pending;

export interface OpenInMobileFilesRequest {
  /** Repo-relative (or cwd-relative — best-effort match) path. On
   *  mismatch `BrowseFileDispatcher`'s `fsReadFile` stream surfaces an
   *  error toast; the user can still hit back to land on the tree. */
  path: string;
}

export function openInMobileFiles(req: OpenInMobileFilesRequest): void {
  batch(() => {
    useRightPanel().setSelectedFile("browse", req.path);
    setPending((n) => n + 1);
  });
}
