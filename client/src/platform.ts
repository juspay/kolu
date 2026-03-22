/** True on macOS/iOS — where browser keyboard events use metaKey instead of ctrlKey. */
// Includes iPad/iPhone because browser keyboard events use metaKey on all Apple devices
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
