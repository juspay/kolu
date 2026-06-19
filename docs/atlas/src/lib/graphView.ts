import type { CollectionEntry } from "astro:content";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { AtlasGraph } from "./atlasGraph";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  type Category,
  titleCmp,
} from "./indexTree";

// Build-time force-directed layout for the unified Atlas entry point. This is a
// LEAF: it turns the already-derived edge set (lib/atlasGraph) into baked SVG
// geometry. It owns NO edge derivation — that stays the single source of truth
// upstream.
//
// The unification: the four `kind`s (bug/feature/analysis/reference) are NOT a
// separate hardcoded skeleton. They become synthetic HUB nodes in the graph, and
// every note gets an edge to its kind hub. Two payoffs:
//   - No orphans. Every note is now connected — to its kind hub at minimum — so
//     every note is reachable by traversal from a hub, and the graph is one piece.
//   - One MoC. The kind hubs are the biggest hubs (degree = notes of that kind);
//     their clusters are the complete per-kind listing, so the hub cards alone
//     let you reach every note with no JS.
//
// Determinism (load-bearing — ci::atlas-sync rebuilds under a scrambled TZ/locale
// on the same machine and fails on any dist/ byte change):
//   1. d3-force v3 has no Math.random — it seeds every force from a fixed LCG.
//   2. The only remaining hazard is input ORDER (float addition isn't
//      associative): we sort nodes by id and edges by pair-key, and seed ring
//      positions by the SORTED index, before touching the simulation.
//   3. We run a fixed tick count with .stop() and round every coordinate (-0→0).
// Every force constant and tick count is a literal here, so the layout is a pure
// function of the note set.

const RING_RADIUS = 300;
const TICKS = 340;
const NOTE_CHARGE = -210;
const KIND_CHARGE = -1500; // strong, so the four kind clusters spread apart
const REAL_LINK_DISTANCE = 46;
const KIND_LINK_DISTANCE = 78;
const REAL_LINK_STRENGTH = 0.7;
const KIND_LINK_STRENGTH = 0.16; // loose: notes orbit their kind, real links dominate
const GRAVITY = 0.035;
const PAD = 50;

// Topical hubs (cross-cutting entry points like `electricity`) are the notes the
// rest of the Atlas points at most — ranked by inbound degree (note→note only).
const TOPICAL_MIN_INBOUND = 2;
const TOPICAL_CAP = 6;

type Maturity = "seedling" | "budding" | "evergreen";

const KIND_NODE = (c: Category) => `@${c}`;
const KIND_ANCHOR = (c: Category) => `moc-${c}`;
const chipWidth = (label: string) => Math.round(label.length * 6.7 + 24);

interface SimNode extends SimulationNodeDatum {
  id: string;
  isKind: boolean;
  r: number;
  charge: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  rel: "parent" | "link" | "kind";
}

export interface GraphNode {
  id: string;
  label: string;
  kind: Category;
  isKind: boolean;
  href: string;
  maturity?: Maturity;
  isHub: boolean;
  x: number;
  y: number;
  r: number;
  chipW?: number;
  /** Space-joined, sorted ids of adjacent nodes — drives the 1-hop hover
   *  highlight. Sorted so it never churns the dist. */
  neighbors: string;
}

export interface GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rel: "parent" | "link" | "kind";
  a: string;
  b: string;
}

export interface ClusterMember {
  id: string;
  title: string;
  description: string;
  kind: Category;
  maturity: Maturity;
}

export interface HubCard {
  /** The node id this card mirrors (`@bug` or a note slug) — drives data-hub. */
  id: string;
  /** Section anchor for kind cards (`moc-bug`), so a kind node links here. */
  anchorId?: string;
  isKind: boolean;
  label: string;
  /** Topical cards link their title to the note; kind cards are a section. */
  href?: string;
  kind: Category;
  count: number;
  countLabel: string;
  description: string;
  cluster: ClusterMember[];
}

export interface GraphLayout {
  viewBox: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hubs: HubCard[];
}

const radiusOf = (degree: number) => 3.5 + Math.sqrt(degree) * 2.2;
const snap = (v: number) => Math.round(v) || 0; // -0 → 0
const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildGraphLayout(
  notes: CollectionEntry<"atlas">[],
  graph: AtlasGraph,
): GraphLayout {
  const { backlinks, edges } = graph;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const kindOf = (id: string) => byId.get(id)!.data.kind as Category;

  // ── nodes: notes + the four kind hubs ──────────────────────────────────
  const kindLabel = (c: Category) => CATEGORY_META[c].label;
  const kindIds = CATEGORY_ORDER.map(KIND_NODE);

  // ── edges: the real ones + a synthetic note→kind edge each (no orphans) ──
  const realEdges = edges.map((e) => ({
    a: e.source,
    b: e.target,
    rel: e.kind,
  }));
  const kindEdges = notes.map((n) => ({
    a: n.id,
    b: KIND_NODE(kindOf(n.id)),
    rel: "kind" as const,
  }));
  const allEdges = [...realEdges, ...kindEdges];

  // degree (drives radius) counts every incident edge incl. the kind edge.
  const degree = new Map<string, number>();
  const nbr = new Map<string, Set<string>>();
  const touch = (id: string) => {
    if (!nbr.has(id)) nbr.set(id, new Set());
  };
  for (const e of allEdges) {
    touch(e.a);
    touch(e.b);
    nbr.get(e.a)!.add(e.b);
    nbr.get(e.b)!.add(e.a);
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }

  // ── deterministic ordering ──────────────────────────────────────────────
  // ids are ASCII (`@bug`, slugs) so a plain sort is code-point order — total,
  // unique, locale-invariant. Kind ids (`@…`) sort ahead of slugs.
  const ids = [...notes.map((n) => n.id), ...kindIds].sort();
  const N = ids.length;
  const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const sortedEdges = [...allEdges].sort((x, y) => {
    const kx = pairKey(x.a, x.b);
    const ky = pairKey(y.a, y.b);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });

  // radius per node: notes by degree, kind hubs by chip width.
  const chipW = new Map(
    CATEGORY_ORDER.map((c) => [KIND_NODE(c), chipWidth(kindLabel(c))]),
  );
  const isKindId = (id: string) => id.startsWith("@");
  const rOf = (id: string) =>
    isKindId(id) ? chipW.get(id)! / 2 : radiusOf(degree.get(id) ?? 0);

  // ── seed ring by sorted index, run a fixed stopped sim ──────────────────
  const simNodes: SimNode[] = ids.map((id, i) => ({
    id,
    isKind: isKindId(id),
    r: rOf(id),
    charge: isKindId(id) ? KIND_CHARGE : NOTE_CHARGE,
    x: Math.cos((2 * Math.PI * i) / N) * RING_RADIUS,
    y: Math.sin((2 * Math.PI * i) / N) * RING_RADIUS,
  }));
  const simById = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = sortedEdges.map((e) => ({
    source: e.a,
    target: e.b,
    rel: e.rel,
  }));

  forceSimulation(simNodes)
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((d) => d.charge)
        .theta(0.9),
    )
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) =>
          l.rel === "kind" ? KIND_LINK_DISTANCE : REAL_LINK_DISTANCE,
        )
        .strength((l) =>
          l.rel === "kind" ? KIND_LINK_STRENGTH : REAL_LINK_STRENGTH,
        ),
    )
    .force("x", forceX(0).strength(GRAVITY))
    .force("y", forceY(0).strength(GRAVITY))
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => d.r + 6)
        .iterations(2),
    )
    .stop()
    .tick(TICKS);

  for (const n of simNodes) {
    n.x = snap(n.x ?? 0);
    n.y = snap(n.y ?? 0);
  }

  // ── topical hubs: top notes by real inbound degree ──────────────────────
  const inboundOf = (id: string) => backlinks.get(id)?.length ?? 0;
  const topical = [...notes.map((n) => n.id)]
    .sort((a, b) => inboundOf(b) - inboundOf(a) || (a < b ? -1 : a > b ? 1 : 0))
    .filter((id) => inboundOf(id) >= TOPICAL_MIN_INBOUND)
    .slice(0, TOPICAL_CAP);
  const topicalSet = new Set(topical);

  const neighborsStr = (id: string) =>
    [...(nbr.get(id) ?? [])].sort().join(" ");

  const noteNodes: GraphNode[] = notes
    .map((n) => n.id)
    .sort()
    .map((id) => {
      const d = byId.get(id)!.data;
      const sn = simById.get(id)!;
      return {
        id,
        label: id,
        kind: d.kind as Category,
        isKind: false,
        href: `./${id}.html`,
        maturity: d.maturity as Maturity,
        isHub: topicalSet.has(id),
        x: sn.x as number,
        y: sn.y as number,
        r: round1(radiusOf(degree.get(id) ?? 0)),
        neighbors: neighborsStr(id),
      };
    });

  const kindNodes: GraphNode[] = CATEGORY_ORDER.map((c) => {
    const id = KIND_NODE(c);
    const sn = simById.get(id)!;
    return {
      id,
      label: kindLabel(c),
      kind: c,
      isKind: true,
      href: `#${KIND_ANCHOR(c)}`,
      isHub: true,
      x: sn.x as number,
      y: sn.y as number,
      r: chipW.get(id)! / 2,
      chipW: chipW.get(id)!,
      neighbors: neighborsStr(id),
    };
  });
  const nodes = [...noteNodes, ...kindNodes];

  const graphEdges: GraphEdge[] = sortedEdges.map((e) => {
    const s = simById.get(e.a)!;
    const t = simById.get(e.b)!;
    return {
      x1: s.x as number,
      y1: s.y as number,
      x2: t.x as number,
      y2: t.y as number,
      rel: e.rel,
      a: e.a,
      b: e.b,
    };
  });

  // viewBox from the rounded bbox (+ padding), all integers.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  const vbX = Math.floor(minX - PAD);
  const vbY = Math.floor(minY - PAD);
  const viewBox = `${vbX} ${vbY} ${Math.ceil(maxX + PAD) - vbX} ${Math.ceil(maxY + PAD) - vbY}`;

  // ── hub cards: the four kind hubs (complete listings) + topical hubs ─────
  const member = (id: string): ClusterMember => {
    const d = byId.get(id)!.data;
    return {
      id,
      title: d.title,
      description: d.description,
      kind: d.kind as Category,
      maturity: d.maturity as Maturity,
    };
  };
  const byTitle = (a: ClusterMember, b: ClusterMember) =>
    titleCmp(a.title, b.title);

  const kindHubs: HubCard[] = CATEGORY_ORDER.map((c) => {
    const members = notes
      .filter((n) => (n.data.kind as Category) === c)
      .map((n) => member(n.id))
      .sort(byTitle);
    return {
      id: KIND_NODE(c),
      anchorId: KIND_ANCHOR(c),
      isKind: true,
      label: kindLabel(c),
      kind: c,
      count: members.length,
      countLabel: members.length === 1 ? "note" : "notes",
      description: CATEGORY_META[c].blurb,
      cluster: members,
    };
  }).filter((h) => h.count > 0);

  const topicalHubs: HubCard[] = topical.map((id) => {
    const d = byId.get(id)!.data;
    const members = (backlinks.get(id) ?? []).map((ref) => member(ref.id));
    return {
      id,
      isKind: false,
      label: d.title,
      href: `./${id}.html`,
      kind: d.kind as Category,
      count: members.length,
      countLabel: "referenced by",
      description: d.description,
      cluster: members,
    };
  });

  return {
    viewBox,
    nodes,
    edges: graphEdges,
    hubs: [...kindHubs, ...topicalHubs],
  };
}
