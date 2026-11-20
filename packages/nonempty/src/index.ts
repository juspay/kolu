export type NonEmpty<T> = readonly [T, ...T[]];

export function nonEmpty<T>(arr: readonly T[]): NonEmpty<T> | null {
  return arr.length === 0 ? null : (arr as NonEmpty<T>);
}
