/** The skills kolu's own agent plugin declares — read from each
 *  `agent-plugin/skills/<name>/SKILL.md` at BUILD time. The plugin is kolu's own
 *  source and ships in the same build that loads it into every agent, so the
 *  build is the source of truth: no wire, no runtime read.
 *
 *  A tile tip names one of these at an agent's first prompt (`terminalTip.ts`). */

import { splitFrontMatter } from "@kolu/solid-markdown/render";
import { parse as parseYaml } from "yaml";

export interface PluginSkill {
  /** The skill's `name` — what a harness invokes (`/kolu` in Claude Code). */
  readonly name: string;
  /** The first clause of its `description`, lower-cased for mid-sentence use:
   *  "drive one AI agent from another through kolu's terminals". */
  readonly blurb: string;
}

/** The first clause of a description — up to the first `:` or `.` — with its
 *  first letter lower-cased so it reads after a dash. */
export function skillBlurb(description: string): string {
  const clause = description.split(/[:.]/, 1)[0]?.trim() ?? "";
  return clause.charAt(0).toLowerCase() + clause.slice(1);
}

/** Parse one SKILL.md. Throws on a file without a `name` and `description` —
 *  kolu's own plugin is malformed, which is a build defect, not a quiet case. */
export function parseSkill(path: string, source: string): PluginSkill {
  const block = splitFrontMatter(source).yaml;
  if (block === null) throw new Error(`${path}: no front matter`);
  const meta: unknown = parseYaml(block);
  const name = (meta as { name?: unknown } | null)?.name;
  const description = (meta as { description?: unknown } | null)?.description;
  if (typeof name !== "string" || name === "")
    throw new Error(`${path}: front matter has no name`);
  if (typeof description !== "string" || description === "")
    throw new Error(`${path}: front matter has no description`);
  return { name, blurb: skillBlurb(description) };
}

const SOURCES = import.meta.glob<string>(
  "../../../../agent-plugin/skills/*/SKILL.md",
  { query: "?raw", import: "default", eager: true },
);

/** Every skill the plugin declares, sorted by name. Never empty: kolu ships the
 *  `kolu` skill, so finding none means the build lost the plugin directory —
 *  fail loudly here rather than leave the tip silently without a skill. */
export const PLUGIN_SKILLS: readonly PluginSkill[] = (() => {
  const skills = Object.entries(SOURCES)
    .map(([path, source]) => parseSkill(path, source))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (skills.length === 0)
    throw new Error("agent-plugin/skills: no SKILL.md found in this build");
  return skills;
})();
