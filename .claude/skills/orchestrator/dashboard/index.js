// Renders window.BOARD into the board. The DATA lives in the downstream
// project's root as `orchestrator-data.js` (the only file a coordinator's
// state change edits); this shell+renderer are versioned skill assets, so the
// climb below is fixed by the skill's known depth (agents/.apm/skills/…/dashboard
// and the generated .claude/.agents copies sit at the SAME depth). Refresh =
// re-insert the data script with a cache-buster; fetch() is unavailable here
// because the Code-tab preview iframe is sandboxed (origin null, deliberate) —
// the browser normalizes the ../ climb before the request, so the preview
// route's wire-level traversal guard is never involved.
const DATA_SRC = "../../../../orchestrator-data.js";
const $ = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const pill = (n) => {
  const el = $(n.href ? "a" : "span", `n ${n.state ?? "q"}`, n.label);
  if (n.href) el.href = n.href;
  if (n.title) el.title = n.title;
  return el;
};

const flowRow = (item) => {
  const row = $("div", "flow");
  const lane = $("div", "lane");
  if (item.href) {
    const a = $("a", null, item.name);
    a.href = item.href;
    a.title = "jump to this lane's terminal in kolu";
    lane.appendChild(a);
  } else lane.appendChild(document.createTextNode(item.name));
  if (item.sub) lane.appendChild($("small", null, item.sub));
  row.appendChild(lane);
  item.nodes.forEach((n, i) => {
    if (i > 0) row.appendChild($("span", "arr", "→"));
    row.appendChild(pill(n));
  });
  return row;
};

function render(d) {
  const root = document.getElementById("root");
  root.replaceChildren();

  root.appendChild($("div", "meta",
    `${d.updated} · coordinator ${d.coordinator} · data reloads 30s · hover for detail`));

  const legend = $("div", "legend");
  for (const [cls, label] of [["done", "● done"], ["run", "● running"], ["wait", "● waiting on srid"], ["block", "● blocked"], ["q", "◌ queued"]]) {
    legend.appendChild($("span", `lg ${cls}`, label));
  }
  root.appendChild(legend);

  root.appendChild($("h2", null, "Live lanes"));
  d.lanes.forEach((l) => root.appendChild(flowRow(l)));

  root.appendChild($("h2", null, "Merge queue (srid)"));
  const q = $("div", "queue");
  d.queue.forEach((n, i) => {
    if (i > 0) q.appendChild($("span", "arr", "·"));
    q.appendChild(pill(n));
  });
  root.appendChild(q);

  root.appendChild($("h2", null, "Lineages"));
  d.lineages.forEach((l) => root.appendChild(flowRow(l)));

  root.appendChild($("h2", null, "Shipped today"));
  const arch = $("div", "archive");
  d.shipped.forEach((n) => arch.appendChild(pill({ ...n, state: "done" })));
  root.appendChild(arch);

  root.appendChild($("div", "strip", d.strip));
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
    const meta = document.querySelector(".meta");
    if (meta) meta.textContent = "orchestrator-data.js not found at the project root — retrying in 30s";
  };
  document.body.appendChild(s);
}

reloadData();
setInterval(reloadData, 30_000);
