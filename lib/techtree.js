"use strict";
// Tech-tree view of one concept: prerequisites to the left, what it unlocks to the right.
// Shared by the editor and the viewer ("Item" view, next to the concept details).
(function (global) {
  const DOMAIN_COLORS = {
    propulsion: "#ff9f45", energy: "#ffb870", habitation: "#ffd9a8", governance: "#9f86e3",
    biology: "#c3b3f2", communication: "#b49cf0", economics: "#ffcf8a", manufacturing: "#d8661f",
    science: "#8f7ae0", philosophy: "#d9b8ff", ai: "#ff5a1f", military: "#b08a7a",
  };
  const STAGES = ["K0_EARTH", "K0_ORBIT", "K0_LUNAR", "K0_INNER", "K0_OUTER", "K0_REACH", "K1", "K2"];
  const UP = "#ff9f45", DOWN = "#9f86e3", FOCUS = "#ffd9a8";
  const COL_W = 236, NODE_W = 196, NODE_H = 38, ROW_H = 48, PAD = 14, MAX_PER_COL = 30, MAX_LAYER = 6;
  const DEPTHS = [[1, "1"], [2, "2"], [3, "3"], [MAX_LAYER, "all"]];
  let depth = 2;

  const esc = s => String(s ?? "").replace(/[&<>"']/g,
    c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;

  const CSS = `
    .tt-root { flex:1; display:flex; flex-direction:column; min-height:0; min-width:0; }
    .tt-head { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; font-size:12px; color:var(--muted,#8e8e93); margin-bottom:8px; white-space:nowrap; }
    .tt-controls { display:flex; gap:10px; align-items:center; }
    .tt-seg { display:inline-flex; padding:2px; gap:2px; background:var(--surface,#2c2c2e); border-radius:7px; }
    .tt-seg button { background:transparent; border:none; color:var(--muted,#8e8e93); border-radius:5px; font-size:11.5px; padding:2px 10px; cursor:pointer; min-width:28px; }
    .tt-seg button:hover { color:var(--text,#f2f2f7); }
    .tt-seg button.on { background:var(--elevated,#3a3a3c); color:var(--text,#f2f2f7); box-shadow:0 1px 2px rgba(0,0,0,.5); }
    .tt-zoom-level { font-variant-numeric:tabular-nums; min-width:40px; text-align:right; }
    .tt-scroll { flex:1; min-height:0; overflow:hidden; position:relative; background:var(--bg,#1c1c1e); border:1px solid var(--border,#38383a); border-radius:10px; cursor:grab; touch-action:none; }
    .tt-scroll.dragging { cursor:grabbing; }
    .tt-scroll svg { display:block; width:100%; height:100%; user-select:none; }
    .tt-node { cursor:pointer; }
    .tt-node rect.tt-box { fill:var(--surface,#2c2c2e); }
    .tt-node:hover rect.tt-box { fill:var(--elevated,#3a3a3c); }
    .tt-name { font-size:12.5px; fill:var(--text,#f2f2f7); }
    .tt-meta { font-size:10px; fill:var(--muted,#8e8e93); }
    .tt-colhead { font-size:10.5px; font-weight:600; fill:var(--muted,#8e8e93); }
    .tt-more { font-size:11px; fill:var(--muted,#8e8e93); font-style:italic; }
    .tt-side { margin-top:8px; font-size:12px; color:var(--muted,#8e8e93); display:flex; flex-direction:column; gap:4px; }
    .tt-chip { display:inline-block; margin:1px 4px 1px 0; padding:2px 10px; border-radius:12px; background:var(--surface,#2c2c2e); color:var(--text,#f2f2f7); cursor:pointer; }
    .tt-chip:hover { background:var(--accent,#0a84ff); }
    .tt-empty { font-size:12px; color:var(--muted,#8e8e93); padding:20px 0; }`;

  function injectCss() {
    if (document.getElementById("tt-style")) return;
    const s = document.createElement("style");
    s.id = "tt-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function layout(focus, edges, maxDepth) {
    const fwd = {}, back = {};
    for (const e of edges) {
      if (e.type !== "enables" || e.source_id === e.target_id) continue;
      (fwd[e.source_id] ||= []).push(e.target_id);
      (back[e.target_id] ||= []).push(e.source_id);
    }
    const reach = adj => {
      const d = new Map([[focus, 0]]), q = [focus];
      for (let i = 0; i < q.length; i++) {
        if (d.get(q[i]) >= maxDepth) continue;
        for (const m of adj[q[i]] || []) if (!d.has(m)) { d.set(m, d.get(q[i]) + 1); q.push(m); }
      }
      d.delete(focus);
      return d;
    };
    const up = reach(back), down = reach(fwd);
    for (const n of up.keys()) down.delete(n);
    // longest-path layering: a prerequisite of a prerequisite always sits further out
    const relax = (set, toward) => {
      const L = new Map([...set.keys()].map(n => [n, 1]));
      for (let it = 0; it < set.size; it++) {
        let changed = false;
        for (const n of set.keys()) for (const m of toward[n] || []) {
          if (!set.has(m)) continue;
          const v = Math.min(MAX_LAYER, L.get(m) + 1);
          if (v > L.get(n)) { L.set(n, v); changed = true; }
        }
        if (!changed) break;
      }
      return L;
    };
    const col = new Map([[focus, 0]]);
    for (const [n, l] of relax(up, fwd)) col.set(n, -l);
    for (const [n, l] of relax(down, back)) col.set(n, l);
    return {col, fwd, back, nUp: up.size, nDown: down.size};
  }

  function render(container, data, focusId, opts = {}) {
    injectCss();
    container._tt = {data, focusId, opts};
    const nodes = data.nodes instanceof Map ? data.nodes
      : new Map((Array.isArray(data.nodes) ? data.nodes : Object.values(data.nodes)).map(n => [n.id, n]));
    const edges = data.edges.filter(e => nodes.has(e.source_id) && nodes.has(e.target_id));
    const focus = nodes.get(focusId);
    if (!focus) { container.innerHTML = ""; return; }

    const {col, fwd, back, nUp, nDown} = layout(focusId, edges, depth);
    const side = {alternative_to: [], related: []};
    for (const e of edges) {
      if (!(e.type in side)) continue;
      const other = e.source_id === focusId ? e.target_id : e.target_id === focusId ? e.source_id : null;
      if (other != null && !side[e.type].includes(other)) side[e.type].push(other);
    }

    // columns: initial order by stage then name, capped; then barycentre ordering outward from the focus
    const cols = new Map();
    for (const [id, c] of col) (cols.get(c) || cols.set(c, []).get(c)).push(id);
    const hidden = new Map();
    const stageOf = id => STAGES.indexOf(nodes.get(id).stage);
    for (const [c, ids] of cols) {
      ids.sort((a, b) => stageOf(a) - stageOf(b) || nodes.get(a).name.localeCompare(nodes.get(b).name));
      if (ids.length > MAX_PER_COL) { hidden.set(c, ids.length - MAX_PER_COL); ids.length = MAX_PER_COL; }
    }
    const shown = new Set([...cols.values()].flat());
    const yKey = new Map();
    const setKeys = c => (cols.get(c) || []).forEach((id, i, a) => yKey.set(id, i - (a.length - 1) / 2));
    setKeys(-1); setKeys(1);
    for (const sign of [-1, 1]) {
      for (let k = 2; cols.has(sign * k); k++) {
        const c = sign * k, adj = sign < 0 ? fwd : back;
        const key = id => {
          const ys = (adj[id] || []).filter(m => col.get(m) === c - sign && yKey.has(m)).map(m => yKey.get(m));
          return ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : Infinity;
        };
        cols.get(c).sort((a, b) => key(a) - key(b));
        setKeys(c);
      }
    }

    const colIds = [...cols.keys()].sort((a, b) => a - b);
    const minCol = colIds[0], maxCol = colIds[colIds.length - 1];
    const rows = Math.max(...colIds.map(c => cols.get(c).length + (hidden.has(c) ? 1 : 0)));
    const W = (maxCol - minCol) * COL_W + NODE_W + 2 * PAD, H = rows * ROW_H + 2 * PAD + 14;
    const pos = new Map();
    for (const c of colIds) {
      const ids = cols.get(c), n = ids.length + (hidden.has(c) ? 1 : 0);
      const top = PAD + 14 + ((rows - n) * ROW_H) / 2;
      ids.forEach((id, i) => pos.set(id, [PAD + (c - minCol) * COL_W, top + i * ROW_H]));
    }

    const edgeSvg = edges.filter(e => e.type === "enables" && shown.has(e.source_id) && shown.has(e.target_id)).map(e => {
      const [x1, y1] = pos.get(e.source_id), [x2, y2] = pos.get(e.target_id);
      const cs = col.get(e.source_id), ct = col.get(e.target_id);
      const sx = x1 + NODE_W, sy = y1 + NODE_H / 2, tx = x2, ty = y2 + NODE_H / 2;
      const dx = Math.max(24, Math.abs(tx - sx) / 2);
      const color = ct <= 0 ? UP : DOWN;
      const backwards = ct <= cs;
      const near = ct - cs === 1;
      return `<path d="M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}" fill="none" stroke="${color}"
        stroke-width="${near ? 1.4 : 1}" opacity="${near ? 0.75 : 0.3}" ${backwards ? 'stroke-dasharray="3,3"' : ""}
        marker-end="url(#tt-arrow-${ct <= 0 ? "up" : "down"})"/>`;
    }).join("");

    const nodeSvg = [...shown].map(id => {
      const n = nodes.get(id), [x, y] = pos.get(id), c = DOMAIN_COLORS[n.domain] ?? "#888", isFocus = id === focusId;
      return `<g class="tt-node${isFocus ? " tt-focus" : ""}" data-id="${id}">
        <title>${esc(n.name)} · ${esc(n.stage)} · ${esc(n.domain)}</title>
        <rect class="tt-box" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="${NODE_H / 4}"
          stroke="${isFocus ? FOCUS : c}" stroke-width="${isFocus ? 2.5 : 1.5}" stroke-opacity="${isFocus ? 1 : 0.8}"/>
        <text class="tt-name" x="${x + NODE_H / 2}" y="${y + 16}" ${isFocus ? 'font-weight="700"' : ""}>${esc(trunc(n.name, 28))}</text>
        <text class="tt-meta" x="${x + NODE_H / 2}" y="${y + 30}" fill="${c}">${esc(n.stage)} · ${esc(n.domain)}</text>
      </g>`;
    }).join("");

    const moreSvg = [...hidden].map(([c, k]) => {
      const ids = cols.get(c), [x, y] = pos.get(ids[ids.length - 1]);
      return `<text class="tt-more" x="${x + 10}" y="${y + ROW_H + 20}">+${k} more</text>`;
    }).join("");
    const heads = colIds.map(c => `<text class="tt-colhead" x="${PAD + (c - minCol) * COL_W}" y="${PAD + 4}">${
      c < 0 ? (c === -1 ? "needs" : `needs ×${-c}`) : c > 0 ? (c === 1 ? "unlocks" : `unlocks ×${c}`) : "concept"}</text>`).join("");
    const markers = [["up", UP], ["down", DOWN]].map(([k, c]) =>
      `<marker id="tt-arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("");

    const chips = ids => ids.map(id => `<span class="tt-chip" data-id="${id}">${esc(nodes.get(id).name)}</span>`).join("");
    const sideHtml = [["alternative_to", "Alternatives"], ["related", "Related"]]
      .filter(([t]) => side[t].length)
      .map(([t, label]) => `<div>${label}: ${chips(side[t])}</div>`).join("");
    const depthBtns = DEPTHS.map(([d, label]) =>
      `<button data-depth="${d}" class="${d === depth ? "on" : ""}">${label}</button>`).join("");

    container.innerHTML = `<div class="tt-root">
      <div class="tt-head">
        <span>${nUp} prerequisite${nUp === 1 ? "" : "s"} · ${nDown} unlock${nDown === 1 ? "" : "s"}${data.truncated ? " · truncated" : ""}</span>
        <span class="tt-controls">
          <span class="tt-seg" title="Steps to follow">${depthBtns}</span>
          ${nUp + nDown ? `<span class="tt-seg" title="Zoom (scroll) · pan (drag)">
            <button data-zoom="out" aria-label="Zoom out">−</button>
            <button data-zoom="fit">Fit</button>
            <button data-zoom="in" aria-label="Zoom in">+</button>
          </span><span class="tt-zoom-level"></span>` : ""}
        </span>
      </div>
      ${nUp + nDown
        ? `<div class="tt-scroll"><svg preserveAspectRatio="xMinYMin meet"><defs>${markers}</defs>${heads}${edgeSvg}${nodeSvg}${moreSvg}</svg></div>`
        : `<p class="tt-empty">No prerequisites or dependents.</p>`}
      ${sideHtml ? `<div class="tt-side">${sideHtml}</div>` : ""}</div>`;

    const scroll = container.querySelector(".tt-scroll");
    if (scroll) {
      const [fx, fy] = pos.get(focusId);
      container._ttZoom = attachZoom(scroll, container.querySelector(".tt-zoom-level"), W, H,
                                     fx + NODE_W / 2, fy + NODE_H / 2);
    }

    if (!container._ttBound) {
      container._ttBound = true;
      container.addEventListener("click", e => {
        const st = container._tt;
        const btn = e.target.closest("[data-depth]");
        if (btn) { depth = +btn.dataset.depth; render(container, st.data, st.focusId, st.opts); return; }
        const z = e.target.closest("[data-zoom]");
        if (z) { container._ttZoom?.[z.dataset.zoom](); return; }
        if (container._ttZoom?.dragged()) return;
        const hit = e.target.closest("[data-id]");
        if (hit && st.opts.onSelect) st.opts.onSelect(+hit.dataset.id);
      });
    }
  }

  // Zoom (wheel / pinch, around the cursor) and pan (drag) by rewriting the SVG viewBox.
  function attachZoom(view, label, W, H, focusX, focusY) {
    const svg = view.querySelector("svg");
    const MIN = 0.15, MAX = 3, READABLE = 0.8;
    const st = {k: 1, x: 0, y: 0};
    let drag = null, moved = false;
    const size = () => [view.clientWidth || 1, view.clientHeight || 1];
    let raf = 0;
    const apply = () => {      // at most one viewBox write per frame
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const [cw, ch] = size();
        svg.setAttribute("viewBox", `${st.x} ${st.y} ${cw / st.k} ${ch / st.k}`);
        if (label) label.textContent = `${Math.round(st.k * 100)}%`;
      });
    };
    const zoomAt = (k, px, py) => {
      k = Math.min(MAX, Math.max(MIN, k));
      const wx = st.x + px / st.k, wy = st.y + py / st.k;
      st.k = k; st.x = wx - px / k; st.y = wy - py / k;
      apply();
    };
    const fit = () => {
      const [cw, ch] = size();
      st.k = Math.min(1.25, Math.max(MIN, Math.min(cw / W, ch / H)));
      st.x = (W - cw / st.k) / 2; st.y = (H - ch / st.k) / 2;
      apply();
    };
    // fill the panel width unless that drops below a readable scale; keep the focus topic centred
    const focus = () => {
      const [cw, ch] = size();
      st.k = Math.min(1.25, Math.max(READABLE, cw / W));
      const vw = cw / st.k, vh = ch / st.k;
      st.x = vw >= W ? (W - vw) / 2 : focusX - vw / 2;
      st.y = vh >= H ? (H - vh) / 2 : focusY - vh / 2;
      apply();
    };
    const [cw0, ch0] = size();
    let ready = cw0 > 40 && ch0 > 40;
    if (ready) focus();

    view.addEventListener("wheel", e => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX) && e.deltaMode === 0 && !e.shiftKey) {
        zoomAt(st.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        st.x += e.deltaX / st.k; st.y += e.deltaY / st.k; apply();
      }
    }, {passive: false});
    view.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      drag = {x: e.clientX, y: e.clientY, sx: st.x, sy: st.y};
      moved = false;
    });
    view.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; view.setPointerCapture(e.pointerId); view.classList.add("dragging"); }
      st.x = drag.sx - dx / st.k; st.y = drag.sy - dy / st.k; apply();
    });
    const end = () => { drag = null; view.classList.remove("dragging"); };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    let last = size();
    new ResizeObserver(() => {
      const [cw, ch] = size(), [pw, ph] = last;
      last = [cw, ch];
      if (!ready && cw > 40 && ch > 40) { ready = true; focus(); return; }
      // keep the centre of the view fixed when the panel resizes
      st.x += (pw - cw) / (2 * st.k); st.y += (ph - ch) / (2 * st.k);
      apply();
    }).observe(view);

    const center = () => { const [cw, ch] = size(); return [cw / 2, ch / 2]; };
    return {
      in:  () => zoomAt(st.k * 1.25, ...center()),
      out: () => zoomAt(st.k / 1.25, ...center()),
      fit,
      dragged: () => { const m = moved; moved = false; return m; },
    };
  }

  global.TechTree = {render, DOMAIN_COLORS};
})(window);
