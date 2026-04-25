/**
 * Re-export of `unwrap` from `anyagent` so higher-level kolu code
 * (client, server, common itself) can import it through the same
 * `kolu-common/*` namespace they use for the rest of the shared
 * surface. The implementation lives in `anyagent` because integration
 * packages need it too and `kolu-common` sits above them in the
 * workspace dep graph.
 */
export { unwrap } from "anyagent/unwrap";
