import { hostname } from "node:os";
import { surfaceProcessId } from "@kolu/surface/identity";
import pkg from "../package.json" with { type: "json" };

export const serverHostname = hostname();

export const serverProcessId = surfaceProcessId();

export const serverStartedAt = Date.now();

export const serverCommit = process.env.KOLU_COMMIT_HASH ?? "";

export const serverVersion = pkg.version;
