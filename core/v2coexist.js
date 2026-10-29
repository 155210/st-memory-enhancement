import { V2, ORIGINAL, EXTENSION_FOLDER } from './v2keys.js';
import { APP, DERIVED, EDITOR, USER } from './manager.js';
import { extensionNames } from '/scripts/extensions.js';

/**
 * @description v2 与原版共存：检测原版是否启用、首次运行复制原版设置、把原版的聊天表格导入 v2
 * @description 这里对原版数据只读不写
 */

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * 原版插件是否也启用着（同名文件夹 st-memory-enhancement，且不在禁用列表里）
 * @returns {string|null} 启用着的原版扩展名，没有则为 null
 */
export function findActiveOriginal() {
    const disabled = APP.extension_settings?.disabledExtensions ?? [];
    const found = (extensionNames ?? []).find(name =>
        name !== EXTENSION_FOLDER
        && name.split('/').pop() === ORIGINAL.folderName
        && !disabled.includes(name));
    return found ?? null;
}

/**
 * 首次运行时把原版的设置、模板、API 配置复制到 v2 自己的键下，只复制一次
 */
export function importOriginalSettingsOnce() {
    const settings = USER.getSettings();
    if (settings[V2.settingsImported]) return;
    const pairs = [
        [ORIGINAL.settings, V2.settings],
        [ORIGINAL.templates, V2.templates],
        [ORIGINAL.selectedSheets, V2.selectedSheets],
        [ORIGINAL.privacy, V2.privacy],
        [ORIGINAL.messageTemplate, V2.messageTemplate],
    ];
    const copied = [];
    for (const [from, to] of pairs) {
        // 更老的原版把设置放在 extension_settings 下，也一并找
        const source = settings[from] ?? USER.getExtensionSettings()?.[from];
        if (source !== undefined && settings[to] === undefined) {
            settings[to] = clone(source);
            copied.push(from);
        }
    }
    settings[V2.settingsImported] = { at: new Date().toISOString(), copied };
    USER.saveSettings();
    console.log('[记忆增强 v2] 已从原版复制设置：', copied);
}

/** 原版快照里是否有真实数据（不只是表头） */
function hasRealRows(hashSheets) {
    return !!hashSheets && Object.values(hashSheets).some(rows => Array.isArray(rows) && rows.length > 1);
}

/** 找到原版最新一层有快照的楼层 */
function findLatestOriginalFloor(chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user) continue;
        if (chat[i]?.[ORIGINAL.pieceHash]) return i;
    }
    return -1;
}

/** 当前聊天的 v2 是否已经有自己的数据 */
function hasV2Data(chat) {
    return chat.some(piece => hasRealRows(piece?.[V2.pieceHash]));
}

/**
 * 把原版当前聊天的表格导入 v2：复制表格数据，记下导入时的楼层；
 * 导入那一层及更早的楼层，v2 只读回退到原版快照，所以不用复制 2000 层快照
 * @returns {boolean} 是否导入成功
 */
export function importChatFromOriginal() {
    const context = USER.getContext();
    const meta = context.chatMetadata;
    const chat = context.chat ?? [];
    const originalSheets = meta?.[ORIGINAL.chatSheets];
    const floor = findLatestOriginalFloor(chat);
    if (!Array.isArray(originalSheets) || originalSheets.length === 0 || floor === -1) {
        EDITOR.warning('这个聊天里没有原版的表格数据，无需导入');
        return false;
    }
    meta[V2.chatSheets] = clone(originalSheets);
    if (meta[ORIGINAL.chatSelectedSheets]) meta[V2.chatSelectedSheets] = clone(meta[ORIGINAL.chatSelectedSheets]);
    meta[V2.chatImport] = { floor, at: new Date().toISOString() };
    // 导入前 v2 自己写过的快照作废，统一以原版为准
    chat.forEach(piece => { if (piece && piece[V2.pieceHash]) delete piece[V2.pieceHash]; });
    // 让表格实例按新数据重建
    DERIVED.any.chatSheetMap = {};
    USER.saveChat();
    console.log('[记忆增强 v2] 已从原版导入表格，导入楼层：', floor);
    return true;
}

/**
 * 切换聊天时，如果这个聊天只有原版数据、v2 还没有数据，就问一次要不要导入
 * @returns {Promise<boolean>} 是否进行了导入
 */
export async function offerChatImport() {
    const context = USER.getContext();
    const meta = context.chatMetadata;
    const chat = context.chat ?? [];
    if (!meta || meta[V2.chatImport] || meta[V2.chatImport + '_declined']) return false;
    const floor = findLatestOriginalFloor(chat);
    if (floor === -1 || !hasRealRows(chat[floor][ORIGINAL.pieceHash]) || hasV2Data(chat)) return false;
    const ok = await EDITOR.callGenericPopup(
        `这个聊天里有原版记忆表格的数据（最新在第 ${floor} 层）。<br>要导入到 v2 吗？<br><br>导入只是复制一份，原版的数据一个字都不会改，切回原版还是原来的表格。`,
        EDITOR.POPUP_TYPE.CONFIRM, '导入原版表格', { okButton: '导入', cancelButton: '不导入' });
    if (!ok) {
        meta[V2.chatImport + '_declined'] = true;
        USER.saveChat();
        return false;
    }
    return importChatFromOriginal();
}
