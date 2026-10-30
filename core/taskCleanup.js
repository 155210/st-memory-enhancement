import { BASE, USER } from './manager.js';
import { loadSheetsFilled } from './sheetRepair.js';
import { Cell } from './table/cell.js';
import { getHeaders, stripColumnMark } from './rowIdentity.js';

/**
 * @description 任务表自动清理：AI 常常不删已完成的任务，表越堆越长
 * @description 每轮填完表后，名字带「任务」的表里，「状态」或「持续时间」列写着完成/取消的行由程序删掉，只留最近几条
 * @description 只改最新一层的快照，回退到老楼层时看到的还是原样
 */

const DONE_RE = /^(已经?|已被)?(完成|取消|结束|作废|失效|达成|放弃)(了)?($|[：:，,。；;（(\s-])/;

export function isDoneStatus(value) {
    return DONE_RE.test(String(value ?? '').trim());
}

/** 找任务表和状态列；没有返回 null */
function findTaskColumn(sheet) {
    if (!/任务/.test(sheet.name || '')) return -1;
    const headers = getHeaders(sheet).map(stripColumnMark);
    const exact = headers.findIndex(h => h === '状态');
    return exact !== -1 ? exact : headers.findIndex(h => /状态|持续时间/.test(h));
}

/**
 * 清掉已完成的任务，最近的 keep 条留着
 * @returns {number} 删了几行
 */
export function cleanFinishedTasks(piece, keep = Number(USER.tableBaseSetting.v2_task_keep_done ?? 3)) {
    if (USER.tableBaseSetting.v2_task_cleanup === false || !piece) return 0;
    const source = BASE.getPieceHash(piece) ? piece : BASE.getLastSheetsPiece()?.piece;
    if (!source) return 0;
    const sheets = loadSheetsFilled(source);
    let removed = 0;
    for (const sheet of sheets) {
        const col = findTaskColumn(sheet);
        if (col === -1) continue;
        const done = [];
        for (let r = 1; r < sheet.getRowCount(); r++) {
            const cell = sheet.getCellsByRowIndex(r)?.[col + 1];
            if (isDoneStatus(cell?.data?.value)) done.push(r);
        }
        const drop = done.slice(0, Math.max(0, done.length - Math.max(0, keep)));
        if (!drop.length) continue;
        drop.reverse().forEach(r => sheet.findCellByPosition(r, 0)?.newAction(Cell.CellAction.deleteSelfRow, {}, false));
        removed += drop.length;
    }
    if (removed) sheets.forEach(sheet => sheet.save(piece, true));
    return removed;
}
