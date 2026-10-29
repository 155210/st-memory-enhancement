import { USER } from './manager.js';
import { getHeaders, isNameKeyedSheet, parseNameCell, stripColumnMark } from './rowIdentity.js';
import { collectNames, findRolesInText, readRows, recentText } from './summaryManager.js';

/**
 * @description I1 角色四档发送：角色类表不再整张发
 * @description - 在场（时空表的此地角色、最近几层正文里出现的人）：发完整一行
 * @description - 主要角色（最近几十层出场最多的几个，自动选）：发简要一行，长格子截短
 * @description - 其余：只进名册，一个名字占几个字
 * @description - <user> 永远发完整
 * @description 三张角色表用同一份名单，行号保持原样，AI 照样能按行号或名字更新
 */

/** 设置（带默认值） */
export function tierConfig() {
    const s = USER.tableBaseSetting;
    return {
        enabled: s.v2_tier_enabled !== false,
        mainCount: Number(s.v2_tier_main_count) >= 0 ? Number(s.v2_tier_main_count) : 10,
        presentDepth: Number(s.v2_tier_present_depth) || 2,
        mainDepth: Number(s.v2_tier_main_depth) || 30,
        briefLength: Number(s.v2_tier_brief_length) || 30,
    };
}

const clean = (v) => String(v ?? '').trim();
const PRESENT_HEADERS = ['此地角色', '在场角色', '在场人物', '当前角色'];
const USER_NAMES = () => new Set(['<user>', '{{user}}', clean(USER.getContext().name1)].filter(Boolean));

/**
 * 算出本轮名单
 * @returns {{ present: Set<string>, main: Set<string>, names: Map<string,string> } | null} 主名集合；认不出任何人时返回 null（整表照发）
 */
export function computeTiers(sheets) {
    const config = tierConfig();
    const names = collectNames(sheets);
    if (!names.size) return null;
    const present = new Set(findRolesInText(recentText(config.presentDepth), names, 100));
    // 时空表的「此地角色」列
    for (const sheet of sheets) {
        const col = getHeaders(sheet).findIndex(h => PRESENT_HEADERS.includes(stripColumnMark(h)));
        if (col === -1) continue;
        const rows = readRows(sheet);
        const last = rows[rows.length - 1];
        if (!last) continue;
        findRolesInText(String(last.values[col] || ''), names, 100).forEach(n => present.add(n));
    }
    const main = new Set(findRolesInText(recentText(config.mainDepth), names, config.mainCount));
    return { present, main, names };
}

/** 一行的档位：full / brief / roster */
export function rowTier(nameCell, tiers) {
    const { primary } = parseNameCell(nameCell);
    if (!primary || USER_NAMES().has(primary)) return 'full';
    const key = tiers.names.get(primary) || primary;
    if (tiers.present.has(key)) return 'full';
    if (tiers.main.has(key)) return 'brief';
    return 'roster';
}

const shorten = (value, max) => {
    const text = clean(value);
    if (text.length <= max) return text;
    // 追加列（用；分隔）只留最近一段
    const parts = text.split('；');
    const tail = parts[parts.length - 1];
    return tail.length <= max ? `…${tail}` : `${text.slice(0, max)}…`;
};

/**
 * 把角色类表的数据行按档位排成发送文本
 * @returns {{ text: string, counts: { full: number, brief: number, roster: number } } | null} 不是角色类表时返回 null
 */
export function buildTieredRows(sheet, tiers) {
    if (!tiers || !isNameKeyedSheet(sheet)) return null;
    const config = tierConfig();
    const rows = readRows(sheet);
    const counts = { full: 0, brief: 0, roster: 0 };
    if (!rows.length) return { text: '（此表格当前为空）\n', counts };
    const headers = getHeaders(sheet);
    const relationCol = headers.findIndex(h => /关系/.test(stripColumnMark(h)));
    const lines = [];
    const roster = [];
    for (const row of rows) {
        const tier = rowTier(row.values[0], tiers);
        counts[tier]++;
        if (tier === 'full') lines.push(`${row.rowIndex},${row.values.join(',')}`);
        else if (tier === 'brief') lines.push(`${row.rowIndex},${row.values.map((v, i) => i === 0 ? v : shorten(v, config.briefLength)).join(',')}`);
        else {
            const relation = relationCol > 0 ? clean(row.values[relationCol]) : '';
            roster.push(`${row.rowIndex}:${parseNameCell(row.values[0]).primary}${relation ? `(${shorten(relation, 8)})` : ''}`);
        }
    }
    let text = lines.length ? lines.join('\n') + '\n' : '';
    if (roster.length) text += `【名册：以下角色本轮不在场，只列行号和名字，已在表里，不要再插入；需要时按名字 updateRow】${roster.join('、')}\n`;
    return { text, counts };
}
