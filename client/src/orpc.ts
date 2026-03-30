/** oRPC + TanStack Query integration — type-safe queryOptions/mutationOptions from the oRPC client. */

import { createORPCSolidQueryUtils } from "@orpc/solid-query";
import { client } from "./rpc";

export const orpc = createORPCSolidQueryUtils(client);
