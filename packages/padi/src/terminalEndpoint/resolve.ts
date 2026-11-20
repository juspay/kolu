import type { HostLocation } from "@kolu/padi-client/surface";
import { match } from "ts-pattern";
import type { TerminalEndpoint } from "../endpoint.ts";
import { localTerminalEndpoint } from "./local.ts";

export class RemoteEndpointUnavailable extends Error {
  readonly hostId: string;

  constructor(hostId: string) {
    super(
      `no terminal endpoint for remote host "${hostId}" — remote dialing lands in R9.2`,
    );
    this.name = "RemoteEndpointUnavailable";
    this.hostId = hostId;
  }
}

export function resolveTerminalEndpoint(
  location: HostLocation,
): TerminalEndpoint {
  return match(location)
    .with({ kind: "local" }, () => localTerminalEndpoint)
    .with({ kind: "remote" }, ({ hostId }): never => {
      throw new RemoteEndpointUnavailable(hostId);
    })
    .exhaustive();
}
