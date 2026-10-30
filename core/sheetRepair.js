import { BASE, USER } from './manager.js';

/**
 * @description 表格快照补全：某层的快照里缺了某张表（以前改表时只存了发给 AI 的那几张，归档表和停用的表被漏掉），
 * @description 就从更早、还有这张表的楼层拿过来。只补缺的，不改已有的，也不动老楼层
 */

/**
 * @param {Object} hash 某层的快照 { uid: hashSheet }
 * @param {Object} piece 这层消息（从它往前找）；不传就从最新一层往前找
 * @returns {Object} 补全后的快照（新对象；不缺就原样返回）
 */
export function fillMissingSheets(hash, piece) {
    if (!hash) return hash;
    const missing = new Set((BASE.sheetsData.context || []).map(s => s.uid).filter(uid => uid && !hash[uid]));
    if (!missing.size) return hash;
    const chat = USER.getContext().chat || [];
    let start = piece ? chat.indexOf(piece) : chat.length;
    if (start === -1) start = chat.length;
    const out = { ...hash };
    for (let i = start - 1; i >= 0 && missing.size; i--) {
        const h = BASE.getPieceHash(chat[i]);
        if (!h) continue;
        for (const uid of [...missing]) {
            if (h[uid]) { out[uid] = h[uid]; missing.delete(uid); }
        }
    }
    return out;
}

/** 读某层的全部表格（缺的表从更早的楼层补） */
export function loadSheetsFilled(piece) {
    return BASE.hashSheetsToSheets(fillMissingSheets(BASE.getPieceHash(piece), piece));
}

const rowText = (sheet, r) => (sheet.getCellsByRowIndex(r) || []).slice(1).map(c => String(c?.data?.value ?? '')).join('\u0001');

/**
 * 找回丢失的归档：在所有楼层里找行数最多的那份归档，把最新表格里没有的行补回去（放在前面，保持先后顺序）
 * 只增加不删除，写进最新有表格的那一层，老楼层不变
 * @returns {{ restored: number, from: number }} 补回几行、从第几层找到的
 */
export function repairArchive(archiveName) {
    const chat = USER.getContext().chat || [];
    const meta = (BASE.sheetsData.context || []).find(s => s.name === archiveName);
    const { piece: latest } = BASE.getLastSheetsPiece() || {};
    if (!meta || !latest) return { restored: 0, from: -1 };
    const uid = meta.uid;
    let best = -1, bestLen = 0;
    chat.forEach((p, i) => {
        const len = BASE.getPieceHash(p)?.[uid]?.length || 0;
        if (len > bestLen) { best = i; bestLen = len; }
    });
    if (best === -1 || bestLen <= 1) return { restored: 0, from: -1 };
    // 先读出旧的那份：hashSheetsToSheets 共用表格实例，读完再读最新的
    const old = BASE.hashSheetsToSheets(BASE.getPieceHash(chat[best])).find(s => s.uid === uid);
    const oldRows = [];
    for (let r = 1; r < old.getRowCount(); r++) oldRows.push({ text: rowText(old, r), hash: old.hashSheet[r].map(h => h) });
    const sheets = loadSheetsFilled(latest);
    const archive = sheets.find(s => s.uid === uid);
    const have = new Set();
    for (let r = 1; r < archive.getRowCount(); r++) have.add(rowText(archive, r));
    const lost = oldRows.filter(row => !have.has(row.text));
    if (!lost.length) return { restored: 0, from: best };
    archive.hashSheet = [archive.hashSheet[0], ...lost.map(row => row.hash), ...archive.hashSheet.slice(1)];
    archive.markPositionCacheDirty?.();
    sheets.forEach(sheet => sheet.save(latest, true));
    return { restored: lost.length, from: best };
}

/** 存完表格后：这层快照里还缺的表从更早的楼层补上 */
export function completePieceHash(piece, key) {
    if (!piece?.[key]) return;
    piece[key] = fillMissingSheets(piece[key], piece);
}
