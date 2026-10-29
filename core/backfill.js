import { BASE, USER } from './manager.js';
import { V2 } from './v2keys.js';
import { isArchiveSheet, runSummaryPipeline, summaryHooks } from './summaryManager.js';
import { replaceUserTag } from '../utils/stringUtil.js';

/**
 * @description O3 从第一层分批回填：新导入的聊天没有表格时，每批几层正文发一次请求补填表格
 * @description - 起点在最后一个已有 v2 表格的楼层之后，已有的快照一个都不改
 * @description - 每批结果存到这批最后一条 AI 消息上，下一批接着这个状态填；事件满了照常写大总结
 * @description - 随时可以停，停下时已填的批次保留
 */

export const BACKFILL_NOTE = (from, to) => `

【回填说明】
用户发来的是已经发生过的第 ${from} 到 ${to} 层正文（用户和 AI 的对话）。请按上面的表格规则，把这段正文里的信息一次性补进表格：
- 事件历史：这段里每条 AI 正文各插入 1 行，按时间先后。
- 其他表：只记这段里明确出现的信息，同一个人只占一行，表里已有的人用 updateRow。
- 只输出 <tableEdit> 标签，不写正文、不续写剧情。`;

const stripText = (mes) => String(mes || '')
    .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/g, '')
    .replace(/<tableThink>[\s\S]*?<\/tableThink>/g, '')
    .replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/g, '')
    .trim();

/**
 * 规划回填批次
 * @param {{ from?: number, to?: number, batch?: number }} options
 * @returns {{ start: number, end: number, lastFilled: number, batches: { floors: number[], target: number }[] }}
 */
export function planBackfill({ from = 0, to, batch } = {}) {
    const chat = USER.getContext().chat || [];
    const size = Math.max(1, Number(batch) || Number(USER.tableBaseSetting.v2_backfill_batch) || 5);
    let lastFilled = -1;
    chat.forEach((m, i) => { if (m && !m.is_user && m[V2.pieceHash]) lastFilled = i; });
    const start = Math.max(Number(from) || 0, lastFilled + 1);
    const end = Math.min(to ?? chat.length - 1, chat.length - 1);
    const batches = [];
    let floors = [];
    let aiCount = 0;
    for (let i = start; i <= end; i++) {
        const m = chat[i];
        if (!m || m.is_system) continue;
        floors.push(i);
        if (!m.is_user) aiCount++;
        if (!m.is_user && aiCount === size) {
            batches.push({ floors, target: i });
            floors = []; aiCount = 0;
        }
    }
    if (aiCount) batches.push({ floors, target: floors.filter(i => !chat[i].is_user).pop() });
    return { start, end, lastFilled, batches };
}

/**
 * 按计划回填
 * @param {ReturnType<typeof planBackfill>} plan
 * @param {Function} applyEdits (text, enabledSheets) => 执行的指令数（index.js 的 applyTableEditText）
 * @param {{ onProgress?: Function, shouldStop?: () => boolean }} hooks
 * @returns {Promise<{ done: number, edits: number, summaries: string[], stopped: boolean }>}
 */
export async function runBackfill(plan, applyEdits, { onProgress = () => {}, shouldStop = () => false } = {}) {
    const chat = USER.getContext().chat || [];
    let source = plan.lastFilled >= 0 ? chat[plan.lastFilled] : BASE.initHashSheet();
    const load = () => BASE.hashSheetsToSheets(BASE.getPieceHash(source));
    const result = { done: 0, edits: 0, summaries: [], stopped: false };
    for (const batch of plan.batches) {
        if (shouldStop()) { result.stopped = true; break; }
        const enabled = load().filter(sheet => sheet.enable);
        const tableText = enabled.filter(sheet => !isArchiveSheet(sheet)).map((sheet, index) => sheet.getTableText(index)).join('\n');
        const from = batch.floors[0];
        const system = replaceUserTag(USER.tableBaseSetting.message_template.replace('{{tableData}}', tableText)) + BACKFILL_NOTE(from, batch.target);
        const user = batch.floors.map(i => `[第${i}层·${chat[i].is_user ? '用户' : 'AI'}]\n${stripText(chat[i].mes)}`).join('\n\n');
        const raw = await summaryHooks.ask(system, user, `回填第 ${from}–${batch.target} 层`);
        // 等回复期间表格实例可能被换成别的楼层，重新载入
        const sheets = load();
        result.edits += applyEdits(raw, sheets.filter(sheet => sheet.enable && !isArchiveSheet(sheet)));
        const target = chat[batch.target];
        sheets.forEach(sheet => sheet.save(target, true));
        source = target;
        try {
            result.summaries.push(...await runSummaryPipeline(target, batch.target));
        } catch (error) {
            result.summaries.push(`第 ${batch.target} 层写大总结失败：${error.message}`);
        }
        await USER.saveChat();
        result.done++;
        onProgress({ ...result, total: plan.batches.length, batch });
    }
    return result;
}
