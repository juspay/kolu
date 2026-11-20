import { Effect, type Scope, Stream } from "effect";

export function runScopedSync<A>(
  effect: Effect.Effect<A, never, Scope.Scope>,
): A {
  return Effect.runSync(Effect.scoped(effect));
}

export function openStream<T>(
  stream: Stream.Stream<T, unknown>,
): AsyncIterator<T> {
  return Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
}

export function closeStream(it: AsyncIterator<unknown>): void {
  void Promise.resolve(it.return?.()).catch(() => {});
}

async function awaitFrame<T>(
  pull: Promise<IteratorResult<T>>,
  ms: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("stream timed out")), ms);
  });
  try {
    const r = await Promise.race([pull, timeout]);
    if (r.done) throw new Error("stream ended without yielding");
    return r.value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function nextFrame<T>(it: AsyncIterator<T>, ms = 8000): Promise<T> {
  return awaitFrame(it.next(), ms);
}

export interface FrameStream<T> {
  next(ms?: number): Promise<T>;
  until(match: (v: T) => boolean, ms?: number): Promise<T>;
  close(): void;
}

export function subscribeFrames<T>(
  stream: Stream.Stream<T, unknown>,
): FrameStream<T> {
  const it = openStream(stream);
  let pending: Promise<IteratorResult<T>> | undefined = it.next();
  const next = (ms = 8000): Promise<T> => {
    const pull = pending ?? it.next();
    pending = undefined;
    return awaitFrame(pull, ms);
  };
  return {
    next,
    async until(match, ms = 8000) {
      const deadline = Date.now() + ms;
      for (;;) {
        const v = await next(Math.max(0, deadline - Date.now()));
        if (match(v)) return v;
      }
    },
    close: () => closeStream(it),
  };
}
