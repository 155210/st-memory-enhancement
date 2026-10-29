import { BASE, USER } from './manager.js';
import { collectNames, findRolesInText, insertSummaryByRange, parseSummaryOutput, summaryConfig, summaryHooks } from './summaryManager.js';

/**
 * @description O10 手动融合沙盒：按楼层、正则、故事日期挑一段正文，让 AI 写成一条更细的大总结或卷总结
 * @description 生成结果先给你看、可以改，确认后才按楼层范围插进大总结表，存到最新一层
 */

const DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
const stripText = (mes) => String(mes || '')
    .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/g, '')
    .replace(/<tableThink>[\s\S]*?<\/tableThink>/g, '')
    .replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/g, '')
    .trim();

/** 一条消息里最后一个时间标签的日期（yyyymmdd 数字），没有就是 null */
function floorDate(mes) {
    const tags = String(mes || '').match(/『[^』]*』/g) || [];
    for (const tag of tags.reverse()) {
        const m = tag.match(DATE_RE);
        if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    }
    return null;
}

const parseDate = (text) => {
    const m = String(text || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
};

/**
 * 挑楼层
 * @param {{ from?: number, to?: number, pattern?: string, dateFrom?: string, dateTo?: string }} options
 * @returns {{ floors: number[], chars: number, error?: string }}
 */
export function selectFloors({ from = 0, to, pattern = '', dateFrom = '', dateTo = '' } = {}) {
    const chat = USER.getContext().chat || [];
    const end = Math.min(to ?? chat.length - 1, chat.length - 1);
    let regex = null;
    if (pattern) {
        try { regex = new RegExp(pattern); } catch (e) { return { floors: [], chars: 0, error: `正则写错了：${e.message}` }; }
    }
    const lo = parseDate(dateFrom);
    const hi = parseDate(dateTo);
    let current = null;   // 没有时间标签的楼层沿用上一条的日期
    const floors = [];
    for (let i = 0; i <= end; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        current = floorDate(m.mes) ?? current;
        if (i < from) continue;
        if (lo && (current === null || current < lo)) continue;
        if (hi && (current === null || current > hi)) continue;
        if (regex && !regex.test(m.mes || '')) continue;
        floors.push(i);
    }
    const chars = floors.reduce((n, i) => n + stripText(chat[i].mes).length, 0);
    return { floors, chars };
}

const FUSION_SYSTEM = (level) => `你是小说记录员。把用户给的几段正文写成一条「${level}」总结，用来补充或改正自动总结漏掉的细节。
规则：
1. 只写正文里有的事，按时间先后，不编造、不评价。
2. 开头带日期和地点；电报体：谁对谁做了什么→结果；保留关系变化、承诺、伏笔、重要物品、身份揭示。
3. ${level === '大' ? '80 到 300 字' : '150 到 500 字'}。
输出格式（只输出这个）：
<summary>总结</summary>`;

/** 让 AI 写融合总结，返回总结文字 */
export async function generateFusion(floors, level = '大') {
    const chat = USER.getContext().chat || [];
    const text = floors.map(i => `[第${i}层·${chat[i].is_user ? '用户' : 'AI'}]\n${stripText(chat[i].mes)}`).join('\n\n');
    const raw = await summaryHooks.ask(FUSION_SYSTEM(level), text, `融合 ${floors.length} 层写成${level}总结`);
    const { summary } = parseSummaryOutput(raw);
    if (!summary) throw new Error('AI 没有返回总结');
    return summary;
}

/**
 * 把确认过的融合总结插进大总结表，存到最新一层
 * @returns {{ rowIndex: number, range: string }}
 */
export function insertFusion(content, floors, level = '大') {
    const { piece: source } = BASE.getLastSheetsPiece();
    const { piece: target } = USER.getChatPiece();
    if (!source || !target) throw new Error('没有可以保存表格的 AI 消息');
    const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(source));
    const sheet = sheets.find(s => s.name === summaryConfig().summaryTable);
    if (!sheet) throw new Error(`找不到表「${summaryConfig().summaryTable}」`);
    const range = `${Math.min(...floors)}-${Math.max(...floors)}`;
    const roles = findRolesInText(content, collectNames(sheets), 5).join('|');
    const rowIndex = insertSummaryByRange(sheet, { content, level, range: `${range}（手动）`, roles });
    sheets.forEach(s => s.save(target, true));
    USER.saveChat();
    return { rowIndex, range };
}
