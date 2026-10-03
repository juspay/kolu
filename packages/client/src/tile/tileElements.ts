/** Mounted canvas hosts. Each ref owns its registration until unmount. */
const elements = new Map<string, HTMLElement>();
export function registerTileElement(
  id: string,
  element: HTMLElement,
): () => void {
  elements.set(id, element);
  return () => {
    if (elements.get(id) === element) elements.delete(id);
  };
}
export function tileElements(): Iterable<HTMLElement> {
  return elements.values();
}
