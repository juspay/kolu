import GithubSlugger from "github-slugger";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Nodes, Root } from "mdast";
import type {
  MdxJsxAttribute,
  MdxJsxFlowElement,
  MdxJsxTextElement,
} from "mdast-util-mdx-jsx";
import { visit } from "unist-util-visit";
import {
  CHANGE_KINDS,
  type ChangeKind,
  type ChangelogStat,
  changelogReleaseKey,
  isChangeKind,
} from "./changelog";

interface AstroFileData {
  astro?: { frontmatter?: Record<string, unknown> };
}

type MdxElement = MdxJsxFlowElement | MdxJsxTextElement;

const isChangeElement = (node: Nodes): node is MdxElement =>
  (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") &&
  node.name === "Change";

const changeKind = (node: Nodes): ChangeKind | undefined => {
  if (!isChangeElement(node)) return undefined;

  const kindAttribute = node.attributes.find(
    (attribute): attribute is MdxJsxAttribute =>
      attribute.type === "mdxJsxAttribute" && attribute.name === "kind",
  );
  const value = kindAttribute?.value;
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
    const kind = changeKind(node);
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
      const label = mdastToString(node).trim();
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
    const prefix = changelogReleaseKey(version);
    visit(tree, "heading", (node) => {
      const id = `${prefix}-${headingSlugger.slug(mdastToString(node))}`;
      node.data ??= {};
      node.data.hProperties = { ...node.data.hProperties, id };
    });

    const kinds = typedStats(tree);
    frontmatter.changelogStats = kinds.length > 0 ? kinds : headingStats(tree);
  };
}
