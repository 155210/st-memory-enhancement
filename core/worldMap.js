import { APP, BASE, USER } from './manager.js';
import { V2 } from './v2keys.js';
import { buildLocationTree, currentPlacePath, nodePath, renderTreeText } from './locationTree.js';
import { getHeaders, stripColumnMark } from './rowIdentity.js';
import { readRows, recentText, summaryHooks } from './summaryManager.js';

/**
 * @description P3 世界地图，设置里三选一：
 * @description - off：不画
 * @description - box：程序按地点树画框图，不花 token
 * @description - ai：让 AI 画当前地点的平面示意图（SVG），按地点缓存，只有到新地点才画
 */

export const MAP_MODES = ['off', 'box', 'ai'];
export const mapMode = () => (MAP_MODES.includes(USER.tableBaseSetting.v2_map_mode) ? USER.tableBaseSetting.v2_map_mode : 'box');

const clean = (v) => String(v ?? '').trim();
const esc = (text) => clean(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 时空表「此地角色」最新一格里的人 */
export function presentNames(sheets) {
    for (const sheet of sheets) {
        const col = getHeaders(sheet).findIndex(h => /此地角色|在场/.test(stripColumnMark(h)));
        if (col === -1) continue;
        const rows = readRows(sheet);
        const value = rows.length ? rows[rows.length - 1].values[col] : '';
        return clean(value).split(/[/、,，|｜\s]+/).map(clean).filter(Boolean);
    }
    return [];
}

/**
 * 程序画框图：当前地点所在的最大区域，子地点按格子排在父地点里，当前地点一路高亮
 * @returns {string} SVG，没有地点时为空串
 */
export function renderBoxMap(tree, present = [], width = 800, height = 560) {
    if (!tree.current) return '';
    let top = tree.current;
    while (top.parent && top.parent.parent) top = top.parent;
    const onPath = new Set();
    for (let n = tree.current; n && n.parent; n = n.parent) onPath.add(n);
    const parts = [];
    const draw = (node, x, y, w, h, depth) => {
        const isCurrent = node === tree.current;
        // 按框宽截字，约 12px 一个字
        const fit = (text) => { const max = Math.max(2, Math.floor((w - 12) / 12)); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
        const highlighted = onPath.has(node);
        parts.push(`<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${isCurrent ? 'var(--v2m-current)' : highlighted ? 'var(--v2m-path)' : 'var(--v2m-box)'}" stroke="var(--v2m-line)" stroke-width="${highlighted ? 2 : 1}"><title>${esc(nodePath(node).join('>'))}：去过 ${node.visits} 次</title></rect>`
            + `<text x="${(x + 6).toFixed(1)}" y="${(y + 15).toFixed(1)}" class="v2m-name">${esc(fit(node.name + (isCurrent ? ' ★' : '')))}</text></g>`);
        if (isCurrent && present.length) {
            parts.push(`<text x="${(x + 6).toFixed(1)}" y="${(y + 32).toFixed(1)}" class="v2m-people">${esc(fit(`在场：${present.slice(0, 8).join('、')}`))}<title>${esc(present.join('、'))}</title></text>`);
        }
        const children = [...node.children.values()].sort((a, b) => (onPath.has(b) - onPath.has(a)) || b.visits - a.visits).slice(0, 12);
        if (!children.length || depth >= 4 || w < 60 || h < 50) return;
        const top = isCurrent && present.length ? 40 : 22;
        const cols = Math.ceil(Math.sqrt(children.length * (w / h)));
        const rows = Math.ceil(children.length / cols);
        const pad = 6;
        const cw = (w - pad * (cols + 1)) / cols;
        const ch = (h - top - pad * (rows + 1)) / rows;
        if (cw < 30 || ch < 24) return;
        children.forEach((child, i) => {
            const cx = x + pad + (i % cols) * (cw + pad);
            const cy = y + top + pad + Math.floor(i / cols) * (ch + pad);
            draw(child, cx, cy, cw, ch, depth + 1);
        });
    };
    draw(top, 4, 4, width - 8, height - 8, 0);
    return `<svg class="v2-world-map" viewBox="0 0 ${width} ${height}" width="100%" style="${MAP_STYLE}">
<style>.v2-world-map{--v2m-line:var(--SmartThemeBodyColor,#888);--v2m-box:transparent;--v2m-path:color-mix(in srgb,var(--SmartThemeQuoteColor,#6a9) 18%,transparent);--v2m-current:color-mix(in srgb,var(--SmartThemeEmColor,#c96) 35%,transparent)}.v2m-name{font-size:13px;fill:var(--SmartThemeBodyColor,#ddd)}.v2m-people{font-size:12px;fill:var(--SmartThemeEmColor,#c96)}</style>
<g class="v2m-viewport">${parts.join('\n')}</g></svg>`;
}

const MAP_STYLE = 'height:auto;max-height:70vh;touch-action:none;user-select:none;-webkit-user-select:none';

/** AI 画的图：去掉写死的宽高，补上 viewBox，套上可缩放的一层，手机上按屏幕宽显示 */
export function fitSvg(svg) {
    const open = svg.match(/<svg\b[^>]*>/i);
    if (!open) return svg;
    let tag = open[0];
    const num = (name) => Number((tag.match(new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)`, 'i')) || [])[1]) || 0;
    if (!/viewBox\s*=/i.test(tag)) tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${num('width') || 600} ${num('height') || 400}"`);
    tag = tag.replace(/\s(width|height|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/<svg\b/i, `<svg width="100%" style="${MAP_STYLE}"`);
    if (!/class\s*=/.test(tag)) tag = tag.replace(/<svg\b/i, '<svg class="v2-ai-map"');
    const body = svg.slice(open.index + open[0].length).replace(/<\/svg>\s*$/i, '');
    if (/class="v2m-viewport"/.test(body)) return tag + body + '</svg>';
    return `${tag}<g class="v2m-viewport">${body}</g></svg>`;
}

/**
 * 地图的拖动和缩放：单指/鼠标拖动平移，双指捏合或滚轮缩放
 * @param {SVGSVGElement} svg 里面要有 .v2m-viewport
 */
export function attachMapZoom(svg) {
    const viewport = svg?.querySelector('.v2m-viewport');
    if (!viewport) return;
    let scale = 1, tx = 0, ty = 0;
    const apply = () => viewport.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    const toSvg = (event) => {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        return { x: vb.x + ((event.clientX - rect.left) / rect.width) * vb.width, y: vb.y + ((event.clientY - rect.top) / rect.height) * vb.height };
    };
    const zoomAt = (p, next) => {
        next = Math.min(6, Math.max(0.5, next));
        tx = p.x - ((p.x - tx) * next) / scale; ty = p.y - ((p.y - ty) * next) / scale;
        scale = next;
        apply();
    };
    const pointers = new Map();
    let pan = null, pinch = null;
    const pinchState = () => {
        const [a, b] = [...pointers.values()];
        return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    svg.addEventListener('pointerdown', (event) => {
        const p = toSvg(event);
        pointers.set(event.pointerId, p);
        svg.setPointerCapture(event.pointerId);
        if (pointers.size === 2) { pan = null; pinch = { ...pinchState(), scale }; return; }
        pan = { x: p.x - tx, y: p.y - ty };
    });
    const release = (event) => {
        pointers.delete(event.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!pointers.size) pan = null;
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);
    svg.addEventListener('pointermove', (event) => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, toSvg(event));
        if (pinch && pointers.size === 2) {
            const now = pinchState();
            if (pinch.dist > 0) zoomAt(now.mid, pinch.scale * (now.dist / pinch.dist));
            return;
        }
        if (!pan) return;
        const p = toSvg(event);
        tx = p.x - pan.x; ty = p.y - pan.y;
        apply();
    });
    svg.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoomAt(toSvg(event), scale * (event.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
    svg.addEventListener('dblclick', () => { scale = 1; tx = 0; ty = 0; apply(); });
}

/** 只留安全的 SVG：去掉脚本、事件属性、外链 */
export function sanitizeSvg(raw) {
    let svg = completeSvg(raw);
    if (!svg) return '';
    svg = svg
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|xlink:href)\s*=\s*("|')\s*(javascript|data|https?):[^"']*\2/gi, '');
    if (APP.DOMPurify?.sanitize) svg = APP.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    return svg;
}

/** 回复是不是写到一半被截断了（有 <svg 没有 </svg>） */
export function svgTruncated(raw) {
    const text = String(raw || '');
    return /<svg\b/i.test(text) && !/<\/svg>/i.test(text);
}

/** 取出 SVG；被截断时丢掉最后半个标签，补上 </svg>，能画多少画多少 */
function completeSvg(raw) {
    const text = String(raw || '');
    const full = text.match(/<svg[\s\S]*<\/svg>/i);
    if (full) return full[0];
    const start = text.search(/<svg\b/i);
    if (start === -1) return '';
    const cut = text.slice(start, text.lastIndexOf('>') + 1);
    if (!/^<svg\b[^>]*>/i.test(cut)) return '';
    // 没闭合的 <text>/<g> 补上，免得后面的 </svg> 被吞
    const open = (tag) => (cut.match(new RegExp(`<${tag}\\b(?:[^>]*[^/>])?>`, 'gi')) || []).length - (cut.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    return cut + '</text>'.repeat(Math.max(0, open('text'))) + '</g>'.repeat(Math.max(0, open('g'))) + '</svg>';
}

const AI_MAP_SYSTEM = `你是地图绘制员。根据用户给的地点和最近剧情，画当前地点的平面示意图。
要求：
1. 只输出一段 SVG 代码：<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">……</svg>，不要解释。
2. 用方框代表房间、建筑或区域，用线或箭头表示通道和出入口，中文标注名字（font-size 12 到 16）。
3. 用小圆点加名字标出在场人物的位置，<user> 用不同颜色。
4. 只画剧情里出现过或合理推断的结构，不要写实细节，不要图片、脚本和外链。
5. 代码要短：不写注释，不写多余属性，元素总数控制在 80 个以内，免得超出回复长度被截断。`;

/** 画布大小跟屏幕走：手机竖屏就画成竖的，1 个单位约等于 1 像素，字不会被缩得太小 */
export function mapSize() {
    const w = globalThis.innerWidth || 0, h = globalThis.innerHeight || 0;
    if (!w || !h) return { width: 600, height: 400 };
    return { width: Math.max(320, Math.round(Math.min(w, 1000) - 100)), height: Math.max(360, Math.round(h * 0.55)) };
}

/** 当前地点的缓存地图 */
export function cachedMap(path) {
    return USER.getContext().chatMetadata?.[V2.mapCache]?.[path] || null;
}

let drawing = false;

/**
 * 让 AI 画当前地点（ai 模式）；同一地点画过就用缓存
 * @param {boolean} force 重新画
 * @returns {Promise<{ path: string, svg: string, cached: boolean } | null>}
 */
export async function drawAiMap(force = false, size = mapSize()) {
    const { piece } = BASE.getLastSheetsPiece();
    const sheets = piece ? BASE.hashSheetsToSheets(BASE.getPieceHash(piece)) : [];
    const tree = buildLocationTree(USER.getContext().chat || [], sheets);
    const path = currentPlacePath(tree);
    if (!path) return null;
    const cached = cachedMap(path);
    if (cached && !force) return { path, svg: cached.svg, cached: true };
    if (drawing) return null;
    drawing = true;
    try {
        const node = tree.current;
        const siblings = node.parent ? [...node.parent.children.keys()].filter(n => n !== node.name) : [];
        const prompt = [
            `当前地点：${path}`,
            node.children.size ? `里面去过的地方：${[...node.children.keys()].join('、')}` : '',
            siblings.length ? `同一层的其他地方：${siblings.slice(0, 10).join('、')}` : '',
            `在场人物：${presentNames(sheets).join('、') || '不详'}`,
            `最近剧情：\n${recentText(2).replace(/<tableEdit>[\s\S]*?<\/tableEdit>/g, '').slice(-3000)}`,
        ].filter(Boolean).join('\n');
        const system = AI_MAP_SYSTEM.replace('{W}', size.width).replace('{H}', size.height)
            + (size.height > size.width ? '\n6. 画布是竖的（给手机看），房间从上往下排，字不要小于 14。' : '');
        const raw = await summaryHooks.ask(system, prompt, `画地图：${path}`);
        const svg = sanitizeSvg(raw);
        if (!svg) throw new Error('AI 没有返回 SVG');
        const truncated = svgTruncated(raw);
        const meta = USER.getContext().chatMetadata;
        meta[V2.mapCache] ||= {};
        meta[V2.mapCache][path] = { svg, at: new Date().toISOString() };
        // 只留最近 30 个地点的图，避免聊天文件变大
        const keys = Object.keys(meta[V2.mapCache]);
        keys.slice(0, Math.max(0, keys.length - 30)).forEach(k => delete meta[V2.mapCache][k]);
        await USER.saveChat();
        return { path, svg, cached: false, truncated };
    } finally {
        drawing = false;
    }
}

/** 收到新消息后：ai 模式且到了新地点时，在后台画一张 */
export async function maybeDrawOnNewPlace() {
    if (mapMode() !== 'ai') return null;
    try {
        return await drawAiMap(false);
    } catch (error) {
        console.warn('[记忆表格 v2] 自动画地图失败', error);
        return null;
    }
}

/** 地图弹窗内容 */
export function mapPanelHtml(tree, present, mode = mapMode()) {
    const path = currentPlacePath(tree);
    const header = `<p style="margin:0 0 6px">当前地点：<b>${esc(path || '不详')}</b>${present.length ? `　在场：${esc(present.join('、'))}` : ''}</p>`;
    let body = '';
    if (mode === 'box') {
        const { width, height } = mapSize();
        body = renderBoxMap(tree, present, width, height) || '<p>还没有地点记录</p>';
    }
    if (mode === 'ai') {
        const cached = path ? cachedMap(path) : null;
        body = cached ? fitSvg(cached.svg) : '<p>这个地点还没有 AI 画的图，点下面的「让 AI 画」。</p>';
    }
    const treeText = renderTreeText(tree);
    return `${header}${body}<details><summary>地点树</summary><pre style="white-space:pre-wrap;text-align:left">${esc(treeText || '还没有地点记录')}</pre></details>`;
}
