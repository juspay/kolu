import type { SurfaceCallFailure } from "@kolu/surface/client";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { Effect } from "effect";
import type {
  HostRef,
  ROOT_RPC_TAGS,
  ServerBackupsList,
  ServerBackupsRestore,
  ServerBackupsRestoreResult,
  ServerInfo,
  ViewerHost,
} from "kolu-common/contract";

type RootRpcTag = (typeof ROOT_RPC_TAGS)[number];

export type RootEffect<O> = Effect.Effect<O, SurfaceCallFailure>;

export interface RootProcedures {
  readonly server: {
    readonly info: () => RootEffect<ServerInfo>;
    readonly backups: {
      readonly list: () => RootEffect<ServerBackupsList>;
      readonly restore: (
        input: ServerBackupsRestore,
      ) => RootEffect<ServerBackupsRestoreResult>;
    };
  };
  readonly daemon: {
    readonly restart: () => RootEffect<void>;
  };
  readonly hosts: {
    readonly viewer: () => RootEffect<ViewerHost>;
    readonly add: (input: HostRef) => RootEffect<void>;
    readonly remove: (input: HostRef) => RootEffect<void>;
    readonly reconnect: (input: HostRef) => RootEffect<void>;
    readonly renewDaemon: (input: HostRef) => RootEffect<void>;
  };
}

function unary<I, O>(
  dispatch: SurfaceDispatch,
  tag: RootRpcTag,
): (input: I) => RootEffect<O> {
  return (input) => dispatch.unary(tag, input) as RootEffect<O>;
}

export function rootProcedures(dispatch: SurfaceDispatch): RootProcedures {
  const voidPayload = <O>(tag: RootRpcTag): (() => RootEffect<O>) => {
    const call = unary<undefined, O>(dispatch, tag);
    return () => call(undefined);
  };
  return {
    server: {
      info: voidPayload<ServerInfo>("server/info"),
      backups: {
        list: voidPayload<ServerBackupsList>("server/backups/list"),
        restore: unary<ServerBackupsRestore, ServerBackupsRestoreResult>(
          dispatch,
          "server/backups/restore",
        ),
      },
    },
    daemon: { restart: voidPayload<void>("daemon/restart") },
    hosts: {
      viewer: voidPayload<ViewerHost>("hosts/viewer"),
      add: unary<HostRef, void>(dispatch, "hosts/add"),
      remove: unary<HostRef, void>(dispatch, "hosts/remove"),
      reconnect: unary<HostRef, void>(dispatch, "hosts/reconnect"),
      renewDaemon: unary<HostRef, void>(dispatch, "hosts/renewDaemon"),
    },
  };
}
