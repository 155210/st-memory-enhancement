import { USER } from './manager.js';
import { getHeaders, isNameKeyedSheet, parseNameCell, stripColumnMark } from './rowIdentity.js';
import { collectNames, findRolesInText, readRows, recentText, summaryConfig } from './summaryManager.js';
import { isPairSheet } from './sendTiers.js';

/**
 * @description P12 角色关系图：读角色表、社交表和大总结的「涉及角色」，在浏览器里用 SVG 画成关系网
 * @description - 实线：社交表里角色对 <user> 的关系，线上写关系词
 * @description - 彩色实线：角色关系表里角色和角色之间的关系
 * @description - 虚线：在同几条总结里一起出现过的两个人，越常一起出现线越深
 * @description 只给你看，不发给 AI；最多 30 个人，按出场多少挑
 */

const clean = (v) => String(v ?? '').trim();
const esc = (text) => clean(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * 从表格算出关系网
 * @returns {{ nodes: { id: string, label: string, weight: number, isUser: boolean }[], edges: { a: string, b: string, label: string, weight: number, kind: 'relation'|'together' }[] }}
 */
export function buildGraph(sheets, maxNodes = 30) {
    const userName = clean(USER.getContext().name1) || '<user>';
    const names = collectNames(sheets);
    const weight = new Map();
    const bump = (name, n = 1) => weight.set(name, (weight.get(name) || 0) + n);
    for (const primary of new Set(names.values())) bump(primary, 0);

    // 总结里的同场
    const { summaryTable, archiveTable } = summaryConfig();
    const together = new Map();
    for (const sheet of sheets.filter(s => s.name === summaryTable || s.name === archiveTable)) {
        const rolesCol = getHeaders(sheet).findIndex(h => stripColumnMark(h) === '涉及角色');
        for (const row of readRows(sheet)) {
            const roles = rolesCol >= 0 && row.values[rolesCol]
                ? row.values[rolesCol].split(/[|｜/、,，]/).map(clean).filter(n => weight.has(n))
                : findRolesInText(row.values.join(' '), names, 6);
            const unique = [...new Set(roles)];
            unique.forEach(n => bump(n, 2));
            for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
                const key = [unique[i], unique[j]].sort().join('\u0000');
                together.set(key, (together.get(key) || 0) + 1);
            }
        }
    }
    findRolesInText(recentText(30), names, 100).forEach(n => bump(n, 3));

    // 社交表：对 <user> 的关系
    const relations = [];
    for (const sheet of sheets.filter(isNameKeyedSheet)) {
        const col = getHeaders(sheet).findIndex(h => /关系/.test(stripColumnMark(h)));
        if (col <= 0) continue;
        for (const row of readRows(sheet)) {
            const { primary } = parseNameCell(row.values[0]);
            const relation = clean(row.values[col]);
            if (!primary || !relation || !weight.has(primary)) continue;
            relations.push({ a: userName, b: primary, label: short(relation, 40), weight: 1, kind: 'relation' });
            bump(primary, 1);
        }
    }

    // 角色关系表：角色之间的关系
    const pairs = [];
    const toId = (name) => {
        const n = parseNameCell(name).primary;
        if (!n) return '';
        if (n === userName || /^(<user>|\{\{user\}\}|你|我|主角)$/i.test(n)) return userName;
        return names.get(n) || n;
    };
    const hasUserRelation = new Set(relations.map(e => e.b));
    const seenPairs = new Set();
    for (const sheet of sheets.filter(isPairSheet)) {
        const col = getHeaders(sheet).findIndex((h, i) => i >= 2 && /关系/.test(stripColumnMark(h)));
        for (const row of readRows(sheet)) {
            const a = toId(row.values[0]), b = toId(row.values[1]);
            const label = clean(row.values[col >= 0 ? col : 2]);
            if (!a || !b || a === b || !label) continue;
            if ((a === userName && hasUserRelation.has(b)) || (b === userName && hasUserRelation.has(a))) continue;
            const key = [a, b].sort().join('\u0000');
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            pairs.push({ a, b, label: short(label, 40), weight: 1, kind: 'pair' });
            if (a !== userName) bump(a, 1);
            if (b !== userName) bump(b, 1);
        }
    }

    const picked = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(1, maxNodes - 1)).map(([n]) => n);
    const keep = new Set([userName, ...picked]);
    const nodes = [{ id: userName, label: userName, weight: Infinity, isUser: true }, ...picked.map(n => ({ id: n, label: n, weight: weight.get(n), isUser: false }))];
    const edges = [
        ...relations.filter(e => keep.has(e.b)),
        ...pairs.filter(e => keep.has(e.a) && keep.has(e.b)),
        ...[...together.entries()].map(([key, n]) => { const [a, b] = key.split('\u0000'); return { a, b, label: `同场 ${n} 次`, weight: n, kind: 'together' }; })
            .filter(e => keep.has(e.a) && keep.has(e.b) && e.weight >= 2),
    ];
    return { nodes, edges };
}

/**
 * 力导向布局（确定性：起点排成圆）
 * @returns {Map<string, { x: number, y: number }>}
 */
export function layoutGraph(graph, width = 800, height = 600, iterations = 300) {
    const { nodes, edges } = graph;
    const pos = new Map();
    const cx = width / 2, cy = height / 2;
    nodes.forEach((n, i) => {
        if (n.isUser) return pos.set(n.id, { x: cx, y: cy });
        const angle = (2 * Math.PI * i) / Math.max(1, nodes.length - 1);
        pos.set(n.id, { x: cx + Math.cos(angle) * width * 0.35, y: cy + Math.sin(angle) * height * 0.35 });
    });
    const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.9;
    const userId = nodes.find(n => n.isUser)?.id;
    let temp = width / 10;
    for (let it = 0; it < iterations; it++) {
        const disp = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]));
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const a = pos.get(nodes[i].id), b = pos.get(nodes[j].id);
            let dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.max(0.01, Math.hypot(dx, dy));
            const f = (k * k) / d;
            dx = (dx / d) * f; dy = (dy / d) * f;
            disp.get(nodes[i].id).x += dx; disp.get(nodes[i].id).y += dy;
            disp.get(nodes[j].id).x -= dx; disp.get(nodes[j].id).y -= dy;
        }
        for (const e of edges) {
            const a = pos.get(e.a), b = pos.get(e.b);
            if (!a || !b) continue;
            let dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.max(0.01, Math.hypot(dx, dy));
            // 人人都连着你，你的线拉得太紧会全挤在中间，所以放松一些
            const f = ((d * d) / k) * (e.kind === 'together' ? 0.3 : e.a === userId || e.b === userId ? 0.35 : 1);
            dx = (dx / d) * f; dy = (dy / d) * f;
            disp.get(e.a).x -= dx; disp.get(e.a).y -= dy;
            disp.get(e.b).x += dx; disp.get(e.b).y += dy;
        }
        for (const n of nodes) {
            if (n.isUser) continue;   // 你固定在中间
            const p = pos.get(n.id), v = disp.get(n.id);
            const len = Math.max(0.01, Math.hypot(v.x, v.y));
            p.x = Math.min(width - 40, Math.max(40, p.x + (v.x / len) * Math.min(len, temp)));
            p.y = Math.min(height - 30, Math.max(30, p.y + (v.y / len) * Math.min(len, temp)));
        }
        temp = Math.max(1, temp * 0.98);
    }
    return pos;
}

/** 线上的关系词：每行 7 个字，最多 4 行，超出的在最后一行末尾加…；完整内容放在 title 里 */
function edgeLabel(label, x, y) {
    const text = clean(label);
    const per = 7, maxLines = 4;
    const lines = [];
    for (let i = 0; i < text.length && lines.length < maxLines; i += per) lines.push(text.slice(i, i + per));
    if (text.length > per * maxLines) lines[maxLines - 1] = lines[maxLines - 1].slice(0, per - 1) + '…';
    const top = y - 4 - (lines.length - 1) * 13 / 2;
    const spans = lines.map((line, i) => `<tspan x="${x}" y="${(top + i * 13).toFixed(1)}">${esc(line)}</tspan>`).join('');
    return `<text x="${x}" y="${top.toFixed(1)}" class="v2g-label" text-anchor="middle"><title>${esc(text)}</title>${spans}</text>`;
}

/** 画成 SVG 字符串 */
export function renderGraphSvg(graph, pos, width = 800, height = 600) {
    const maxTogether = Math.max(1, ...graph.edges.filter(e => e.kind === 'together').map(e => e.weight));
    const lines = graph.edges.map(e => {
        const a = pos.get(e.a), b = pos.get(e.b);
        if (!a || !b) return '';
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (e.kind === 'relation' || e.kind === 'pair') {
            const stroke = e.kind === 'pair' ? 'var(--v2g-pair)' : 'var(--v2g-line)';
            return `<g class="v2g-edge" data-a="${esc(e.a)}" data-b="${esc(e.b)}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${stroke}" stroke-width="1.5"/>${edgeLabel(e.label, mx, my)}</g>`;
        }
        const opacity = (0.25 + 0.6 * (e.weight / maxTogether)).toFixed(2);
        return `<g class="v2g-edge" data-a="${esc(e.a)}" data-b="${esc(e.b)}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--v2g-line)" stroke-dasharray="4 4" stroke-opacity="${opacity}"><title>${esc(e.a)} 和 ${esc(e.b)}：${esc(e.label)}</title></line></g>`;
    }).join('');
    const maxWeight = Math.max(1, ...graph.nodes.filter(n => !n.isUser).map(n => n.weight));
    const circles = graph.nodes.map(n => {
        const p = pos.get(n.id);
        const base = Math.max(6, Math.min(width, height) / 50);
        const r = n.isUser ? base * 1.8 : base + base * (n.weight / maxWeight);
        return `<g class="v2g-node" data-id="${esc(n.id)}" transform="translate(${p.x},${p.y})" style="cursor:grab"><circle r="${r.toFixed(1)}" fill="${n.isUser ? 'var(--v2g-user)' : 'var(--v2g-node)'}" stroke="var(--v2g-line)"/><text y="${(r + 13).toFixed(1)}" text-anchor="middle" class="v2g-name">${esc(n.label)}</text></g>`;
    }).join('');
    // 人少时关系词全显示；人多时先藏起来，点一个人只显示他的关系，免得字叠成一团
    const showAll = graph.nodes.length <= 10 ? ' v2g-show-all' : '';
    return `<svg class="v2-relation-graph${showAll}" viewBox="0 0 ${width} ${height}" width="100%" style="height:auto;max-height:75vh;touch-action:none;user-select:none;-webkit-user-select:none">
<style>.v2-relation-graph{--v2g-line:var(--SmartThemeBodyColor,#888);--v2g-node:var(--SmartThemeQuoteColor,#6a9);--v2g-user:var(--SmartThemeEmColor,#c96);--v2g-pair:var(--SmartThemeQuoteColor,#6a9)}.v2g-label{font-size:11px;fill:var(--SmartThemeBodyColor,#ccc);paint-order:stroke;stroke:var(--SmartThemeBlurTintColor,#1a1a2e);stroke-width:3px;stroke-linejoin:round}.v2g-name{font-size:13px;fill:var(--SmartThemeBodyColor,#eee);paint-order:stroke;stroke:var(--SmartThemeBlurTintColor,#1a1a2e);stroke-width:3px;stroke-linejoin:round}.v2-relation-graph:not(.v2g-show-all):not(.v2g-focus) .v2g-label{display:none}.v2g-focus .v2g-edge:not(.v2g-on) .v2g-label{display:none}.v2g-focus .v2g-edge:not(.v2g-on),.v2g-focus .v2g-node:not(.v2g-on){opacity:.12}.v2g-focus .v2g-edge.v2g-on line{stroke-width:2.5}</style>
<g class="v2g-viewport">${lines}${circles}</g></svg>`;
}

/** 给画好的图加上拖动节点、拖动画布和滚轮缩放 */
export function attachGraphInteraction(svg, graph, pos) {
    if (!svg) return;
    const viewport = svg.querySelector('.v2g-viewport');
    let scale = 1, tx = 0, ty = 0;
    const apply = () => viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    const toSvg = (event) => {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        return { x: ((event.clientX - rect.left) / rect.width) * vb.width, y: ((event.clientY - rect.top) / rect.height) * vb.height };
    };
    const redrawEdges = (id) => {
        svg.querySelectorAll('.v2g-edge').forEach(g => {
            if (g.dataset.a !== id && g.dataset.b !== id) return;
            const a = pos.get(g.dataset.a), b = pos.get(g.dataset.b);
            const line = g.querySelector('line');
            line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
            const text = g.querySelector('text');
            if (text) {
                // 多行标签：整体跟着线的中点走
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const spans = [...text.querySelectorAll('tspan')];
                const top = my - 4 - (spans.length - 1) * 13 / 2;
                text.setAttribute('x', mx); text.setAttribute('y', top);
                spans.forEach((span, i) => { span.setAttribute('x', mx); span.setAttribute('y', top + i * 13); });
            }
        });
    };
    let drag = null;
    // 手机双指缩放：记下每个手指的位置
    const pointers = new Map();
    let pinch = null;
    const zoomAt = (p, next) => {
        next = Math.min(4, Math.max(0.3, next));
        tx = p.x - ((p.x - tx) * next) / scale; ty = p.y - ((p.y - ty) * next) / scale;
        scale = next;
        apply();
    };
    const pinchState = () => {
        const [a, b] = [...pointers.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    svg.addEventListener('pointerdown', (event) => {
        const p = toSvg(event);
        pointers.set(event.pointerId, p);
        svg.setPointerCapture(event.pointerId);
        if (pointers.size === 2) {
            drag = null;
            pinch = { ...pinchState(), scale };
            return;
        }
        const node = event.target.closest('.v2g-node');
        drag = node ? { id: node.dataset.id, node } : { pan: true, x: p.x - tx, y: p.y - ty };
        drag.start = p;
        drag.moved = false;
    });
    // 点一个人：只亮出和他有关的线和关系词；再点一次或点空白处复原
    let focused = null;
    const focus = (id) => {
        focused = id && id !== focused ? id : null;
        svg.classList.toggle('v2g-focus', !!focused);
        const on = new Set(focused ? [focused] : []);
        svg.querySelectorAll('.v2g-edge').forEach(g => {
            const hit = !!focused && (g.dataset.a === focused || g.dataset.b === focused);
            g.classList.toggle('v2g-on', hit);
            if (hit) { on.add(g.dataset.a); on.add(g.dataset.b); }
        });
        svg.querySelectorAll('.v2g-node').forEach(g => g.classList.toggle('v2g-on', on.has(g.dataset.id)));
    };
    const release = (event) => {
        if (drag && !drag.moved && pointers.size === 1 && event.type === 'pointerup') focus(drag.id || null);
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) drag = null;
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
    svg.addEventListener('pointermove', (event) => {
        if (pointers.has(event.pointerId)) pointers.set(event.pointerId, toSvg(event));
        if (pinch && pointers.size === 2) {
            const now = pinchState();
            if (pinch.dist > 0) zoomAt(now.mid, pinch.scale * (now.dist / pinch.dist));
            return;
        }
        if (!drag) return;
        const p = toSvg(event);
        if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 5) return;
        drag.moved = true;
        if (drag.pan) { tx = p.x - drag.x; ty = p.y - drag.y; return apply(); }
        const point = pos.get(drag.id);
        point.x = (p.x - tx) / scale; point.y = (p.y - ty) / scale;
        drag.node.setAttribute('transform', `translate(${point.x},${point.y})`);
        redrawEdges(drag.id);
    });
    svg.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoomAt(toSvg(event), scale * (event.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
}
