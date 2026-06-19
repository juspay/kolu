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

// Build-time force-directed layout for the Atlas graph view. This is a LEAF: it
// turns the already-derived edge set (lib/atlasGraph) into baked SVG geometry.
// It owns NO edge derivation — that stays the single source of truth upstream.
//
// Determinism (the load-bearing property — ci::atlas-sync rebuilds under a
// scrambled TZ/locale on the same machine and fails on any dist/ byte change):
//   1. d3-force v3 has no Math.random — it seeds every force from a fixed LCG,
//      so the simulation is already a pure function of its inputs.
//   2. The ONLY remaining hazard is input ORDER: getCollection() yields glob
//      order, and float addition isn't associative, so an unsorted node/edge
//      list would re-churn every coordinate when a note is added. We therefore
//      sort nodes by id and edges by pair-key, and seed ring positions by the
//      SORTED index, before touching the simulation.
//   3. We run a fixed tick count with .stop() (never the wall-clock .restart()
//      timer) and round every coordinate, normalizing -0 to 0.
// Every force constant and the tick count are literals here, so the layout is a
// pure function of the note set.

const RING_RADIUS = 280;
const TICKS = 320;
const CHARGE = -240;
const LINK_DISTANCE = 50;
const LINK_STRENGTH = 0.5;
const GRAVITY = 0.045;
const PAD = 48; // viewBox breathing room for labels around the bbox

/** Hubs (Maps of Content) are derived purely from inbound degree — how many
 *  notes point to a note via `parents`/prose links. Threshold + cap keep the set
 *  small and stable; a floor guarantees the page is never thin. */
const HUB_MIN_INBOUND = 2;
const HUB_CAP = 6;
const HUB_FLOOR = 5;

type Kind = "bug" | "feature" | "analysis" | "reference";
type Maturity = "seedling" | "budding" | "evergreen";

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: Kind;
  maturity: Maturity;
  status?: string;
  description: string;
  x: number;
  y: number;
  r: number;
  degree: number;
  inbound: number;
  isHub: boolean;
  /** Space-joined, sorted ids of adjacent notes — drives the 1-hop hover
   *  highlight in the client script. Sorted so it never churns the dist. */
  neighbors: string;
}

export interface GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "parent" | "link";
  a: string;
  b: string;
}

export interface ClusterMember {
  id: string;
  title: string;
  kind: Kind;
  maturity: Maturity;
}

export interface HubCard {
  id: string;
  title: string;
  kind: Kind;
  maturity: Maturity;
  description: string;
  inbound: number;
  degree: number;
  cluster: ClusterMember[];
}

export interface GraphLayout {
  viewBox: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  hubs: HubCard[];
}

const radiusOf = (degree: number) => 3.5 + Math.sqrt(degree) * 2.2;
// Math.round is deterministic on a fixed machine; `|| 0` collapses -0 → 0 so no
// "-0" token can ever appear in the baked SVG.
const snap = (v: number) => Math.round(v) || 0;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildGraphLayout(
  notes: CollectionEntry<"atlas">[],
  graph: AtlasGraph,
): GraphLayout {
  const { backlinks, edges, degree } = graph;
  const byId = new Map(notes.map((n) => [n.id, n]));

  // 1. Deterministic node order: slugs are ASCII [a-z0-9-], so a plain sort is
  //    code-point order — total, unique, and locale-invariant.
  const ids = notes.map((n) => n.id).sort();
  const N = ids.length;

  // 2. Deterministic edge order: sort by unordered pair key.
  const pairKey = (e: { source: string; target: string }) =>
    e.source < e.target ? `${e.source} ${e.target}` : `${e.target} ${e.source}`;
  const sortedEdges = [...edges].sort((a, b) => {
    const ka = pairKey(a);
    const kb = pairKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Undirected adjacency for the hover highlight.
  const nbr = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of sortedEdges) {
    nbr.get(e.source)?.add(e.target);
    nbr.get(e.target)?.add(e.source);
  }

  // 3. Seed ring positions by SORTED index, then run a fixed, stopped sim.
  const simNodes: SimNode[] = ids.map((id, i) => ({
    id,
    x: Math.cos((2 * Math.PI * i) / N) * RING_RADIUS,
    y: Math.sin((2 * Math.PI * i) / N) * RING_RADIUS,
  }));
  const simById = new Map(simNodes.map((n) => [n.id, n]));
  const simLinks: SimulationLinkDatum<SimNode>[] = sortedEdges.map((e) => ({
    source: e.source,
    target: e.target,
  }));

  forceSimulation(simNodes)
    .force("charge", forceManyBody().strength(CHARGE).theta(0.9))
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance(LINK_DISTANCE)
        .strength(LINK_STRENGTH),
    )
    .force("x", forceX(0).strength(GRAVITY))
    .force("y", forceY(0).strength(GRAVITY))
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => radiusOf(degree.get(d.id) ?? 0) + 7)
        .iterations(2),
    )
    .stop()
    .tick(TICKS);

  for (const n of simNodes) {
    n.x = snap(n.x ?? 0);
    n.y = snap(n.y ?? 0);
  }

  // Hub ranking — inbound degree desc, then id for a stable tiebreak.
  const inboundOf = (id: string) => backlinks.get(id)?.length ?? 0;
  const ranked = [...ids].sort(
    (a, b) => inboundOf(b) - inboundOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  let hubIds = ranked.filter((id) => inboundOf(id) >= HUB_MIN_INBOUND);
  if (hubIds.length < HUB_FLOOR) hubIds = ranked.slice(0, HUB_FLOOR);
  hubIds = hubIds.slice(0, HUB_CAP);
  const hubSet = new Set(hubIds);

  const nodes: GraphNode[] = ids.map((id) => {
    const d = byId.get(id)!.data;
    const sn = simById.get(id)!;
    return {
      id,
      title: d.title,
      kind: d.kind as Kind,
      maturity: d.maturity as Maturity,
      status: d.status,
      description: d.description,
      x: sn.x as number,
      y: sn.y as number,
      r: round1(radiusOf(degree.get(id) ?? 0)),
      degree: degree.get(id) ?? 0,
      inbound: inboundOf(id),
      isHub: hubSet.has(id),
      neighbors: [...nbr.get(id)!].sort().join(" "),
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
      kind: e.kind,
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
  const vbW = Math.ceil(maxX + PAD) - vbX;
  const vbH = Math.ceil(maxY + PAD) - vbY;

  const hubs: HubCard[] = hubIds.map((id) => {
    const d = byId.get(id)!.data;
    const cluster: ClusterMember[] = (backlinks.get(id) ?? []).map((ref) => {
      const cd = byId.get(ref.id)!.data;
      return {
        id: ref.id,
        title: ref.title,
        kind: cd.kind as Kind,
        maturity: cd.maturity as Maturity,
      };
    });
    return {
      id,
      title: d.title,
      kind: d.kind as Kind,
      maturity: d.maturity as Maturity,
      description: d.description,
      inbound: inboundOf(id),
      degree: degree.get(id) ?? 0,
      cluster,
    };
  });

  return {
    viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
    nodes,
    edges: graphEdges,
    hubs,
  };
}
