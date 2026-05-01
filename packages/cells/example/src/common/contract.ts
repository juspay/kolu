/**
 * Re-export of the matrix-generated contract. All wire-shape definitions
 * live in `cells.ts` via `defineMatrix({...})` — this file exists only
 * so server (`implement(contract)`) and client
 * (`createCellsClient<typeof contract>`) imports remain stable.
 *
 * To compose with raw oRPC for non-descriptor RPCs (custom retry, binary
 * framing), spread `matrix.contract` alongside a sibling
 * `oc.router({...})` here.
 */

import { matrix } from "./cells";

export const contract = matrix.contract;
