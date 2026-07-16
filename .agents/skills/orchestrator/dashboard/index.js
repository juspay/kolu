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

const station = (n) => {
  const el = $(n.href ? "a" : "span", `station p-${n.state ?? "q"}`);
  if (n.href) el.href = n.href;
  if (n.title) el.title = n.title;
  el.appendChild($("span", "dot"));
  el.appendChild($("span", "slabel", n.label));
  return el;
};

const laneCard = (item) => {
  const head = headline(item.nodes);
  const card = $("div", `card s-${head.state ?? "q"}`);

  const hd = $("div", "card-head");
  const name = $("span", "lane-name");
  if (item.href) {
    const a = $("a", null, item.name);
    a.href = item.href;
    a.title = "jump to this lane's terminal in kolu";
    name.appendChild(a);
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
  item.nodes.forEach((n) => rail.appendChild(station(n)));
  card.appendChild(rail);
  return card;
};

const pill = (n) => {
  const el = $(n.href ? "a" : "span", `pill s-${n.state ?? "q"}`, n.label);
  if (n.href) el.href = n.href;
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

  const live = section("Live lanes");
  d.lanes.forEach((l, i) => {
    const c = laneCard(l);
    c.style.animationDelay = `${i * 70}ms`;
    live.appendChild(c);
  });

  const q = section("Merge queue · srid");
  const qp = $("div", "pills");
  if (d.queue.length === 0) qp.appendChild($("span", "empty", "— empty —"));
  d.queue.forEach((n) => qp.appendChild(pill(n)));
  q.appendChild(qp);

  const lin = section("Lineages");
  d.lineages.forEach((l, i) => {
    const c = laneCard(l);
    c.style.animationDelay = `${(d.lanes.length + i) * 70}ms`;
    lin.appendChild(c);
  });

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
