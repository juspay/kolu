/** TanStack Query + oRPC integration — shared QueryClient and typed utils. */

import { QueryClient } from "@tanstack/solid-query";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { client } from "./rpc";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Server state is authoritative — don't refetch on window focus
      refetchOnWindowFocus: false,
      // Streaming queries stay connected; one-shot queries rarely go stale
      staleTime: Infinity,
    },
  },
});

export const orpc = createTanstackQueryUtils(client);
