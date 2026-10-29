import { Cell } from './table/cell.js';

/**
 * @description 角色类表格按名字识别行（B1 去重、K1 外号、K2 列写入规则）
 * @description 名字格写成「主名|外号1|外号2」：主名必须唯一，合并只看主名；外号只在恰好对上一个人时用来找人
 * @description 列名以 # 开头：只追加不覆盖；以 ! 开头：只在空着时填一次；其余列：空值不覆盖已有内容
 */

/** 第一列是这些列名的表按角色名去重 */
const NAME_HEADERS = ['角色名', '姓名', '名字', '人物', '人物名', 'name'];

/** 很多人共用的称呼，不算外号（Q8） */
export const GENERIC_TITLES = new Set([
    '师姐', '师兄', '师妹', '师弟', '师父', '师傅', '师尊', '小姐', '夫人', '太太', '姑娘', '公子', '少爷', '大小姐',
    '姐姐', '妹妹', '哥哥', '弟弟', '阿姨', '叔叔', '大叔', '大姐', '大哥', '妈妈', '爸爸', '母亲', '父亲',
    '老师', '同学', '学姐', '学长', '学妹', '学弟', '前辈', '大人', '主人', '老板', '老大', '殿下', '陛下', '娘娘',
    '宝贝', '亲爱的', '老婆', '老公', '女儿', '儿子', '那个人', '她', '他',
]);

const SPLIT = /[|｜]/;

const clean = (value) => String(value ?? '').trim();
/** 用于比较的名字：去掉空白和 {{user}} 之类的大小写差异 */
const normalize = (value) => clean(value).replace(/\s+/g, '').toLowerCase();

/** 列名去掉 #、! 标记 */
export function stripColumnMark(header) {
    return clean(header).replace(/^[#!！]+/, '');
}

/** 列的写入方式：append 只追加、once 只填一次、normal 普通（空值不覆盖） */
export function columnMode(header) {
    const h = clean(header);
    if (h.startsWith('#')) return 'append';
    if (h.startsWith('!') || h.startsWith('！')) return 'once';
    return 'normal';
}

/** 解析名字格 → { primary, aliases } */
export function parseNameCell(value) {
    const parts = clean(value).split(SPLIT).map(clean).filter(Boolean);
    const primary = parts[0] ?? '';
    const seen = new Set([normalize(primary)]);
    const aliases = [];
    for (const alias of parts.slice(1)) {
        const key = normalize(alias);
        if (!key || seen.has(key) || GENERIC_TITLES.has(alias)) continue;
        seen.add(key);
        aliases.push(alias);
    }
    return { primary, aliases };
}

/** 合并两个名字格：主名用已有的，外号取并集 */
export function mergeNameCells(existing, incoming) {
    const a = parseNameCell(existing);
    const b = parseNameCell(incoming);
    if (!a.primary) return clean(incoming);
    const all = [a.primary, ...a.aliases];
    const keys = new Set(all.map(normalize));
    for (const name of [b.primary, ...b.aliases]) {
        if (name && !keys.has(normalize(name)) && !GENERIC_TITLES.has(name)) {
            keys.add(normalize(name));
            all.push(name);
        }
    }
    return all.join('|');
}

/** 表头（不含行号列）；sheet 的第 0 行是表头，第 0 列是行号 */
export function getHeaders(sheet) {
    const cells = sheet.getCellsByRowIndex(0) || [];
    return cells.slice(1).map(cell => clean(cell?.data?.value));
}

/** 这张表是否按名字去重：第一列是角色名之类 */
export function isNameKeyedSheet(sheet) {
    const first = stripColumnMark(getHeaders(sheet)[0] ?? '');
    return NAME_HEADERS.includes(first) || NAME_HEADERS.includes(first.toLowerCase());
}

/** 读第 rowIndex 个数据行的名字格（rowIndex 从 0 开始，不含表头） */
function nameAt(sheet, rowIndex) {
    const cell = sheet.findCellByPosition(rowIndex + 1, 1);
    return clean(cell?.data?.value);
}

/**
 * 按名字找行
 * @returns {{ rowIndex: number, by: 'primary'|'alias'|null, ambiguous: string[] }}
 *   rowIndex 为 -1 表示没找到；ambiguous 非空表示外号对上了多个人
 */
export function findRowByName(sheet, name, { allowAlias = true } = {}) {
    const { primary } = parseNameCell(name);
    const key = normalize(primary);
    const result = { rowIndex: -1, by: null, ambiguous: [] };
    if (!key) return result;
    const rowCount = sheet.getRowCount() - 1;
    const aliasHits = [];
    for (let r = 0; r < rowCount; r++) {
        const parsed = parseNameCell(nameAt(sheet, r));
        if (normalize(parsed.primary) === key) return { rowIndex: r, by: 'primary', ambiguous: [] };
        if (allowAlias && parsed.aliases.some(alias => normalize(alias) === key)) aliasHits.push(r);
    }
    if (aliasHits.length === 1) return { rowIndex: aliasHits[0], by: 'alias', ambiguous: [] };
    if (aliasHits.length > 1) result.ambiguous = aliasHits.map(r => parseNameCell(nameAt(sheet, r)).primary);
    return result;
}

/**
 * 按列规则算出写入后的值，返回 undefined 表示不写
 * @param {string} header 列名
 * @param {string} oldValue 原值
 * @param {*} newValue AI 给的新值
 * @param {boolean} isNameColumn 是否是名字列
 * @param {boolean} keepOnEmpty 新值为空时是否保留原值
 */
export function resolveCellWrite(header, oldValue, newValue, isNameColumn = false, keepOnEmpty = true) {
    const next = clean(newValue);
    const prev = clean(oldValue);
    if (!next) return keepOnEmpty || !prev ? undefined : '';   // 角色类表空值不覆盖；其他表照原版允许清空
    if (isNameColumn) {
        const merged = mergeNameCells(prev, next);
        return merged === prev ? undefined : merged;
    }
    switch (columnMode(header)) {
        case 'once':
            return prev ? undefined : next;
        case 'append':
            if (!prev) return next;
            if (prev.includes(next)) return undefined;
            return `${prev}；${next}`;
        default:
            return next === prev ? undefined : next;
    }
}

/**
 * 按列规则写入一行：空值不覆盖、# 列追加、! 列只填一次、名字列合并外号
 * @param {number} rowIndex 数据行号（不含表头）
 * @param {Object} data 形如 {0: 值, 1: 值}
 * @returns {number} 实际改动的格子数
 */
export function writeRowValues(sheet, rowIndex, data, keyedByName) {
    const headers = getHeaders(sheet);
    let changed = 0;
    Object.entries(data).forEach(([key, value]) => {
        const col = parseInt(key);
        const cell = sheet.findCellByPosition(rowIndex + 1, col + 1);
        if (!cell) return;
        const next = resolveCellWrite(headers[col], cell.data.value, value, keyedByName && col === 0, keyedByName);
        if (next === undefined) return;
        cell.newAction(Cell.CellAction.editCell, { value: next }, false);
        changed++;
    });
    return changed;
}

/**
 * 合并角色类表里主名相同的重复行（迁移老档用）：保留最早的一行，把后面行的内容按列规则并进去，再删掉后面的行
 * @param {Object[]} sheets 表格实例
 * @param {boolean} dryRun 只统计不改
 * @returns {{ sheet: string, name: string, merged: number }[]} 合并报告
 */
export function mergeDuplicateRows(sheets, dryRun = false) {
    const report = [];
    for (const sheet of sheets) {
        if (!isNameKeyedSheet(sheet)) continue;
        const firstRowOf = new Map();
        const toDelete = [];
        const rowCount = sheet.getRowCount() - 1;
        for (let r = 0; r < rowCount; r++) {
            const key = normalize(parseNameCell(nameAt(sheet, r)).primary);
            if (!key) continue;
            if (!firstRowOf.has(key)) { firstRowOf.set(key, r); continue; }
            const target = firstRowOf.get(key);
            const values = {};
            sheet.getCellsByRowIndex(r + 1).slice(1).forEach((cell, col) => { values[col] = cell.data.value; });
            if (!dryRun) writeRowValues(sheet, target, values, true);
            toDelete.push(r);
            const name = parseNameCell(nameAt(sheet, target)).primary;
            const entry = report.find(x => x.sheet === sheet.name && x.name === name);
            if (entry) entry.merged++; else report.push({ sheet: sheet.name, name, merged: 1 });
        }
        // 从下往上删，行号不会错位
        if (!dryRun) for (const r of toDelete.reverse()) sheet.findCellByPosition(r + 1, 0)?.newAction(Cell.CellAction.deleteSelfRow, {}, false);
    }
    return report;
}
