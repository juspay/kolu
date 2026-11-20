import type { TerminalId } from "kolu-common/surface";

export type TileId = TerminalId;

export type TileContent = { kind: "terminal"; terminalId: TerminalId };
