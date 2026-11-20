export function focusOnMount(el: HTMLElement | undefined): void {
  queueMicrotask(() => {
    if (el?.isConnected) el.focus({ preventScroll: true });
  });
}
