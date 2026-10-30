import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import { Cell } from '../../core/table/cell.js';
import {estimateTokenCount} from "../settings/standaloneAPI.js";
import { V2, ORIGINAL } from '../../core/v2keys.js';

const statistics = `
<style>
.table-statistics-content {
    padding: 10px;
}
.stat-item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 5px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.stat-label {
    font-weight: 500;
}
.stat-value {
    font-weight: 600;
}
</style>
<div class="table-statistics">
    <div id="dialogue_popup_text">
        <h3>表格数据统计</h3>
        <div class="table-statistics-header">
            <div class="menu_button_icon menu_button interactable gap5" id="clear_table_statistics_button" tabindex="0">
                <i class="fa-solid fa-broom"></i>
                <span>清理不在对话树的历史单元</a>
            </div>
        </div>
        <div class="table-statistics-content">
            <!-- 动态内容将在这里插入 -->
        </div>
    </div>
</div>
`

async function updataTableStatisticsData(container) {
    const { piece, deep } = BASE.getLastSheetsPiece();
    const sheetsData = BASE.sheetsData.context;
    if (!piece || !BASE.getPieceHash(piece)) return;
    const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(piece));
    const cellHistories = sheetsData.map(sheet => sheet.cellHistory);
    const sheetDataPrompt = sheets.map((sheet, index) => sheet.getTableText(index)).join('\n')
    const sheetsValueCount = estimateTokenCount(sheetDataPrompt);
    const lastChangeFloor = `${deep}/${USER.getContext().chat.length - 1}`;

    // 定义要显示的统计数据
    const statsData = [
        { label: '已开启表格数量', value: sheets.length },
        { label: '历史总单元格数量', value: cellHistories.reduce((acc, cellHistory) => acc + cellHistory.length, 0) },
        { label: '历史数据总大小', value: `${(JSON.stringify(sheetsData).length / 1024).toFixed(2)} KB` },
        { label: '当前表格模糊计算的Token数', value: Math.round(sheetsValueCount * 0.6) },
        { label: '当前表格最后一次修改位置', value: lastChangeFloor },
        ...storageSizeStats(sheets),
    ];

    // 获取内容容器
    const contentContainer = $(container).find('.table-statistics-content');
    contentContainer.empty(); // 清空现有内容

    // 动态创建统计项
    statsData.forEach(stat => {
        const statItem = $('<div class="stat-item"></div>');
        const statLabel = $(`<div class="stat-label">${stat.label}</div>`);
        const statValue = $(`<div class="stat-value">${stat.value}</div>`);

        statItem.append(statLabel);
        statItem.append(statValue);
        contentContainer.append(statItem);
    });
}

async function clearTableStatisticsButton(statisticsContainer) {
    const chat = USER.getContext().chat;
    if (!chat || chat.length === 0) return;

    const messageHashSheets = JSON.parse(JSON.stringify(USER.getContext().chat
        .filter(message => BASE.getPieceHash(message))
        .map(message => BASE.getPieceHash(message))));
    let hashList = []
    messageHashSheets.forEach(hashSheets => {
        Object.entries(hashSheets).forEach(([sheetId, sheet]) => {
            hashList = [...hashList, ...sheet.map(row => row.flat()).flat()]
        })
    });
    const filterDuplicateMap = new Set(hashList);

    const sheetsData = BASE.sheetsData.context;
    const cellHistories = sheetsData.map(sheet => sheet.cellHistory);
    let cellHistoryHashNum = 0;
    let lastCellHistoryHashNum = 0;
    cellHistories.forEach((cellHistory, index) => {
        cellHistory.forEach((cell, cellIndex) => {
            lastCellHistoryHashNum++
            if (cell && cell.uid && filterDuplicateMap.has(cell.uid)) {
                cellHistoryHashNum++;
                delete cell.bridge;
            } else {
                cellHistories[index].splice(cellIndex, 1);
            }
        })
    })

    setTimeout(() => {
        if (lastCellHistoryHashNum === cellHistoryHashNum) {
            updataTableStatisticsData(statisticsContainer);
            EDITOR.success(`清理历史单元格操作完成, 有效单元格数量: ${cellHistoryHashNum}`);
            USER.saveChat()
            return;
        } else {
            EDITOR.info(`本轮清理单元格数量: ${lastCellHistoryHashNum - cellHistoryHashNum}`);
            clearTableStatisticsButton(statisticsContainer)
        }
    }, 0)
}

/**
 * 打开表格编辑历史记录弹窗
 * */
export async function openTableStatisticsPopup(){
    const manager = statistics;
    const tableStatisticsPopup = new EDITOR.Popup(manager, EDITOR.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
    const statisticsContainer = $(tableStatisticsPopup.dlg)[0];
    // 绑定清理按钮事件
    const clearButton = $(statisticsContainer).find('#clear_table_statistics_button');
    clearButton.on('click', () => {
        clearTableStatisticsButton(statisticsContainer)
    });

    updataTableStatisticsData(statisticsContainer);

    await tableStatisticsPopup.show();
}

/** 把字符数换算成好读的大小（按 UTF-8 粗算：中文约 3 字节） */
function formatSize(text) {
    const bytes = new Blob([text]).size;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 占用大小：整个聊天文件、v2 和原版各自的每层快照、各表的行数和字数 */
function storageSizeStats(sheets) {
    const context = USER.getContext();
    const chat = context.chat || [];
    const sizeOfKey = (key) => {
        let floors = 0;
        const text = chat.map(piece => {
            if (!piece?.[key]) return '';
            floors++;
            return JSON.stringify(piece[key]);
        }).join('');
        return { floors, text };
    };
    const v2Snap = sizeOfKey(V2.pieceHash);
    const originalSnap = sizeOfKey(ORIGINAL.pieceHash);
    const stats = [
        { label: '聊天文件总大小（约）', value: formatSize(JSON.stringify(chat) + JSON.stringify(context.chatMetadata || {})) },
        { label: '其中 v2 每层快照', value: `${formatSize(v2Snap.text)}（${v2Snap.floors} 层）` },
        { label: '其中原版每层快照', value: `${formatSize(originalSnap.text)}（${originalSnap.floors} 层）` },
        { label: '其中 v2 表格历史数据', value: formatSize(JSON.stringify(context.chatMetadata?.[V2.chatSheets] || [])) },
        { label: '其中原版表格历史数据', value: formatSize(JSON.stringify(context.chatMetadata?.[ORIGINAL.chatSheets] || [])) },
    ];
    stats.push(...chatPartsStats(chat, context.chatMetadata || {}));
    for (const sheet of sheets) {
        const rows = sheet.getRowCount() - 1;
        let chars = 0;
        for (let r = 1; r <= rows; r++) sheet.getCellsByRowIndex(r).slice(1).forEach(cell => { chars += String(cell?.data?.value ?? '').length; });
        stats.push({ label: `「${sheet.name}」`, value: `${rows} 行，${chars} 字` });
    }
    return stats;
}

/** 字符串的 UTF-8 字节数（不用 Blob，几千层也快） */
function byteLength(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }
        else bytes += 3;
    }
    return bytes;
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * 表格以外的聊天内容各占多少：正文、重 roll 版本、思考、其他字段（多半是别的插件存的），只统计不改
 * @returns {{ label: string, value: string }[]}
 */
export function chatPartsStats(chat, chatMetadata = {}) {
    const tableKeys = new Set([V2.pieceHash, ORIGINAL.pieceHash]);
    const size = (value) => value === undefined ? 0 : byteLength(typeof value === 'string' ? value : JSON.stringify(value));
    let text = 0, swipes = 0, reasoning = 0, swipeFloors = 0, swipeCount = 0;
    const others = new Map();
    const addOther = (key, bytes) => { if (bytes) others.set(key, (others.get(key) || 0) + bytes); };
    for (const piece of chat) {
        if (!piece || typeof piece !== 'object') continue;
        for (const [key, value] of Object.entries(piece)) {
            if (tableKeys.has(key)) continue;
            if (key === 'mes') text += size(value);
            else if (key === 'swipes' || key === 'swipe_info') {
                // swipes 里也存着当前这一版正文：这份算进正文（酒馆必须存，删不得），剩下的才是重 roll 多出来的
                const copy = key === 'swipes' ? size(piece.mes) : 0;
                text += copy;
                swipes += size(value) - copy;
                if (key === 'swipes' && Array.isArray(value) && value.length > 1) { swipeFloors++; swipeCount += value.length - 1; }
            } else if (key === 'extra' && value && typeof value === 'object') {
                for (const [extraKey, extraValue] of Object.entries(value)) {
                    if (extraKey === 'reasoning') reasoning += size(extraValue);
                    else addOther(`extra.${extraKey}`, size(extraValue));
                }
            } else addOther(key, size(value));
        }
    }
    const tableMetaKeys = new Set([V2.chatSheets, ORIGINAL.chatSheets]);
    let meta = 0;
    for (const [key, value] of Object.entries(chatMetadata)) if (!tableMetaKeys.has(key)) meta += size(value);
    const stats = [
        { label: '其中正文（含酒馆在 swipes 里存的那一份）', value: formatBytes(text) },
        { label: '其中重 roll 的其他版本', value: `${formatBytes(Math.max(0, swipes))}（${swipeFloors} 层有，共 ${swipeCount} 个）` },
        { label: '其中思考内容', value: formatBytes(reasoning) },
        { label: '其中聊天元数据（不含表格）', value: formatBytes(meta) },
    ];
    [...others.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        .forEach(([key, bytes]) => stats.push({ label: `其中其他字段 ${key}`, value: formatBytes(bytes) }));
    return stats;
}
