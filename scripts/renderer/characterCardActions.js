/**
 * @description 角色资料卡的动作：往输入框插字、查世界书、AI 精简长字段、存图、导入导出文件、复制、跳到原表 / 某一楼
 * @description 这里的东西只给用户看或只改输入框；唯一会发请求的是手动点的「精简」，唯一会改表的也是它（确认后才写）
 */
import { BASE, EDITOR, USER } from '../../core/manager.js';
import { Cell } from '../../core/table/cell.js';
import { askExtra } from '../../core/extraRequest.js';

/** HTML 转义 */
function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 往酒馆输入框末尾追加一段话（不发送）
 * @param {string} text
 */
export function insertToInput(text) {
    const box = document.querySelector('#send_textarea');
    if (!box) return EDITOR.warning('没找到输入框');
    const current = String(box.value ?? '');
    box.value = current.trim() ? `${current.replace(/\s+$/, '')}\n${text}` : String(text ?? '');
    try { box.focus(); } catch (_) { }
    try { box.setSelectionRange?.(box.value.length, box.value.length); } catch (_) { }
    box.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 世界书条目是否提到这些名字（看关键词和备注） */
function entryMatches(entry, names) {
    const keys = [...(entry.key || []), ...(entry.keysecondary || []), entry.comment || ''].map(k => String(k || '')).filter(Boolean);
    return names.some(name => name && keys.some(k => k.includes(name)));
}

/** 当前聊天会用到的世界书名字：全局、角色卡（含附加）、聊天、人设 */
function activeWorldNames(WI) {
    const ctx = USER.getContext() || {};
    const names = new Set();
    try { (WI.selected_world_info || []).forEach(n => names.add(n)); } catch (_) { }
    try {
        const meta = ctx.chatMetadata || {};
        if (meta.world_info) names.add(meta.world_info);
    } catch (_) { }
    try {
        const character = ctx.characters?.[ctx.characterId];
        const world = character?.data?.extensions?.world;
        if (world) names.add(world);
        const file = character?.avatar && String(character.avatar).replace(/\.[^/.]+$/, '');
        const extra = (WI.world_info?.charLore || []).find(x => x.name === file);
        (extra?.extraBooks || []).forEach(n => names.add(n));
    } catch (_) { }
    try {
        const persona = ctx.powerUserSettings?.persona_description_lorebook;
        if (persona) names.add(persona);
    } catch (_) { }
    return [...names].filter(Boolean);
}

/**
 * 找世界书里提到这个人的条目（关键词或备注含主名 / 外号）
 * @param {string[]} names 主名和外号
 * @returns {Promise<{ title: string, content: string, book: string }[]>} 出错时返回空数组
 */
export async function lookupWorldInfo(names) {
    try {
        const list = (names || []).map(n => String(n || '').trim()).filter(n => n.length >= 1);
        if (!list.length) return [];
        const WI = await import('/scripts/world-info.js');
        const ctx = USER.getContext() || {};
        let entries = [];
        if (typeof WI.getSortedEntries === 'function') {
            try { entries = (await WI.getSortedEntries()) || []; } catch (_) { entries = []; }
        }
        if (!entries.length) {
            const load = WI.loadWorldInfo || ctx.loadWorldInfo;
            if (typeof load !== 'function') return [];
            for (const book of activeWorldNames(WI)) {
                try {
                    const data = await load(book);
                    Object.values(data?.entries || {}).forEach(entry => entries.push({ ...entry, world: book }));
                } catch (_) { }
            }
        }
        const seen = new Set();
        const result = [];
        for (const entry of entries) {
            if (!entry || entry.disable || !entryMatches(entry, list)) continue;
            const id = `${entry.world}:${entry.uid}`;
            if (seen.has(id)) continue;
            seen.add(id);
            result.push({
                title: String(entry.comment || (entry.key || []).join('、') || `条目 ${entry.uid}`),
                content: String(entry.content || ''),
                book: String(entry.world || ''),
            });
        }
        return result;
    } catch (error) {
        console.warn('[记忆增强 v2] 角色资料卡：读世界书失败', error);
        return [];
    }
}

const CONDENSE_SYSTEM = `你是角色资料整理助手。用户给你一个角色的一格表格内容，这一格是一条条往后追加的记录，越写越长。
请把它精简：
1. 保留关键事实（人名、地点、时间、数字、关系变化、重要承诺和后果），删掉重复、修饰和已经被后面推翻的内容；
2. 按时间先后排列，一条一行，每行简短；
3. 总长度不超过原文的四成；
4. 不要编造原文没有的内容，不要加评论；
5. 只输出精简后的内容，不要标题、序号说明、代码块或其它话。`;

/** 去掉 AI 回复外面的代码块、思考标签和空行 */
function cleanReply(text) {
    return String(text || '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/^\s*```[a-z]*\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .split('\n').map(line => line.trim()).filter(Boolean).join('\n')
        .trim();
}

/**
 * 用 AI 精简一格长字段（# 追加列），弹窗对比新旧，确认后写回表格并保存
 * @param {{ primary: string, sheetUid: string, rowIndex: number, col: number, label: string, value: string }} item rowIndex 是数据行号（不含表头），col 是数据列号（不含行号列）
 * @returns {Promise<boolean>} 是否写入
 */
export async function condenseField({ primary, sheetUid, rowIndex, col, label, value }) {
    try {
        const { piece: tablePiece } = BASE.getLastSheetsPiece();
        const { piece: currentPiece } = USER.getChatPiece();
        if (!currentPiece) { EDITOR.error('没有可以保存表格的 AI 消息，请先聊一轮'); return false; }
        const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(tablePiece));
        const sheet = sheets.find(s => s.uid === sheetUid);
        const cell = sheet?.findCellByPosition(Number(rowIndex) + 1, Number(col) + 1);
        if (!cell) { EDITOR.error('没找到这一格，表格可能已经变了'); return false; }
        const original = String(cell.data.value ?? value ?? '');
        if (original.trim().length < 20) { EDITOR.info('这一格内容不长，不用精简'); return false; }

        const ok = await EDITOR.callGenericPopup(`用 AI 精简「${esc(primary)}」的「${esc(label)}」？<br><br>会另发一次请求（${original.length} 字），精简结果先给你看，确认后才写回表格。`, EDITOR.POPUP_TYPE.CONFIRM, 'AI 精简', { okButton: '开始', cancelButton: '取消' });
        if (!ok) return false;

        const reply = cleanReply(await askExtra(CONDENSE_SYSTEM, `角色：${primary}\n字段：${label}\n\n原文：\n${original}`, `精简 ${primary} · ${label}`));
        if (!reply) { EDITOR.error('AI 没有返回内容'); return false; }

        const $form = $(`<div class="v2cc-condense">
            <div style="margin-bottom:6px">「${esc(primary)}」·「${esc(label)}」：原文 ${original.length} 字 → 精简后 ${reply.length} 字（可以直接改右边/下边的内容）</div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; text-align:left">
                <div style="flex:1 1 260px; min-width:0">
                    <b>原文</b>
                    <pre style="white-space:pre-wrap; word-break:break-all; max-height:50vh; overflow:auto; margin:4px 0; padding:6px; border:1px solid var(--SmartThemeBorderColor); border-radius:6px">${esc(original)}</pre>
                </div>
                <div style="flex:1 1 260px; min-width:0">
                    <b>精简后</b>
                    <textarea class="text_pole v2cc-condense-new" rows="12" style="width:100%; max-height:50vh; margin:4px 0"></textarea>
                </div>
            </div>
        </div>`);
        $form.find('.v2cc-condense-new').val(reply);
        const confirmed = await EDITOR.callGenericPopup($form, EDITOR.POPUP_TYPE.CONFIRM, 'AI 精简', { okButton: '写回表格', cancelButton: '不要', wide: true, large: true, allowVerticalScrolling: true });
        if (!confirmed) return false;
        const next = String($form.find('.v2cc-condense-new').val() ?? reply).trim();
        if (!next || next === original) return false;

        // 直接改这一格（绕开 # 列只能追加的规则）；用 editCell 生成新格子，回退到老楼层时还是原样
        cell.newAction(Cell.CellAction.editCell, { value: next }, false);
        sheets.forEach(s => s.save(currentPiece, true));
        await USER.saveChat();
        try {
            const { updateSheetsView } = await import('../../index.js');
            await updateSheetsView();
        } catch (_) { }
        EDITOR.success(`已精简：${original.length} 字 → ${next.length} 字`);
        return true;
    } catch (error) {
        if (String(error?.message || '').includes('手动停止')) return false;
        EDITOR.error('AI 精简失败', error?.message || String(error), error);
        return false;
    }
}

/** 把计算后的样式写进克隆节点的 style（存图用） */
function inlineStyles(source, target) {
    if (!(source instanceof Element) || !(target instanceof Element)) return;
    const computed = getComputedStyle(source);
    let css = '';
    for (let i = 0; i < computed.length; i++) {
        const prop = computed[i];
        css += `${prop}:${computed.getPropertyValue(prop)};`;
    }
    target.setAttribute('style', css);
    if (source instanceof HTMLTextAreaElement || source instanceof HTMLInputElement) {
        if (source.type !== 'file') target.setAttribute('value', source.value);
        if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
    }
    const sourceChildren = source.children;
    const targetChildren = target.children;
    for (let i = 0; i < sourceChildren.length; i++) inlineStyles(sourceChildren[i], targetChildren[i]);
}

/** 触发下载 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 把卡片存成 PNG 下载（克隆节点、内联样式、SVG foreignObject 画到 canvas）
 * @param {Element} element 卡片根节点
 * @param {string} filename
 */
export async function exportCardImage(element, filename = '角色资料卡.png') {
    try {
        const el = element?.jquery ? element[0] : element;
        if (!el) throw new Error('没有卡片');
        const width = Math.ceil(el.scrollWidth || el.getBoundingClientRect().width);
        const height = Math.ceil(el.scrollHeight || el.getBoundingClientRect().height);
        const clone = el.cloneNode(true);
        inlineStyles(el, clone);
        clone.style.maxHeight = 'none';
        clone.style.height = `${height}px`;
        clone.style.width = `${width}px`;
        clone.style.overflow = 'visible';
        clone.style.margin = '0';
        // 背景透明时补一个，避免存出来是透明底
        const bg = getComputedStyle(el).backgroundColor;
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') {
            const bodyBg = getComputedStyle(document.body).backgroundColor;
            clone.style.background = bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' ? bodyBg : '#222';
        }
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        const html = new XMLSerializer().serializeToString(clone);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${html}</foreignObject></svg>`;
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('图片生成失败')); img.src = url; });
        const scale = Math.min(2, window.devicePixelRatio || 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise((resolve, reject) => {
            try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('浏览器不让导出图片')), 'image/png'); } catch (error) { reject(error); }
        });
        downloadBlob(blob, filename);
        EDITOR.success('已存图');
        return true;
    } catch (error) {
        console.warn('[记忆增强 v2] 角色资料卡存图失败', error);
        EDITOR.warning('存图失败，可以用「复制」或者系统截图代替', error?.message || '');
        return false;
    }
}

/**
 * 把对象存成 JSON 文件下载
 * @param {Object} obj
 * @param {string} filename
 */
export function downloadJson(obj, filename = 'data.json') {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
}

/** 弹出选文件框，返回选中的文件（取消时为 null） */
function pickFile(accept) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        let done = false;
        const finish = (file) => { if (done) return; done = true; input.remove(); resolve(file || null); };
        input.addEventListener('change', () => finish(input.files?.[0]));
        input.addEventListener('cancel', () => finish(null));
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * 选一个 JSON 文件并解析
 * @returns {Promise<Object|null>}
 */
export async function pickJsonFile() {
    const file = await pickFile('.json,application/json');
    if (!file) return null;
    try {
        return JSON.parse(await file.text());
    } catch (error) {
        EDITOR.error('文件不是有效的 JSON', error?.message || '', error);
        return null;
    }
}

/**
 * 选一张图片，居中裁成正方形缩到 size×size，返回 JPEG dataURL
 * @param {number} size
 * @returns {Promise<string|null>}
 */
export async function pickImageAsDataUrl(size = 96) {
    const file = await pickFile('image/*');
    if (!file) return null;
    try {
        const src = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('图片读不出来')); img.src = src; });
        const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
        const sx = ((img.naturalWidth || img.width) - side) / 2;
        const sy = ((img.naturalHeight || img.height) - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch (error) {
        EDITOR.error('头像读取失败', error?.message || '', error);
        return null;
    }
}

/**
 * 复制文字到剪贴板
 * @param {string} text
 */
export function copyText(text) {
    const value = String(text ?? '');
    const fallback = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            ok ? EDITOR.success('已复制') : EDITOR.warning('复制失败，浏览器不让写剪贴板');
        } catch (_) {
            EDITOR.warning('复制失败，浏览器不让写剪贴板');
        }
    };
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext !== false) {
            return navigator.clipboard.writeText(value).then(() => EDITOR.success('已复制'), fallback);
        }
    } catch (_) { }
    fallback();
}

/** 按表名找当前表格的 uid */
function sheetUidByName(sheetName) {
    try {
        const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(BASE.getLastSheetsPiece()?.piece));
        return sheets.find(s => s.name === sheetName)?.uid || null;
    } catch (_) {
        return null;
    }
}

/**
 * 打开表格抽屉，翻到这张表（折叠着就展开），尽力而为
 * @param {string} sheetName
 */
export async function jumpToSheet(sheetName) {
    try {
        const uid = sheetUidByName(sheetName);
        if (!$('#table_drawer_content').hasClass('openDrawer')) {
            const { openDrawer } = await import('../../index.js');
            await openDrawer();
        }
        $('#database_button').trigger('click');
        const findTitle = () => {
            if (uid) {
                const byUid = document.querySelector(`[data-table-directory-sheet-title="${CSS?.escape ? CSS.escape(uid) : uid}"]`);
                if (byUid) return byUid;
            }
            return [...document.querySelectorAll('.table-directory-sheet-title')].find(el => {
                const text = el.textContent.replace(/^[▸▾]\s*/, '').replace(/^#\d+\s*/, '').replace(/（\d+ 行，点开）$/, '');
                return text === sheetName;
            }) || null;
        };
        let title = null;
        for (let i = 0; i < 30 && !title; i++) {
            title = findTitle();
            if (!title) await wait(100);
        }
        if (!title) return EDITOR.info(`打开了表格，没找到「${sheetName}」，请手动翻一下`);
        const container = title.nextElementSibling;
        if (container && container.style.display === 'none') title.click();
        title.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.warn('[记忆增强 v2] 跳到原表失败', error);
        EDITOR.info('打不开表格抽屉，请手动打开');
    }
}

/**
 * 滚到第 N 楼（这一楼已经渲染出来时）
 * @param {number} mesIndex
 * @returns {boolean} 是否找到
 */
export function scrollToFloor(mesIndex) {
    const target = document.querySelector(`#chat .mes[mesid="${Number(mesIndex)}"]`);
    if (!target) {
        EDITOR.info(`第 ${mesIndex} 楼没有显示出来，往上加载更多消息后再点`);
        return false;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('v2cc-flash');
    setTimeout(() => target.classList.remove('v2cc-flash'), 1500);
    return true;
}
