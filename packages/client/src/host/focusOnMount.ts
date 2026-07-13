/** Focus an input the frame it mounts. Defer past mount (the ref isn't attached
 *  on the tick the owner decides to show it, so `queueMicrotask` waits for it)
 *  and guard `isConnected` so a dismiss that beats the microtask is a no-op. The
 *  single owner of this timing, shared by the desktop add-host popover
 *  (`AddHostAffordance`) and the mobile in-sheet add section (`MobileAddSection`),
 *  which had mounted it verbatim. */
export function focusOnMount(el: HTMLElement | undefined): void {
  queueMicrotask(() => {
    if (el?.isConnected) el.focus({ preventScroll: true });
  });
}
