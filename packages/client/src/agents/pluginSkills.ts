import { splitFrontMatter } from "@kolu/solid-markdown/render";
import { parse as parseYaml } from "yaml";

export interface PluginSkill {
  readonly name: string;
  readonly blurb: string;
}

export function skillBlurb(description: string): string {
  const clause = description.split(/[:.]/, 1)[0]?.trim() ?? "";
  return clause.charAt(0).toLowerCase() + clause.slice(1);
}

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

const SOURCES = import.meta.glob<string>("../../../../skills/*/SKILL.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const PLUGIN_SKILLS: readonly [PluginSkill, ...PluginSkill[]] = (() => {
  const [first, ...rest] = Object.entries(SOURCES)
    .map(([path, source]) => parseSkill(path, source))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (first === undefined)
    throw new Error("skills: no SKILL.md found in this build");
  return [first, ...rest];
})();
