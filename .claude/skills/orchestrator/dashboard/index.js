// Departure-board renderer for window.BOARD (from $PWD/orchestrator-data.js —
// see SKILL.md; the ../ climb is fixed by the skill's known depth and the
// browser normalizes it before the request, so the preview route's wire-level
// traversal guard is never involved). Each lane renders as a card with a
// PROGRESS RAIL of stations: filled ✓ = done, pulsing beacon = running,
// colored = waiting/blocked, hollow = queued. Narrow-first (Code-tab preview
// panel); detail lives in hover titles. Data refresh re-inserts the data
// script (fetch() is CORS-blocked in the sandboxed preview BY DESIGN);
// the entrance animation runs on first paint only, so the 30s reload never
// re-plays it.
const DATA_SRC = "../../../../orchestrator-data.js";

const $ = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

/** A lane's headline state: the station the eye should read first. */
const headline = (nodes) => {
  const pick =
    nodes.find((n) => n.state === "block") ??
    nodes.find((n) => n.state === "run") ??
    nodes.find((n) => n.state === "wait") ??
    (nodes.every((n) => n.state === "done") ? nodes[nodes.length - 1] : null);
  return pick ?? nodes.find((n) => (n.state ?? "q") === "q") ?? nodes[0];
};

/** Classify a link by where it goes, so its badge tells you before you click:
 *  ❯ = a terminal in kolu · ▤ = a file/note in the Code tab · ↗ = external. */
const linkKind = (href) => {
  if (!href) return null;
  const h = href.replace(/^https?:\/\/[^#]*#/, "#");
  if (h.startsWith("#/t/")) return h.includes("/code?") ? "note" : "term";
  if (h.startsWith("#/")) return "app";
  return "ext";
};
const ICON = { term: "❯", note: "▤", app: "◇", ext: "↗" };
const badge = (el, href) => {
  const k = linkKind(href);
  if (!k) return el;
  el.classList.add(`lk-${k}`);
  el.prepend($("span", "lkicon", ICON[k]));
  return el;
};

const station = (n) => {
  const el = $(n.href ? "a" : "span", `station p-${n.state ?? "q"}`);
  if (n.href) el.href = n.href;
  if (n.title) el.title = n.title;
  el.appendChild($("span", "dot"));
  const lbl = $("span", "slabel", n.label);
  if (n.href) badge(lbl, n.href);
  el.appendChild(lbl);
  return el;
};

/** A track card: the campaign's macro rail; any node carrying `lane`
 *  (a live agent working that step) expands IN PLACE — its detailed
 *  pipeline nests under the macro rail, visually tied to its station. */
const trackCard = (item) => {
  // headline: prefer the deepest live detail; else the macro rail's own
  const liveNode = item.nodes.find((n) => n.lane);
  const head = liveNode
    ? headline(liveNode.lane.nodes)
    : headline(item.nodes);
  const card = $("div", `card s-${head.state ?? "q"}`);

  const hd = $("div", "card-head");
  const name = $("span", "lane-name");
  if (item.href) {
    const a = $("a", null, item.name);
    a.href = item.href;
    a.title = "jump to this track's terminal in kolu";
    name.appendChild(badge(a, item.href));
  } else name.textContent = item.name;
  hd.appendChild(name);
  if (item.sub) hd.appendChild($("span", "lane-sub", item.sub));
  const now = $("span", `now s-${head.state ?? "q"}`);
  now.appendChild($("span", "caret", "▸ "));
  now.appendChild(document.createTextNode(head.label));
  if (head.title) now.title = head.title;
  hd.appendChild(now);
  card.appendChild(hd);

  const rail = $("div", "rail");
  item.nodes.forEach((n) => {
    const st = station(n);
    if (n.lane) st.classList.add("has-lane");
    rail.appendChild(st);
  });
  card.appendChild(rail);

  // nested live-lane detail under the macro rail
  item.nodes.forEach((n) => {
    if (!n.lane) return;
    const sub = $("div", "sub-lane");
    const shd = $("div", "sub-head");
    const t = $(n.lane.href ? "a" : "span", "sub-title", n.lane.name ?? n.label);
    if (n.lane.href) { t.href = n.lane.href; t.title = "jump to this agent's terminal"; badge(t, n.lane.href); }
    shd.appendChild(t);
    if (n.lane.sub) shd.appendChild($("span", "lane-sub", n.lane.sub));
    sub.appendChild(shd);
    const srail = $("div", "rail rail-sub");
    n.lane.nodes.forEach((x) => srail.appendChild(station(x)));
    sub.appendChild(srail);
    card.appendChild(sub);
  });
  return card;
};

const pill = (n) => {
  const el = $(n.href ? "a" : "span", `pill s-${n.state ?? "q"}`, n.label);
  if (n.href) { el.href = n.href; badge(el, n.href); }
  if (n.title) el.title = n.title;
  return el;
};

let painted = false;

function render(d) {
  const meta = document.getElementById("meta");
  meta.replaceChildren($("span", "live-dot"),
    $("span", null, `${d.project ? d.project + " · " : ""}${d.updated} · coordinator ${d.coordinator} · data reloads 30s · hover for detail`));

  const root = document.getElementById("root");
  root.replaceChildren();
  root.className = painted ? "" : "boot";

  const section = (title) => {
    const s = $("section");
    s.appendChild($("h2", null, title));
    root.appendChild(s);
    return s;
  };

  const tracks = section("Tracks");
  d.tracks.forEach((l, i) => {
    const c = trackCard(l);
    c.style.animationDelay = `${i * 70}ms`;
    tracks.appendChild(c);
  });

  const q = section("Merge queue · srid");
  const qp = $("div", "pills");
  if (d.queue.length === 0) qp.appendChild($("span", "empty", "— empty —"));
  d.queue.forEach((n) => qp.appendChild(pill(n)));
  q.appendChild(qp);

  const det = $("details", "shipped");
  det.appendChild($("summary", null, `Shipped today · ${d.shipped.length}`));
  const sp = $("div", "pills");
  d.shipped.forEach((n) => sp.appendChild(pill({ ...n, state: "done" })));
  det.appendChild(sp);
  root.appendChild(det);

  root.appendChild($("div", "strip", d.strip));
  painted = true;
}

window.addEventListener("board-data", () => render(window.BOARD));
if (window.BOARD) render(window.BOARD);

function reloadData() {
  const old = document.getElementById("board-data");
  if (old) old.remove();
  const s = document.createElement("script");
  s.id = "board-data";
  s.src = `${DATA_SRC}?t=${Date.now()}`;
  s.onerror = () => {
    const meta = document.getElementById("meta");
    if (meta) meta.replaceChildren(
      $("span", "live-dot"),
      $("span", null, "orchestrator-data.js not found at the project root — retrying in 30s"));
  };
  document.body.appendChild(s);
}

reloadData();
setInterval(reloadData, 30_000);
