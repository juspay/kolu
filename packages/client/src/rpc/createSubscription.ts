/**
 * Re-export from `@kolu/cells/solid`. The leaf primitive moved into the
 * cells framework so server-pushed reactive state has one canonical
 * implementation; this shim keeps existing call sites unchanged while
 * the in-flight migrations from `createSubscription` to `useCell` /
 * `useCollection` / `useStream` proceed.
 */
export {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "@kolu/cells/solid";
