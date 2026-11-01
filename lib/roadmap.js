"use strict";
// Roadmap: stage columns × domain lanes with the most important concepts of each cell as readable tiles.
// Hovering a tile traces its full prerequisite / unlock lineage across the whole map.
(function (global) {
  const COLORS = global.TechTree?.DOMAIN_COLORS ?? {};
  const UP = "#ff9f45", DOWN = "#9f86e3", EDGE = "#6b5a4c";
  const DENSITY = [[3, "3"], [6, "6"], [Infinity, "all"]];
  const LAYERS = [["", "all"], ["scientific", "sci"], ["speculative", "spec"]];
  let perCell = 3, layerFilter = "";
  const expanded = new Set();

  const esc = s => String(s ?? "").replace(/[&<>"']/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

  const CSS = `
    .rm-root { flex:1; display:flex; flex-direction:column; min-height:0; min-width:0; gap:8px; }
    .rm-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; font-size:12px; color:var(--muted); }
    .rm-controls { display:flex; gap:10px; align-items:center; }
    .rm-seg { display:inline-flex; padding:2px; gap:2px; background:var(--surface); border-radius:7px; align-items:center; }
    .rm-seg .lbl { padding:0 6px; text-transform:uppercase; letter-spacing:.06em; font-size:10.5px; }
    .rm-seg button { background:transparent; border:none; color:var(--muted); border-radius:5px; font-size:11.5px; padding:2px 10px; cursor:pointer; }
    .rm-seg button:hover { color:var(--text); }
    .rm-seg button.on { background:var(--elevated); color:var(--text); }
    .rm-scroll { flex:1; min-height:0; overflow:auto; background:#000; border:1px solid var(--border); border-radius:10px; }
    .rm-grid { position:relative; isolation:isolate; display:grid; }
    .rm-edges { position:absolute; inset:0; width:100%; height:100%; z-index:1; pointer-events:none; overflow:visible; }
    .rm-corner, .rm-stage, .rm-lane { background:#0b0b0b; }
    .rm-corner { position:sticky; top:0; left:0; z-index:5; }
    .rm-stage { position:sticky; top:0; z-index:4; padding:8px 10px; border-bottom:1px solid var(--border); }
    .rm-stage b { display:block; color:var(--lc-gold); font-size:13px; text-transform:uppercase; letter-spacing:.06em; }
    .rm-stage small { color:var(--muted); font-size:10.5px; }
    .rm-lane { position:sticky; left:0; z-index:3; padding:8px 10px; color:var(--c); font-size:12px; text-transform:uppercase; letter-spacing:.06em; border-right:1px solid var(--border); }
    .rm-lane small { display:block; color:var(--muted); font-size:10.5px; text-transform:none; letter-spacing:0; }
    .rm-cell { padding:6px 8px; display:flex; flex-direction:column; gap:4px; min-height:40px; min-width:0; border-left:1px solid #1a1a1a; }
    .rm-cell.rm-band { background:#0c0c10; }
    .rm-tile { position:relative; z-index:2; display:flex; align-items:center; gap:6px; width:100%; height:26px; padding:0 8px; border:1px solid #2a2a2a; border-left:3px solid var(--c); border-radius:6px; background:var(--surface); color:var(--text); font-size:12px; text-align:left; cursor:pointer; transition:opacity .12s, background .12s; }
    .rm-tile:hover, .rm-tile:focus-visible { background:var(--elevated); outline:none; }
    .rm-tile.spec { border-style:dashed; border-left-style:solid; font-style:italic; }
    .rm-tile .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .rm-tile .fl { color:var(--muted); font-size:11px; font-style:normal; }
    .rm-tile.major .nm { font-weight:600; }
    .rm-more { align-self:flex-start; background:none; border:none; color:var(--muted); font-size:11px; cursor:pointer; padding:0 2px; }
    .rm-more:hover { color:var(--text); }
    .rm-more.hot { color:var(--lc-gold); font-weight:600; }
    .rm-cov { height:3px; border-radius:2px; background:var(--spec); margin-top:auto; opacity:.7; }
    .rm-cov i { display:block; height:100%; border-radius:2px; background:var(--lc-orange); }
    .rm-cov.gap i { background:var(--c-rust); opacity:.4; }
    .rm-tracing .rm-tile { opacity:.22; }
    .rm-tracing .rm-tile.focus, .rm-tracing .rm-tile.up, .rm-tracing .rm-tile.down { opacity:1; }
    .rm-tile.focus { box-shadow:0 0 0 2px var(--lc-gold); }
    .rm-tile.up { box-shadow:0 0 0 1px ${UP}; }
    .rm-tile.down { box-shadow:0 0 0 1px ${DOWN}; }
    .rm-legend { font-size:11.5px; color:var(--muted); display:flex; flex-wrap:wrap; gap:14px; }
    .rm-legend b { font-weight:600; }`;

  function injectCss() {
    if (document.getElementById("rm-style")) return;
    const s = document.createElement("style");
    s.id = "rm-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function render(container, data, opts = {}) {
    injectCss();
    container._rm = {data, opts};
    const {columns, lanes} = data.layout;
    const nodes = data.nodes.filter(n => !layerFilter || n.layer === layerFilter);
    const ids = new Set(nodes.map(n => n.id));
    const key = (s, d) => `${s}|${d}`;
    const cells = new Map();
    for (const n of nodes) (cells.get(key(n.stage, n.domain)) || cells.set(key(n.stage, n.domain), []).get(key(n.stage, n.domain))).push(n);
    for (const list of cells.values()) list.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.name.localeCompare(b.name));
    const activeLanes = lanes.filter(l => columns.some(c => cells.has(key(c.stage, l.domain))));

    const fwd = {}, back = {};
    for (const e of data.edges) {
      if (e.type !== "enables" || !ids.has(e.source_id) || !ids.has(e.target_id)) continue;
      (fwd[e.source_id] ||= []).push(e.target_id);
      (back[e.target_id] ||= []).push(e.source_id);
    }

    const visible = new Set(), hiddenIn = new Map();
    const tile = n => {
      visible.add(n.id);
      const fl = (n.is_barrier ? "⚠" : "") + (n.is_choice ? "⑂" : "") + (n.is_enabler ? "→" : "");
      return `<button class="rm-tile${n.layer === "speculative" ? " spec" : ""}${n.importance === "major" ? " major" : ""}"
        data-id="${n.id}" style="--c:${COLORS[n.domain] ?? "#888"}"
        title="${esc(n.name)} · ${esc(n.layer)} · ${esc(n.maturity)}"><span class="nm">${esc(n.name)}</span>${fl ? `<span class="fl">${fl}</span>` : ""}</button>`;
    };
    const cell = (c, l, band) => {
      const k = key(c.stage, l.domain), list = cells.get(k) || [];
      if (!list.length) return `<div class="rm-cell${band ? " rm-band" : ""}"></div>`;
      const open = expanded.has(k), shown = open ? list : list.slice(0, perCell);
      list.slice(shown.length).forEach(n => hiddenIn.set(n.id, k));
      const more = list.length > perCell
        ? `<button class="rm-more" data-key="${esc(k)}" data-base="${open ? "less" : `+${list.length - shown.length} more`}">${open ? "less" : `+${list.length - shown.length} more`}</button>` : "";
      const sci = list.filter(n => n.layer === "scientific").length, spec = list.length - sci;
      const cov = layerFilter ? "" : `<div class="rm-cov${spec ? "" : " gap"}" title="${sci} scientific · ${spec} speculative${spec ? "" : " — no fiction covers this yet"}"><i style="width:${100 * sci / list.length}%"></i></div>`;
      return `<div class="rm-cell${band ? " rm-band" : ""}">${shown.map(tile).join("")}${more}${cov}</div>`;
    };

    const stageCount = s => nodes.filter(n => n.stage === s).length;
    const laneCount = d => nodes.filter(n => n.domain === d).length;
    const seg = (label, items, cur, attr) => `<span class="rm-seg"><span class="lbl">${label}</span>${
      items.map(([v, t]) => `<button data-${attr}="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;

    container.innerHTML = `<div class="rm-root">
      <div class="rm-head">
        <span>${nodes.length} concepts · hover a tile to trace what it needs and what it unlocks · click to open</span>
        <span class="rm-controls">${seg("Layer", LAYERS, layerFilter, "layer")}${seg("Per cell", DENSITY, perCell, "density")}</span>
      </div>
      <div class="rm-scroll"><div class="rm-grid" style="width:max(100%, ${130 + 200 * columns.length}px); grid-template-columns:130px repeat(${columns.length}, minmax(0, 1fr))">
        <div class="rm-corner"></div>
        ${columns.map(c => `<div class="rm-stage"><b>${esc(c.label)}</b><small>${esc(c.stage)} · ${stageCount(c.stage)}</small></div>`).join("")}
        ${activeLanes.map((l, i) => `<div class="rm-lane" style="--c:${COLORS[l.domain] ?? "#aaa"}">${esc(l.domain)}<small>${laneCount(l.domain)} concepts</small></div>${
          columns.map(c => cell(c, l, i % 2)).join("")}`).join("")}
        <svg class="rm-edges"><defs>${[["e", EDGE], ["up", UP], ["down", DOWN]].map(([k, c]) =>
          `<marker id="rm-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("")}</defs><g></g></svg>
      </div></div>
      <div class="rm-legend">
        <span><b style="color:${UP}">orange</b> needs</span><span><b style="color:${DOWN}">violet</b> unlocks</span>
        <span><i>dashed italic</i> = speculative</span><span>⚠ barrier · ⑂ choice · → enabler</span>
        <span>cell bar: <b style="color:var(--lc-orange)">scientific</b> vs <b style="color:var(--spec)">speculative</b>; dim bar = no fiction coverage</span>
      </div></div>`;

    const grid = container.querySelector(".rm-grid"), g = grid.querySelector(".rm-edges g");
    const tiles = new Map([...grid.querySelectorAll(".rm-tile")].map(el => [+el.dataset.id, el]));
    const walk = (adj, start) => {
      const seen = new Set([start]), q = [start];
      for (let i = 0; i < q.length; i++) for (const m of adj[q[i]] || []) if (!seen.has(m)) { seen.add(m); q.push(m); }
      seen.delete(start);
      return seen;
    };

    let trace = null, raf = 0;
    const draw = () => {
      const gr = grid.getBoundingClientRect(), box = new Map();
      const rect = id => box.get(id) ?? box.set(id, (() => {
        const r = tiles.get(id).getBoundingClientRect();
        return {l: r.left - gr.left, r: r.right - gr.left, y: r.top - gr.top + r.height / 2};
      })()).get(id);
      const paths = [];
      for (const s of visible) for (const t of fwd[s] || []) {
        if (!visible.has(t)) continue;
        let kind = "e";
        if (trace) {
          if ((trace.up.has(s) || s === trace.id) && (trace.up.has(t) || t === trace.id)) kind = "up";
          else if ((trace.down.has(t) || t === trace.id) && (trace.down.has(s) || s === trace.id)) kind = "down";
          else continue;
        }
        const a = rect(s), b = rect(t);
        let d;
        if (a.r + 8 < b.l) { const dx = Math.max(20, (b.l - a.r) / 2); d = `M${a.r},${a.y} C${a.r + dx},${a.y} ${b.l - dx},${b.y} ${b.l},${b.y}`; }
        else { const dx = 28 + Math.abs(b.y - a.y) * 0.08; d = `M${a.l},${a.y} C${a.l - dx},${a.y} ${b.l - dx},${b.y} ${b.l},${b.y}`; }
        const hot = kind !== "e";
        paths.push(`<path d="${d}" fill="none" stroke="${hot ? (kind === "up" ? UP : DOWN) : EDGE}" stroke-width="${hot ? 1.8 : 1}"
          opacity="${hot ? 0.95 : 0.45}" marker-end="url(#rm-arrow-${kind})"/>`);
      }
      g.innerHTML = paths.join("");
    };
    const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

    const setTrace = id => {
      if ((trace?.id ?? null) === id) return;
      trace = id == null ? null : {id, up: walk(back, id), down: walk(fwd, id)};
      grid.classList.toggle("rm-tracing", !!trace);
      for (const [tid, el] of tiles) {
        el.classList.toggle("focus", tid === id);
        el.classList.toggle("up", !!trace && trace.up.has(tid));
        el.classList.toggle("down", !!trace && trace.down.has(tid));
      }
      const inPath = new Map();
      if (trace) for (const set of [trace.up, trace.down]) for (const n of set) {
        const k = hiddenIn.get(n);
        if (k) inPath.set(k, (inPath.get(k) ?? 0) + 1);
      }
      grid.querySelectorAll(".rm-more").forEach(b => {
        const n = inPath.get(b.dataset.key);
        b.classList.toggle("hot", !!n);
        b.textContent = n ? `${b.dataset.base} · ${n} in path` : b.dataset.base;
      });
      redraw();
    };

    grid.addEventListener("mouseover", e => { const t = e.target.closest(".rm-tile"); if (t) setTrace(+t.dataset.id); });
    grid.addEventListener("focusin", e => { const t = e.target.closest(".rm-tile"); if (t) setTrace(+t.dataset.id); });
    grid.addEventListener("mouseleave", () => setTrace(null));
    container._rmObserver?.disconnect();
    container._rmObserver = new ResizeObserver(redraw);
    container._rmObserver.observe(grid);
    redraw();

    if (!container._rmBound) {
      container._rmBound = true;
      container.addEventListener("click", e => {
        const st = container._rm, rerender = () => {
          const sc = container.querySelector(".rm-scroll"), pos = sc && [sc.scrollLeft, sc.scrollTop];
          render(container, st.data, st.opts);
          if (pos) [container.querySelector(".rm-scroll").scrollLeft, container.querySelector(".rm-scroll").scrollTop] = pos;
        };
        const b = e.target.closest("[data-layer],[data-density],[data-key]");
        if (b?.dataset.layer !== undefined) { layerFilter = b.dataset.layer; rerender(); return; }
        if (b?.dataset.density !== undefined) { perCell = Number(b.dataset.density); expanded.clear(); rerender(); return; }
        if (b?.dataset.key) { expanded.has(b.dataset.key) ? expanded.delete(b.dataset.key) : expanded.add(b.dataset.key); rerender(); return; }
        const t = e.target.closest(".rm-tile");
        if (t && st.opts.onSelect) st.opts.onSelect(+t.dataset.id);
      });
    }
  }

  global.Roadmap = {render};
})(window);
