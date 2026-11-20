export const disposers: Array<() => void> = [];

export function disposeAll(): void {
  for (const d of disposers.splice(0)) d();
}

export function findShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  for (const child of el.children) {
    const found = findShadowRoot(child);
    if (found) return found;
  }
  return null;
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function paintedRows(root: ShadowRoot): string[] {
  return [
    ...new Set(
      [...root.querySelectorAll("[data-item-path]")].map(
        (n) => (n as HTMLElement).dataset.itemPath as string,
      ),
    ),
  ];
}

export function mountInto(
  renderInto: (host: HTMLElement) => () => void,
): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = renderInto(host);
  disposers.push(dispose, () => host.remove());
  const container = host.querySelector(
    '[data-testid="pierre-file-tree"]',
  ) as HTMLElement;
  const root = findShadowRoot(container);
  if (!root) throw new Error("Pierre mounted no shadow root");
  return root;
}
