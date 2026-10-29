import { BASE } from './manager.js';
import { Cell } from './table/cell.js';
import { stripColumnMark } from './rowIdentity.js';

/**
 * @description 把全局模板同步到当前聊天，不动已有数据（老档迁移用）
 * @description - 同名表：复制说明和增删改提示词；表头按模板改（例如加 # ! 标记）；模板在末尾多出的列追加到表尾
 * @description - 本聊天没有的表：按模板新建，排在最后，已有表的序号不变
 * @description - 列对不上的表只同步提示词，表头不动，并写进报告
 */

const RULE_KEYS = ['note', 'initNode', 'insertNode', 'updateNode', 'deleteNode'];

const headerValues = (sheet) => (sheet.getCellsByRowIndex(0) || []).slice(1).map(cell => String(cell?.data?.value ?? ''));

/**
 * @param {Object[]} chatSheets 本聊天的表格实例（全部，不只启用的）
 * @param {Object[]} templates 全局模板数据（BASE.templates）
 * @param {boolean} dryRun 只出报告不改
 * @returns {{ updated: string[], added: string[], columnsAdded: string[], skippedHeaders: string[] }}
 */
export function syncChatSheetsWithTemplates(chatSheets, templates, dryRun = false) {
    const report = { updated: [], added: [], columnsAdded: [], skippedHeaders: [] };
    for (const templateData of templates) {
        if (templateData.enable === false) continue;
        const template = new BASE.SheetTemplate(templateData.uid);
        const sheet = chatSheets.find(s => s.name === template.name);
        if (!sheet) {
            report.added.push(template.name);
            if (!dryRun) chatSheets.push(BASE.createChatSheetByTemp(templateData));
            continue;
        }
        let changed = false;
        for (const key of RULE_KEYS) {
            if ((template.data[key] ?? '') !== (sheet.data[key] ?? '')) {
                changed = true;
                if (!dryRun) sheet.data[key] = template.data[key];
            }
        }
        const want = headerValues(template);
        const have = headerValues(sheet);
        const sameBase = have.every((h, i) => i < want.length && stripColumnMark(h) === stripColumnMark(want[i]));
        if (!sameBase) {
            report.skippedHeaders.push(`${sheet.name}（本聊天 ${have.length} 列，模板 ${want.length} 列，列名对不上）`);
        } else {
            have.forEach((h, i) => {
                if (h !== want[i]) {
                    changed = true;
                    if (!dryRun) sheet.findCellByPosition(0, i + 1).data.value = want[i];
                }
            });
            for (let i = have.length; i < want.length; i++) {
                report.columnsAdded.push(`${sheet.name}：${want[i]}`);
                if (dryRun) continue;
                const last = sheet.findCellByPosition(0, i);   // 当前最后一列的表头（第 0 列是行号）
                last.newAction(Cell.CellAction.insertRightColumn, {}, false);
                sheet.findCellByPosition(0, i + 1).data.value = want[i];
            }
        }
        if (changed) report.updated.push(sheet.name);
    }
    return report;
}
