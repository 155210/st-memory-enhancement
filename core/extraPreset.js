import { USER } from './manager.js';

/**
 * @description v2 额外请求套用酒馆预设（写法参考 ST-BaiBai-Image 的「重型提示词」）：
 * @description - 导入酒馆聊天补全预设，条目的顺序和开关跟酒馆提示词管理器里一样（只认 prompt_order 里的开关）
 * @description - 角色卡、世界书等占位条目不导入；「聊天记录」换成 v2 占位条目，v2 的任务和数据放在这里
 * @description - 「聊天中」深度注入的条目插进 v2 内容里，深度 0 在最末尾，深度 N 在倒数第 N 条之前
 * @description - 条目可以开关、调顺序、改内容；预设里有但酒馆列表没放的条目单独收着，不发送，可以加入末尾
 */

export const SLOT_ID = 'v2-content';
const CHAT_HISTORY_ID = 'chatHistory';
const ROLES = ['system', 'user', 'assistant'];

export const slotEntry = () => ({ id: SLOT_ID, name: '记忆表格 v2 的任务和数据', role: 'system', content: '', enabled: true, position: 'relative', depth: 0, order: 100 });

const normalizeRole = (v) => (ROLES.includes(v) ? v : 'system');
const finiteInt = (v, fallback, min = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : fallback;
};

/** 从 prompt_order 里取一份顺序：优先全局默认（100001），没有就取条目最多的那份 */
function pickOrder(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    // 提示词管理器单独导出的格式：prompt_order 直接就是 [{identifier, enabled}]
    if (raw.every(x => x && typeof x === 'object' && 'identifier' in x)) return raw;
    const lists = raw.filter(x => x && Array.isArray(x.order));
    return lists.find(x => Number(x.character_id) === 100001)?.order
        ?? lists.slice().sort((a, b) => b.order.length - a.order.length)[0]?.order
        ?? null;
}

/**
 * 解析酒馆预设 JSON（整份聊天补全预设，或提示词管理器单独导出的 {data:{prompts,prompt_order}}）
 * @returns {{ name: string, entries: Object[], extras: Object[], squash: boolean }}
 */
export function parsePreset(json, name = '') {
    const root = json && typeof json === 'object' ? json : null;
    const data = root?.data && typeof root.data === 'object' ? root.data : root;
    const prompts = data?.prompts;
    if (!Array.isArray(prompts) || !prompts.length) throw new Error('没有找到预设条目（prompts），请导入酒馆的聊天补全预设 JSON');
    const byId = new Map();
    for (const p of prompts) if (p && typeof p.identifier === 'string' && p.identifier && !byId.has(p.identifier)) byId.set(p.identifier, p);
    const order = pickOrder(data?.prompt_order);
    const sequence = [];
    const placed = new Set();
    for (const item of order ?? []) {
        const id = typeof item?.identifier === 'string' ? item.identifier : '';
        if (!id || placed.has(id) || !byId.has(id)) continue;
        placed.add(id);
        sequence.push({ id, enabled: typeof item.enabled === 'boolean' ? item.enabled : true });
    }
    const orphans = [];
    for (const id of byId.keys()) {
        if (placed.has(id)) continue;
        if (order) orphans.push(id);
        else sequence.push({ id, enabled: null });
    }
    const toEntry = (id, p, enabled) => {
        const triggers = Array.isArray(p.injection_trigger) ? p.injection_trigger : [];
        const triggerOk = !triggers.length || triggers.includes('normal');
        const selfEnabled = typeof p.enabled === 'boolean' ? p.enabled : true;
        return {
            id,
            name: typeof p.name === 'string' && p.name.trim() ? p.name : id,
            role: normalizeRole(p.role),
            content: typeof p.content === 'string' ? p.content : '',
            enabled: (enabled ?? selfEnabled) && triggerOk,
            position: Number(p.injection_position) === 1 ? 'depth' : 'relative',
            depth: finiteInt(p.injection_depth, 4),
            order: finiteInt(p.injection_order, 100, Number.MIN_SAFE_INTEGER),
        };
    };
    const entries = [];
    let slotPlaced = false;
    for (const { id, enabled } of sequence) {
        const p = byId.get(id);
        if (id === CHAT_HISTORY_ID) {
            if (!slotPlaced) entries.push(slotEntry());
            slotPlaced = true;
            continue;
        }
        if (p.marker === true) continue;
        entries.push(toEntry(id, p, enabled));
    }
    if (!slotPlaced) entries.push(slotEntry());
    const extras = orphans
        .filter(id => id !== CHAT_HISTORY_ID && byId.get(id).marker !== true)
        .map(id => toEntry(id, byId.get(id), false));
    return {
        name: String(name || root?.name || '导入的预设').trim(),
        entries,
        extras,
        squash: data?.squash_system_messages === true || root?.squash_system_messages === true,
    };
}

/** 设置里存的预设：缺字段补齐，占位条目只留一个 */
export function normalizePreset(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const take = (list, inOrder) => {
        const out = [];
        for (const e of Array.isArray(list) ? list : []) {
            const id = typeof e?.id === 'string' && e.id ? e.id : '';
            if (!id || seen.has(id) || (!inOrder && id === SLOT_ID)) continue;
            seen.add(id);
            if (id === SLOT_ID) { out.push(slotEntry()); continue; }
            const entry = {
                id,
                name: typeof e.name === 'string' ? e.name : id,
                role: normalizeRole(e.role),
                content: typeof e.content === 'string' ? e.content : '',
                enabled: inOrder ? e.enabled !== false : false,
                position: e.position === 'depth' ? 'depth' : 'relative',
                depth: finiteInt(e.depth, 4),
                order: finiteInt(e.order, 100, Number.MIN_SAFE_INTEGER),
            };
            out.push(entry);
        }
        return out;
    };
    const entries = take(r.entries, true);
    if (!seen.has(SLOT_ID)) entries.push(slotEntry());
    return { name: typeof r.name === 'string' ? r.name : '', entries, extras: take(r.extras, false), squash: r.squash === true };
}

/** 当前预设（总是规范过的） */
export function currentPreset() {
    return normalizePreset(USER.tableBaseSetting.v2_extra_preset);
}

/** 当前是否套用预设：开关开着，且除占位外至少一条启用、有内容的条目 */
export function presetActive() {
    if (USER.tableBaseSetting.v2_extra_preset_enabled !== true) return false;
    return currentPreset().entries.some(e => e.id !== SLOT_ID && e.enabled && e.content.trim());
}

/**
 * 按条目拼消息（与酒馆同算法）：相对条目按列表顺序；占位条目展开成 v2 的消息；
 * 深度条目插进 v2 的消息里，同深度按 order 从小到大，同 order 内同身份的合并成一条
 */
export function assembleMessages(entries, coreMessages, substitute = (t) => t, squash = false) {
    const live = entries
        .filter(e => e.id === SLOT_ID || e.enabled)
        .map(e => (e.id === SLOT_ID ? e : { ...e, content: substitute(e.content) }))
        .filter(e => e.id === SLOT_ID || e.content.trim());
    const chat = coreMessages.slice().reverse();
    const depthEntries = live.filter(e => e.id !== SLOT_ID && e.position === 'depth');
    let inserted = 0;
    for (const depth of [...new Set(depthEntries.map(e => e.depth))].sort((a, b) => a - b)) {
        const atDepth = depthEntries.filter(e => e.depth === depth);
        for (const order of [...new Set(atDepth.map(e => e.order))].sort((a, b) => b - a)) {
            const group = atDepth.filter(e => e.order === order);
            const roleMessages = [];
            for (const role of ROLES) {
                const content = group.filter(e => e.role === role).map(e => e.content).join('\n');
                if (content) roleMessages.push({ role, content });
            }
            if (!roleMessages.length) continue;
            chat.splice(Math.min(depth + inserted, chat.length), 0, ...roleMessages);
            inserted += roleMessages.length;
        }
    }
    const block = chat.reverse();
    const out = [];
    for (const e of live) {
        if (e.id === SLOT_ID) out.push(...block);
        else if (e.position === 'relative') out.push({ role: e.role, content: e.content });
    }
    if (!squash) return out;
    const squashed = [];
    for (const m of out) {
        const prev = squashed[squashed.length - 1];
        if (prev?.role === 'system' && m.role === 'system') prev.content += `\n\n${m.content}`;
        else squashed.push({ ...m });
    }
    return squashed;
}

function substitute(text) {
    try {
        const sub = USER.getContext()?.substituteParams;
        return typeof sub === 'function' ? sub(text) : text;
    } catch (_) {
        return text;
    }
}

/**
 * 拼出要发的消息：没开预设时就是 system + user 两条
 * @returns {{ role: string, content: string }[]}
 */
export function buildExtraMessages(system, user) {
    const core = [{ role: 'system', content: system }, { role: 'user', content: user }];
    if (!presetActive()) return core;
    const preset = currentPreset();
    return assembleMessages(preset.entries, core, substitute, preset.squash);
}
