import { BASE, DERIVED, EDITOR, USER } from './manager.js';
import { V2 } from './v2keys.js';

/**
 * @description O11 问题导出和诊断：一键导出版本、设置、表格概况、最近的报错和请求，方便排查
 * @description 不导出 API 地址、密钥、代理这类隐私设置；聊天正文只带最近一次注入给 AI 的表格提示词
 */

const MAX_ERRORS = 30;

/** 记下插件报出的错误（只装一次） */
export function installErrorCapture() {
    if (EDITOR.__v2ErrorCapture) return;
    const original = EDITOR.error;
    EDITOR.error = function (message, detail, error) {
        const log = DERIVED.any.errorLog || (DERIVED.any.errorLog = []);
        log.push({ at: new Date().toISOString(), message: String(message ?? ''), detail: String(detail ?? ''), stack: error?.stack ? String(error.stack).split('\n').slice(0, 6).join('\n') : '' });
        if (log.length > MAX_ERRORS) log.splice(0, log.length - MAX_ERRORS);
        return original.apply(this, arguments);
    };
    EDITOR.__v2ErrorCapture = true;
}

const SECRET_KEY = /api_?key|apikey|token|password|secret|proxy|custom_api_url/i;

function safeSettings() {
    const out = {};
    const settings = USER.tableBaseSetting;
    for (const key of Object.keys(settings || {})) {
        if (SECRET_KEY.test(key)) continue;
        const value = settings[key];
        out[key] = typeof value === 'string' && value.length > 2000 ? `${value.slice(0, 2000)}…（共 ${value.length} 字）` : value;
    }
    return out;
}

function sheetOverview() {
    const { piece, deep } = BASE.getLastSheetsPiece();
    if (!piece) return { floor: -1, sheets: [] };
    const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(piece));
    return {
        floor: deep,
        sheets: sheets.map(sheet => ({
            name: sheet.name, enable: sheet.enable, rows: sheet.getRowCount() - 1,
            headers: (sheet.getCellsByRowIndex(0) || []).slice(1).map(c => c?.data?.value ?? ''),
        })),
    };
}

/** 生成诊断数据 */
export function buildDiagnostics(version) {
    const context = USER.getContext();
    const chat = context.chat || [];
    const meta = context.chatMetadata || {};
    return {
        exportedAt: new Date().toISOString(),
        version,
        userAgent: globalThis.navigator?.userAgent ?? '',
        chat: {
            length: chat.length,
            v2Snapshots: chat.filter(m => m?.[V2.pieceHash]).length,
            originalSnapshots: chat.filter(m => m?.hash_sheets).length,
            importRecord: meta[V2.chatImport] ?? null,
            summaryState: meta[V2.summaryState] ? { summaryFloors: meta[V2.summaryState].summaryFloors, cached: Object.keys(meta[V2.summaryState].cache || {}).length } : null,
        },
        tables: sheetOverview(),
        templates: (BASE.templates || []).map(t => ({ name: t.name, enable: t.enable })),
        settings: safeSettings(),
        lastInjection: DERIVED.any.lastInjection ?? null,
        lastExtraRequest: DERIVED.any.lastExtraRequest ?? null,
        summaryLog: DERIVED.any.summaryLog ?? [],
        rowIdentityLog: DERIVED.any.rowIdentityLog ?? [],
        errors: DERIVED.any.errorLog ?? [],
    };
}

/** 下载诊断文件 */
export function downloadDiagnostics(version) {
    const data = buildDiagnostics(version);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `记忆表格v2-诊断-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return data;
}
