import { type Accessor, batch, createSignal } from "solid-js";
import { hashSegments } from "../../hashPath";
import { toast } from "solid-sonner";

export interface ReaderTarget {
  readonly work: string;
  readonly path: string;
}

const [target, setTarget] = createSignal<ReaderTarget | null>(null);
const [filled, setFilled] = createSignal(false);

export const readerTarget: Accessor<ReaderTarget | null> = target;

export const readerFilled: Accessor<boolean> = filled;

export function openReader(next: ReaderTarget): void {
  setTarget(next);
}

export function closeReader(): void {
  batch(() => {
    setTarget(null);
    setFilled(false);
  });
}

export function toggleReaderFill(): void {
  setFilled((was) => !was);
}

export function readerHash(of: ReaderTarget): string {
  return `#/reader/${encodeURIComponent(of.work)}/${encodeURIComponent(of.path)}`;
}

export function parseReaderHash(hash: string): ReaderTarget | null {
  const read = hashSegments(hash);
  if (read.kind !== "path" || read.segments.length !== 3) return null;
  const [family, work, path] = read.segments;
  if (family !== "reader" || work === undefined || path === undefined)
    return null;
  return work === "" || path === "" ? null : { work, path };
}

const POP_OUT_FEATURES = "popup=yes,width=900,height=1000";

export function popOutReader(of: ReaderTarget): void {
  const url = `${location.pathname}${location.search}${readerHash(of)}`;
  const opened = window.open(
    url,
    `kolu-reader:${of.work}:${of.path}`,
    POP_OUT_FEATURES,
  );
  if (opened === null) {
    toast.error(
      "The browser blocked the reader window — allow pop-ups for kolu",
    );
    return;
  }
  opened.focus();
  closeReader();
}
