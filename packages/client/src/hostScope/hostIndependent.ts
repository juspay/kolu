import { createSignal, type Signal } from "solid-js";
import { createStore, type SetStoreFunction, type Store } from "solid-js/store";

export function hostIndependentSignal<T>(): Signal<T | undefined>;
export function hostIndependentSignal<T>(value: T): Signal<T>;
export function hostIndependentSignal<T>(value?: T): Signal<T | undefined> {
  return createSignal<T | undefined>(value);
}

export function hostIndependentStore<T extends object>(
  init: T,
): [Store<T>, SetStoreFunction<T>] {
  return createStore<T>(init);
}
