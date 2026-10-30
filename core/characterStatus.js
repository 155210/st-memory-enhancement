import { USER } from './manager.js';
import { V2 } from './v2keys.js';

/**
 * @description 角色资料卡：读 AI 每层输出的状态标签（如 <Calculated_data>），存进本聊天的 chatMetadata
 * @description - 状态快照、数值变化曲线、出场楼层、书签、置顶、分组标签、私人备注、头像
 * @description - 规则自检（液体只增不减、胃/膀胱上限、高潮次数不减、突变、含糊词）
 * @description 只给你看，不发给 AI；只在收到新楼层时读这一层，不扫整段聊天
 */

const STATE_KEY = V2.characterCard ?? 'memory_enhancement_v2_character_card';
const clean = (v) => String(v ?? '').trim();
const USER_MARK = '\u0001';
const MAX_RECENT = 200;
const MAX_BOOKMARKS = 50;

/** 画曲线的字段：标签里的字段名包含左边的词就归到右边 */
const HISTORY_FIELDS = [['好感', '好感'], ['臣服', '臣服值'], ['体力', '体力'], ['快感', '快感'], ['高潮次数', '累计高潮次数']];
/** 应该是数字的字段，出现含糊词就提醒 */
const NUMERIC_HINTS = ['好感', '臣服', '体力', '快感', '高潮次数', '液体量', '胃部', '膀胱', '性爱次数'];
const VAGUE_WORDS = /多次|不详|未知/;
/** 正文里出现的这些词会记下来，规则自检时当作例外 */
const CUE_WORDS = ['清洗', '洗澡', '冲洗', '沐浴', '拔出', '抽出', '滑出', '脱出', '软掉', '呕吐', '吐了', '失禁'];
const WASH = ['清洗', '洗澡', '冲洗', '沐浴'];
const PLUG_OUT = ['拔出', '抽出', '滑出', '脱出', '软掉'];

// ---------------------------------------------------------------- 设置

/** 状态标签相关设置 */
export function statusConfig() {
    const s = USER.tableBaseSetting || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
    const fieldMap = new Map();
    for (const line of String(s.v2_card_field_map ?? '').split('\n')) {
        const at = line.indexOf('=');
        if (at <= 0) continue;
        const from = normalizeLabel(line.slice(0, at));
        const to = normalizeLabel(line.slice(at + 1));
        if (from && to) fieldMap.set(from, to);
    }
    return {
        tag: clean(s.v2_card_tag) || 'Calculated_data',
        fieldMap,
        historyPoints: Math.max(2, num(s.v2_card_history_points, 50)),
        ruleCheck: s.v2_card_rule_check !== false,
        jumpThreshold: num(s.v2_card_jump_threshold, 20),
    };
}

// ---------------------------------------------------------------- 解析

/** 字段名：去掉开头的表情、符号、「-」和空格，{{user}}/<user> 统一成 <user> */
function normalizeLabel(text) {
    let s = String(text ?? '').replace(/\{\{user\}\}|<user>/gi, USER_MARK);
    s = s.replace(/^[\s\p{Extended_Pictographic}\p{S}\p{P}‍️]+/u, '').trim();
    return s.split(USER_MARK).join('<user>');
}

/** 从 <summary> 那一行取角色名：「🌡️陈映竹数据」→ 陈映竹 */
function blockName(body) {
    const m = body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (!m) return '';
    const text = normalizeLabel(m[1].replace(/<[^>]+>/g, ''));
    const hit = text.match(/^(.+?)的?(?:状态)?数据$/) || text.match(/^(\S+?)数据/);
    return clean(hit ? hit[1] : text);
}

/**
 * 读出文本里的所有状态标签块（一个角色一块）
 * @returns {{ name: string, fields: Map<string, string>, raw: string }[]}
 */
export function parseStatusBlocks(text, tag) {
    const config = statusConfig();
    return readBlocks(text, tag ?? config.tag, config.fieldMap);
}

function readBlocks(text, tag, fieldMap) {
    text = String(text ?? '');
    const escTag = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const open = new RegExp(`<${escTag}(?:\\s[^>]*)?>`, 'gi');
    const close = new RegExp(`</${escTag}\\s*>`, 'i');
    const starts = [...text.matchAll(open)].map(m => ({ at: m.index, body: m.index + m[0].length }));
    const blocks = [];
    starts.forEach((s, i) => {
        // 没有闭合标签时读到下一个开标签或结尾
        const limit = i + 1 < starts.length ? starts[i + 1].at : text.length;
        const rest = text.slice(s.body, limit);
        const end = rest.search(close);
        const raw = end >= 0 ? rest.slice(0, end) : rest;
        blocks.push({ name: blockName(raw), fields: parseFields(raw, fieldMap), raw });
    });
    return blocks;
}

function parseFields(raw, fieldMap) {
    const body = raw.replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, '')
        .replace(/\{\{user\}\}|<user>/gi, USER_MARK).replace(/<[^>]+>/g, '');
    const fields = new Map();
    let last = null;      // 上一个字段，没有冒号的行接在它后面
    let multi = null;     // 正在收集的多行字段（服装），到空行为止
    for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.split(USER_MARK).join('<user>').trim();
        if (!line) { multi = null; last = null; continue; }
        if (multi) { fields.set(multi, [fields.get(multi), line].filter(Boolean).join('\n')); continue; }
        const at = line.search(/[:：]/);
        if (at <= 0) {
            if (last) fields.set(last, `${fields.get(last)}\n${line}`.trim());
            continue;
        }
        let label = normalizeLabel(line.slice(0, at));
        if (!label) continue;
        if (fieldMap?.has(label)) label = fieldMap.get(label);
        const value = clean(line.slice(at + 1));
        fields.set(label, value);
        last = label;
        if (!value && label.includes('服装')) multi = label;
    }
    return fields;
}

/**
 * 拆一个数值：「72 /100(+5)被救了」→ {num:72,max:100,delta:5,reason:'被救了'}；
 * 「牛奶:200ml+面包:150ml =350ml/1000ml(+200)」→ {ml:350,max:1000,delta:200}
 */
export function parseValue(raw) {
    const s = String(raw ?? '').replace(/−/g, '-');
    const out = {};
    let from = 0;
    const ml = s.match(/=\s*(\d+(?:\.\d+)?)\s*ml(?:\s*\/\s*(\d+(?:\.\d+)?)\s*ml)?/i);
    if (ml) {
        out.ml = Number(ml[1]);
        if (ml[2] !== undefined) out.max = Number(ml[2]);
        from = ml.index + ml[0].length;
    } else {
        const n = s.match(/^\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/);
        if (!n) return out;
        out.num = Number(n[1]);
        if (n[2] !== undefined) out.max = Number(n[2]);
        from = n.index + n[0].length;
    }
    const d = s.slice(from).match(/^\s*[(（]\s*([+-]?\d+(?:\.\d+)?)\s*[)）]\s*(.*)$/s);
    if (d) {
        out.delta = Number(d[1]);
        const reason = clean(d[2]);
        if (reason) out.reason = reason;
    }
    return out;
}

/** 数值：普通数字或 ml */
const valueNumber = (raw) => { const p = parseValue(raw); return p.num ?? p.ml; };

/** 字段名归到曲线字段：「对<user>好感」→ 好感 */
function historyKey(label) {
    for (const [word, key] of HISTORY_FIELDS) if (label.includes(word)) return key;
    return null;
}

// ---------------------------------------------------------------- 存储

const DEFAULT_STATE = () => ({ status: {}, history: {}, appear: {}, bookmarks: [], viewed: {}, pins: [], tags: {}, notes: {}, avatars: {}, avatarFull: {}, version: 1 });

/** 本聊天的资料卡数据（缺的键补默认值） */
export function cardState() {
    const meta = USER.getContext()?.chatMetadata;
    const fresh = DEFAULT_STATE();
    if (!meta) return fresh;
    const state = meta[STATE_KEY] && typeof meta[STATE_KEY] === 'object' ? meta[STATE_KEY] : (meta[STATE_KEY] = fresh);
    for (const [k, v] of Object.entries(fresh)) {
        if (state[k] === undefined || state[k] === null || Array.isArray(v) !== Array.isArray(state[k])) state[k] = v;
    }
    return state;
}

let saveTimer = null;
let lastSave = 0;
/** 延迟保存聊天，1 秒内最多一次 */
export function saveSoon() {
    if (saveTimer) return;
    const wait = Math.max(0, 1000 - (Date.now() - lastSave));
    saveTimer = setTimeout(() => {
        saveTimer = null;
        lastSave = Date.now();
        try { Promise.resolve(USER.saveChat()).catch(e => console.warn('[v2 资料卡] 保存失败', e)); } catch (e) { console.warn('[v2 资料卡] 保存失败', e); }
    }, wait);
}

// ---------------------------------------------------------------- 出场

function addAppear(state, primary, floor) {
    const a = state.appear[primary] ??= { first: floor, last: floor, count: 0, recent: [] };
    if (a.recent.includes(floor)) return;
    a.recent.push(floor);
    a.recent.sort((x, y) => x - y);
    if (a.recent.length > MAX_RECENT) a.recent = a.recent.slice(-MAX_RECENT);
    a.count = (a.count || 0) + 1;
    a.first = Math.min(a.first ?? floor, floor);
    a.last = Math.max(a.last ?? floor, floor);
}

/** 记下这些人在这一层出场（没输出标签的在场角色也算） */
export function markPresent(floor, primaries) {
    if (!Number.isInteger(floor) || floor < 0) return;
    const state = cardState();
    let changed = false;
    for (const p of primaries || []) {
        const name = clean(p);
        if (!name) continue;
        const before = state.appear[name]?.count;
        addAppear(state, name, floor);
        if (state.appear[name].count !== before) changed = true;
    }
    if (changed) saveSoon();
}

// ---------------------------------------------------------------- 读取一层

/**
 * 读这一层（当前 swipe）里的状态标签，存快照、曲线和出场
 * @param {number} mesIndex 楼层号
 * @param {Map<string,string>} names collectNames 的结果，外号 → 主名
 * @param {Iterable<string>} [present] 在场角色主名，没输出标签的也记出场
 * @returns {string[]} 读到的角色主名
 */
export function captureFromMessage(mesIndex, names, present = []) {
    const chat = USER.getContext()?.chat;
    const msg = chat?.[mesIndex];
    if (!msg || msg.is_user || msg.is_system) return [];
    const state = cardState();
    const config = statusConfig();
    const text = String(msg.mes ?? '');
    const cues = CUE_WORDS.filter(w => text.includes(w));

    // 同一个人在一层里有两块就合并
    const byPrimary = new Map();
    for (const block of readBlocks(text, config.tag, config.fieldMap)) {
        if (!block.name) continue;
        const primary = names?.get?.(block.name) ?? block.name;
        const fields = byPrimary.get(primary) || new Map();
        for (const [k, v] of block.fields) fields.set(k, v);
        byPrimary.set(primary, fields);
    }

    // 重 roll / 编辑同一层：先去掉这一层以前读到、这次没有了的人的快照
    for (const [primary, st] of Object.entries(state.status)) {
        if (st?.floor !== mesIndex || byPrimary.has(primary)) continue;
        dropHistoryAt(state, primary, (f) => f === mesIndex);
        if (st.prev && Number.isInteger(st.prevFloor)) state.status[primary] = { floor: st.prevFloor, swipe: 0, fields: st.prev, prev: null, prevFloor: null, cues: [], at: st.at };
        else delete state.status[primary];
    }

    for (const [primary, fieldMap] of byPrimary) {
        const fields = Object.fromEntries(fieldMap);
        const old = state.status[primary];
        // 改的是更早的楼层时不覆盖最新快照，只补曲线和出场
        if (!old || old.floor <= mesIndex) {
            const same = old && old.floor === mesIndex;
            state.status[primary] = {
                floor: mesIndex,
                swipe: msg.swipe_id ?? 0,
                fields,
                prev: same ? (old.prev ?? null) : (old?.fields ?? null),
                prevFloor: same ? (old.prevFloor ?? null) : (old?.floor ?? null),
                cues,
                at: Date.now(),
            };
        }
        // 曲线：同一层只留一个点
        dropHistoryAt(state, primary, (f) => f === mesIndex);
        const seen = new Set();
        for (const [label, value] of fieldMap) {
            const key = historyKey(label);
            if (!key || seen.has(key)) continue;
            const p = parseValue(value);
            if (!Number.isFinite(p.num)) continue;
            seen.add(key);
            const list = ((state.history[primary] ??= {})[key] ??= []);
            const point = { f: mesIndex, v: p.num };
            if (Number.isFinite(p.delta)) point.d = p.delta;
            if (p.reason) point.r = p.reason.slice(0, 40);
            list.push(point);
            list.sort((a, b) => a.f - b.f);
            if (list.length > config.historyPoints) list.splice(0, list.length - config.historyPoints);
        }
        addAppear(state, primary, mesIndex);
    }

    const captured = [...byPrimary.keys()];
    markPresent(mesIndex, [...present].filter(p => !byPrimary.has(p)));
    if (captured.length) saveSoon();
    return captured;
}

function dropHistoryAt(state, primary, test) {
    const fields = state.history[primary];
    if (!fields) return;
    for (const key of Object.keys(fields)) {
        fields[key] = fields[key].filter(p => !test(p.f));
        if (!fields[key].length) delete fields[key];
    }
    if (!Object.keys(fields).length) delete state.history[primary];
}

/** 删消息后：去掉 mesIndex 及之后楼层读到的数据（尽力而为） */
export function forgetFloor(mesIndex) {
    if (!Number.isInteger(mesIndex) || mesIndex < 0) return;
    const state = cardState();
    const gone = (f) => f >= mesIndex;
    for (const primary of Object.keys(state.history)) dropHistoryAt(state, primary, gone);
    for (const [primary, a] of Object.entries(state.appear)) {
        const keep = a.recent.filter(f => !gone(f));
        const removed = a.recent.length - keep.length;
        if (!removed && a.last < mesIndex) continue;
        if (!keep.length && a.first >= mesIndex) { delete state.appear[primary]; continue; }
        a.recent = keep;
        a.count = Math.max(keep.length, (a.count || 0) - removed);
        a.last = keep.length ? keep[keep.length - 1] : a.first;
        a.first = Math.min(a.first, a.last);
    }
    for (const [primary, st] of Object.entries(state.status)) {
        if (!st || st.floor < mesIndex) continue;
        if (st.prev && Number.isInteger(st.prevFloor) && st.prevFloor < mesIndex) {
            state.status[primary] = { floor: st.prevFloor, swipe: 0, fields: st.prev, prev: null, prevFloor: null, cues: [], at: st.at };
        } else delete state.status[primary];
    }
    saveSoon();
}

// ---------------------------------------------------------------- 规则自检

function findField(fields, word) {
    if (!fields) return null;
    const label = Object.keys(fields).find(k => k.includes(word));
    return label ? { label, value: fields[label] } : null;
}

/**
 * 当前快照和上一份比，查违反规则的地方
 * @returns {{ code: string, field: string, text: string, fix: string }[]}
 */
export function checkRules(primary) {
    const config = statusConfig();
    if (!config.ruleCheck) return [];
    const st = cardState().status[primary];
    if (!st?.fields) return [];
    const cur = st.fields;
    const prev = st.prev || null;
    const cues = new Set(st.cues || []);
    const allText = Object.values(cur).join('\n');
    const has = (words) => words.some(w => cues.has(w) || allText.includes(w));
    const alerts = [];
    const add = (code, field, text, fix) => alerts.push({ code, field, text, fix });

    // 小穴 / 菊花：只有清洗、洗澡才会减少；实心塞子拔出时可以喷到正好 300ml
    for (const [word, code, part] of [['小穴内液体量', 'P9', '小穴'], ['菊花内液体量', 'A6', '菊花']]) {
        const c = findField(cur, word), p = findField(prev, word);
        if (!c || !p) continue;
        const now = parseValue(c.value).ml, before = parseValue(p.value).ml;
        if (!Number.isFinite(now) || !Number.isFinite(before) || now >= before) continue;
        if (has(WASH)) continue;
        if (before > 300 && now === 300 && has(PLUG_OUT)) continue;
        add(code, c.label, `${part}内液体从 ${before}ml 降到 ${now}ml，但没有清洗或洗澡`,
            `（纠正：${primary}的${part}内液体量上一轮是${before}ml，没有清洗或洗澡时液体不会减少，请按${before}ml及以上继续计算。）`);
    }
    const stomach = findField(cur, '胃部');
    const stomachMl = stomach ? parseValue(stomach.value).ml : NaN;
    if (stomachMl > 1000 && !has(['呕吐', '吐了'])) {
        add('S2', stomach.label, `胃部 ${stomachMl}ml 超过 1000ml，应该触发呕吐`, `（纠正：${primary}的胃部已有${stomachMl}ml，超过1000ml必须触发呕吐，请在下一轮写出呕吐并更新胃部状态。）`);
    }
    const bladder = findField(cur, '膀胱');
    const bladderMl = bladder ? parseValue(bladder.value).ml : NaN;
    if (bladderMl > 800 && !has(['失禁'])) {
        add('B4', bladder.label, `膀胱 ${bladderMl}ml 超过 800ml，应该触发失禁`, `（纠正：${primary}的膀胱已有${bladderMl}ml，超过800ml必须触发失禁，请在下一轮写出失禁并更新膀胱状态。）`);
    }
    const org = findField(cur, '高潮次数'), orgPrev = findField(prev, '高潮次数');
    if (org && orgPrev) {
        const now = parseValue(org.value).num, before = parseValue(orgPrev.value).num;
        if (now < before) add('ORG', org.label, `累计高潮次数从 ${before} 变成 ${now}，不应减少`, `（纠正：${primary}的累计高潮次数上一轮是${before}，累计次数不会减少，请按${before}及以上继续计数。）`);
    }
    // 突变：满分 100 的字段一层里变化超过阈值
    const gap = Number.isInteger(st.prevFloor) ? st.floor - st.prevFloor : Infinity;
    for (const [label, value] of Object.entries(cur)) {
        const p = parseValue(value);
        if (p.max !== 100 || !Number.isFinite(p.num)) continue;
        const before = prev && gap <= 2 ? parseValue(prev[label]).num : NaN;
        const diff = Number.isFinite(before) ? p.num - before : p.delta;
        if (Number.isFinite(diff) && Math.abs(diff) > config.jumpThreshold) {
            add('JUMP', label, `${label}一层变化 ${diff > 0 ? '+' : ''}${diff}，超过 ${config.jumpThreshold}`, `（纠正：${primary}的${label}一轮内变化了${diff > 0 ? '+' : ''}${diff}，幅度过大，请确认是否合理，必要时改为渐进变化。）`);
        }
    }
    // 数值字段里的含糊词
    for (const [label, value] of Object.entries(cur)) {
        if (!NUMERIC_HINTS.some(w => label.includes(w))) continue;
        const m = String(value).match(VAGUE_WORDS);
        if (m) add('VAGUE', label, `${label}里写了「${m[0]}」，应该是具体数字`, `（纠正：${primary}的${label}不能写「${m[0]}」，请给出具体数字。）`);
    }
    return alerts;
}

/** 标签里的数值和表格不一致（表格可能还没更新） */
export function mismatchAlerts(primary, profile) {
    const st = cardState().status[primary];
    const numbers = profile?.numbers || {};
    if (!st?.fields) return [];
    const alerts = [];
    for (const key of ['好感', '臣服值', '累计高潮次数']) {
        const table = numbers[key];
        if (!Number.isFinite(table)) continue;
        const label = Object.keys(st.fields).find(k => historyKey(k) === key);
        const tag = label ? parseValue(st.fields[label]).num : NaN;
        if (!Number.isFinite(tag) || tag === table) continue;
        alerts.push({
            code: 'MISMATCH', field: key,
            text: `标签里${key} ${tag}，表格里是 ${table}，表格可能还没更新`,
            fix: `（纠正：${primary}的${key}现在是${tag}，表格里还是${table}，请同步更新表格。）`,
        });
    }
    return alerts;
}

// ---------------------------------------------------------------- 红点（看过之后改了什么）

function hash(text) {
    let h = 5381;
    const s = String(text ?? '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/** 上次看这个人的卡片之后变过的 key（没看过就是空） */
export function changedKeys(primary, items) {
    const snap = cardState().viewed[primary];
    const out = new Set();
    if (!snap) return out;
    for (const { key, value } of items || []) if (snap[key] !== hash(value)) out.add(key);
    return out;
}

/** 记下这次看到的值 */
export function markViewed(primary, items) {
    const state = cardState();
    const next = Object.fromEntries((items || []).map(({ key, value }) => [key, hash(value)]));
    const old = state.viewed[primary];
    if (old && Object.keys(old).length === Object.keys(next).length && Object.entries(next).every(([k, v]) => old[k] === v)) return;
    state.viewed[primary] = next;
    saveSoon();
}

// ---------------------------------------------------------------- 书签

/** 存下所有人当前的状态 */
export function addBookmark(label) {
    const state = cardState();
    const status = {};
    let floor = -1;
    for (const [primary, st] of Object.entries(state.status)) {
        if (!st?.fields) continue;
        status[primary] = { floor: st.floor, fields: { ...st.fields } };
        floor = Math.max(floor, st.floor);
    }
    const chatLen = USER.getContext()?.chat?.length;
    if (floor < 0 && chatLen) floor = chatLen - 1;
    const bookmark = { id: `bm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: clean(label) || `第 ${floor} 楼`, floor, at: Date.now(), status };
    state.bookmarks.push(bookmark);
    if (state.bookmarks.length > MAX_BOOKMARKS) state.bookmarks.splice(0, state.bookmarks.length - MAX_BOOKMARKS);
    saveSoon();
    return bookmark;
}

/** 书签列表，新的在前 */
export function listBookmarks() {
    return [...cardState().bookmarks].sort((a, b) => b.at - a.at);
}

export function deleteBookmark(id) {
    const state = cardState();
    const before = state.bookmarks.length;
    state.bookmarks = state.bookmarks.filter(b => b.id !== id);
    if (state.bookmarks.length === before) return false;
    saveSoon();
    return true;
}

/** 书签时和现在比，数值字段的变化 → [{field, from, to}] */
export function bookmarkDiff(id, primary) {
    const state = cardState();
    const old = state.bookmarks.find(b => b.id === id)?.status?.[primary]?.fields || {};
    const now = state.status[primary]?.fields || {};
    const out = [];
    for (const field of new Set([...Object.keys(old), ...Object.keys(now)])) {
        const from = valueNumber(old[field]), to = valueNumber(now[field]);
        if (!Number.isFinite(from) && !Number.isFinite(to)) continue;
        if (from === to) continue;
        out.push({ field, from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null });
    }
    return out;
}

// ---------------------------------------------------------------- 置顶、标签、备注、头像

/** 置顶的人（Set） */
export function getPins() {
    return new Set(cardState().pins);
}

/** 切换置顶，返回切换后是否置顶 */
export function togglePin(primary) {
    const state = cardState();
    const on = !state.pins.includes(primary);
    state.pins = on ? [...state.pins, primary] : state.pins.filter(p => p !== primary);
    saveSoon();
    return on;
}

export function getTags(primary) {
    return [...(cardState().tags[primary] || [])];
}

/** 设置分组标签：数组或逗号分隔的字符串 */
export function setTags(primary, arr) {
    const state = cardState();
    const list = (Array.isArray(arr) ? arr : String(arr ?? '').split(/[,，、]/)).map(clean).filter(Boolean);
    const unique = [...new Set(list)];
    if (unique.length) state.tags[primary] = unique; else delete state.tags[primary];
    saveSoon();
    return unique;
}

/** 所有用过的分组标签 */
export function allTags() {
    return [...new Set(Object.values(cardState().tags).flat())].sort((a, b) => a.localeCompare(b, 'zh'));
}

export function getNote(primary) {
    return cardState().notes[primary] || '';
}

export function setNote(primary, text) {
    const state = cardState();
    const value = String(text ?? '');
    if (value.trim()) state.notes[primary] = value; else delete state.notes[primary];
    saveSoon();
}

export function getAvatar(primary) {
    return cardState().avatars[primary] || '';
}

/** 头像的原图地址（柏宝绘图库里的路径），点头像时看大图用；没有就是空串 */
export function getAvatarFull(primary) {
    return cardState().avatarFull[primary] || '';
}

/**
 * @param {string} primary
 * @param {string} dataUrl 裁好的小头像
 * @param {string} [full] 原图在 ST 里的路径（/user/images/...），只存路径不存图
 */
export function setAvatar(primary, dataUrl, full = '') {
    const state = cardState();
    if (dataUrl && /^data:image\//.test(dataUrl)) state.avatars[primary] = dataUrl; else delete state.avatars[primary];
    if (state.avatars[primary] && typeof full === 'string' && full.startsWith('/user/images/')) state.avatarFull[primary] = full; else delete state.avatarFull[primary];
    saveSoon();
}

// ---------------------------------------------------------------- 备份

/** 导出本聊天的资料卡数据 */
export function exportBackup(extra) {
    const context = USER.getContext() || {};
    return {
        version: 1,
        type: 'v2-character-card',
        exportedAt: new Date().toISOString(),
        chat: context.chatId ?? null,
        card: JSON.parse(JSON.stringify(cardState())),
        extra: extra ?? null,
    };
}

/**
 * 导入备份，和现有数据合并（同一个人取楼层更新的快照，曲线、出场、书签合并去重）
 * @returns {{ ok: boolean, error?: string, characters?: number }}
 */
export function importBackup(obj) {
    const card = obj?.card;
    if (!card || typeof card !== 'object' || Array.isArray(card)) return { ok: false, error: '不是资料卡备份文件' };
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const state = cardState();
    const names = new Set();

    if (isObj(card.status)) for (const [p, st] of Object.entries(card.status)) {
        if (!isObj(st) || !isObj(st.fields)) continue;
        names.add(p);
        const mine = state.status[p];
        if (!mine || (Number(st.floor) || 0) > (Number(mine.floor) || 0)) state.status[p] = st;
    }
    if (isObj(card.history)) for (const [p, fields] of Object.entries(card.history)) {
        if (!isObj(fields)) continue;
        names.add(p);
        const mine = (state.history[p] ??= {});
        for (const [key, points] of Object.entries(fields)) {
            if (!Array.isArray(points)) continue;
            const byFloor = new Map((mine[key] || []).map(pt => [pt.f, pt]));
            for (const pt of points) if (pt && Number.isFinite(pt.f) && Number.isFinite(pt.v) && !byFloor.has(pt.f)) byFloor.set(pt.f, pt);
            mine[key] = [...byFloor.values()].sort((a, b) => a.f - b.f).slice(-statusConfig().historyPoints);
        }
    }
    if (isObj(card.appear)) for (const [p, a] of Object.entries(card.appear)) {
        if (!isObj(a)) continue;
        names.add(p);
        const mine = state.appear[p];
        if (!mine) { state.appear[p] = { first: a.first, last: a.last, count: a.count || 0, recent: Array.isArray(a.recent) ? [...a.recent] : [] }; continue; }
        const recent = [...new Set([...mine.recent, ...(Array.isArray(a.recent) ? a.recent : [])])].sort((x, y) => x - y).slice(-MAX_RECENT);
        mine.count = Math.max(mine.count || 0, a.count || 0, recent.length);
        mine.first = Math.min(mine.first, a.first ?? mine.first);
        mine.last = Math.max(mine.last, a.last ?? mine.last);
        mine.recent = recent;
    }
    if (Array.isArray(card.bookmarks)) {
        const ids = new Set(state.bookmarks.map(b => b.id));
        for (const b of card.bookmarks) if (isObj(b) && b.id && !ids.has(b.id)) state.bookmarks.push(b);
        state.bookmarks.sort((a, b) => a.at - b.at);
    }
    if (isObj(card.viewed)) for (const [p, v] of Object.entries(card.viewed)) if (!state.viewed[p] && isObj(v)) state.viewed[p] = v;
    if (Array.isArray(card.pins)) state.pins = [...new Set([...state.pins, ...card.pins.filter(x => typeof x === 'string')])];
    if (isObj(card.tags)) for (const [p, t] of Object.entries(card.tags)) if (Array.isArray(t)) state.tags[p] = [...new Set([...(state.tags[p] || []), ...t])];
    for (const key of ['notes', 'avatars', 'avatarFull']) {
        if (isObj(card[key])) for (const [p, v] of Object.entries(card[key])) if (!state[key][p] && typeof v === 'string' && v) state[key][p] = v;
    }
    saveSoon();
    return { ok: true, characters: names.size };
}
