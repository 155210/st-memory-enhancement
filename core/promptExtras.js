import { DERIVED, USER } from './manager.js';

/**
 * @description 阶段 3 的发送小工具
 * @description - I2 条件块：规则或消息模板里写 {{#if 事件历史>=20}}……{{/if}}，条件成立才发
 * @description - W3 定时提示词：每隔 N 轮插一段自定义提醒
 * @description - I5 本轮注入预览：记下最近一次实际发了什么
 */

const IF_BLOCK = /\{\{#if\s+([^}]+?)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
const CONDITION = /^(.+?)(?:\.行数)?\s*(>=|<=|==|!=|>|<|=)\s*(-?\d+)$/;

/** 本轮是第几轮（AI 回复数 + 1） */
export function currentTurn() {
    const chat = USER.getContext().chat || [];
    return chat.filter(m => m && !m.is_user && !m.is_system).length + 1;
}

/**
 * 按条件块取舍文本
 * @param {string} text 含条件块的文本
 * @param {Object[]} sheets 用来查行数的表格
 * @returns {string}
 */
export function applyConditionalBlocks(text, sheets) {
    if (typeof text !== 'string' || !text.includes('{{#if')) return text;
    return text.replace(IF_BLOCK, (_, condition, yes, no = '') => evaluate(condition, sheets) ? yes : no);
}

function evaluate(condition, sheets) {
    const m = String(condition).trim().match(CONDITION);
    if (!m) return true;   // 写错的条件不吞内容
    const [, left, op, right] = m;
    const name = left.trim();
    let value;
    if (name === '轮次') value = currentTurn();
    else {
        const sheet = sheets.find(s => s.name === name);
        if (!sheet) return false;
        value = sheet.getRowCount() - 1;
    }
    const n = Number(right);
    switch (op) {
        case '>=': return value >= n;
        case '<=': return value <= n;
        case '>': return value > n;
        case '<': return value < n;
        case '!=': return value !== n;
        default: return value === n;
    }
}

/**
 * W3：解析提醒设置，每行「间隔|内容」
 * @returns {{ every: number, text: string }[]}
 */
export function parseReminders(raw = USER.tableBaseSetting.v2_reminders) {
    return String(raw || '').split('\n').map(line => {
        const m = line.match(/^\s*(\d+)\s*[|｜]\s*(.+)$/);
        return m && Number(m[1]) > 0 ? { every: Number(m[1]), text: m[2].trim() } : null;
    }).filter(Boolean);
}

/** 本轮该发的提醒，没有时返回空串 */
export function dueReminderText(turn = currentTurn()) {
    if (USER.tableBaseSetting.v2_reminders_enabled === false) return '';
    const due = parseReminders().filter(r => turn % r.every === 0).map(r => `- ${r.text}`);
    return due.length ? `【定时提醒（第 ${turn} 轮）】\n${due.join('\n')}\n` : '';
}

/** I5：记下这次发了什么 */
export function recordInjection(entry) {
    DERIVED.any.lastInjection = { at: new Date().toLocaleString(), turn: currentTurn(), ...entry };
}

export function lastInjection() {
    return DERIVED.any.lastInjection || null;
}
