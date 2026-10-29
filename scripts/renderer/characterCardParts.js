/**
 * @description 角色资料卡的小零件：转义、数值条、生理周期条、变化曲线、小关系图、对比表
 * @description 只拼 HTML / SVG 字符串，不碰数据，不发给 AI
 */

export const clean = (v) => String(v ?? '').trim();
/** HTML 转义（属性里也能用） */
export const esc = (text) => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const short = (text, max) => { const s = clean(text); return s.length > max ? `${s.slice(0, max)}…` : s; };
/** 第一行做预览 */
export const firstLine = (text, max = 40) => short(clean(text).split('\n')[0], max);
/** 带正负号的变化量 */
export const signed = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n}` : '');

/** 细进度条：value / max */
export function meterHtml(value, max) {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return '';
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    const level = value > max ? ' is-over' : pct >= 80 ? ' is-high' : '';
    return `<div class="v2cc-meter${level}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
}

/** 生理周期：月经期 2 / 安全期 3 / 排卵期 4，按天数比例画三段 */
const CYCLE = [['月经期', 2], ['安全期', 3], ['排卵期', 4]];
export function cycleHtml(text) {
    const s = clean(text);
    const current = CYCLE.find(([name]) => s.includes(name))?.[0];
    if (!current) return '';
    const left = s.match(/剩余(?:时间)?\s*(\d+)\s*天/)?.[1];
    const segs = CYCLE.map(([name, days]) =>
        `<div class="v2cc-cycle-seg${name === current ? ' is-on' : ''}" style="flex:${days}"><span>${name}</span></div>`).join('');
    return `<div class="v2cc-cycle"><div class="v2cc-cycle-head"><span class="v2cc-k">生理周期</span><span>${esc(current)}${left !== undefined ? ` · 剩余 ${esc(left)} 天` : ''}</span></div><div class="v2cc-cycle-bar">${segs}</div></div>`;
}

/**
 * 变化曲线（SVG 折线，不用库）
 * @param {{ f: number, v: number, d?: number, r?: string }[]} points
 * @param {number} picked 选中的点下标
 */
export function curveSvg(points, picked = -1) {
    const W = 320, H = 120, L = 30, R = 10, T = 10, B = 22;
    const vs = points.map(p => p.v);
    let min = Math.min(...vs), max = Math.max(...vs);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    min = Math.floor(min - pad); max = Math.ceil(max + pad);
    const fx = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
    const fy = (v) => T + ((max - v) * (H - T - B)) / (max - min);
    const line = points.map((p, i) => `${fx(i).toFixed(1)},${fy(p.v).toFixed(1)}`).join(' ');
    const dots = points.map((p, i) => {
        const x = fx(i).toFixed(1), y = fy(p.v).toFixed(1);
        // 大一圈的透明圆方便手指点
        return `<g class="v2cc-pt${i === picked ? ' is-on' : ''}" data-act="curve-pt" data-i="${i}"><circle class="v2cc-pt-hit" cx="${x}" cy="${y}" r="13"/><circle class="v2cc-pt-dot" cx="${x}" cy="${y}" r="${i === picked ? 5 : 3.5}"/></g>`;
    }).join('');
    const first = points[0], last = points[points.length - 1];
    const axis = `<text x="${L - 4}" y="${fy(max) + 4}" text-anchor="end">${max}</text><text x="${L - 4}" y="${fy(min) + 4}" text-anchor="end">${min}</text>`
        + `<text x="${fx(0)}" y="${H - 6}" text-anchor="start">第${first.f}楼</text>`
        + (points.length > 1 ? `<text x="${fx(points.length - 1)}" y="${H - 6}" text-anchor="end">第${last.f}楼</text>` : '');
    return `<svg class="v2cc-curve-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`
        + `<line class="v2cc-axis" x1="${L}" y1="${fy(max)}" x2="${W - R}" y2="${fy(max)}"/><line class="v2cc-axis" x1="${L}" y1="${fy(min)}" x2="${W - R}" y2="${fy(min)}"/>`
        + `${axis}<polyline class="v2cc-line" points="${line}"/>${dots}</svg>`;
}

/**
 * 小关系图：这个人在中间，相关的人围一圈，线上写关系
 * @param {string} center
 * @param {{ name: string, label: string, link: string|null }[]} others
 */
export function egoGraphSvg(center, others) {
    const list = others.slice(0, 12);
    const W = 320, H = list.length > 6 ? 300 : list.length > 2 ? 250 : 150, cx = W / 2, cy = H / 2;
    const r = list.length > 2 ? Math.min(W, H) / 2 - 34 : 110;
    const nodes = list.map((o, i) => {
        // 两个人时左右摆，别竖成一条线
        const a = (list.length === 2 ? 0 : -Math.PI / 2) + (2 * Math.PI * i) / Math.max(1, list.length);
        return { ...o, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
    const edges = nodes.map(n => {
        const mx = (cx + n.x) / 2, my = (cy + n.y) / 2;
        return `<line x1="${cx}" y1="${cy}" x2="${n.x.toFixed(1)}" y2="${n.y.toFixed(1)}"/>`
            + (n.label ? `<text class="v2cc-eg-label" x="${mx.toFixed(1)}" y="${(my + 4).toFixed(1)}" text-anchor="middle">${esc(short(n.label, 6))}</text>` : '');
    }).join('');
    const circles = nodes.map(n =>
        `<g class="v2cc-eg-node${n.link ? ' is-link' : ''}"${n.link ? ` data-act="pick" data-name="${esc(n.link)}"` : ''} transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})"><circle r="16"/><text y="30" text-anchor="middle">${esc(short(n.name, 5))}</text></g>`).join('');
    return `<svg class="v2cc-ego" viewBox="0 0 ${W} ${H}"><g class="v2cc-eg-edges">${edges}</g>`
        + `<g class="v2cc-eg-node is-center" transform="translate(${cx},${cy})"><circle r="24"/><text y="4" text-anchor="middle">${esc(short(center, 4))}</text></g>${circles}</svg>`;
}

/** 头像圆：有图用图，没有用名字第一个字 */
export function avatarHtml(name, dataUrl, cls = '') {
    const inner = dataUrl ? `<img src="${esc(dataUrl)}" alt="">` : `<span>${esc(clean(name).slice(0, 1))}</span>`;
    return `<span class="v2cc-ava ${cls}">${inner}</span>`;
}
