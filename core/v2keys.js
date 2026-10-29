/**
 * @description v2 与原版插件共存用的存储键
 * @description v2 的设置、模板、聊天表格数据、每层快照都存在带 _v2 的键下，绝不写原版的键；
 * @description 原版的键只在「从原版导入」和「回退到导入前的楼层」时读取。
 */
export const V2 = {
    // power_user 下的设置
    settings: 'muyoo_dataTable_v2',
    templates: 'table_database_templates_v2',
    selectedSheets: 'table_selected_sheets_v2',
    privacy: 'IMPORTANT_USER_PRIVACY_DATA_v2',
    messageTemplate: 'message_template_v2',
    settingsImported: 'memory_enhancement_v2_settings_imported',
    // chatMetadata 下的聊天数据
    chatSheets: 'sheets_v2',
    chatSelectedSheets: 'selected_sheets_v2',
    chatImport: 'memory_enhancement_v2_import',
    // 每条消息上的数据
    pieceHash: 'hash_sheets_v2',
    twoStepLinks: 'two_step_links_v2',
    twoStepWaiting: 'two_step_waiting_v2',
    tableEditMatches: 'tableEditMatches_v2',
};

/** 原版插件使用的键，只读 */
export const ORIGINAL = {
    settings: 'muyoo_dataTable',
    templates: 'table_database_templates',
    selectedSheets: 'table_selected_sheets',
    privacy: 'IMPORTANT_USER_PRIVACY_DATA',
    messageTemplate: 'message_template',
    chatSheets: 'sheets',
    chatSelectedSheets: 'selected_sheets',
    pieceHash: 'hash_sheets',
    folderName: 'st-memory-enhancement',
};

/** 本插件所在的扩展目录，例如 third-party/st-memory-enhancement-v2，按实际安装的文件夹名计算 */
export const EXTENSION_FOLDER = (() => {
    try {
        const path = decodeURIComponent(new URL(import.meta.url).pathname);
        const match = path.match(/\/scripts\/extensions\/(.+)\/core\/v2keys\.js$/);
        if (match) return match[1];
    } catch (_) { }
    return 'third-party/st-memory-enhancement-v2';
})();
