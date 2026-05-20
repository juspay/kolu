import {
  createWalSubscription,
  type WalSubscription,
} from "kolu-shared/sqlite";
import type { Logger } from "kolu-shared";
import type { Executor } from "./executor.ts";

export interface ExecutorWalSubscriptionConfig {
  executor: Executor;
  dbPath: string;
  walPath: string;
  label: string;
}

interface SharedExecutorWalSubscription {
  refs: number;
  subscription: WalSubscription;
}

const subscriptions = new Map<string, SharedExecutorWalSubscription>();

function subscriptionKey(config: ExecutorWalSubscriptionConfig): string {
  return [config.executor.id, config.label, config.dbPath, config.walPath].join(
    "\x00",
  );
}

function getSubscription(
  config: ExecutorWalSubscriptionConfig,
): [string, SharedExecutorWalSubscription] {
  const key = subscriptionKey(config);
  const existing = subscriptions.get(key);
  if (existing) return [key, existing];

  const subscription = createWalSubscription({
    dbPath: config.dbPath,
    walPath: config.walPath,
    label: config.label,
    watch: (target, onChange, opts) =>
      config.executor.watch(target, onChange, opts),
    identity: async (target) =>
      String(await config.executor.statMtimeMs(target)),
  });
  const entry = { refs: 0, subscription };
  subscriptions.set(key, entry);
  return [key, entry];
}

export function subscribeExecutorWal(
  config: ExecutorWalSubscriptionConfig,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const [key, entry] = getSubscription(config);
  entry.refs++;
  const unsubscribe = entry.subscription.subscribe(onChange, onError, log);
  return () => {
    unsubscribe();
    entry.refs--;
    if (entry.refs === 0) subscriptions.delete(key);
  };
}
