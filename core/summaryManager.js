import { BASE, DERIVED, EDITOR, USER } from './manager.js';
import { loadSheetsFilled } from './sheetRepair.js';
import { cleanChatText } from './chatText.js';
import { V2 } from './v2keys.js';
import { Cell } from './table/cell.js';
import { placesInMessage, splitPlace } from './locationTree.js';
import { getHeaders, isNameKeyedSheet, parseNameCell, stripColumnMark, writeRowValues, findRowByName } from './rowIdentity.js';
import { askExtra } from './extraRequest.js';

/**
 * @description 大总结交给程序管（B3、M1、M2、M3、M5、M6、M8）
 * @description - 事件历史满 N 条：程序另发一个请求，把这些事件写成一条「大」总结，记下楼层范围和涉及角色，再删掉事件
 * @description - 「大」总结攒够 batch + keep 条：最早的 batch 条压成一条「卷」，「卷」同理压成「篇」；被压掉的原文移进归档表，不删
 * @description - 每轮按最近几层出现的人名，从归档里找回最多几条相关旧事，附在表格后面发给 AI
 * @description - 发送时给总结里的日期标上「几天前」
 * @description 正文请求照常发全部现有总结；压缩是额外请求，成功后才替换原来的行
 */

export const LEVELS = ['大', '卷', '篇'];

const COL = { content: '内容', level: '层级', range: '楼层范围', roles: '涉及角色' };

/** 设置（带默认值） */
export function summaryConfig() {
    const s = USER.tableBaseSetting;
    return {
        enabled: s.v2_summary_enabled !== false,
        eventTable: s.v2_summary_event_table || '事件历史',
        summaryTable: s.v2_summary_table || '大总结',
        archiveTable: s.v2_summary_archive_table || '总结归档',
        eventThreshold: Number(s.v2_summary_event_threshold) || 20,
        batch: Number(s.v2_summary_batch) || 10,
        keep: Number(s.v2_summary_keep) >= 0 ? Number(s.v2_summary_keep) : 3,
        recallCount: Number(s.v2_summary_recall_count) >= 0 ? Number(s.v2_summary_recall_count) : 5,
        recallDepth: Number(s.v2_summary_recall_depth) || 3,
    };
}

const clean = (v) => String(v ?? '').trim();
const findSheet = (sheets, name) => sheets.find(s => s.name === name);

/** 列名 → 列号（不含行号列），找不到为 -1；内容列找不到时用第 0 列 */
function columnIndex(sheet, name) {
    const index = getHeaders(sheet).findIndex(h => stripColumnMark(h) === name);
    return index === -1 && name === COL.content ? 0 : index;
}

/** 读出全部数据行：[{ rowIndex, values: [] }] */
export function readRows(sheet) {
    const rows = [];
    for (let r = 1; r < sheet.getRowCount(); r++) {
        rows.push({ rowIndex: r - 1, values: (sheet.getCellsByRowIndex(r) || []).slice(1).map(c => clean(c?.data?.value)) });
    }
    return rows;
}

/** 总结行 → { content, level, range, roles } */
function readSummaryRows(sheet) {
    const c = { content: columnIndex(sheet, COL.content), level: columnIndex(sheet, COL.level), range: columnIndex(sheet, COL.range), roles: columnIndex(sheet, COL.roles) };
    return readRows(sheet).map(row => ({
        rowIndex: row.rowIndex,
        content: row.values[c.content] ?? '',
        level: (c.level >= 0 && row.values[c.level]) || '大',
        range: c.range >= 0 ? row.values[c.range] ?? '' : '',
        roles: c.roles >= 0 ? row.values[c.roles] ?? '' : '',
    }));
}

/** 总结行 → 写入用的 data（按列号） */
function summaryData(sheet, { content, level, range, roles }) {
    const data = {};
    const put = (name, value) => { const i = columnIndex(sheet, name); if (i >= 0 && value !== undefined) data[i] = value; };
    put(COL.content, content); put(COL.level, level); put(COL.range, range); put(COL.roles, roles);
    return data;
}

/** 在表尾追加一行 */
function appendRow(sheet, data) {
    sheet.findCellByPosition(sheet.getRowCount() - 1, 0).newAction(Cell.CellAction.insertDownRow, {}, false);
    const cells = sheet.getCellsByRowIndex(sheet.getRowCount() - 1);
    Object.entries(data).forEach(([col, value]) => { const cell = cells[parseInt(col) + 1]; if (cell) cell.data.value = value; });
}

/** 在第 rowIndex 行上面插入一行 */
function insertRowAbove(sheet, rowIndex, data) {
    sheet.findCellByPosition(rowIndex + 1, 0).newAction(Cell.CellAction.insertUpRow, {}, false);
    const cells = sheet.getCellsByRowIndex(rowIndex + 1);
    Object.entries(data).forEach(([col, value]) => { const cell = cells[parseInt(col) + 1]; if (cell) cell.data.value = value; });
}

/** 从下往上删行 */
function deleteRows(sheet, rowIndexes) {
    [...rowIndexes].sort((a, b) => b - a).forEach(r => sheet.findCellByPosition(r + 1, 0)?.newAction(Cell.CellAction.deleteSelfRow, {}, false));
}

/** 楼层范围「12-40」合并 */
function mergeRanges(ranges) {
    const nums = ranges.flatMap(r => String(r).match(/\d+/g) || []).map(Number);
    if (!nums.length) return ranges.find(Boolean) || '';
    return `${Math.min(...nums)}-${Math.max(...nums)}`;
}

/**
 * 按楼层范围的起点把一条总结插到合适的位置（手动融合用）；范围认不出时放最后
 * @returns {number} 插入后的行号
 */
export function insertSummaryByRange(sheet, row) {
    const start = (String(row.range).match(/\d+/) || [])[0];
    const rows = readSummaryRows(sheet);
    const before = start === undefined ? undefined : rows.find(r => {
        const s = (String(r.range).match(/\d+/) || [])[0];
        return s !== undefined && Number(s) > Number(start);
    });
    if (!before) {
        appendRow(sheet, summaryData(sheet, row));
        return sheet.getRowCount() - 2;
    }
    insertRowAbove(sheet, before.rowIndex, summaryData(sheet, row));
    return before.rowIndex;
}

// ---------------------------------------------------------------- 人名

/** 所有角色类表里的名字：别名 → 主名 */
export function collectNames(sheets) {
    const userName = clean(USER.getContext().name1);
    const map = new Map();
    for (const sheet of sheets) {
        if (!isNameKeyedSheet(sheet)) continue;
        for (const row of readRows(sheet)) {
            const { primary, aliases } = parseNameCell(row.values[0]);
            if (!primary || primary === userName || primary === '<user>' || primary === '{{user}}') continue;
            for (const name of [primary, ...aliases]) if (name.length >= 2 && !map.has(name)) map.set(name, primary);
        }
    }
    return map;
}

/** 文本里出现的角色（主名），按出现次数排，最多 limit 个 */
export function findRolesInText(text, names, limit = 3) {
    const count = new Map();
    for (const [name, primary] of names) {
        const hits = text.split(name).length - 1;
        if (hits) count.set(primary, (count.get(primary) || 0) + hits);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([p]) => p);
}

// ---------------------------------------------------------------- 请求模型

/** 测试时可以换掉 ask */
export const summaryHooks = { ask: (system, user, title) => askModel(system, user, title) };

async function askModel(system, user, title) {
    // 排队、等正文生成完、流式显示都在 askExtra 里
    return askExtra(system, user, title);
}

/** 从模型输出里取 <summary> 和 <past>（没有标签就整段当总结） */
export function parseSummaryOutput(text) {
    text = String(text ?? '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '');
    // 取最后一个 <summary>（有的模型会先复述一遍格式）；没有标签时去掉其他标签块，只留正文
    const pick = (tag) => [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].pop()?.[1];
    const summary = clean(pick('summary') ?? text.replace(/<past>[\s\S]*?<\/past>/g, '').replace(/<(\w+)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '')).replace(/\n+/g, ' ');
    const past = clean(pick('past') ?? '').split('\n').map(clean).filter(Boolean).map(line => {
        const m = line.match(/^(.+?)[：:]\s*(.+)$/);
        return m ? { name: clean(m[1]), text: clean(m[2]) } : null;
    }).filter(Boolean);
    return { summary, past };
}

const EVENT_SYSTEM = `你是小说记录员。把用户给的「事件历史」整理成一条大总结。
规则：
1. 只写事件历史里有的事，按时间先后写，不编造、不评价。
2. 格式：「日期/地点/内容」，内容写成电报体：谁对谁做了什么→结果；去掉形容词、语气词、心理描写；不写人物外貌性格。
3. 25 到 180 字。
4. 另外，对事件里有重要经历的角色（最多 5 个，不含主角本人），各写一句这次的关键经历。
输出格式（只输出这些）：
<summary>大总结</summary>
<past>
角色名：一句话
</past>`;

const COMPRESS_SYSTEM = (from, to) => `你是小说记录员。把用户给的 ${'{n}'} 条「${from}」总结按原顺序压缩成一条「${to}」总结。
规则：
1. 只用给出的内容，按时间先后写，不调换顺序，不编造、不评价。
2. 每一段开头带日期；电报体：谁对谁做了什么→结果。
3. 保留会影响后续剧情的事：关系变化、承诺、伏笔、重要物品、生死、身份揭示；删掉细节和重复。
4. 字数不超过所有输入总字数的三分之一，最多 400 字。
输出格式（只输出这个）：
<summary>压缩后的总结</summary>`;

// ---------------------------------------------------------------- 主流程

let running = false;

/**
 * 对一层的表格跑一遍：事件满了就写大总结，大总结多了就逐级压缩
 * @description 表格实例是全局共用的，等模型回复期间别处可能换成别的楼层的数据，所以每次改之前都按楼层重新载入，并核对内容没变
 * @param {Object} piece 结果保存到的消息
 * @param {number} floor 这层的楼层号
 * @param {Object} options sourcePiece 从哪条消息读表格（默认就是 piece）；compressAll 一直压到不够一组为止（迁移老档用）
 * @returns {Promise<string[]>} 做了哪些事
 */
export async function runSummaryPipeline(piece, floor, { sourcePiece = piece, compressAll = false } = {}) {
    const config = summaryConfig();
    if (!config.enabled || running || !piece) return [];
    running = true;
    const log = [];
    let source = sourcePiece;
    const load = () => {
        const sheets = loadSheetsFilled(source);
        return {
            sheets,
            events: findSheet(sheets, config.eventTable),
            summary: findSheet(sheets, config.summaryTable),
            archive: findSheet(sheets, config.archiveTable),
        };
    };
    // 撤回用：第一次改表前记下这层原来的表格快照
    let undo = null;
    const commit = (sheets) => {
        if (!undo) {
            undo = {
                floor,
                at: new Date().toISOString(),
                own: piece[V2.pieceHash] ? copyHash(piece[V2.pieceHash]) : null,
                before: copyHash(BASE.getPieceHash(source) || {}),
                summaryFloors: [...(USER.getContext().chatMetadata?.[V2.summaryState]?.summaryFloors || [])],
            };
        }
        sheets.forEach(sheet => sheet.save(piece, true));
        source = piece;
    };
    const eventText = (events) => readRows(events).map((row, i) => `${i + 1}. ${row.values.filter(Boolean).join(' / ')}`).join('\n');
    try {
        let t = load();
        if (!t.events || !t.summary) return [];
        const meta = USER.getContext().chatMetadata;
        const state = meta[V2.summaryState] ||= { summaryFloors: [], cache: {} };
        state.summaryFloors ||= [];

        // 1. 事件满了 → 一条「大」总结
        const eventCount = readRows(t.events).length;
        if (eventCount >= config.eventThreshold) {
            const text = eventText(t.events);
            const lastBig = readSummaryRows(t.summary).filter(r => r.level === LEVELS[0]).pop();
            const prompt = `${lastBig ? `（上一条大总结的结尾，只用来衔接，不要复述：${lastBig.content.slice(-60)}）\n\n` : ''}事件历史：\n${text}`;
            const result = await cachedAsk(state, EVENT_SYSTEM, prompt, `写大总结（事件 ${eventCount} 条）`);
            const { summary: content, past } = parseSummaryOutput(result);
            if (!content) throw new Error('大总结为空');
            t = load();
            if (eventText(t.events) === text) {
                const names = collectNames(t.sheets);
                const range = `${rangeStart(state, floor)}-${floor}`;
                appendRow(t.summary, summaryData(t.summary, { content, level: LEVELS[0], range, roles: findRolesInText(text, names).join('|') }));
                deleteRows(t.events, readRows(t.events).map(r => r.rowIndex));
                appendPast(t.sheets, past);
                commit(t.sheets);
                // 重 roll 同一层时不会记两次
                state.summaryFloors = [...state.summaryFloors.filter(f => f < floor), floor].slice(-50);
                log.push(`事件历史 ${eventCount} 条写成 1 条大总结（${range} 层）`);
            }
        }

        // 2. 逐级压缩（失败不影响上面已写好的大总结）
        try {
            for (let level = 0; level < LEVELS.length - 1; level++) {
                // 平时每级最多压一组；迁移老档时一直压到不够为止
                for (let round = 0; round < (compressAll ? 50 : 1); round++) {
                    t = load();
                    if (!t.archive) break;
                    const pickGroup = () => {
                        const rows = readSummaryRows(t.summary).filter(r => r.level === LEVELS[level]);
                        return rows.length < config.batch + config.keep ? null : rows.slice(0, config.batch);
                    };
                    const group = pickGroup();
                    if (!group) break;
                    const prompt = group.map((r, i) => `${i + 1}. ${r.content}`).join('\n');
                    const result = await cachedAsk(state, COMPRESS_SYSTEM(LEVELS[level], LEVELS[level + 1]).replace('{n}', group.length), prompt, `压缩 ${group.length} 条${LEVELS[level]}总结成${LEVELS[level + 1]}`);
                    const { summary: content } = parseSummaryOutput(result);
                    if (!content) throw new Error(`${LEVELS[level + 1]}总结为空`);
                    t = load();
                    const now = pickGroup();
                    if (!now || JSON.stringify(now) !== JSON.stringify(group)) break;   // 等待期间表变了，下次再压
                    const names = collectNames(t.sheets);
                    const range = mergeRanges(group.map(r => r.range));
                    const roles = findRolesInText(group.map(r => r.content).join('\n'), names, 5).join('|');
                    group.forEach(r => appendRow(t.archive, summaryData(t.archive, r)));
                    insertRowAbove(t.summary, group[0].rowIndex, summaryData(t.summary, { content, level: LEVELS[level + 1], range, roles }));
                    deleteRows(t.summary, group.map(r => r.rowIndex + 1));   // 上面插了一行，原行号都下移 1
                    commit(t.sheets);
                    log.push(`${group.length} 条${LEVELS[level]}总结压成 1 条${LEVELS[level + 1]}总结（原文移进归档）`);
                }
            }
        } catch (error) {
            if (!log.length) throw error;
            log.push(`压缩没做完，下次再试：${error.message}`);
        }

        if (undo) {
            const meta = USER.getContext().chatMetadata;
            undo.after = copyHash(piece[V2.pieceHash] || {});
            undo.log = log.slice();
            meta[V2.summaryUndo] = [...(meta[V2.summaryUndo] || []), undo].slice(-3);   // 最多留 3 次，免得聊天文件变大
        }
        if (log.length) await USER.saveChat();
        return log;
    } finally {
        running = false;
    }
}

function copyHash(hash) {
    return Object.fromEntries(Object.entries(hash || {}).map(([uid, rows]) => [uid, (rows || []).map(row => [...row])]));
}

/** 能撤回的大总结记录（最近的在最后） */
export function summaryUndoList() {
    return USER.getContext().chatMetadata?.[V2.summaryUndo] || [];
}

/**
 * 撤回最近一次程序写的大总结 / 压缩
 * - 那层之后没再改过表：整层表格原样恢复
 * - 之后又聊了几层：在最新一层上把大总结表、归档表恢复成写之前的样子；被写进总结而删掉的事件放回事件历史最前面，之后新记的事件保留；其他表不动
 * 同时清掉这次的请求缓存，再写时会重新请求，不会拿到同一个结果
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function undoLastSummary() {
    const config = summaryConfig();
    const meta = USER.getContext().chatMetadata;
    const list = meta[V2.summaryUndo] || [];
    const entry = list[list.length - 1];
    if (!entry) return { ok: false, message: '没有可以撤回的大总结' };
    if (running) return { ok: false, message: '大总结正在写，等它写完再撤回' };
    const chat = USER.getContext().chat || [];
    const piece = chat[entry.floor];
    if (!piece) return { ok: false, message: `第 ${entry.floor} 层已经不在了，撤回不了` };
    const { piece: latest } = BASE.getLastSheetsPiece();
    const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
    let mode;
    if (latest === piece && same(piece[V2.pieceHash], entry.after)) {
        if (entry.own) piece[V2.pieceHash] = copyHash(entry.own);
        else delete piece[V2.pieceHash];
        mode = '整层恢复';
    } else {
        if (!latest || !BASE.getPieceHash(latest)) return { ok: false, message: '找不到最新的表格' };
        const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(latest));
        const uidOf = (name) => findSheet(sheets, name)?.uid;
        const target = latest[V2.pieceHash] ||= copyHash(BASE.getPieceHash(latest));
        for (const name of [config.summaryTable, config.archiveTable]) {
            const uid = uidOf(name);
            if (uid && entry.before[uid]) target[uid] = entry.before[uid].map(row => [...row]);
        }
        const eventUid = uidOf(config.eventTable);
        if (eventUid && entry.before[eventUid] && target[eventUid]) {
            // 写总结前的事件 + 之后新记的事件（写完总结时事件表是清空的，所以现在表里的都是新的）
            const kept = new Set(entry.after?.[eventUid]?.slice(1).map(row => row.join('|')) || []);
            const added = target[eventUid].slice(1).filter(row => !kept.has(row.join('|')));
            target[eventUid] = [target[eventUid][0], ...entry.before[eventUid].slice(1), ...added];
        }
        mode = `在最新一层恢复大总结和归档，事件放回事件历史`;
    }
    const state = meta[V2.summaryState] ||= { summaryFloors: [], cache: {} };
    state.summaryFloors = entry.summaryFloors;
    state.cache = {};
    meta[V2.summaryUndo] = list.slice(0, -1);
    await USER.saveChat();
    return { ok: true, message: `已撤回（${mode}）：${(entry.log || []).join('；') || '大总结'}` };
}

/** 这条大总结从哪层开始：上次写大总结那层的下一层；从没写过时用导入 v2 的楼层，新聊天从 0 开始 */
function rangeStart(state, floor) {
    const previous = state.summaryFloors.filter(f => f < floor).pop();
    if (previous !== undefined) return previous + 1;
    const imported = USER.getContext().chatMetadata?.[V2.chatImport]?.floor;
    return Number.isInteger(imported) ? imported + 1 : 0;
}

/** 本层收到正文后调用：按楼层号跑一遍，失败只提示不影响正文 */
export async function runSummaryAfterFill(piece) {
    if (!summaryConfig().enabled || !piece) return [];
    const chat = USER.getContext().chat || [];
    const floor = chat.indexOf(piece);
    if (floor === -1) return [];
    try {
        // 这层 AI 没填表时，从最近有表格的那层读
        const sourcePiece = BASE.getPieceHash(piece) ? piece : BASE.getLastSheetsPiece().piece;
        const log = await runSummaryPipeline(piece, floor, { sourcePiece });
        rememberSummaryLog(log);
        return log;
    } catch (error) {
        EDITOR.error('记忆插件 v2：自动大总结失败，下一轮会再试', error.message, error);
        return [];
    }
}

/**
 * 程序管大总结时，AI 在正文里对大总结表的增删、对事件历史的删除都不执行（只在实时收到新消息时拦，重建老楼层照旧）
 * @returns {boolean} true 表示这条指令跳过
 */
export function shouldIgnoreAiEdit(sheet, type) {
    const config = summaryConfig();
    if (!config.enabled || !sheet) return false;
    if (sheet.name === config.summaryTable) return type === 'insert' || type === 'delete';
    if (sheet.name === config.eventTable) return type === 'delete';
    if (sheet.name === config.archiveTable) return true;
    return false;
}

/**
 * 迁移老档：给已有的大总结补上 层级=大、楼层范围=迁移前、涉及角色，然后按设置压缩
 * 需要先「同步模板到本聊天」，让大总结表有这几列、并建出归档表
 * @param {boolean} dryRun 只统计
 * @returns {Promise<{ filled: number, total: number, missing: string[], log: string[] }>}
 */
export async function migrateOldSummaries(dryRun = false) {
    const config = summaryConfig();
    const { piece } = USER.getChatPiece();
    const { piece: sourcePiece } = BASE.getLastSheetsPiece();
    const result = { filled: 0, total: 0, missing: [], log: [] };
    if (!piece || !sourcePiece) { result.missing.push('聊天记录'); return result; }
    const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(sourcePiece));
    const summary = findSheet(sheets, config.summaryTable);
    if (!summary) { result.missing.push(`表「${config.summaryTable}」`); return result; }
    for (const name of [COL.level, COL.range, COL.roles]) if (columnIndex(summary, name) === -1) result.missing.push(`「${config.summaryTable}」的「${name}」列`);
    if (!findSheet(sheets, config.archiveTable)) result.missing.push(`表「${config.archiveTable}」`);
    const rows = readSummaryRows(summary);
    result.total = rows.length;
    if (result.missing.length || dryRun) return result;
    const names = collectNames(sheets);
    const c = { level: columnIndex(summary, COL.level), range: columnIndex(summary, COL.range), roles: columnIndex(summary, COL.roles) };
    for (const row of rows) {
        // 用 editCell 生成新格子，回退到老楼层时看到的还是原样
        const fill = { [c.level]: LEVELS[0], [c.range]: '迁移前', [c.roles]: findRolesInText(row.content, names, 5).join('|') };
        let touched = false;
        for (const [col, value] of Object.entries(fill)) {
            const cell = summary.findCellByPosition(row.rowIndex + 1, Number(col) + 1);
            if (!cell || clean(cell.data.value) || !value) continue;
            cell.newAction(Cell.CellAction.editCell, { value }, false);
            touched = true;
        }
        if (touched) result.filled++;
    }
    sheets.forEach(sheet => sheet.save(piece, true));
    await USER.saveChat();
    const chat = USER.getContext().chat || [];
    result.log = await runSummaryPipeline(piece, chat.indexOf(piece), { compressAll: true });
    rememberSummaryLog(result.log);
    return result;
}

/** 同样的输入不重复请求（重 roll 时直接用上次的结果） */
async function cachedAsk(state, system, prompt, title) {
    const key = hashText(system + '\n' + prompt);
    if (state.cache[key]) return state.cache[key];
    const result = await summaryHooks.ask(system, prompt, title);
    if (looksLikeStory(result)) throw new Error('回复没有 <summary> 标签、又很长，像是在续写剧情，没有写进表格（检查额外请求用的预设，或换个模型再试）');
    state.cache = Object.fromEntries(Object.entries(state.cache).slice(-19));   // 只留最近 20 条
    state.cache[key] = result;
    return result;
}

/** 没有 <summary> 标签、正文又远超总结长度的回复，多半是模型在续写剧情 */
export function looksLikeStory(text) {
    const plain = String(text ?? '').replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '');
    if (/<summary>[\s\S]*?<\/summary>/.test(plain)) return false;
    return parseSummaryOutput(plain).summary.length > 800;
}

function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return `${text.length}_${h >>> 0}`;
}

/** M6：把每个角色这次的关键经历追加到角色表的「往事」列 */
function appendPast(sheets, past) {
    if (!past.length) return;
    const sheet = sheets.find(s => isNameKeyedSheet(s) && getHeaders(s).some(h => stripColumnMark(h) === '往事'));
    if (!sheet) return;
    const col = getHeaders(sheet).findIndex(h => stripColumnMark(h) === '往事');
    for (const { name, text } of past) {
        const found = findRowByName(sheet, name);
        if (found.rowIndex === -1) continue;
        writeRowValues(sheet, found.rowIndex, { [col]: text }, true);
    }
}

// ---------------------------------------------------------------- 发送时：召回和「几天前」

/** 最近几层正文 + 本轮输入 */
export function recentText(depth) {
    const chat = USER.getContext().chat || [];
    // 去掉填表指令、思考和设置里要跳过的标签：<tableEdit> 和状态栏里会列很多不在场的人，算进去的话谁都成了「在场」
    return chat.slice(-depth * 2).map(m => cleanChatText(m?.mes)).join('\n');
}

/**
 * M5：按最近出现的人名从归档里找回相关旧事
 * @returns {string} 发给 AI 的一段文字，没有就是空串
 */
export function buildRecallBlock(sheets) {
    const config = summaryConfig();
    if (!config.enabled || !config.recallCount) return '';
    const archive = findSheet(sheets, config.archiveTable);
    if (!archive || archive.getRowCount() <= 1) return '';
    const names = collectNames(sheets);
    const present = new Set(findRolesInText(recentText(config.recallDepth), names, 20));
    // 地名也算：最近一个时间标签里的地点，取三个字以上的段（「走廊」这类太泛的不算）
    const places = recentPlaceSegments(config.recallDepth).filter(seg => seg.length >= 3);
    if (!present.size && !places.length) return '';
    const rows = readSummaryRows(archive);
    // 越少见的名字越有区分度
    const freq = new Map();
    rows.forEach(r => r.roles.split('|').filter(Boolean).forEach(n => freq.set(n, (freq.get(n) || 0) + 1)));
    const scored = rows.map(r => {
        const roles = r.roles ? r.roles.split('|').filter(Boolean) : findRolesInText(r.content, names, 5);
        const score = roles.filter(n => present.has(n)).reduce((s, n) => s + 1 / (freq.get(n) || 1), 0)
            + places.filter(seg => r.content.includes(seg)).length * 0.5;
        return { r, score };
    }).filter(x => x.score > 0);
    if (!scored.length) return '';
    const picked = scored.sort((a, b) => b.score - a.score || b.r.rowIndex - a.r.rowIndex).slice(0, config.recallCount)
        .sort((a, b) => a.r.rowIndex - b.r.rowIndex);
    return `【相关旧事（按本轮出场的人和地点从归档里找回，只供参考，不要改写）】\n${picked.map(x => `- ${x.r.range ? `[${x.r.range}层] ` : ''}${x.r.content}`).join('\n')}\n`;
}

/** 最近几层里最后一个时间标签的地点，拆成由大到小的几段 */
function recentPlaceSegments(depth) {
    const chat = USER.getContext().chat || [];
    for (let i = chat.length - 1; i >= 0 && i >= chat.length - depth * 2; i--) {
        if (chat[i]?.is_user) continue;
        const places = placesInMessage(chat[i]?.mes);
        if (places.length) return splitPlace(places[places.length - 1]);
    }
    return [];
}

const DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;

/** 当前故事日期：最新一条 AI 消息里的时间标签，其次时空表的日期列 */
export function currentStoryDate(sheets) {
    const chat = USER.getContext().chat || [];
    for (let i = chat.length - 1; i >= 0 && i >= chat.length - 6; i--) {
        if (chat[i]?.is_user) continue;
        const tags = String(chat[i]?.mes || '').match(/『[^』]*』/g) || [];
        for (const tag of tags.reverse()) {
            const m = tag.match(DATE_RE);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        }
    }
    for (const sheet of sheets) {
        const col = getHeaders(sheet).findIndex(h => stripColumnMark(h) === '日期');
        if (col === -1) continue;
        const rows = readRows(sheet);
        for (const row of rows.reverse()) {
            const m = String(row.values[col] || '').match(DATE_RE) || String(row.values[col] || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
            if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        }
    }
    return null;
}

function relative(days) {
    if (days <= 0) return '当天';
    if (days < 31) return `${days}天前`;
    if (days < 365) return `约${Math.round(days / 30)}个月前`;
    return `约${(days / 365).toFixed(days < 730 ? 1 : 0)}年前`;
}

/** M8：给一段文字里每行第一个日期标上「几天前」 */
export function annotateRelativeDates(text, now) {
    if (!now) return text;
    return text.split('\n').map(line => line.replace(DATE_RE, (match, y, m, d) => {
        const days = Math.round((now - new Date(Number(y), Number(m) - 1, Number(d))) / 86400000);
        return days < 0 ? match : `${match}（${relative(days)}）`;
    })).join('\n');
}

/** 发送时不发归档表 */
export function isArchiveSheet(sheet) {
    return sheet?.name === summaryConfig().archiveTable;
}

/** 本次压缩记录，用于诊断 */
export function rememberSummaryLog(lines) {
    if (!lines.length) return;
    DERIVED.any.summaryLog = [...(DERIVED.any.summaryLog || []).slice(-19), { at: new Date().toISOString(), lines }];
    EDITOR.success(lines.join('<br>'));
}
