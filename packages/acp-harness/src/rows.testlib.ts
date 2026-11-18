/**
 * EVERY ROW THE HARNESS PUBLISHES IS DECODED — strictly — before a test reads
 * it.
 *
 * The transcript class is generic over a product's row union, and a generic
 * method that writes a field into `Row` can write one the product's SCHEMA does
 * not declare: the compiler cannot see it, the encoder drops it without a word,
 * and the failure surfaces far away — in a browser that never drew the card, as
 * fourteen e2e scenarios did once.
 *
 * So the suites that read published rows decode them with the schema the SERVER
 * uses, and with `onExcessProperty: "error"`, which is the half that catches a
 * field nobody declared. It is one helper rather than a call per test for
 * `says`' reason: the day a suite reads rows another way is the day it stops
 * checking.
 */

import { Schema } from "effect";
import { ConductorRowSchema } from "kolu-common/conductor";
import type { ConductorRow } from "./rows.ts";

/** Decode one published row the way the server will, refusing a field the
 *  contract does not declare. */
export const published = (row: unknown): ConductorRow =>
  Schema.decodeUnknownSync(ConductorRowSchema, {
    onExcessProperty: "error",
  })(row);
