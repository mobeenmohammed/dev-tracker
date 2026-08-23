/* ============================================================
   tree.js — the tree of cards.

   A top-down tidy tree: the field sits at the top, its topics on the row
   below, and so on. Every topic is a card you can act on directly — rename
   it, advance its status, add a sub-topic, or log time against it.
   ============================================================ */

const Tree = (() => {

  const ROOT_ID   = '__root__';
  const MIN_SCALE = 0.12;
  const MAX_SCALE = 3.5;

  /* card metrics, by depth */
  const CARD = [
    { w: 220, h: 72 },   // the centre
    { w: 200, h: 66 },   // fields
    { w: 184, h: 62 },   // everything below
  ];
  const cardFor = depth => CARD[Math.min(depth, CARD.length - 1)];
  const COL_GAP = 26;    // horizontal space between siblings
  const ROW_GAP = 54;    // vertical space between generations

  let svg, gViewport, gLinks, gNodes;
  let onSelect = () => {};
  let onAction = () => {};
  let collapsed = new Set();
  let selectedId = null;
  let query = '';
  let layoutRoot = null;
  let rootId = null;            // null = every field at once
  let showActivity = true;
  let showRefs = true;          // draw the reference arrows between topics
  let editingId = null;         // node whose title is being renamed inline
  const pinned = new Set();     // graph nodes the person has dragged into place

  const view = { x: 0, y: 0, scale: 1 };

  /* ---------------- hierarchy ---------------- */

  function buildHierarchy() {
    const make = (node, depth) => {
      const isCollapsed = collapsed.has(node.id);
      const rawKids = node.id === ROOT_ID ? Store.roots() : Store.childrenOf(node.id);
      return {
        id:          node.id,
        name:        node.name,
        status:      node.status,
        isSynthetic: node.id === ROOT_ID,
        depth,
        hiddenKids:  isCollapsed ? rawKids.length : 0,
        children:    isCollapsed ? [] : rawKids.map(k => make(k, depth + 1)),
      };
    };

    const field = rootId ? Store.byId(rootId) : null;
    if (field) return make(field, 0);

    const profile = Store.state.profile;
    return make({ id: ROOT_ID, name: profile.name || 'Everything', status: 'mastered' }, 0);
  }

  const isGraphMode = () => rootId === null;

  const flatten = root => {
    const out = [];
    (function walk(n) { out.push(n); n.children.forEach(walk); })(root);
    return out;
  };

  /* ---------------- layout ---------------- */

  /* Leaves are laid out left to right in reading order and every parent
     centres over its children, which is what keeps branches from crossing.
     Depth runs downwards, so the tree grows the way it reads. */
  function layout(root) {
    const all = flatten(root);

    const rowH = [];
    all.forEach(n => {
      const card = cardFor(n.depth);
      n.w = card.w;
      n.h = card.h;
      rowH[n.depth] = Math.max(rowH[n.depth] || 0, card.h);
    });

    const ys = [];
    rowH.forEach((h, d) => {
      ys[d] = d === 0 ? 0 : ys[d - 1] + rowH[d - 1] / 2 + ROW_GAP + h / 2;
    });

    let cursor = 0;
    (function place(n) {
      n.y = ys[n.depth];

      if (!n.children.length) {
        n.x = cursor + n.w / 2;
        cursor += n.w + COL_GAP;
        return;
      }
      n.children.forEach(place);
      n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
    })(root);

    layoutRoot = root;
    return root;
  }

  /* A vertical S-curve from the parent's bottom edge to the child's top. In
     the graph there is no consistent direction, so a plain line is honest. */
  function linkPath(parent, child) {
    if (isGraphMode()) return `M${parent.x},${parent.y}L${child.x},${child.y}`;
    const y1 = parent.y + parent.h / 2;
    const y2 = child.y - child.h / 2;
    const mid = (y1 + y2) / 2;
    return `M${parent.x},${y1}C${parent.x},${mid} ${child.x},${mid} ${child.x},${y2}`;
  }


  /* ---------------- graph layout (the All view) ---------------- */

  /* One field is a hierarchy and reads best as a tidy tree. Everything at once
     is not a hierarchy — topics reference each other across fields — so the
     All view is a force-directed graph in the spirit of a knowledge graph:
     parent-child edges pull, every pair pushes, and references pull too.

     Positions are cached by node id and reused between renders, so selecting a
     card or ticking something does not reshuffle the whole picture. */
  const graphPos = new Map();
  let graphSignature = '';

  const GRAPH = {
    iterations: 320,
    repulsion:  46000,
    springLen:  132,
    springK:    0.055,
    refLen:     190,
    refK:       0.022,
    centering:  0.012,
    damping:    0.86,
    maxStep:    38,
  };

  function graphNodes() {
    return Store.state.nodes.map(n => ({
      id: n.id,
      name: n.name,
      status: n.status,
      depth: Store.depthOf(n.id),
      isSynthetic: false,
      children: [],
      hiddenKids: 0,
    }));
  }

  /* Only recompute when the shape actually changed, not on every repaint. */
  function signatureOf(nodes, edges) {
    return nodes.map(n => n.id).sort().join(',') + '|' + edges.map(e => e.a + '>' + e.b).sort().join(',');
  }

  function simulate(nodes, edges, refs) {
    const byId = new Map(nodes.map(n => [n.id, n]));

    /* Deterministic starting ring, so an unchanged graph always settles the
       same way rather than looking different on each reload. */
    nodes.forEach((n, i) => {
      const cached = graphPos.get(n.id);
      if (cached) { n.x = cached.x; n.y = cached.y; }
      else {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        const radius = 160 + (i % 7) * 42;
        n.x = Math.cos(angle) * radius;
        n.y = Math.sin(angle) * radius;
      }
      n.vx = 0; n.vy = 0;
    });

    const pull = (list, restLength, k) => list.forEach(({ a, b }) => {
      const A = byId.get(a), B = byId.get(b);
      if (!A || !B) return;
      let dx = B.x - A.x, dy = B.y - A.y;
      let dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist - restLength) * k;
      dx /= dist; dy /= dist;
      A.vx += dx * force; A.vy += dy * force;
      B.vx -= dx * force; B.vy -= dy * force;
    });

    for (let step = 0; step < GRAPH.iterations; step++) {
      /* Everything pushes everything, which is affordable at this size and
         keeps unrelated branches from piling up. */
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const A = nodes[i], B = nodes[j];
          let dx = B.x - A.x, dy = B.y - A.y;
          let distSq = dx * dx + dy * dy;
          if (distSq < 1) { dx = (i - j) || 1; dy = (j - i) || 1; distSq = 1; }
          const dist = Math.sqrt(distSq);
          const force = GRAPH.repulsion / distSq;
          dx /= dist; dy /= dist;
          A.vx -= dx * force; A.vy -= dy * force;
          B.vx += dx * force; B.vy += dy * force;
        }
      }

      pull(edges, GRAPH.springLen, GRAPH.springK);
      pull(refs,  GRAPH.refLen,    GRAPH.refK);

      nodes.forEach(n => {
        n.vx -= n.x * GRAPH.centering;
        n.vy -= n.y * GRAPH.centering;
        n.vx *= GRAPH.damping;
        n.vy *= GRAPH.damping;

        const speed = Math.hypot(n.vx, n.vy);
        if (speed > GRAPH.maxStep) { n.vx = (n.vx / speed) * GRAPH.maxStep; n.vy = (n.vy / speed) * GRAPH.maxStep; }
        if (n.pinned) return;
        n.x += n.vx;
        n.y += n.vy;
      });
    }

    /* Cards must not sit on top of each other, so nudge overlaps apart. */
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const A = nodes[i], B = nodes[j];
          const overlapX = (A.w + B.w) / 2 + 16 - Math.abs(B.x - A.x);
          const overlapY = (A.h + B.h) / 2 + 14 - Math.abs(B.y - A.y);
          if (overlapX <= 0 || overlapY <= 0) continue;

          moved = true;
          if (overlapX < overlapY) {
            const shift = (overlapX / 2) * (B.x >= A.x ? 1 : -1);
            if (!A.pinned) A.x -= shift;
            if (!B.pinned) B.x += shift;
          } else {
            const shift = (overlapY / 2) * (B.y >= A.y ? 1 : -1);
            if (!A.pinned) A.y -= shift;
            if (!B.pinned) B.y += shift;
          }
        }
      }
      if (!moved) break;
    }

    nodes.forEach(n => graphPos.set(n.id, { x: n.x, y: n.y }));
    return nodes;
  }

  function layoutGraph() {
    const nodes = graphNodes();
    nodes.forEach(n => {
      const card = cardFor(Math.min(n.depth, 2));
      n.w = card.w; n.h = card.h;
      n.pinned = pinned.has(n.id);
    });

    const edges = Store.state.nodes
      .filter(n => n.parentId)
      .map(n => ({ a: n.parentId, b: n.id }));
    const refs = Store.state.links.map(l => ({ a: l.from, b: l.to }));

    const signature = signatureOf(nodes, edges.concat(refs));
    if (signature !== graphSignature) {
      graphSignature = signature;
      simulate(nodes, edges, refs);
    } else {
      nodes.forEach(n => {
        const cached = graphPos.get(n.id);
        if (cached) { n.x = cached.x; n.y = cached.y; }
      });
    }

    return { nodes, edges };
  }

  /* ---------------- rendering ---------------- */

  const SVG_NS  = 'http://www.w3.org/2000/svg';
  const HTML_NS = 'http://www.w3.org/1999/xhtml';

  const el = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const html = (tag, cls) => {
    const node = document.createElementNS(HTML_NS, tag);
    if (cls) node.setAttribute('class', cls);
    return node;
  };

  function statusColor(status) {
    const meta = Store.STATUS_BY_ID[status] || Store.STATUS_BY_ID.planned;
    return getComputedStyle(document.documentElement).getPropertyValue(meta.cssVar).trim();
  }

  const matches = name => query && name.toLowerCase().includes(query);

  /* Nodes matching a search stay lit along with their ancestors. */
  function litSet(all) {
    if (!query) return null;
    const parentOf = new Map();
    all.forEach(n => n.children.forEach(c => parentOf.set(c.id, n)));
    const lit = new Set();
    all.filter(n => matches(n.name)).forEach(n => {
      let cur = n;
      while (cur) { lit.add(cur.id); cur = parentOf.get(cur.id); }
    });
    return lit;
  }

  function render() {
    if (!gNodes) return;              // nothing to draw into until init() has run

    gLinks.replaceChildren();
    gNodes.replaceChildren();

    const { all, edges } = isGraphMode() ? renderGraph() : renderTree();
    const byId = new Map(all.map(n => [n.id, n]));
    const lit = litSet(all);
    const isDim = n => lit && !lit.has(n.id);

    edges.forEach(({ from, to }) => {
      const path = el('path', { class: 'link' + (isDim(to) ? ' is-dimmed' : ''), d: linkPath(from, to) });
      if (to.id === selectedId || from.id === selectedId) path.classList.add('is-hot');
      gLinks.appendChild(path);
    });

    if (showRefs) drawReferences(byId, isDim);

    all.forEach(n => gNodes.appendChild(cardNode(n, isDim(n))));
    layoutRoot = { children: [], flat: all };
  }

  /* One field: the tidy top-down tree. */
  function renderTree() {
    const root = layout(buildHierarchy());
    const all = flatten(root);
    const edges = [];
    all.forEach(parent => parent.children.forEach(child => edges.push({ from: parent, to: child })));
    return { all, edges };
  }

  /* Everything at once: the force-directed graph. */
  function renderGraph() {
    const { nodes, edges } = layoutGraph();
    const byId = new Map(nodes.map(n => [n.id, n]));
    return {
      all: nodes,
      edges: edges
        .map(e => ({ from: byId.get(e.a), to: byId.get(e.b) }))
        .filter(e => e.from && e.to),
    };
  }

  /* References are drawn as dashed, arrowed curves in their own colour, so a
     relationship is never mistaken for containment. */
  function drawReferences(byId, isDim) {
    Store.state.links.forEach(link => {
      const from = byId.get(link.from);
      const to   = byId.get(link.to);
      if (!from || !to) return;          // an end is collapsed away or out of view

      const touchesSelection = link.from === selectedId || link.to === selectedId;
      const cls = ['ref-link'];
      if (touchesSelection) cls.push('is-hot');
      if (isDim(from) && isDim(to)) cls.push('is-dimmed');

      const path = el('path', {
        class: cls.join(' '),
        d: refPath(from, to),
        'marker-end': touchesSelection ? 'url(#ref-arrow-hot)' : 'url(#ref-arrow)',
      });
      gLinks.appendChild(path);

      if (link.label && touchesSelection) {
        const label = el('text', {
          class: 'ref-label',
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2 - 6,
          'text-anchor': 'middle',
        });
        label.textContent = link.label;
        gLinks.appendChild(label);
      }
    });
  }

  /* Bowed away from the straight line so a reference is visible even when it
     runs alongside a parent-child edge, and stops at the card's edge so the
     arrowhead is not hidden underneath it. */
  function refPath(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;

    const inset = t => Math.min(t.w / 2, t.h / 2) + 6;
    const x1 = from.x + ux * inset(from), y1 = from.y + uy * inset(from);
    const x2 = to.x - ux * inset(to),     y2 = to.y - uy * inset(to);

    const bow = Math.min(70, dist * 0.22);
    const cx = (x1 + x2) / 2 - uy * bow;
    const cy = (y1 + y2) / 2 + ux * bow;
    return `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`;
  }

  function activityOf(n) {
    const worked = n.isSynthetic ? null : Store.lastWorked(n.id, true);
    return { worked, age: worked ? Store.daysBetween(worked, Store.todayISO()) : null };
  }

  /* Cards are real HTML inside a foreignObject, so they can wrap text and
     carry working buttons instead of being painted shapes. */
  function cardNode(n, dim) {
    const cls = ['node', 'node-card', 'depth-' + Math.min(n.depth, 2)];
    if (n.id === selectedId) cls.push('is-selected');
    if (n.hiddenKids)        cls.push('has-hidden-kids');
    if (dim)                 cls.push('is-dimmed');
    if (matches(n.name))     cls.push('is-match');

    const g = el('g', { class: cls.join(' ') });
    const fo = el('foreignObject', {
      x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h,
    });

    const card = html('div', 'card');
    card.style.setProperty('--card-color', n.isSynthetic ? 'var(--accent)' : statusColor(n.status));
    if (n.id === selectedId) card.classList.add('is-selected');
    if (matches(n.name)) card.classList.add('is-match');
    if (!n.isSynthetic && Store.isPrivate(n.id)) card.classList.add('is-private');

    card.appendChild(html('div', 'card-bar'));

    const body = html('div', 'card-body');
    const title = html('div', 'card-title');
    title.textContent = n.name;
    title.title = n.name;
    body.appendChild(title);

    const { worked, age } = activityOf(n);
    const meta = html('div', 'card-meta');

    if (n.isSynthetic) {
      const count = html('span', 'card-status');
      count.textContent = Store.roots().length + ' fields';
      meta.appendChild(count);
    } else {
      const status = html('span', 'card-status');
      status.textContent = Store.STATUS_BY_ID[n.status].label;
      meta.appendChild(status);

      const list = Store.checklistOf(n.id);
      if (list.total) {
        const chk = html('span', 'card-check');
        chk.textContent = `${list.done}/${list.total}`;
        chk.title = `${list.done} of ${list.total} checklist items done`;
        meta.appendChild(chk);
      }

      if (showActivity) {
        const when = html('span', 'card-when' + (age !== null && age <= 7 ? ' is-fresh' : ''));
        when.textContent = worked ? Store.relativeDay(worked) : 'not started';
        meta.appendChild(when);
      }

      const minutes = Store.minutesFor(n.id, true);
      if (minutes) {
        const time = html('span', 'card-time');
        time.textContent = minutes >= 60 ? Math.round(minutes / 60) + 'h' : minutes + 'm';
        meta.appendChild(time);
      }
    }
    body.appendChild(meta);

    const bar = html('div', 'card-progress');
    const fill = html('i');
    fill.style.width = Math.round(Store.progressOf(n.id) * 100) + '%';
    bar.appendChild(fill);
    body.appendChild(bar);

    card.appendChild(body);
    if (!n.isSynthetic) card.appendChild(cardActions(n));
    card.appendChild(foldControl(n));

    card.addEventListener('pointerdown', ev => {
      ev.stopPropagation();                       // never start a canvas pan
      if (isGraphMode()) startCardDrag(ev, n);
    });
    card.addEventListener('click', ev => { ev.stopPropagation(); select(n.id); });
    title.addEventListener('dblclick', ev => { ev.stopPropagation(); startRename(n.id); });

    fo.appendChild(card);
    g.appendChild(fo);

    if (editingId === n.id) queueMicrotask(() => openTitleEditor(card, n));
    return g;
  }

  function cardActions(n) {
    const actions = html('div', 'card-actions');
    const action = (label, act, title) => {
      const btn = html('button', 'card-btn');
      btn.textContent = label;
      btn.title = title;
      btn.dataset.act = act;
      btn.addEventListener('click', ev => { ev.stopPropagation(); handleCardAction(act, n.id); });
      return btn;
    };
    actions.appendChild(action('\u270E', 'rename',  'Rename (or double-click the title)'));
    actions.appendChild(action('\u25B8', 'advance', 'Move to the next status'));
    actions.appendChild(action('\uFF0B', 'child',   'Add a sub-topic'));
    actions.appendChild(action('\u23F1', 'log',     'Log time on this topic'));
    return actions;
  }

  /* Collapsed branches keep a count, so nothing disappears silently. */
  function foldControl(n) {
    const badge = html('button', 'card-badge' + (n.hiddenKids ? '' : ' card-fold'));
    if (n.hiddenKids) {
      badge.textContent = '+' + n.hiddenKids;
      badge.title = 'Expand ' + n.hiddenKids + ' hidden sub-topics';
    } else {
      badge.textContent = '\u2013';
      badge.title = 'Collapse this branch';
      if (!n.children.length) badge.style.display = 'none';
    }
    badge.addEventListener('click', ev => { ev.stopPropagation(); toggleCollapse(n.id); });
    return badge;
  }

  function handleCardAction(act, nodeId) {
    if (act === 'rename') { startRename(nodeId); return; }

    if (act === 'advance') {
      const node = Store.byId(nodeId);
      const order = Store.STATUSES.map(s => s.id);
      const next = order[Math.min(order.indexOf(node.status) + 1, order.length - 1)];
      if (next !== node.status) Store.updateNode(nodeId, { status: next });
      select(nodeId);
      onAction('advance', nodeId);
      return;
    }
    select(nodeId);
    onAction(act, nodeId);      // 'child' and 'log' are handled by the app
  }

  function startRename(nodeId) {
    editingId = nodeId;
    selectedId = nodeId;
    render();
  }

  /* Swaps the card title for an input, committing on Enter or blur. */
  function openTitleEditor(card, n) {
    const title = card.querySelector('.card-title');
    if (!title) return;

    const input = html('input', 'card-input');
    input.value = n.name;
    input.setAttribute('aria-label', 'Topic name');
    title.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = commit => {
      if (settled) return;
      settled = true;
      editingId = null;
      const name = input.value.trim();
      if (commit && name && name !== n.name) {
        Store.updateNode(n.id, { name });
        onAction('renamed', n.id);
      }
      render();
    };
    input.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Enter')  { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', ev => ev.stopPropagation());
    input.addEventListener('pointerdown', ev => ev.stopPropagation());
  }

  /* In the graph, a card can be dragged where it makes sense and stays there:
     the layout is a starting point, not an opinion to be argued with. */
  function startCardDrag(ev, node) {
    if (ev.button !== 0 || ev.target.closest('button, input, a')) return;

    const startX = ev.clientX, startY = ev.clientY;
    const origin = graphPos.get(node.id) || { x: node.x, y: node.y };
    let dragged = false;

    const move = move => {
      const dx = (move.clientX - startX) / view.scale;
      const dy = (move.clientY - startY) / view.scale;
      if (Math.abs(dx) + Math.abs(dy) < 3 && !dragged) return;

      dragged = true;
      pinned.add(node.id);
      graphPos.set(node.id, { x: origin.x + dx, y: origin.y + dy });
      render();
    };

    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  /* ---------------- viewport: pan, zoom, fit ---------------- */

  function applyView() {
    gViewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function fit(padding = 60) {
    if (!layoutRoot || !gNodes) return;
    const box = gNodes.getBBox();
    const rect = svg.getBoundingClientRect();
    if (!box.width || !box.height || !rect.width) return;

    const scale = Math.min(
      (rect.width  - padding * 2) / box.width,
      (rect.height - padding * 2) / box.height,
      1.15,                                     // never blow a single card up
    );
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    view.x = rect.width  / 2 - (box.x + box.width  / 2) * view.scale;
    view.y = rect.height / 2 - (box.y + box.height / 2) * view.scale;
    applyView();
  }

  function zoomAt(factor, px, py) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    const ratio = next / view.scale;
    view.x = px - (px - view.x) * ratio;
    view.y = py - (py - view.y) * ratio;
    view.scale = next;
    applyView();
  }

  function zoom(factor) {
    const rect = svg.getBoundingClientRect();
    zoomAt(factor, rect.width / 2, rect.height / 2);
  }

  function centerOn(nodeId) {
    if (!layoutRoot || !layoutRoot.flat) return;
    const target = layoutRoot.flat.find(n => n.id === nodeId);
    if (!target) return;
    const rect = svg.getBoundingClientRect();
    view.x = rect.width  / 2 - target.x * view.scale;
    view.y = rect.height / 2 - target.y * view.scale;
    applyView();
  }

  function attachPanZoom() {
    let dragging = false, moved = false, lastX = 0, lastY = 0;

    svg.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      dragging = true; moved = false;
      lastX = ev.clientX; lastY = ev.clientY;
      try { svg.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
      svg.classList.add('is-panning');
    });

    svg.addEventListener('pointermove', ev => {
      if (!dragging) return;
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      view.x += dx; view.y += dy;
      lastX = ev.clientX; lastY = ev.clientY;
      applyView();
    });

    const endPan = ev => {
      if (!dragging) return;
      dragging = false;
      svg.classList.remove('is-panning');
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
      if (!moved && ev.target === svg) select(null);
    };
    svg.addEventListener('pointerup', endPan);
    svg.addEventListener('pointercancel', endPan);

    svg.addEventListener('wheel', ev => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - rect.left, ev.clientY - rect.top);
    }, { passive: false });
  }

  /* ---------------- selection and collapsing ---------------- */

  function select(id) {
    selectedId = id === ROOT_ID ? null : id;
    if (editingId && editingId !== selectedId) editingId = null;
    render();
    onSelect(selectedId);
  }

  function toggleCollapse(id) {
    if (id === ROOT_ID) return;
    if (!Store.byId(id) || !Store.childrenOf(id).length) return;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    render();
  }

  function expandAll() { collapsed.clear(); render(); fit(); }

  function setQuery(q) { query = (q || '').trim().toLowerCase(); render(); }

  function setRoot(fieldId) {
    rootId = fieldId || null;
    render();
    requestAnimationFrame(() => fit());
  }

  function setShowActivity(on) { showActivity = !!on; render(); }

  function setShowRefs(on) { showRefs = !!on; render(); }

  /* Throws away every dragged position and lets the graph settle again. */
  function relayoutGraph() {
    pinned.clear();
    graphPos.clear();
    graphSignature = '';
    render();
    requestAnimationFrame(() => fit());
  }

  /* ---------------- init ---------------- */

  function init(opts) {
    svg       = document.getElementById('tree');
    gViewport = document.getElementById('viewport');
    gLinks    = document.getElementById('links');
    gNodes    = document.getElementById('nodes');
    onSelect  = opts.onSelect || onSelect;
    onAction  = opts.onAction || onAction;

    attachPanZoom();
    render();
    requestAnimationFrame(() => fit());

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fit(), 150);
    });
  }

  return {
    init, render, fit, zoom, centerOn, select, expandAll, setQuery, toggleCollapse,
    setRoot, setShowActivity, setShowRefs, relayoutGraph, startRename,
    get selectedId()   { return selectedId; },
    get rootId()       { return rootId; },
    get showActivity() { return showActivity; },
    get showRefs()     { return showRefs; },
    get isGraph()      { return isGraphMode(); },
  };
})();
