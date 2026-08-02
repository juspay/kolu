/**
 * @kolu/surface-map/testing — test-only support for the membership vocabulary.
 *
 * The one honest way for a FIXTURE to construct a branded {@link MembershipId}: a
 * `decodeMembershipId` behind a named helper, so a test never writes a bare
 * literal (an empty `""` or a fabricated id is a compile error at the typed API;
 * this is the sanctioned constructor that makes a valid one). Dependency-light
 * (the schema decode + `crypto` only), a labeled `./testing` subpath so its
 * test-only intent is explicit at every import site.
 */

import { decodeMembershipId, type MembershipId } from "./define";

/** Mint a branded {@link MembershipId} for a fixture. Pass a `seed` to make a
 *  stable, readable id (e.g. `testMembershipId("m1")`); omit it for a fresh uuid
 *  when only distinctness matters. */
export function testMembershipId(seed?: string): MembershipId {
  return decodeMembershipId(seed ?? crypto.randomUUID());
}
