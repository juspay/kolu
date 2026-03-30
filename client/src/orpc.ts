/** oRPC + TanStack Query integration — type-safe queryOptions/mutationOptions/liveOptions from the oRPC client. */

import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { client } from "./rpc";

export const orpc = createTanstackQueryUtils(client);
