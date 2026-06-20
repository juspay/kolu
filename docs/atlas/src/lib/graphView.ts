import type { CollectionEntry } from "astro:content";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { AtlasGraph } from "./atlasGraph";
import { resolveParents, titleCmp } from "./indexTree";

// Build-time force-directed layout for the unified Atlas entry point. This is a
// LEAF: it turns the already-derived edge set (lib/atlasGraph) into baked SVG
// geometry. It owns NO edge derivation — that stays the single source of truth
// upstream.
//
// The data model is decomplected: a "category" is NOT a hardcoded enum or a
// synthetic node. It is a real note marked `moc: true` (an index / Map-of-Content
// node), and a note is filed under it through the ONE edge mechanism — `parents`.
// So this file fabricates nothing: nodes are the notes, edges are the real
// parent/prose edges atlasGraph already returns. An index note just renders large
// and seeds its own card. Add a fifth category by writing a fifth `moc` note.
//
// Determinism (load-bearing — ci::atlas-sync rebuilds under a scrambled TZ/locale
// on the same machine and fails on any dist/ byte change): d3-force v3 has no
// Math.random; the only hazard is input ORDER (float addition isn't associative),
// so we sort nodes by id and edges by pair-key, seed ring positions by that
// stable index, run a fixed tick count with .stop(), and round every coordinate.

const RING_RADIUS = 300;
const TICKS = 340;
const NOTE_CHARGE = -210;
const MOC_CHARGE = -1500; // strong, so the index clusters spread apart
const EDGE_DISTANCE = 46;
const MOC_DISTANCE = 78; // a note orbits its index at arm's length
const EDGE_STRENGTH = 0.7;
const MOC_STRENGTH = 0.16; // loose: the topical links dominate placement
const PAD = 50;

const TOPICAL_MIN_INBOUND = 2;
const TOPICAL_CAP = 6;

type Maturity = "seedling" | "budding" | "evergreen";

const chipWidth = (label: string) => Math.round(label.length * 6.7 + 24);

interface SimNode extends SimulationNodeDatum {
  id: string;
  isMoc: boolean;
  r: number;
  charge: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
  toMoc: boolean;
}

export interface GraphNode {
  id: string;
  /** Display label: the slug for notes, the title for index notes. */
  label: string;
  /** Full note title — drives the hover tooltip and the title search. */
  title: string;
  /** Accent token (e.g. "red"/"teal"); a note inherits its index's accent. */
  color: string;
  isMoc: boolean;
  href: string;
  maturity?: Maturity;
  isHub: boolean;
  x: number;
  y: number;
  r: number;
  chipW?: number;
  neighbors: string;
}

export interface GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rel: "parent" | "link";
  /** Either endpoint is an index note → drawn faint (membership spoke). */
  toMoc: boolean;
  a: string;
  b: string;
}

export interface ClusterMember {
  id: string;
  title: string;
  description: string;
  maturity: Maturity;
}

export interface HubCard {
  /** The node id this card mirrors — drives data-hub. */
  id: string;
  isMoc: boolean;
  label: string;
  href: string;
  color: string;
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
  const { backlinks, edges, degree } = graph;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const isMoc = (id: string) => byId.get(id)?.data.moc === true;

  // A note's accent = its own (if it's an index) or its first index parent's.
  const colorOf = (id: string): string => {
    const d = byId.get(id)!.data;
    if (d.moc) return d.color ?? "grey";
    for (const pid of resolveParents(byId, byId.get(id)!)) {
      const pd = byId.get(pid)?.data;
      if (pd?.moc) return pd.color ?? "grey";
    }
    return "grey";
  };

  // ── deterministic ordering ──────────────────────────────────────────────
  const ids = notes.map((n) => n.id).sort();
  const N = ids.length;
  const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  const sortedEdges = [...edges].sort((x, y) => {
    const kx = pairKey(x.source, x.target);
    const ky = pairKey(y.source, y.target);
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });

  const nbr = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of sortedEdges) {
    nbr.get(e.source)?.add(e.target);
    nbr.get(e.target)?.add(e.source);
  }
  const neighborsStr = (id: string) =>
    [...(nbr.get(id) ?? [])].sort().join(" ");

  // radius: index notes by chip width, notes by degree.
  const chipW = new Map(
    ids.filter(isMoc).map((id) => [id, chipWidth(byId.get(id)!.data.title)]),
  );
  const rOf = (id: string) =>
    isMoc(id) ? chipW.get(id)! / 2 : radiusOf(degree.get(id) ?? 0);

  // ── seed ring by sorted index, run a fixed stopped sim ──────────────────
  const simNodes: SimNode[] = ids.map((id, i) => ({
    id,
    isMoc: isMoc(id),
    r: rOf(id),
    charge: isMoc(id) ? MOC_CHARGE : NOTE_CHARGE,
    x: Math.cos((2 * Math.PI * i) / N) * RING_RADIUS,
    y: Math.sin((2 * Math.PI * i) / N) * RING_RADIUS,
  }));
  const simById = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimLink[] = sortedEdges.map((e) => ({
    source: e.source,
    target: e.target,
    toMoc: isMoc(e.source) || isMoc(e.target),
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
        .distance((l) => (l.toMoc ? MOC_DISTANCE : EDGE_DISTANCE))
        .strength((l) => (l.toMoc ? MOC_STRENGTH : EDGE_STRENGTH)),
    )
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

  // topical hubs: the most-referenced NON-index notes.
  const inboundOf = (id: string) => backlinks.get(id)?.length ?? 0;
  const topical = ids
    .filter((id) => !isMoc(id))
    .sort((a, b) => inboundOf(b) - inboundOf(a) || (a < b ? -1 : a > b ? 1 : 0))
    .filter((id) => inboundOf(id) >= TOPICAL_MIN_INBOUND)
    .slice(0, TOPICAL_CAP);
  const topicalSet = new Set(topical);

  const nodes: GraphNode[] = ids.map((id) => {
    const d = byId.get(id)!.data;
    const sn = simById.get(id)!;
    return {
      id,
      label: d.moc ? d.title : id,
      title: d.title,
      color: colorOf(id),
      isMoc: !!d.moc,
      href: `./${id}.html`,
      maturity: d.moc ? undefined : (d.maturity as Maturity),
      isHub: topicalSet.has(id),
      x: sn.x as number,
      y: sn.y as number,
      r: d.moc ? chipW.get(id)! / 2 : round1(radiusOf(degree.get(id) ?? 0)),
      chipW: d.moc ? chipW.get(id) : undefined,
      neighbors: neighborsStr(id),
    };
  });

  const graphEdges: GraphEdge[] = sortedEdges.map((e) => {
    const s = simById.get(e.source)!;
    const t = simById.get(e.target)!;
    return {
      x1: s.x as number,
      y1: s.y as number,
      x2: t.x as number,
      y2: t.y as number,
      rel: e.kind,
      toMoc: isMoc(e.source) || isMoc(e.target),
      a: e.source,
      b: e.target,
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

  // ── hub cards: the index notes (ordered) + the topical hubs ──────────────
  const member = (id: string): ClusterMember => {
    const d = byId.get(id)!.data;
    return {
      id,
      title: d.title,
      description: d.description,
      maturity: d.maturity as Maturity,
    };
  };
  const byTitle = (a: ClusterMember, b: ClusterMember) =>
    titleCmp(a.title, b.title);

  const mocCards: HubCard[] = ids
    .filter(isMoc)
    .sort((a, b) => {
      const oa = byId.get(a)!.data.order ?? Number.POSITIVE_INFINITY;
      const ob = byId.get(b)!.data.order ?? Number.POSITIVE_INFINITY;
      return (
        oa - ob || titleCmp(byId.get(a)!.data.title, byId.get(b)!.data.title)
      );
    })
    .map((id) => {
      const d = byId.get(id)!.data;
      const cluster = (backlinks.get(id) ?? [])
        .map((ref) => member(ref.id))
        .sort(byTitle);
      return {
        id,
        isMoc: true,
        label: d.title,
        href: `./${id}.html`,
        color: d.color ?? "grey",
        count: cluster.length,
        countLabel: cluster.length === 1 ? "note" : "notes",
        description: d.description,
        cluster,
      };
    });

  // Only the explicit `moc: true` notes get a card below the graph. Topical
  // hubs (electricity, …) are still emphasized AS NODES (always-on label) via the
  // `isHub` flag, but the Maps of Content are exactly the index notes.
  return { viewBox, nodes, edges: graphEdges, hubs: mocCards };
}
