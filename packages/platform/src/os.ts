/** True on macOS/iOS — browser keyboard events use metaKey instead of ctrlKey on Apple devices. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
