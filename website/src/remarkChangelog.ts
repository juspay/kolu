import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import {
  CHANGE_KINDS,
  type ChangeKind,
  type ChangelogStat,
  isChangeKind,
} from "./changelog";

interface AstroFileData {
  astro?: { frontmatter?: Record<string, unknown> };
}

interface MdxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

interface MdxElement {
  type: string;
  name?: string;
  attributes?: MdxAttribute[];
}

const changelogPrefix = (version: string) =>
  version === "Unreleased" ? "unreleased" : `v${version.replaceAll(".", "-")}`;

const changeKind = (node: MdxElement): ChangeKind | undefined => {
  if (
    (node.type !== "mdxJsxTextElement" && node.type !== "mdxJsxFlowElement") ||
    node.name !== "Change"
  )
    return undefined;

  const value = node.attributes?.find(
    (attribute) =>
      attribute.type === "mdxJsxAttribute" && attribute.name === "kind",
  )?.value;
  if (!isChangeKind(value))
    throw new Error(
      `<Change> requires a known string \`kind\`, received ${String(value)}`,
    );
  return value;
};

const typedStats = (tree: Root): ChangelogStat[] => {
  const counts = Object.fromEntries(
    CHANGE_KINDS.map(({ key }) => [key, 0]),
  ) as Record<ChangeKind, number>;

  visit(tree, (node) => {
    const kind = changeKind(node as MdxElement);
    if (kind) counts[kind] += 1;
  });

  return CHANGE_KINDS.map(({ key, label }) => ({
    key,
    label,
    count: counts[key],
  })).filter(({ count }) => count > 0);
};

const headingStats = (tree: Root): ChangelogStat[] => {
  const stats: ChangelogStat[] = [];
  const slugger = new GithubSlugger();
  let active: ChangelogStat | undefined;

  for (const node of tree.children) {
    if (node.type === "heading" && node.depth === 3) {
      const label = toString(node).trim();
      active = { label, key: slugger.slug(label), count: 0 };
      stats.push(active);
    } else if (node.type === "list" && active) {
      active.count += node.children.length;
    }
  }

  return stats;
};

/**
 * Give changelog headings release-scoped IDs during the MDX build, and expose
 * release totals from the same syntax tree. SSR HTML, Pagefind, and in-page
 * navigation therefore share one set of anchors and one parsed source of truth.
 */
export function remarkChangelog() {
  return (tree: Root, file: { data: AstroFileData }) => {
    const frontmatter = file.data.astro?.frontmatter;
    if (!frontmatter || typeof frontmatter.version !== "string") return;
    const version = frontmatter.version;

    const headingSlugger = new GithubSlugger();
    const prefix = changelogPrefix(version);
    visit(tree, "heading", (node) => {
      const id = `${prefix}-${headingSlugger.slug(toString(node))}`;
      node.data ??= {};
      node.data.hProperties = { ...node.data.hProperties, id };
    });

    const kinds = typedStats(tree);
    frontmatter.changelogStats = kinds.length > 0 ? kinds : headingStats(tree);
  };
}
