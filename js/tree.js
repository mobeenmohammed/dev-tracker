/* ============================================================
   tree.js — the learning tree, in two layouts.

   "cards"  — a horizontal tidy tree. Every topic is a card you can act on
              directly: rename it, advance its status, add a sub-topic, log
              time. This is the working view.
   "radial" — the classic dendrogram, every leaf on an equal angular slot.
              Denser and better for seeing every field at once.
   ============================================================ */

const Tree = (() => {

  const ROOT_ID   = '__root__';
  const MIN_SCALE = 0.12;
  const MAX_SCALE = 3.5;

  /* radial metrics */
  const RING_1   = 170;
  const RING_GAP = 135;

  /* card metrics, by depth */
  const CARD = [
    { w: 210, h: 68 },   // the centre
    { w: 190, h: 62 },   // fields
    { w: 172, h: 58 },   // everything below
  ];
  const cardFor = depth => CARD[Math.min(depth, CARD.length - 1)];
  const ROW_GAP = 16;    // vertical space between sibling cards
  const COL_GAP = 78;    // horizontal space between generations

  let svg, gViewport, gRings, gLinks, gNodes;
  let onSelect = () => {};
  let onAction = () => {};
  let collapsed = new Set();
  let selectedId = null;
  let query = '';
  let layoutRoot = null;
  let rootId = null;            // null = every field at once
  let showActivity = true;
  let layoutMode = 'cards';     // 'cards' | 'radial'
  let editingId = null;         // node whose title is being renamed inline

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
    return make({ id: ROOT_ID, name: profile.name || 'Learning', status: 'mastered' }, 0);
  }

  const flatten = root => {
    const out = [];
    (function walk(n) { out.push(n); n.children.forEach(walk); })(root);
    return out;
  };

  /* ---------------- radial layout ---------------- */

  const polar = (angle, radius) => [
    Math.cos(angle - Math.PI / 2) * radius,
    Math.sin(angle - Math.PI / 2) * radius,
  ];

  const radiusForDepth = depth => (depth === 0 ? 0 : RING_1 + (depth - 1) * RING_GAP);

  function layoutRadial(root) {
    let leafSlot = 0;
    (function countLeaves(n) {
      if (!n.children.length) { n.slot = leafSlot++; return; }
      n.children.forEach(countLeaves);
    })(root);

    const totalLeaves = Math.max(1, leafSlot);

    (function assign(n) {
      if (!n.children.length) {
        n.angle = ((n.slot + 0.5) / totalLeaves) * Math.PI * 2;
      } else {
        n.children.forEach(assign);
        n.angle = (n.children[0].angle + n.children[n.children.length - 1].angle) / 2;
      }
      n.radius = radiusForDepth(n.depth);
      [n.x, n.y] = polar(n.angle, n.radius);
    })(root);

    root.angle = 0; root.radius = 0; root.x = root.y = 0;
    return root;
  }

  /* ---------------- card layout ---------------- */

  /* Leaves stack down the page in reading order and every parent centres on
     its children, which is what keeps the branches from crossing. */
  function layoutCards(root) {
    /* every column is as wide as the widest card sitting in it */
    const colX = [];
    flatten(root).forEach(n => {
      colX[n.depth] = Math.max(colX[n.depth] || 0, cardFor(n.depth).w);
    });

    const xs = [];
    colX.forEach((w, d) => { xs[d] = d === 0 ? 0 : xs[d - 1] + colX[d - 1] / 2 + COL_GAP + w / 2; });

    let cursor = 0;
    (function place(n) {
      const card = cardFor(n.depth);
      n.w = card.w;
      n.h = card.h;
      n.x = xs[n.depth];

      if (!n.children.length) {
        n.y = cursor;
        cursor += card.h + ROW_GAP;
        return;
      }
      n.children.forEach(place);
      n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
    })(root);

    return root;
  }

  function layout(root) {
    return layoutMode === 'radial' ? layoutRadial(root) : layoutCards(root);
  }

  /* ---------------- links ---------------- */

  function linkPath(parent, child) {
    if (layoutMode === 'radial') {
      const midR = (parent.radius + child.radius) / 2;
      const [x1, y1] = polar(parent.angle, parent.radius);
      const [c1x, c1y] = polar(parent.angle, midR);
      const [c2x, c2y] = polar(child.angle, midR);
      const [x2, y2] = polar(child.angle, child.radius);
      return `M${x1},${y1}C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
    }
    /* card mode: leave the parent's right edge, arrive at the child's left */
    const x1 = parent.x + parent.w / 2;
    const x2 = child.x - child.w / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1},${parent.y}C${mid},${parent.y} ${mid},${child.y} ${x2},${child.y}`;
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

    layoutRoot = layout(buildHierarchy());
    const all = flatten(layoutRoot);

    const empty = document.getElementById('canvasEmpty');
    if (empty) empty.hidden = all.length > 1 || (!rootId && Store.roots().length > 0);

    const lit = litSet(all);
    const isDim = n => lit && !lit.has(n.id);

    gRings.replaceChildren();
    gLinks.replaceChildren();
    gNodes.replaceChildren();

    if (layoutMode === 'radial') {
      const maxDepth = all.reduce((m, n) => Math.max(m, n.depth), 0);
      for (let d = 1; d <= maxDepth; d++) {
        gRings.appendChild(el('circle', { class: 'ring', cx: 0, cy: 0, r: radiusForDepth(d) }));
      }
    }

    all.forEach(parent => parent.children.forEach(child => {
      const path = el('path', { class: 'link' + (isDim(child) ? ' is-dimmed' : ''), d: linkPath(parent, child) });
      if (child.id === selectedId || parent.id === selectedId) path.classList.add('is-hot');
      gLinks.appendChild(path);
    }));

    all.forEach(n => {
      gNodes.appendChild(layoutMode === 'radial' ? radialNode(n, isDim(n)) : cardNode(n, isDim(n)));
    });
  }

  function nodeClasses(n, dim) {
    const cls = ['node', 'depth-' + Math.min(n.depth, 2)];
    if (n.id === selectedId) cls.push('is-selected');
    if (n.hiddenKids)        cls.push('has-hidden-kids');
    if (dim)                 cls.push('is-dimmed');
    if (matches(n.name))     cls.push('is-match');
    return cls.join(' ');
  }

  function activityOf(n) {
    const worked = n.isSynthetic ? null : Store.lastWorked(n.id, true);
    return { worked, age: worked ? Store.daysBetween(worked, Store.todayISO()) : null };
  }

  /* ---------------- radial node (dot + label) ---------------- */

  function radialNode(n, dim) {
    const g = el('g', { class: nodeClasses(n, dim), transform: `translate(${n.x},${n.y})` });

    const isRoot = n.depth === 0;
    const hasKids = n.children.length > 0 || n.hiddenKids > 0;
    const r = isRoot ? 15 : n.depth === 1 ? 10 : hasKids ? 7 : 5.5;
    const fill = n.isSynthetic ? 'var(--accent)' : statusColor(n.status);

    const { worked, age } = activityOf(n);
    if (age !== null && age <= 7) g.appendChild(el('circle', { class: 'halo', r: r + 4.5, stroke: fill }));
    g.appendChild(el('circle', { r, fill }));

    const label = el('text');
    label.textContent = n.hiddenKids ? `${n.name} (+${n.hiddenKids})` : n.name;

    const subText = showActivity && worked ? Store.relativeDay(worked) : null;
    const sub = subText ? el('text', { class: 'sub-label' }) : null;
    if (sub) sub.textContent = subText;

    if (isRoot) {
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', -r - 9);
      if (sub) { sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('dy', r + 17); }
    } else {
      const deg = (n.angle * 180) / Math.PI;
      const onLeft = deg > 180;
      const gap = r + 6;
      const spoke = `rotate(${deg - 90}) translate(${onLeft ? -gap : gap},0)` + (onLeft ? ' rotate(180)' : '');
      const anchor = onLeft ? 'end' : 'start';

      label.setAttribute('transform', spoke);
      label.setAttribute('text-anchor', anchor);
      label.setAttribute('dominant-baseline', 'middle');
      if (sub) {
        sub.setAttribute('transform', spoke);
        sub.setAttribute('text-anchor', anchor);
        sub.setAttribute('dominant-baseline', 'middle');
        sub.setAttribute('dy', 11);
        label.setAttribute('dy', -4);
      }
    }
    g.appendChild(label);
    if (sub) g.appendChild(sub);
    g.appendChild(el('circle', { r: Math.max(r + 6, 12), fill: 'transparent' }));

    g.addEventListener('click', ev => { ev.stopPropagation(); select(n.id); });
    g.addEventListener('dblclick', ev => { ev.stopPropagation(); toggleCollapse(n.id); });
    return g;
  }

  /* ---------------- card node ---------------- */

  /* Cards are real HTML inside a foreignObject, so they can wrap text and
     carry working buttons instead of being painted shapes. */
  function cardNode(n, dim) {
    const g = el('g', { class: nodeClasses(n, dim) + ' node-card' });

    const fo = el('foreignObject', {
      x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h,
    });

    const card = html('div', 'card');
    card.style.setProperty('--card-color', n.isSynthetic ? 'var(--accent)' : statusColor(n.status));
    if (n.id === selectedId) card.classList.add('is-selected');
    if (matches(n.name)) card.classList.add('is-match');

    card.appendChild(html('div', 'card-bar'));

    const body = html('div', 'card-body');

    const title = html('div', 'card-title');
    title.textContent = n.name;
    title.title = n.name;
    body.appendChild(title);

    const { worked, age } = activityOf(n);
    const meta = html('div', 'card-meta');

    if (!n.isSynthetic) {
      const status = html('span', 'card-status');
      status.textContent = Store.STATUS_BY_ID[n.status].label;
      meta.appendChild(status);

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
    } else {
      const count = html('span', 'card-status');
      count.textContent = Store.roots().length + ' fields';
      meta.appendChild(count);
    }
    body.appendChild(meta);

    /* A parent shows how far its whole branch has come. */
    if (n.children.length || n.hiddenKids) {
      const bar = html('div', 'card-progress');
      const fill = html('i');
      fill.style.width = Math.round(Store.progressOf(n.id) * 100) + '%';
      bar.appendChild(fill);
      body.appendChild(bar);
    }
    card.appendChild(body);

    /* --- the actions that make the card a place to work, not just a label --- */
    if (!n.isSynthetic) {
      const actions = html('div', 'card-actions');

      const action = (label, act, title) => {
        const btn = html('button', 'card-btn');
        btn.textContent = label;
        btn.title = title;
        btn.dataset.act = act;
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          handleCardAction(act, n.id);
        });
        return btn;
      };

      actions.appendChild(action('✎', 'rename', 'Rename (or double-click the title)'));
      actions.appendChild(action('▸', 'advance', 'Move to the next status'));
      actions.appendChild(action('＋', 'child', 'Add a sub-topic'));
      actions.appendChild(action('⏱', 'log', 'Log time on this topic'));
      card.appendChild(actions);
    }

    /* collapsed branches keep a count so nothing disappears silently */
    if (n.hiddenKids) {
      const badge = html('button', 'card-badge');
      badge.textContent = '+' + n.hiddenKids;
      badge.title = 'Expand ' + n.hiddenKids + ' hidden sub-topics';
      badge.addEventListener('click', ev => { ev.stopPropagation(); toggleCollapse(n.id); });
      card.appendChild(badge);
    } else if (n.children.length) {
      const fold = html('button', 'card-badge card-fold');
      fold.textContent = '–';
      fold.title = 'Collapse this branch';
      fold.addEventListener('click', ev => { ev.stopPropagation(); toggleCollapse(n.id); });
      card.appendChild(fold);
    }

    card.addEventListener('pointerdown', ev => ev.stopPropagation());   // don't start a pan
    card.addEventListener('click', ev => { ev.stopPropagation(); select(n.id); });
    title.addEventListener('dblclick', ev => { ev.stopPropagation(); startRename(n.id); });

    fo.appendChild(card);
    g.appendChild(fo);

    if (editingId === n.id) queueMicrotask(() => openTitleEditor(card, n));
    return g;
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

  /* ---------------- viewport: pan, zoom, fit ---------------- */

  function applyView() {
    gViewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function fit(padding = 70) {
    if (!layoutRoot || !gNodes) return;
    const box = gNodes.getBBox();
    const rect = svg.getBoundingClientRect();
    if (!box.width || !box.height || !rect.width) return;

    const scale = Math.min(
      (rect.width  - padding * 2) / box.width,
      (rect.height - padding * 2) / box.height,
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
    if (!layoutRoot) return;
    const target = flatten(layoutRoot).find(n => n.id === nodeId);
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

  /* ---------------- selection, collapsing, modes ---------------- */

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

  function setLayout(mode) {
    layoutMode = mode === 'radial' ? 'radial' : 'cards';
    render();
    requestAnimationFrame(() => fit());
  }

  /* ---------------- init ---------------- */

  function init(opts) {
    svg       = document.getElementById('tree');
    gViewport = document.getElementById('viewport');
    gRings    = document.getElementById('rings');
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
    setRoot, setShowActivity, setLayout, startRename,
    get selectedId()   { return selectedId; },
    get rootId()       { return rootId; },
    get showActivity() { return showActivity; },
    get layoutMode()   { return layoutMode; },
  };
})();
