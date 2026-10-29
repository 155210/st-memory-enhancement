import { USER } from './manager.js';

/**
 * @description v2 额外请求套用酒馆预设：导入酒馆「对话补全预设」的 JSON，按预设里的顺序和开关拼消息，
 * @description 把 v2 的任务说明和数据放在「聊天记录」(chatHistory) 的位置；预设里的破限、预填充等照原样发
 * @description 只存拼好的条目，不存整个预设文件
 */

// 这些占位条目要的是角色卡、世界书、聊天记录，额外请求里没有，跳过；chatHistory 换成 v2 的内容
const SLOT = 'chatHistory';

const clean = (v) => String(v ?? '').trim();

/**
 * 解析酒馆对话补全预设
 * @param {Object} json 预设文件内容
 * @returns {{ name: string, items: ({ role: string, content: string, name?: string, after?: boolean } | { slot: true })[] }}
 */
export function parsePreset(json, name = '') {
    if (!json || !Array.isArray(json.prompts)) throw new Error('这不是酒馆的对话补全预设（没有 prompts）');
    const byId = new Map(json.prompts.filter(p => p && p.identifier).map(p => [p.identifier, p]));
    // 角色专属顺序优先用全局的那份（character_id 100001），没有就用第一份
    const orders = Array.isArray(json.prompt_order) ? json.prompt_order : [];
    const order = (orders.find(o => Number(o.character_id) === 100001) || orders[0])?.order
        || json.prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled !== false }));
    const items = [];
    const injected = [];
    for (const entry of order) {
        if (!entry || entry.enabled === false) continue;
        const prompt = byId.get(entry.identifier);
        if (!prompt) continue;
        if (prompt.identifier === SLOT) { items.push({ slot: true }); continue; }
        if (prompt.marker) continue;
        const content = clean(prompt.content);
        if (!content) continue;
        const item = { role: ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system', content, name: clean(prompt.name) };
        // 「聊天中」注入的条目：深度 0 放在 v2 内容后面，其余放前面
        if (Number(prompt.injection_position) === 1) injected.push({ ...item, after: Number(prompt.injection_depth) === 0 });
        else items.push(item);
    }
    let slotAt = items.findIndex(i => i.slot);
    if (slotAt === -1) {
        // 没有聊天记录位置：放在末尾的预填充（assistant）前面
        slotAt = items.length;
        while (slotAt > 0 && items[slotAt - 1].role === 'assistant') slotAt--;
        items.splice(slotAt, 0, { slot: true });
    }
    const before = injected.filter(i => !i.after).map(({ after, ...i }) => i);
    const after = injected.filter(i => i.after).map(({ after, ...i }) => i);
    items.splice(slotAt, 1, ...before, { slot: true }, ...after);
    if (items.length === 1) throw new Error('预设里没有启用的、有内容的条目');
    return { name: clean(name) || clean(json.name) || '导入的预设', items };
}

/** 当前是否套用预设 */
export function presetActive() {
    const s = USER.tableBaseSetting;
    return s.v2_extra_preset_enabled === true && Array.isArray(s.v2_extra_preset?.items) && s.v2_extra_preset.items.length > 1;
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
    const out = [];
    for (const item of USER.tableBaseSetting.v2_extra_preset.items) {
        if (item.slot) out.push(...core);
        else out.push({ role: item.role, content: substitute(item.content) });
    }
    return out;
}
