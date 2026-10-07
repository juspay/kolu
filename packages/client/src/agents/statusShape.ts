/**
 * `@kolu/agent-distro` words the status and setting through STRUCTURAL types
 * (it imports nothing from padi), while the wire schemas live in
 * `@kolu/padi-client`'s surface. The client is where both meet, so it pins here,
 * at compile time, that they are the same shape in both directions: a field
 * added to the wire union without the wording learning it (or the reverse) is a
 * type error, not a silently missing line.
 */

import type {
  AgentDistroSettingShape,
  AgentDistroStatusShape,
} from "@kolu/agent-distro/status";
import type {
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/padi-client/surface";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const statusShapeAgrees: Same<
  AgentDistroStatus,
  AgentDistroStatusShape
> = true;
export const settingShapeAgrees: Same<
  AgentDistroSetting,
  AgentDistroSettingShape
> = true;
