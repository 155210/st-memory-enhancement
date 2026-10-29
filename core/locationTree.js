import { USER } from './manager.js';
import { getHeaders, stripColumnMark } from './rowIdentity.js';
import { readRows } from './summaryManager.js';

/**
 * @description P4 地点树：从每条 AI 回复的时间标签里拆出地点，按由大到小组成一棵树，同一个地方不重复建
 * @description 标签例：『2025年6月15日-星期日–18:15-城南安置房7栋6楼走廊-闷热·天色暗沉』，- 和 – 混用都认
 * @description 一轮里有多个标签时都记进树，当前地点取最后一个；没有标签时用时空表的地点列
 * @description 树每次从聊天记录现算，不另外存
 */

const TAG = /『([^』]*)』/g;
const NUM = '\\d〇零一二三四五六七八九十百千廿卅两元正冬腊初';
// 年号纪年也认：「崇德5年3月19日」「崇德五年三月十九」「3月19日」
const DATE = new RegExp(`[${NUM}]+年(?:[${NUM}]+月)?(?:[${NUM}]+日?)?|[${NUM}]+月[${NUM}]+日?|\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}`);
const PERIOD = '凌晨|清晨|早晨|早上|上午|中午|正午|午后|下午|傍晚|黄昏|晚上|夜晚|入夜|深夜|午夜|半夜|夜里';
const TIME = new RegExp(`^(?:\\d{1,2}[:：,，.]\\d{2}(?:[:：,，.]\\d{2})?|(?:${PERIOD})?[${NUM}]+[点时](?:半|[${NUM}]+分?)?|[子丑寅卯辰巳午未申酉戌亥]时.{0,3}|(?:${PERIOD}).{0,2})$`);
const WEEK = /^(星期|周|礼拜)[一二三四五六日天]$/;
// 由大到小的地名后缀，切开后每段是一层
const MARKERS = ['自治区', '特别行政区', '省', '市', '区', '县', '镇', '乡', '村', '街道', '大街', '街', '路', '巷', '胡同', '小区', '花园', '公寓', '安置房', '新村', '大学', '学院', '中学', '小学', '学校', '医院', '公司', '大厦', '广场', '公园', '商场', '酒店', '宾馆', '别墅', '庄园', '宫', '城', '府', '号楼', '栋', '幢', '座', '单元', '楼', '层', '室', '号'];
const MARKER_RE = new RegExp(`(.*?(?:${MARKERS.sort((a, b) => b.length - a.length).join('|')}))`, 'g');
const EXPLICIT = /\s*[>＞/／→·・•]\s*/;

const clean = (v) => String(v ?? '').trim();
const isDate = (p) => DATE.test(p) && p.replace(DATE, '').replace(/[\s,，]/g, '').length <= 4;

/** 拆一个时间标签 → { date, time, place }，拆不出的段为空；没有日期也没有时间的『』不算时间标签 */
export function parseTimeTag(tag) {
    const parts = clean(tag).replace(/^『|』$/g, '').split(/\s*[-–—|｜]\s*|\s+/).map(clean).filter(Boolean);
    const result = { date: '', time: '', place: '', weather: '' };
    result.date = parts.find(isDate) || '';
    const timeAt = parts.findIndex(p => TIME.test(p));
    if (timeAt !== -1) result.time = parts[timeAt];
    if (!result.date && !result.time) return result;
    // 地点：时间后面第一段（没有时间就是日期后面第一段），跳过日期、星期、时间
    const after = Math.max(timeAt, parts.findIndex(isDate));
    const rest = (i) => i > after && !isDate(parts[i]) && !WEEK.test(parts[i]) && !TIME.test(parts[i]);
    const placeAt = parts.findIndex((_, i) => rest(i));
    if (placeAt !== -1) {
        result.place = parts[placeAt];
        result.weather = parts.slice(placeAt + 1).join(' ');
    }
    return result;
}

/** 地点 → 由大到小的几段 */
export function splitPlace(place) {
    const text = clean(place);
    if (!text) return [];
    if (EXPLICIT.test(text)) return text.split(EXPLICIT).map(clean).filter(Boolean);
    const segments = [];
    let rest = text;
    let match;
    MARKER_RE.lastIndex = 0;
    let consumed = 0;
    while ((match = MARKER_RE.exec(text)) !== null) {
        segments.push(match[1]);
        consumed = MARKER_RE.lastIndex;
    }
    rest = text.slice(consumed);
    if (rest) segments.push(rest);
    // 单字段太碎：并到后一段（「城」+「南安置房」），最后一段并到前一段
    const merged = [];
    for (let i = 0; i < segments.length; i++) {
        if (segments[i].length === 1 && i + 1 < segments.length) segments[i + 1] = segments[i] + segments[i + 1];
        else if (segments[i].length === 1 && merged.length) merged[merged.length - 1] += segments[i];
        else merged.push(segments[i]);
    }
    return merged;
}

/** 一条消息里所有标签的地点（按出现顺序） */
export function placesInMessage(mes) {
    const places = [];
    for (const m of String(mes || '').matchAll(TAG)) {
        const { place } = parseTimeTag(m[1]);
        if (place) places.push(place);
    }
    return places;
}

function newNode(name, parent) {
    return { name, parent, children: new Map(), visits: 0, firstFloor: -1, lastFloor: -1 };
}

/** 节点从根到自己的名字 */
export function nodePath(node) {
    const path = [];
    for (let n = node; n && n.parent; n = n.parent) path.unshift(n.name);
    return path;
}

/**
 * 把一条路径放进树：
 * - 第一段已是根 → 照常往下走
 * - 否则在当前地点的祖先里找同名的那层或它的子节点，接在那里（「6楼走廊」接到当前所在的楼里）
 * - 都没有 → 新根
 */
function insertPath(root, segments, current) {
    let start = root;
    if (!root.children.has(segments[0]) && current) {
        for (let n = current; n && n.parent; n = n.parent) {
            if (n.children.has(segments[0])) { start = n; break; }
            if (n.name === segments[0]) { start = n.parent; break; }
        }
    }
    let node = start;
    for (const seg of segments) {
        if (!node.children.has(seg)) node.children.set(seg, newNode(seg, node));
        node = node.children.get(seg);
    }
    return node;
}

/**
 * 从聊天记录建树
 * @param {Object[]} chat
 * @param {Object[]} sheets 没有标签时用时空表的地点列
 * @returns {{ root: Object, current: Object|null, currentFloor: number }}
 */
export function buildLocationTree(chat = USER.getContext().chat || [], sheets = []) {
    const root = newNode('', null);
    let current = null;
    let currentFloor = -1;
    chat.forEach((m, floor) => {
        if (!m || m.is_user) return;
        for (const place of placesInMessage(m.mes)) {
            const segments = splitPlace(place);
            if (!segments.length) continue;
            const node = insertPath(root, segments, current);
            for (let n = node; n && n.parent; n = n.parent) {
                n.visits++;
                if (n.firstFloor === -1) n.firstFloor = floor;
                n.lastFloor = floor;
            }
            current = node;
            currentFloor = floor;
        }
    });
    if (!current) {
        // 没有任何时间标签：用时空表最新一行的地点
        for (const sheet of sheets) {
            const col = getHeaders(sheet).findIndex(h => /^地点/.test(stripColumnMark(h)));
            if (col === -1) continue;
            const rows = readRows(sheet);
            const place = rows.length ? rows[rows.length - 1].values[col] : '';
            const segments = splitPlace(place);
            if (segments.length) { current = insertPath(root, segments, null); current.visits = 1; break; }
        }
    }
    return { root, current, currentFloor };
}

/** 文字版地点树（给 AI 或面板看），当前地点标 ★ */
export function renderTreeText(tree, maxDepth = 6) {
    const lines = [];
    const currentPath = tree.current ? new Set(ancestors(tree.current)) : new Set();
    const walk = (node, depth) => {
        for (const child of node.children.values()) {
            const mark = child === tree.current ? ' ★当前' : currentPath.has(child) ? ' ·' : '';
            lines.push(`${'  '.repeat(depth)}- ${child.name}${mark}`);
            if (depth + 1 < maxDepth) walk(child, depth + 1);
        }
    };
    walk(tree.root, 0);
    return lines.join('\n');
}

function ancestors(node) {
    const out = [];
    for (let n = node; n && n.parent; n = n.parent) out.push(n);
    return out;
}

/** 当前地点的路径，例如「城南安置房>7栋>6楼>走廊」 */
export function currentPlacePath(tree) {
    return tree.current ? nodePath(tree.current).join('>') : '';
}
