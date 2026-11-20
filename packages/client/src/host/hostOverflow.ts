export type HostFit = {
  key: string;
  width: number;
};

export type OverflowResult = {
  visible: string[];
  overflowed: string[];
};

const allVisible = (order: readonly HostFit[]): OverflowResult => ({
  visible: order.map((h) => h.key),
  overflowed: [],
});

export function computeVisibleHosts(
  order: readonly HostFit[],
  activeKey: string,
  containerWidth: number,
  trailingReserve: number,
): OverflowResult {
  const budgetWithoutTrigger = containerWidth;
  const budgetWithTrigger = containerWidth - trailingReserve;

  const total = order.reduce((sum, h) => sum + h.width, 0);
  if (total <= budgetWithoutTrigger) return allVisible(order);

  let used = 0;
  let cut = order.length;
  for (let i = 0; i < order.length; i++) {
    const next = order[i];
    if (next === undefined) break;
    if (used + next.width > budgetWithTrigger) {
      cut = i;
      break;
    }
    used += next.width;
  }
  const visible = order.slice(0, cut).map((h) => h.key);

  if (!visible.includes(activeKey)) {
    const active = order.find((h) => h.key === activeKey);
    if (active) {
      const need = active.width;
      while (used + need > budgetWithTrigger && visible.length > 0) {
        const dropped = visible.pop();
        const droppedFit = order.find((h) => h.key === dropped);
        used -= droppedFit?.width ?? 0;
      }
      visible.push(activeKey);
      used += need;
    }
  }

  const visibleSet = new Set(visible);
  return {
    visible: order.filter((h) => visibleSet.has(h.key)).map((h) => h.key),
    overflowed: order.filter((h) => !visibleSet.has(h.key)).map((h) => h.key),
  };
}
