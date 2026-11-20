export interface RecordWrites<K extends string> {
  readonly schedule: (what: K) => void;
  readonly now: (what: K) => void;
  readonly flush: () => void;
}

export const recordWrites = <K extends string>(
  write: Readonly<Record<K, () => void>>,
  throttleMs: number,
): RecordWrites<K> => {
  const names = Object.keys(write) as unknown as ReadonlyArray<K>;
  const due = new Set<K>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wroteAt = 0;

  const writeDue = (): void => {
    wroteAt = Date.now();
    const owed = [...due];
    due.clear();
    for (const what of names) if (owed.includes(what)) write[what]();
  };

  return {
    schedule: (what) => {
      due.add(what);
      if (timer !== undefined) return;
      const since = Date.now() - wroteAt;
      if (since >= throttleMs) {
        writeDue();
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (due.size > 0) writeDue();
      }, throttleMs - since);
      timer.unref();
    },
    now: (what) => {
      due.add(what);
      writeDue();
    },
    flush: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (due.size > 0) writeDue();
    },
  };
};
