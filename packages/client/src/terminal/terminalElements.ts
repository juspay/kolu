/** Mounted terminal bodies. Each ref owns its registration until unmount. */
const elements = new Map<string, HTMLElement>();
export function registerTerminalElement(
  id: string,
  element: HTMLElement,
): () => void {
  elements.set(id, element);
  return () => {
    if (elements.get(id) === element) elements.delete(id);
  };
}
export function terminalElements(): Iterable<HTMLElement> {
  return elements.values();
}
