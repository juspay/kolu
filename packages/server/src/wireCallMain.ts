/**
 * `kolu-rpc`'s entry point — argv in, one wire call out.
 *
 * A separate file from `wireCall.ts` for one reason: the module that RUNS on import
 * cannot be the module a test imports. Everything with logic in it (the argv parse,
 * the tag lookup, the ws URL derivation) lives next door and is unit-tested there;
 * this file is the two lines that make it a binary. `default.nix`'s `kolu-rpc`
 * wrapper points `tsx` here.
 */

import { runWireCall } from "./wireCall.ts";

await runWireCall(process.argv.slice(2));
