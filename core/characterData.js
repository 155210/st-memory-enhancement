import { USER } from './manager.js';
import { GENERIC_TITLES, columnMode, getHeaders, isNameKeyedSheet, parseNameCell, stripColumnMark } from './rowIdentity.js';
import { readRows, summaryConfig } from './summaryManager.js';
import { isPairSheet } from './sendTiers.js';

/**
 * @description 角色资料卡的数据层：把各张表里关于同一个人的内容收拢成一份「档案」
 * @description - 角色类表（第一列是角色名）：每列一格，短的进两列网格，# 列和长内容折叠
 * @description - 角色关系表（角色A/角色B）、第一列是角色/拥有人之类的表（任务、物品）、带「涉及角色」列的表（悬念簿）：一行一条
 * @description - 时空表、事件历史、大总结、总结归档不收
 * @description 纯函数，不碰 DOM，不发给 AI
 */

const clean = (v) => String(v ?? '').trim();

/** 第一列是这些列名、又不是角色类表的：一行算一条（任务表的「角色」、物品表的「拥有人」） */
const OWNER_HEADERS = ['角色', '拥有人', '人物', '所属角色', '对象'];
/** 时空表的在场列（有这列的表不收） */
const PRESENT_HEADERS = ['此地角色', '在场角色', '在场人物', '当前角色'];
/** 这些词不是人名，不算对不上的名字 */
const NOT_NAMES = new Set(['无', '暂无', '没有', '未知', '不详', '-', '—', '/', '所有人', '全体', '众人', '大家', '其他人']);
/** 涉及角色、角色列里多个名字的分隔符 */
const MULTI_SPLIT = /[|｜/、,，;；\s]+/;
const OWNER_SPLIT = /[/、,，;；]+/;
/** 行条目里当作副标题的列 */
const META_PATTERN = /状态|进度|完成/;

// ---------------------------------------------------------------- 小工具

/** 估算 token：中日韩字一个算 1，其他字符四个算 1 */
export function estimateTokens(text) {
    const s = String(text ?? '');
    if (!s) return 0;
    const cjk = (s.match(/[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g) || []).length;
    return Math.ceil(cjk + (s.length - cjk) / 4);
}

/** 取字符串里的第一个数字，没有就是 NaN：「72 /100(+5)」→ 72 */
export function parseNumber(value) {
    const m = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
}

/** 卡片布局设置（v2_card_layout 是 JSON 字符串），带默认值；写坏了就用默认 */
export function cardLayout() {
    const layout = { order: [], hidden: {}, forceLong: [], forceShort: [] };
    let raw = USER.tableBaseSetting?.v2_card_layout;
    if (typeof raw === 'string') {
        if (!raw.trim()) return layout;
        try { raw = JSON.parse(raw); } catch { return layout; }
    }
    if (!raw || typeof raw !== 'object') return layout;
    const strings = (arr) => (Array.isArray(arr) ? arr.map(clean).filter(Boolean) : []);
    layout.order = strings(raw.order);
    layout.forceLong = strings(raw.forceLong);
    layout.forceShort = strings(raw.forceShort);
    if (raw.hidden && typeof raw.hidden === 'object' && !Array.isArray(raw.hidden)) {
        for (const [sheet, cols] of Object.entries(raw.hidden)) {
            if (cols === true) layout.hidden[sheet] = ['*'];
            else if (Array.isArray(cols)) layout.hidden[sheet] = strings(cols);
        }
    }
    return layout;
}

/** 两个等长字符串只差一个字 */
function oneCharApart(a, b) {
    if (a.length !== b.length || a.length < 2) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return diff === 1;
}

/** 私密表名单 */
function privateTables() {
    const raw = USER.tableBaseSetting?.v2_card_private_tables;
    return new Set(String(raw ?? '角色信息表格').split(/[,，]/).map(clean).filter(Boolean));
}

/** 这张表的第 col 列被布局设成隐藏了吗 */
function isHidden(layout, sheetName, header) {
    const list = layout.hidden?.[sheetName];
    if (!list?.length) return false;
    return list.includes(header) || list.includes(stripColumnMark(header));
}
const sheetHidden = (layout, sheetName) => layout.hidden?.[sheetName]?.includes('*');

// ---------------------------------------------------------------- 档案

/**
 * 从表格收拢每个角色的档案
 * @param {Object[]} sheets 表格实例
 * @param {{ shortLimit?: number, layout?: Object, userName?: string }} opts
 * @returns {{ list: Object[], index: Map<string,string>, orphans: { name: string, sheet: string, suggestions: string[] }[] }}
 */
export function buildProfiles(sheets, opts = {}) {
    const shortLimit = Number(opts.shortLimit ?? USER.tableBaseSetting?.v2_card_short_limit) || 20;
    const layout = opts.layout ?? cardLayout();
    const userName = clean(opts.userName ?? USER.getContext()?.name1);
    const userNames = new Set(['<user>', '{{user}}', userName].filter(Boolean));
    const isUser = (name) => userNames.has(clean(name));
    const privates = privateTables();
    const forceLong = new Set(layout.forceLong || []);
    const forceShort = new Set(layout.forceShort || []);

    const { summaryTable, archiveTable, eventTable } = summaryConfig();
    const usable = (sheets || []).filter(sheet => {
        if (!sheet || [summaryTable, archiveTable, eventTable].includes(sheet.name)) return false;
        if (sheetHidden(layout, sheet.name)) return false;
        return !getHeaders(sheet).some(h => PRESENT_HEADERS.includes(stripColumnMark(h)));
    });

    const profiles = new Map();
    const index = new Map();
    const order = new Map();   // 表名 → 默认顺序
    let seq = 0;
    const kindRank = { fields: 0, pair: 1, owner: 2, roles: 3 };

    const sectionOf = (profile, sheet, kind) => {
        let section = profile.sections.find(s => s.uid === sheet.uid && s.sheet === sheet.name);
        if (!section) {
            section = { sheet: sheet.name, uid: sheet.uid, kind: kind === 'fields' ? 'fields' : 'rows', private: privates.has(sheet.name), grid: [], long: [], rows: [] };
            profile.sections.push(section);
            if (!order.has(sheet.name)) order.set(sheet.name, kindRank[kind] * 10000 + seq++);
        }
        return section;
    };

    // 第一遍：角色类表建档
    const nameSheets = usable.filter(isNameKeyedSheet);
    const nameRows = nameSheets.map(sheet => ({ sheet, rows: readRows(sheet).map(row => ({ row, ...parseNameCell(row.values[0]) })) }));
    // 别的表里只写了外号的行（社交表写「小雪」）归到主名那个人；同一张表里两行都在的，说明是两个人
    const aliasOwners = new Map();
    const sheetsOf = new Map();
    for (const { sheet, rows } of nameRows) for (const { primary, aliases } of rows) {
        if (!primary) continue;
        if (!sheetsOf.has(primary)) sheetsOf.set(primary, new Set());
        sheetsOf.get(primary).add(sheet);
        for (const a of aliases) {
            if (!aliasOwners.has(a)) aliasOwners.set(a, new Set());
            aliasOwners.get(a).add(primary);
        }
    }
    const canonical = new Map();
    const canonicalOf = (name) => {
        if (canonical.has(name)) return canonical.get(name);
        let result = name;
        const owners = [...(aliasOwners.get(name) || [])].filter(p => p !== name);
        if (owners.length === 1) {
            const own = sheetsOf.get(owners[0]) || new Set();
            if (![...(sheetsOf.get(name) || [])].some(s => own.has(s))) result = owners[0];
        }
        canonical.set(name, result);
        return result;
    };
    for (const { sheet, rows } of nameRows) {
        for (const { row, primary: written, aliases } of rows) {
            if (!written || isUser(written)) continue;
            const primary = canonicalOf(written);
            if (primary !== written && !aliases.includes(written)) aliases.unshift(written);
            let profile = profiles.get(primary);
            if (!profile) {
                profile = { primary, aliases: [], sections: [], tokens: 0, empty: [], text: '', numbers: {}, fieldLabels: new Set(), home: { sheet: sheet.name, uid: sheet.uid, rowIndex: row.rowIndex } };
                profiles.set(primary, profile);
            }
            for (const alias of aliases) if (alias !== primary && !profile.aliases.includes(alias)) profile.aliases.push(alias);
        }
    }
    // 主名优先，外号只在没被占用时登记
    for (const p of profiles.values()) index.set(p.primary, p.primary);
    for (const p of profiles.values()) for (const a of p.aliases) if (!index.has(a)) index.set(a, p.primary);

    /** 名字（可能写成「主名|外号」）→ 主名，认不出为 null */
    const resolve = (raw) => {
        const { primary, aliases } = parseNameCell(raw);
        for (const n of [primary, ...aliases]) if (n && index.has(n)) return index.get(n);
        return null;
    };
    const orphanMap = new Map();
    const noteOrphan = (raw, sheetName) => {
        const name = parseNameCell(raw).primary;
        if (!name || isUser(name) || NOT_NAMES.has(name) || GENERIC_TITLES.has(name) || orphanMap.has(name)) return;
        orphanMap.set(name, sheetName);
    };

    // 角色类表的格子
    for (const { sheet, rows } of nameRows) {
        const headers = getHeaders(sheet);
        for (const { row, primary: written } of rows) {
            if (!written || isUser(written)) continue;
            const profile = profiles.get(canonicalOf(written));
            const section = sectionOf(profile, sheet, 'fields');
            headers.forEach((header, col) => {
                if (col === 0 || isHidden(layout, sheet.name, header)) return;
                const label = stripColumnMark(header);
                const value = clean(row.values[col]);
                if (!value) { profile.empty.push({ sheet: sheet.name, col: label }); return; }
                const append = columnMode(header) === 'append';
                const item = { key: `${sheet.uid}:${row.rowIndex}:${col}`, label, header, value, rowIndex: row.rowIndex, col, append };
                const isLong = forceLong.has(label) || (!forceShort.has(label) && (append || value.length > shortLimit));
                (isLong ? section.long : section.grid).push(item);
                profile.fieldLabels.add(label);
                const num = parseNumber(value);
                if (Number.isNaN(num)) return;
                if (/好感/.test(label) && profile.numbers.好感 === undefined) profile.numbers.好感 = num;
                else if (/臣服/.test(label) && profile.numbers.臣服值 === undefined) profile.numbers.臣服值 = num;
                else if (/高潮次数/.test(label) && profile.numbers.累计高潮次数 === undefined) profile.numbers.累计高潮次数 = num;
            });
        }
    }

    /** 把一行里除去 skip 列以外的非空列写成「列名：值」 */
    const detailOf = (sheet, headers, values, skip) => headers
        .map((h, i) => (skip.includes(i) || isHidden(layout, sheet.name, h) || !clean(values[i]) ? null : `${stripColumnMark(h)}：${clean(values[i])}`))
        .filter(Boolean).join('\n');
    /** 一行条目：标题取第一个非空列，副标题取状态/进度列 */
    const plainRow = (sheet, headers, row, skipCols) => {
        const metaCol = headers.findIndex((h, i) => !skipCols.includes(i) && META_PATTERN.test(stripColumnMark(h)) && !isHidden(layout, sheet.name, h));
        const titleCol = headers.findIndex((h, i) => !skipCols.includes(i) && i !== metaCol && clean(row.values[i]) && !isHidden(layout, sheet.name, h));
        const skip = [...skipCols, metaCol, titleCol].filter(i => i >= 0);
        return {
            key: `${sheet.uid}:${row.rowIndex}`,
            title: titleCol >= 0 ? clean(row.values[titleCol]) : sheet.name,
            meta: metaCol >= 0 ? clean(row.values[metaCol]) : '',
            detail: detailOf(sheet, headers, row.values, skip),
            rowIndex: row.rowIndex,
            link: null,
        };
    };

    // 第二遍：其余表
    for (const sheet of usable) {
        if (isNameKeyedSheet(sheet)) continue;
        const headers = getHeaders(sheet);
        const stripped = headers.map(stripColumnMark);
        if (isPairSheet(sheet)) {
            // 副标题：优先叫「关系」的列，没有就取第一个含「关系」的非追加列
            const exact = stripped.findIndex((h, i) => i >= 2 && h === '关系');
            const metaCol = exact >= 0 ? exact : stripped.findIndex((h, i) => i >= 2 && /关系/.test(h) && columnMode(headers[i]) !== 'append');
            for (const row of readRows(sheet)) {
                const sides = [row.values[0], row.values[1]];
                const resolved = sides.map(resolve);
                sides.forEach((raw, i) => { if (!resolved[i] && clean(raw)) noteOrphan(raw, sheet.name); });
                resolved.forEach((primary, i) => {
                    if (!primary) return;
                    const otherRaw = sides[1 - i];
                    const other = resolved[1 - i];
                    const title = other || parseNameCell(otherRaw).primary || clean(otherRaw);
                    sectionOf(profiles.get(primary), sheet, 'pair').rows.push({
                        key: `${sheet.uid}:${row.rowIndex}`,
                        title,
                        meta: metaCol >= 0 ? clean(row.values[metaCol]) : '',
                        detail: detailOf(sheet, headers, row.values, [0, 1, metaCol]),
                        rowIndex: row.rowIndex,
                        link: other && other !== primary ? other : null,
                    });
                });
            }
            continue;
        }
        if (OWNER_HEADERS.includes(stripped[0])) {
            for (const row of readRows(sheet)) {
                const owners = new Set();
                for (const part of clean(row.values[0]).split(OWNER_SPLIT).map(clean).filter(Boolean)) {
                    const primary = resolve(part);
                    if (primary) owners.add(primary); else noteOrphan(part, sheet.name);
                }
                for (const primary of owners) sectionOf(profiles.get(primary), sheet, 'owner').rows.push(plainRow(sheet, headers, row, [0]));
            }
            continue;
        }
        const rolesCol = stripped.indexOf('涉及角色');
        if (rolesCol === -1) continue;
        for (const row of readRows(sheet)) {
            const involved = new Set();
            for (const part of clean(row.values[rolesCol]).split(MULTI_SPLIT).map(clean).filter(Boolean)) {
                const primary = index.get(part) ?? null;
                if (primary) involved.add(primary); else noteOrphan(part, sheet.name);
            }
            for (const primary of involved) sectionOf(profiles.get(primary), sheet, 'roles').rows.push(plainRow(sheet, headers, row, [rolesCol]));
        }
    }

    // 排序、算 token 和全文
    const userOrder = layout.order || [];
    const rank = (name) => {
        const i = userOrder.indexOf(name);
        return i >= 0 ? i - userOrder.length - 1e6 : order.get(name) ?? 1e9;
    };
    const list = [...profiles.values()];
    for (const profile of list) {
        profile.sections.sort((a, b) => rank(a.sheet) - rank(b.sheet));
        const parts = [profile.primary, ...profile.aliases];
        for (const s of profile.sections) {
            for (const item of [...s.grid, ...s.long]) parts.push(item.value);
            for (const r of s.rows) parts.push(r.title, r.meta, r.detail);
        }
        profile.text = parts.filter(Boolean).join('\n');
        profile.tokens = estimateTokens(profile.text);
    }

    // 对不上的名字：找长得像的人
    const candidates = [...index.entries()];
    const orphans = [...orphanMap.entries()].map(([name, sheet]) => {
        const suggestions = [];
        for (const [n, primary] of candidates) {
            const similar = oneCharApart(n, name) || (n.length >= 2 && name.length >= 2 && (n.includes(name) || name.includes(n)));
            if (similar && !suggestions.includes(primary)) suggestions.push(primary);
        }
        return { name, sheet, suggestions };
    });

    return { list, index, orphans };
}

// ---------------------------------------------------------------- 搜索、排序、导出

/** 全文搜索：主名、外号、档案内容，不分大小写 */
export function searchProfiles(list, q) {
    const key = clean(q).toLowerCase();
    if (!key) return list.slice();
    return list.filter(p => [p.primary, ...(p.aliases || []), p.text || ''].some(s => String(s).toLowerCase().includes(key)));
}

/**
 * 排序：置顶的永远在前
 * @param {'recent'|'favor'|'submit'|'name'|'absent'|'tokens'} key
 * @param {{ appear?: Object, present?: Set<string>, pins?: Set<string>, numbers?: Object }} ctx numbers 可按主名给出状态标签里的数值，优先于表格
 */
export function sortProfiles(list, key, ctx = {}) {
    const appear = ctx.appear || {};
    const present = ctx.present || new Set();
    const pins = ctx.pins || new Set();
    const last = (p) => appear[p.primary]?.last;
    const num = (p, field) => {
        const v = ctx.numbers?.[p.primary]?.[field] ?? p.numbers?.[field];
        return typeof v === 'number' && !Number.isNaN(v) ? v : -Infinity;
    };
    const byKey = {
        recent: (a, b) => (present.has(b.primary) - present.has(a.primary)) || ((last(b) ?? -1) - (last(a) ?? -1)),
        favor: (a, b) => num(b, '好感') - num(a, '好感') || 0,
        submit: (a, b) => num(b, '臣服值') - num(a, '臣服值') || 0,
        name: (a, b) => a.primary.localeCompare(b.primary, 'zh'),
        absent: (a, b) => (last(a) ?? Infinity) - (last(b) ?? Infinity) || 0,
        tokens: (a, b) => (b.tokens || 0) - (a.tokens || 0),
    }[key] || (() => 0);
    return list
        .map((p, i) => ({ p, i }))
        .sort((x, y) => (pins.has(y.p.primary) - pins.has(x.p.primary)) || byKey(x.p, y.p) || x.i - y.i)
        .map(x => x.p);
}

/**
 * 档案转纯文本（复制用）
 * @param {Object} profile buildProfiles 给的档案
 * @param {{ floor?: number, fields?: Object|Map }} [status] 状态标签里抓到的最新状态
 */
export function profileToText(profile, status) {
    const lines = [`【${profile.primary}】${profile.aliases?.length ? `外号：${profile.aliases.join('、')}` : ''}`];
    for (const s of profile.sections) {
        if (!s.grid.length && !s.long.length && !s.rows.length) continue;
        lines.push('', `== ${s.sheet} ==`);
        for (const item of [...s.grid, ...s.long]) lines.push(`${item.label}：${item.value}`);
        for (const r of s.rows) {
            lines.push(`- ${r.title}${r.meta ? `（${r.meta}）` : ''}`);
            if (r.detail) r.detail.split('\n').forEach(d => lines.push(`  ${d}`));
        }
    }
    const fields = status?.fields instanceof Map ? [...status.fields] : Object.entries(status?.fields || {});
    if (fields.length) {
        lines.push('', `== 最新状态${status.floor !== undefined ? `（第 ${status.floor} 楼）` : ''} ==`);
        for (const [label, value] of fields) {
            const text = clean(value);
            if (text.includes('\n')) lines.push(`${label}：`, ...text.split('\n').map(t => `  ${clean(t)}`));
            else lines.push(`${label}：${text}`);
        }
    }
    return lines.join('\n');
}
