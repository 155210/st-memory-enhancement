import { EDITOR, USER } from '../../core/manager.js';
import { SLOT_ID, currentPreset, normalizePreset, parsePreset } from '../../core/extraPreset.js';

/**
 * @description v2 设置里的「额外请求套用酒馆预设」面板：导入、开关每个条目、拖动或上下按钮调顺序、点名字看和改内容
 * @description 预设里有但酒馆列表没放的条目收在下面，不发送，可以「加入末尾」
 */

const ROLE_LABEL = { system: '系统', user: '用户', assistant: 'AI' };
const esc = (text) => String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const positionLabel = (e) => (e.position === 'depth' ? `聊天中 深度${e.depth}` : '相对');

function save(preset) {
    USER.tableBaseSetting.v2_extra_preset = normalizePreset(preset);
    render();
}

function rowHtml(entry, index, total) {
    const slot = entry.id === SLOT_ID;
    return `<li class="v2p-row${slot ? ' is-slot' : ''}${!slot && !entry.enabled ? ' is-off' : ''}" data-id="${esc(entry.id)}">
        <span class="v2p-handle" title="按住拖动排序"><i class="fa-solid fa-grip-lines"></i></span>
        ${slot ? '<span class="v2p-pin" title="v2 的任务和数据放在这里，不能关"><i class="fa-solid fa-thumbtack"></i></span>'
        : `<input type="checkbox" class="v2p-toggle" ${entry.enabled ? 'checked' : ''} title="${entry.enabled ? '关闭此条目' : '启用此条目'}">`}
        <button type="button" class="v2p-open" ${slot ? 'disabled' : ''}>
            <span class="v2p-name">${esc(entry.name)}</span>
            ${slot ? '' : `<span class="v2p-tag">${ROLE_LABEL[entry.role]}</span><span class="v2p-tag${entry.position === 'depth' ? ' is-depth' : ''}">${positionLabel(entry)}</span>`}
        </button>
        <span class="v2p-move">
            <button type="button" class="menu_button v2p-up" ${index === 0 ? 'disabled' : ''} title="上移">↑</button>
            <button type="button" class="menu_button v2p-down" ${index === total - 1 ? 'disabled' : ''} title="下移">↓</button>
        </span>
    </li>`;
}

/** 画面板 */
export function render() {
    const box = document.getElementById('table_v2_preset_panel');
    if (!box) return;
    const preset = currentPreset();
    const imported = preset.entries.filter(e => e.id !== SLOT_ID);
    const enabledCount = imported.filter(e => e.enabled).length;
    const on = USER.tableBaseSetting.v2_extra_preset_enabled === true;
    box.innerHTML = `
        <div class="v2p-bar">
            <label class="checkbox_label"><input type="checkbox" class="v2p-enabled" ${on ? 'checked' : ''}><span>额外请求套用酒馆预设</span></label>
            <span class="v2p-title">${esc(preset.name || '未导入预设')}${imported.length ? `<small>已启用 ${enabledCount}/${imported.length}</small>` : ''}</span>
            <div class="menu_button menu_button_icon v2p-import"><i class="fa-solid fa-file-import"></i><a>导入预设</a></div>
            ${imported.length ? '<div class="menu_button menu_button_icon v2p-clear"><i class="fa-solid fa-trash"></i><a>清除</a></div>' : ''}
        </div>
        <small class="toggle-description justifyLeft">写大总结、压缩、画地图、回填、融合这些额外请求，按下面的条目顺序发：破限、预填充照用，📌那一条是 v2 的任务和数据（相当于预设里「聊天记录」的位置）。角色卡、世界书等占位条目不导入。按住左边的抓手拖动，或点 ↑↓ 调顺序；点名字看和改内容。</small>
        ${imported.length ? `<label class="checkbox_label"><input type="checkbox" class="v2p-squash" ${preset.squash ? 'checked' : ''}><span>合并相邻的系统消息</span></label>` : ''}
        ${imported.length ? `<ul class="v2p-list">${preset.entries.map((e, i) => rowHtml(e, i, preset.entries.length)).join('')}</ul>` : ''}
        ${preset.extras.length ? `<details class="v2p-extras"><summary>没在顺序里的条目（${preset.extras.length}）</summary>
            <small class="toggle-description justifyLeft">这些条目在预设的条目库里，但酒馆的条目列表没放，所以酒馆里看不到也不发送。这里同样不发，需要的点「加入末尾」。</small>
            <ul class="v2p-list">${preset.extras.map(e => `<li class="v2p-row is-off" data-id="${esc(e.id)}"><button type="button" class="v2p-open"><span class="v2p-name">${esc(e.name)}</span><span class="v2p-tag">${ROLE_LABEL[e.role]}</span></button><button type="button" class="menu_button v2p-append">加入末尾</button></li>`).join('')}</ul>
        </details>` : ''}`;
}

function importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const parsed = parsePreset(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
            USER.tableBaseSetting.v2_extra_preset_enabled = true;
            save(parsed);
            const imported = parsed.entries.filter(e => e.id !== SLOT_ID);
            EDITOR.success(`已导入预设「${parsed.name}」：${imported.length} 条，启用 ${imported.filter(e => e.enabled).length} 条`);
        } catch (error) {
            EDITOR.error('导入预设失败', error.message, error);
        }
    });
    input.click();
}

async function editEntry(id, fromExtras) {
    const preset = currentPreset();
    const list = fromExtras ? preset.extras : preset.entries;
    const entry = list.find(e => e.id === id);
    if (!entry) return;
    const $form = $(`<div class="v2p-edit" style="text-align:left;display:flex;flex-direction:column;gap:6px">
        <label>名字 <input class="text_pole v2p-e-name" value="${esc(entry.name)}"></label>
        <label>身份 <select class="text_pole v2p-e-role">${Object.entries(ROLE_LABEL).map(([v, t]) => `<option value="${v}" ${entry.role === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>位置 <select class="text_pole v2p-e-pos"><option value="relative" ${entry.position === 'relative' ? 'selected' : ''}>相对（按列表顺序）</option><option value="depth" ${entry.position === 'depth' ? 'selected' : ''}>聊天中（插进 v2 内容里）</option></select></label>
        <label>深度 <input type="number" min="0" class="text_pole v2p-e-depth" value="${entry.depth}" style="width:80px"></label>
        <textarea class="text_pole v2p-e-content" rows="14" style="width:100%">${esc(entry.content)}</textarea>
    </div>`);
    const ok = await EDITOR.callGenericPopup($form, EDITOR.POPUP_TYPE.CONFIRM, entry.name, { okButton: '保存', cancelButton: '取消', wide: true, large: true, allowVerticalScrolling: true });
    if (!ok) return;
    Object.assign(entry, {
        name: String($form.find('.v2p-e-name').val() || entry.name),
        role: String($form.find('.v2p-e-role').val()),
        position: String($form.find('.v2p-e-pos').val()),
        depth: Number($form.find('.v2p-e-depth').val()) || 0,
        content: String($form.find('.v2p-e-content').val() ?? ''),
    });
    save(preset);
}

function move(id, delta) {
    const preset = currentPreset();
    const i = preset.entries.findIndex(e => e.id === id);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= preset.entries.length) return;
    [preset.entries[i], preset.entries[j]] = [preset.entries[j], preset.entries[i]];
    save(preset);
}

/** 按住抓手拖动：跟着手指把这一行挪到对应位置，松手时按画面上的顺序保存 */
function bindDrag(box) {
    let dragging = null;
    box.addEventListener('pointerdown', (event) => {
        const handle = event.target.closest('.v2p-handle');
        if (!handle) return;
        const row = handle.closest('.v2p-row');
        const list = row?.parentElement;
        if (!row || !list || list.closest('.v2p-extras')) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        dragging = { row, list, handle };
        row.classList.add('is-dragging');
    });
    box.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const rows = [...dragging.list.children].filter(r => r !== dragging.row);
        const after = rows.find(r => { const rect = r.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
        if (after) dragging.list.insertBefore(dragging.row, after);
        else dragging.list.appendChild(dragging.row);
    });
    const finish = () => {
        if (!dragging) return;
        const ids = [...dragging.list.children].map(r => r.dataset.id);
        dragging.row.classList.remove('is-dragging');
        dragging = null;
        const preset = currentPreset();
        const byId = new Map(preset.entries.map(e => [e.id, e]));
        preset.entries = ids.map(id => byId.get(id)).filter(Boolean);
        save(preset);
    };
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);
}

/** 绑定事件（设置页加载后调用一次） */
export function initPresetPanel() {
    const box = document.getElementById('table_v2_preset_panel');
    if (!box || box.dataset.bound) return render();
    box.dataset.bound = '1';
    bindDrag(box);
    box.addEventListener('click', (event) => {
        const t = event.target;
        const row = t.closest('.v2p-row');
        const id = row?.dataset.id;
        const inExtras = !!t.closest('.v2p-extras');
        if (t.closest('.v2p-import')) return importFile();
        if (t.closest('.v2p-clear')) {
            USER.tableBaseSetting.v2_extra_preset_enabled = false;
            USER.tableBaseSetting.v2_extra_preset = null;
            return render();
        }
        if (t.closest('.v2p-up')) return move(id, -1);
        if (t.closest('.v2p-down')) return move(id, 1);
        if (t.closest('.v2p-append')) {
            const preset = currentPreset();
            const entry = preset.extras.find(e => e.id === id);
            if (!entry) return;
            preset.extras = preset.extras.filter(e => e.id !== id);
            preset.entries.push({ ...entry, enabled: true });
            return save(preset);
        }
        if (t.closest('.v2p-open') && id && id !== SLOT_ID) return editEntry(id, inExtras);
    });
    box.addEventListener('change', (event) => {
        const t = event.target;
        if (t.classList.contains('v2p-enabled')) {
            if (t.checked && !currentPreset().entries.some(e => e.id !== SLOT_ID)) {
                t.checked = false;
                return EDITOR.error('先点「导入预设」选一个酒馆预设文件');
            }
            USER.tableBaseSetting.v2_extra_preset_enabled = t.checked;
            return;
        }
        if (t.classList.contains('v2p-squash')) {
            const preset = currentPreset();
            preset.squash = t.checked;
            return save(preset);
        }
        if (t.classList.contains('v2p-toggle')) {
            const preset = currentPreset();
            const entry = preset.entries.find(e => e.id === t.closest('.v2p-row')?.dataset.id);
            if (entry) entry.enabled = t.checked;
            save(preset);
        }
    });
    render();
}
