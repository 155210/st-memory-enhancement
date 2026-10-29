import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { collectNames, findRolesInText } from '../../core/summaryManager.js';
import { cleanChatText, ignoredTags } from '../../core/chatText.js';
import { computeTiers, isPairSheet } from '../../core/sendTiers.js';
import { presentNames } from '../../core/worldMap.js';
import { findRowByName, isNameKeyedSheet, writeRowValues } from '../../core/rowIdentity.js';
import * as CD from '../../core/characterData.js';
import * as CS from '../../core/characterStatus.js';
import * as ACT from './characterCardActions.js';
import { avatarHtml, clean, curveSvg, cycleHtml, egoGraphSvg, esc, firstLine, meterHtml, short, signed } from './characterCardParts.js';

/**
 * @description 角色资料卡：挂在最新一条消息底部（或聊天最下面）的一条可展开的栏
 * @description - 收起时：▸ 角色资料 + 在场的人；点人直接打开她的卡
 * @description - 卡片：表格里关于这个人的所有内容 + 正文状态标签的最新状态、曲线、提醒、备注
 * @description - 名册：所有人一行一个，筛选、排序、对不上的名字
 * @description 界面状态都在模块内存里，重新渲染（新消息、改表）后照原样恢复；只给你看，不发给 AI
 */

const ID = 'v2CharacterCardContainer';
const SORTS = [['recent', '最近出场'], ['favor', '好感'], ['submit', '臣服值'], ['name', '名字'], ['absent', '最久没出场'], ['tokens', 'token 最多']];
const CURVE_FIELDS = ['好感', '臣服值', '体力', '快感', '累计高潮次数'];
const CURVE_WORDS = [['好感', '好感'], ['臣服', '臣服值'], ['体力', '体力'], ['快感', '快感'], ['高潮次数', '累计高潮次数']];
/** 状态里折叠显示的长字段 */
const LONG_STATUS = /服装|外貌|动作|体位|性爱次数/;
/** 状态里应该读出数字的字段，读不出就标「没读到」 */
const NUMERIC_EXPECT = /好感|臣服|体力|快感|高潮次数|液体量|胃部|膀胱/;
const SWIPE_MIN = 60;

const freshUi = () => ({
    open: false, tab: 'card', current: null, q: '', sort: 'recent', group: 'all',
    privacy: false, collapsed: false, openKeys: new Set(), secOpen: {}, scroll: { card: 0, roster: 0 }, stripLeft: 0,
    curve: null, curvePt: -1, compare: null, graph: false, bookmark: '', orphans: false, editTags: false,
    changedFor: null, changed: new Set(), wi: new Map(), reveal: false,
});
let ui = freshUi();
let model = null;
let root = null;
let timer = null;
let inited = false;
/** 本次渲染用到的提醒和条目，按钮按下标 / key 找回 */
let lastAlerts = [];
let itemMap = new Map();

const setting = () => USER.tableBaseSetting || {};
const enabled = () => setting().isExtensionAble !== false && setting().v2_card_enabled !== false;
const userName = () => clean(USER.getContext()?.name1);
const chatLength = () => USER.getContext()?.chat?.length || 0;
const normLabel = (s) => {
    // AI 有时把 {{user}} 直接写成你的名字（「对江辰好感」），也当成 <user>
    let out = clean(s).replace(/\{\{user\}\}|<user>/gi, '<user>');
    const me = userName();
    if (me) out = out.split(`对${me}`).join('对<user>');
    return out.replace(/\s+/g, '').toLowerCase();
};
const showLabel = (s) => clean(s).replace(/\{\{user\}\}|<user>/gi, userName() || '你');
const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.warn('[v2 资料卡]', e); return fallback; } };

// ---------------------------------------------------------------- 数据

/** 从表格建一次档案索引（只看表，不扫聊天） */
function buildModel() {
    const sheets = safe(() => BASE.hashSheetsToSheets(BASE.getPieceHash(BASE.getLastSheetsPiece()?.piece)), []) || [];
    const built = safe(() => CD.buildProfiles(sheets), null) || { list: [], index: new Map(), orphans: [] };
    const list = [...built.list];
    const index = new Map(built.index);
    const state = CS.cardState();
    // 状态标签里有、表格里还没有的人也给一张空卡
    for (const name of Object.keys(state.status || {})) {
        if (index.has(name)) continue;
        list.push({ primary: name, aliases: [], sections: [], tokens: 0, empty: [], text: '', numbers: {}, fieldLabels: new Set(), tagOnly: true });
        index.set(name, name);
    }
    const names = safe(() => collectNames(sheets), new Map());
    const present = cardPresent(sheets, index, names);
    return { sheets, list, index, orphans: built.orphans || [], byPrimary: new Map(list.map(p => [p.primary, p])), present, names };
}

/** 资料卡自己的「跳过的标签」：设置里两处都算 */
function cardIgnoredTags() {
    const own = String(setting().v2_card_ignore_tags || '').split(/[,，、\s]+/).map(t => t.replace(/^<\/?|>$/g, '').trim()).filter(Boolean);
    return [...safe(() => ignoredTags(), []), ...own];
}

/**
 * 在场：只看最新一条 AI 回复
 * - 状态标签里列出的人
 * - 时空表「此地角色」
 * - 正文里提到的名字（去掉状态标签本身和跳过的标签）
 */
function cardPresent(sheets, index, names) {
    const present = new Set();
    const add = (n) => { const key = clean(n); if (index.has(key)) present.add(index.get(key)); else if (names.has(key)) present.add(names.get(key)); };
    const chat = USER.getContext()?.chat || [];
    let last = null;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && !chat[i].is_system) { last = chat[i]; break; }
    const mes = String(last?.mes ?? '');
    safe(() => CS.parseStatusBlocks(mes).forEach(b => add(b.name)));
    safe(() => presentNames(sheets).forEach(add));
    safe(() => findRolesInText(cleanChatText(mes, [...cardIgnoredTags(), CS.statusConfig().tag]), names, 100).forEach(add));
    return present;
}

const resolveName = (name) => {
    const n = clean(name);
    return model?.index.get(n) || (model?.byPrimary.has(n) ? n : null);
};

/** 状态字段里按词找数值 */
function statusNumber(st, word) {
    if (!st?.fields) return undefined;
    const label = Object.keys(st.fields).find(k => k.includes(word));
    if (!label) return undefined;
    const p = CS.parseValue(st.fields[label]);
    return Number.isFinite(p.num) ? p.num : undefined;
}

function sortCtx() {
    const state = CS.cardState();
    const numbers = {};
    for (const [primary, st] of Object.entries(state.status || {})) {
        numbers[primary] = { 好感: statusNumber(st, '好感'), 臣服值: statusNumber(st, '臣服'), 累计高潮次数: statusNumber(st, '高潮次数') };
    }
    return { appear: state.appear || {}, present: model.present, pins: CS.getPins(), numbers };
}

/** 搜索、分组过滤、排序后的名单 */
function visibleList() {
    let list = CD.searchProfiles(model.list, ui.q);
    if (ui.group === 'present') list = list.filter(p => model.present.has(p.primary));
    else if (ui.group === 'gap') list = list.filter(p => p.empty?.length);
    else if (ui.group.startsWith('tag:')) {
        const tag = ui.group.slice(4);
        list = list.filter(p => CS.getTags(p.primary).includes(tag));
    }
    return CD.sortProfiles(list, ui.sort, sortCtx());
}

function currentProfile(list = visibleList()) {
    let p = ui.current && model.byPrimary.get(ui.current);
    if (!p || (ui.q && !list.includes(p))) p = list[0] || (ui.q ? null : model.list[0]) || null;
    if (p) ui.current = p.primary;
    return p;
}

/** 这个人卡上所有条目（红点比较用） */
function itemsOf(p, st) {
    const items = [];
    for (const s of p.sections) {
        for (const it of [...s.grid, ...s.long]) items.push({ key: it.key, value: it.value });
        for (const r of s.rows) items.push({ key: r.key, value: `${r.title}|${r.meta}|${r.detail}` });
    }
    for (const [label, value] of Object.entries(st?.fields || {})) items.push({ key: `st:${label}`, value });
    return items;
}

function appearStats(primary) {
    const a = CS.cardState().appear?.[primary];
    if (!a) return null;
    const from = chatLength() - 100;
    return { ...a, recent100: (a.recent || []).filter(f => f >= from).length };
}

// ---------------------------------------------------------------- HTML：栏和标签页

const dot = (on) => (on ? '<i class="v2cc-dot" title="上次看过之后变了"></i>' : '');
const chipClass = (on) => `v2cc-chip${on ? ' is-on' : ''}`;

function barHtml() {
    const present = model.list.filter(p => model.present.has(p.primary));
    const pins = CS.getPins();
    const count = `<span class="v2cc-count">${present.length ? `在场 ${present.length} · ` : ''}共 ${model.list.length}</span>`;
    if (ui.open) {
        return `<div class="v2cc-bar is-open"><button class="v2cc-title" data-act="bar" aria-expanded="true">▾ 角色资料</button>
<div class="v2cc-tabs" role="tablist"><button class="${chipClass(ui.tab === 'card')}" data-act="tab" data-tab="card">卡片</button><button class="${chipClass(ui.tab === 'roster')}" data-act="tab" data-tab="roster">名册</button></div>${count}</div>`;
    }
    const chips = (present.length ? present : model.list.filter(p => pins.has(p.primary))).slice(0, 12).map(p =>
        `<button class="v2cc-chip" data-act="pick" data-name="${esc(p.primary)}">${model.present.has(p.primary) ? '<b class="v2cc-on">●</b>' : '★'}${esc(p.primary)}</button>`).join('');
    return `<div class="v2cc-bar"><button class="v2cc-title" data-act="bar" aria-expanded="false">▸ 角色资料</button>
<div class="v2cc-chips v2cc-scroll">${chips || '<span class="v2cc-muted">没有在场的人</span>'}</div>${count}</div>`;
}

function sortsHtml() {
    return `<select class="v2cc-input v2cc-sort" data-field="sort" aria-label="排序">${SORTS.map(([k, t]) => `<option value="${k}"${ui.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
}

function groupsHtml(withGap) {
    const tags = safe(() => CS.allTags(), []);
    if (!withGap && !tags.length) return '';
    const groups = [['all', '全部'], ['present', '在场'], ...(withGap ? [['gap', '资料缺口']] : []), ...tags.map(t => [`tag:${t}`, `#${t}`])];
    return `<div class="v2cc-row v2cc-scroll">${groups.map(([k, t]) => `<button class="${chipClass(ui.group === k)}" data-act="group" data-group="${esc(k)}">${esc(t)}</button>`).join('')}</div>`;
}

function toolsHtml(withGap) {
    return `<div class="v2cc-tools"><div class="v2cc-searchrow"><input class="v2cc-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="搜名字或全文" value="${esc(ui.q)}">${sortsHtml()}</div>
${groupsHtml(withGap)}</div>`;
}

function stripHtml(list) {
    const pins = CS.getPins();
    if (!list.length) return '<span class="v2cc-muted">没有匹配的人</span>';
    return list.map(p => `<button class="v2cc-chip v2cc-person${p.primary === ui.current ? ' is-on' : ''}" data-act="pick" data-name="${esc(p.primary)}">`
        + `${avatarHtml(p.primary, CS.getAvatar(p.primary), 'is-sm')}${pins.has(p.primary) ? '★' : ''}${model.present.has(p.primary) ? '<b class="v2cc-on">●</b>' : ''}${esc(p.primary)}</button>`).join('');
}

function cardTabHtml() {
    const list = visibleList();
    const p = currentProfile(list);
    return `${toolsHtml(false)}<div class="v2cc-strip v2cc-scroll">${stripHtml(list)}</div><div class="v2cc-profile-wrap">${p ? profileHtml(p) : ''}</div>`;
}

// ---------------------------------------------------------------- HTML：一个人的卡

function profileHtml(p) {
    const state = CS.cardState();
    const st = state.status?.[p.primary];
    const present = model.present.has(p.primary);
    const pinned = CS.getPins().has(p.primary);
    itemMap = new Map();

    // 红点：和上次看到的比；同一个人连着看时并起来，换人时清掉
    if (ui.changedFor !== p.primary) { ui.changedFor = p.primary; ui.changed = new Set(); }
    const items = itemsOf(p, st);
    if (!ui.collapsed) {
        safe(() => CS.changedKeys(p.primary, items).forEach(k => ui.changed.add(k)));
        safe(() => CS.markViewed(p.primary, items));
    }
    const changed = ui.changed;

    const head = `<div class="v2cc-head" data-act="head">
<button class="v2cc-nav" data-act="prev" aria-label="上一个">‹</button>
<button class="v2cc-avabtn" data-act="avatar" aria-label="换头像">${avatarHtml(p.primary, CS.getAvatar(p.primary), 'is-big')}</button>
<div class="v2cc-who"><div class="v2cc-name"><span>${esc(p.primary)}</span><span class="v2cc-badge${present ? ' is-on' : ''}">${present ? '在场' : '不在场'}</span></div>
<div class="v2cc-aliases">${p.aliases.length ? esc(p.aliases.join(' · ')) : (ui.collapsed ? '点这里展开' : '')}</div></div>
<button class="v2cc-pin${pinned ? ' is-on' : ''}" data-act="pin" aria-label="置顶">${pinned ? '★' : '☆'}</button>
<button class="v2cc-nav" data-act="next" aria-label="下一个">›</button></div>`;
    if (ui.collapsed) return `<div class="v2cc-profile is-collapsed" data-primary="${esc(p.primary)}">${head}</div>`;

    const a = appearStats(p.primary);
    const stats = [`约 ${p.tokens || 0} token`];
    if (a) stats.push(`第一次出场 第 ${a.first} 楼`, `共出场 ${a.count} 次`, `最近 100 楼 ${a.recent100} 次`, `上次出场 第 ${a.last} 楼`);
    else stats.push('还没记到出场');
    if (p.empty?.length) stats.push(`${p.empty.length} 列空`);

    return `<div class="v2cc-profile${ui.privacy ? ' is-private' : ''}" data-primary="${esc(p.primary)}">${head}
<div class="v2cc-stats">${stats.map(s => `<span>${esc(s)}</span>`).join('')}</div>
${tagsHtml(p)}
<div class="v2cc-actions">
<button class="v2cc-btn${ui.privacy ? ' is-on' : ''}" data-act="privacy" aria-pressed="${ui.privacy}">遮挡</button>
<button class="v2cc-btn" data-act="copy">复制</button><button class="v2cc-btn" data-act="image">存图</button>
<button class="v2cc-btn" data-act="summon">让她出场</button><button class="v2cc-btn${ui.compare !== null ? ' is-on' : ''}" data-act="compare">对比</button></div>
${ui.compare !== null ? compareHtml(p) : ''}
${alertsHtml(p)}
${statusHtml(p, st, changed)}
${curveHtml(p)}
${p.tagOnly ? '<div class="v2cc-empty">表格里还没有这个人，只有正文状态标签里有</div>' : ''}
${p.sections.map(s => sectionHtml(p, s, changed)).join('')}
${worldInfoHtml(p)}
<div class="v2cc-note"><div class="v2cc-k">私人备注 <small>只存在这个聊天里，不发给 AI</small></div>
<textarea class="v2cc-input" data-field="note" rows="3" placeholder="随手记点什么">${esc(safe(() => CS.getNote(p.primary), ''))}</textarea></div>
</div>`;
}

function tagsHtml(p) {
    const tags = safe(() => CS.getTags(p.primary), []);
    if (ui.editTags) {
        return `<div class="v2cc-tagrow"><input class="v2cc-input v2cc-tags-input" data-field="tags" enterkeyhint="done" placeholder="分组标签，用逗号分开" value="${esc(tags.join(', '))}"><button class="v2cc-btn" data-act="tags-save">好</button></div>`;
    }
    return `<div class="v2cc-tagrow">${tags.map(t => `<span class="v2cc-tag">#${esc(t)}</span>`).join('')}<button class="v2cc-mini" data-act="tags-edit">${tags.length ? '改标签' : '+ 分组标签'}</button></div>`;
}

function alertsHtml(p) {
    lastAlerts = [];
    if (p.tagOnly && !CS.cardState().status?.[p.primary]) return '';
    lastAlerts = [...safe(() => CS.checkRules(p.primary), []), ...safe(() => CS.mismatchAlerts(p.primary, p), [])];
    if (!lastAlerts.length) return '';
    if (ui.privacy) return `<div class="v2cc-alerts"><div class="v2cc-alerts-sum">⚠ ${lastAlerts.length} 条提醒（已遮挡）</div></div>`;
    // 一条直接显示；多条先折起来，只露第一条，免得把状态挤到下面
    const list = lastAlerts.map((al, i) => `<div class="v2cc-alert"><span>${esc(al.text)}</span>${al.fix ? `<button class="v2cc-btn" data-act="fix" data-i="${i}">纠正提示</button>` : ''}</div>`).join('');
    if (lastAlerts.length === 1) return `<div class="v2cc-alerts">${list}</div>`;
    const key = `alerts:${p.primary}`;
    return `<details class="v2cc-alerts v2cc-fold" data-key="${esc(key)}"${ui.openKeys.has(key) ? ' open' : ''}><summary><span class="v2cc-alerts-sum">⚠ ${lastAlerts.length} 条提醒</span><span class="v2cc-pv">${esc(lastAlerts[0].text)}</span></summary>${list}</details>`;
}

/** 状态里一格（数值带进度条） */
function statusCellHtml(item, changed) {
    const { label, value, pv } = item;
    const k = `<div class="v2cc-k">${esc(showLabel(label))}${dot(changed.has(item.key))}</div>`;
    if (item.missing) return `<div class="v2cc-cell is-missing">${k}<div class="v2cc-v v2cc-muted">没读到</div>${value ? `<div class="v2cc-sub">${esc(short(value, 30))}</div>` : ''}</div>`;
    const num = Number.isFinite(pv.num) ? pv.num : pv.ml;
    if (Number.isFinite(num)) {
        const unit = Number.isFinite(pv.ml) ? 'ml' : '';
        const delta = Number.isFinite(pv.delta) && pv.delta !== 0 ? `<span class="v2cc-delta ${pv.delta > 0 ? 'is-up' : 'is-down'}">${signed(pv.delta)}</span>` : '';
        const sub = Number.isFinite(pv.ml) ? clean(String(value).split('=')[0]) : (pv.reason || '');
        return `<div class="v2cc-cell">${k}<div class="v2cc-v"><b>${num}</b>${Number.isFinite(pv.max) ? `<small>/${pv.max}${unit}</small>` : unit ? `<small>${unit}</small>` : ''}${delta}</div>`
            + `${meterHtml(num, pv.max)}${sub ? `<div class="v2cc-sub">${esc(sub)}</div>` : ''}</div>`;
    }
    return `<div class="v2cc-cell">${k}<div class="v2cc-v">${esc(value)}</div></div>`;
}

function foldHtml(key, label, value, isChanged, extra = '') {
    const open = ui.openKeys.has(key);
    return `<details class="v2cc-fold" data-key="${esc(key)}"${open ? ' open' : ''}><summary><span class="v2cc-k">${esc(label)}${dot(isChanged)}</span><span class="v2cc-pv">${esc(firstLine(value, 60))}</span></summary>`
        + `<div class="v2cc-full">${esc(value)}</div>${extra}</details>`;
}

function statusHtml(p, st, changed) {
    const head = (extra) => `<div class="v2cc-blockhead"><b>最新状态</b>${extra}<span class="v2cc-sp"></span><button class="v2cc-mini" data-act="bm-add">存书签</button></div>`;
    if (!st?.fields) return `<div class="v2cc-block v2cc-status">${head('')}<div class="v2cc-empty">暂无，等下次出场输出标签后就有了</div>${bookmarkHtml(p)}</div>`;
    const floorInfo = `<span class="v2cc-muted">第 ${esc(st.floor)} 楼 · 来自正文</span><button class="v2cc-link" data-act="floor" data-floor="${esc(st.floor)}">跳到那一楼</button>`;
    if (ui.privacy) return `<div class="v2cc-block v2cc-status">${head(floorInfo)}<div class="v2cc-masked">已遮挡</div></div>`;

    const tableLabels = new Set([...(p.fieldLabels || [])].map(normLabel));
    const shortLimit = Number(setting().v2_card_short_limit) || 20;
    const grid = [], longs = [];
    let cycle = '';
    for (const [label, raw] of Object.entries(st.fields)) {
        const value = clean(raw);
        if (tableLabels.has(normLabel(label))) continue;   // 表格里有的以表格为准
        if (!value) continue;
        if (/当前阶段/.test(label) && !cycle) { const c = cycleHtml(value); if (c) { cycle = c; continue; } }
        const pv = safe(() => CS.parseValue(value), {}) || {};
        const item = { key: `st:${label}`, label, value, pv };
        // 只有真正的数值才按数字显示：带「/上限」「(差值)」或整格就是数字；外貌这类长文本开头碰巧是数字的不算
        const numeric = Number.isFinite(pv.ml) || (Number.isFinite(pv.num) && (Number.isFinite(pv.max) || Number.isFinite(pv.delta) || /^\s*-?\d+(\.\d+)?\s*$/.test(value)));
        const hasNum = numeric && !LONG_STATUS.test(label);
        if (!hasNum) { delete item.pv.num; delete item.pv.ml; }
        if (!hasNum && NUMERIC_EXPECT.test(label) && !/服装|状态$/.test(label) && /^\D*$/.test(value) && value !== '无') item.missing = true;
        if (hasNum || item.missing || (!LONG_STATUS.test(label) && value.length <= shortLimit && !value.includes('\n'))) grid.push(item);
        else longs.push(item);
    }
    // 上一份有、这一份没有的字段
    for (const label of Object.keys(st.prev || {})) {
        if (st.fields[label] !== undefined || tableLabels.has(normLabel(label))) continue;
        if (NUMERIC_EXPECT.test(label)) grid.push({ key: `st:${label}`, label, value: '', pv: {}, missing: true });
    }
    const grids = grid.length ? `<div class="v2cc-grid">${grid.map(it => statusCellHtml(it, changed)).join('')}</div>` : '';
    const folds = longs.map(it => foldHtml(`st:${p.primary}:${it.label}`, showLabel(it.label), it.value, changed.has(it.key))).join('');
    const nothing = !grids && !folds && !cycle ? '<div class="v2cc-empty">标签里的内容表格里都有了</div>' : '';
    return `<div class="v2cc-block v2cc-status">${head(floorInfo)}${grids}${cycle}${folds}${nothing}${bookmarkHtml(p)}</div>`;
}

function bookmarkHtml(p) {
    const list = safe(() => CS.listBookmarks(), []);
    if (!list.length) return '';
    if (ui.bookmark && !list.some(b => b.id === ui.bookmark)) ui.bookmark = '';
    const options = list.map(b => `<option value="${esc(b.id)}"${b.id === ui.bookmark ? ' selected' : ''}>${esc(b.label)}（第 ${esc(b.floor)} 楼）</option>`).join('');
    let diff = '';
    if (ui.bookmark) {
        const rows = safe(() => CS.bookmarkDiff(ui.bookmark, p.primary), []);
        diff = rows.length
            ? `<div class="v2cc-diff">${rows.map(r => `<div><span class="v2cc-k">${esc(showLabel(r.field))}</span><span>${r.from ?? '—'} → <b>${r.to ?? '—'}</b></span></div>`).join('')}</div>`
            : '<div class="v2cc-empty">和书签时比，数值没有变化</div>';
    }
    return `<div class="v2cc-bm"><select class="v2cc-input" data-field="bookmark"><option value="">和书签比…</option>${options}</select>${ui.bookmark ? '<button class="v2cc-mini" data-act="bm-del">删书签</button>' : ''}</div>${diff}`;
}

function curveHtml(p) {
    if (ui.privacy) return '';
    const hist = CS.cardState().history?.[p.primary] || {};
    const fields = CURVE_FIELDS.filter(f => (hist[f] || []).length >= 2);
    if (!fields.length) {
        const one = CURVE_FIELDS.filter(f => (hist[f] || []).length === 1);
        return `<div class="v2cc-block v2cc-curve"><div class="v2cc-blockhead"><b>变化曲线</b></div><div class="v2cc-empty">${one.length ? `${esc(one.join('、'))} 才记了 1 个点，下一楼开始画线` : '还没有数值记录，等她出场输出状态标签后开始记'}</div></div>`;
    }
    if (!fields.includes(ui.curve)) { ui.curve = fields[0]; ui.curvePt = -1; }
    const points = hist[ui.curve];
    const i = ui.curvePt >= 0 && ui.curvePt < points.length ? ui.curvePt : points.length - 1;
    const pt = points[i];
    const caption = `第 ${pt.f} 楼 · ${ui.curve} ${pt.v}${Number.isFinite(pt.d) ? `（${signed(pt.d)}）` : ''}${pt.r ? ` ${pt.r}` : ''}`;
    return `<div class="v2cc-block v2cc-curve"><div class="v2cc-blockhead"><b>变化曲线</b><span class="v2cc-muted">从启用资料卡起记录</span></div>
<div class="v2cc-row v2cc-scroll">${fields.map(f => `<button class="${chipClass(f === ui.curve)}" data-act="curve" data-field="${esc(f)}">${esc(f)}</button>`).join('')}</div>
${curveSvg(points, i)}<div class="v2cc-caption">${esc(caption)}</div></div>`;
}

function sheetByUid(uid) { return model.sheets.find(s => s.uid === uid); }

function sectionHtml(p, s, changed) {
    const count = s.grid.length + s.long.length + s.rows.length;
    if (!count) return '';
    const key = `sec:${s.sheet}`;
    const open = ui.secOpen[key] ?? !s.private;
    const masked = ui.privacy && s.private;
    const isPair = safe(() => { const sh = sheetByUid(s.uid); return sh ? isPairSheet(sh) : false; }, false);
    const anyChanged = [...s.grid, ...s.long, ...s.rows].some(it => changed.has(it.key));
    const head = `<div class="v2cc-sec-head"><button class="v2cc-sec-title" data-act="sec" data-key="${esc(key)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(showLabel(s.sheet))} <small>${count}</small>${s.private ? '<span class="v2cc-lock">私密</span>' : ''}${dot(anyChanged)}</button>`
        + `${isPair && open && !masked ? `<button class="v2cc-mini${ui.graph ? ' is-on' : ''}" data-act="graph">图</button>` : ''}<button class="v2cc-link" data-act="jump" data-sheet="${esc(s.sheet)}">跳到原表</button></div>`;
    if (!open) return `<section class="v2cc-sec">${head}</section>`;
    if (masked) return `<section class="v2cc-sec">${head}<div class="v2cc-masked">已遮挡</div></section>`;

    const grid = s.grid.length ? `<div class="v2cc-grid">${s.grid.map(it => `<div class="v2cc-cell"><div class="v2cc-k">${esc(showLabel(it.label))}${dot(changed.has(it.key))}</div><div class="v2cc-v">${esc(it.value)}</div></div>`).join('')}</div>` : '';
    const longs = s.long.map(it => {
        itemMap.set(it.key, { item: it, section: s });
        const extra = it.append ? `<div class="v2cc-foldbar"><span class="v2cc-muted">${it.value.length} 字</span><button class="v2cc-mini" data-act="condense" data-key="${esc(it.key)}">AI 精简</button></div>` : '';
        return foldHtml(`it:${p.primary}:${it.key}`, showLabel(it.label), it.value, changed.has(it.key), extra);
    }).join('');
    const graph = isPair && ui.graph ? egoGraphSvg(p.primary, s.rows.map(r => ({ name: r.title, label: r.meta, link: r.link && model.byPrimary.has(r.link) ? r.link : null }))) : '';
    const rows = s.rows.map(r => {
        const title = r.link && model.byPrimary.has(r.link)
            ? `<button class="v2cc-namelink" data-act="pick" data-name="${esc(r.link)}">${esc(r.title)}</button>`
            : `<span class="v2cc-rt">${esc(r.title)}</span>`;
        const meta = r.meta ? `<span class="v2cc-meta">${esc(r.meta)}</span>` : '';
        if (!r.detail) return `<div class="v2cc-rowitem">${title}${meta}${dot(changed.has(r.key))}</div>`;
        const k = `row:${p.primary}:${r.key}`;
        return `<details class="v2cc-fold v2cc-rowitem" data-key="${esc(k)}"${ui.openKeys.has(k) ? ' open' : ''}><summary>${title}${meta}${dot(changed.has(r.key))}</summary><div class="v2cc-full">${esc(r.detail)}</div></details>`;
    }).join('');
    return `<section class="v2cc-sec">${head}<div class="v2cc-sec-body">${grid}${longs}${graph}${rows}</div></section>`;
}

function worldInfoHtml(p) {
    const key = `wi:${p.primary}`;
    const open = ui.openKeys.has(key);
    const got = ui.wi.get(p.primary);
    let body = '<div class="v2cc-empty">读取中…</div>';
    if (Array.isArray(got)) {
        body = got.length
            ? got.map(e => `<div class="v2cc-wi-entry"><div class="v2cc-k">${esc(e.title)}${e.book ? ` <small>${esc(e.book)}</small>` : ''}</div><div class="v2cc-full">${esc(e.content)}</div></div>`).join('')
            : '<div class="v2cc-empty">世界书里没有提到她的条目</div>';
    }
    const count = Array.isArray(got) ? `${got.length} 条` : '点开读取';
    return `<details class="v2cc-fold v2cc-wi" data-key="${esc(key)}"${open ? ' open' : ''}><summary><span class="v2cc-k">世界书</span><span class="v2cc-pv">${count}</span></summary>${body}</details>`;
}

/** 关系：社交表里含「关系」的格子，没有就用状态标签里的「对<user>关系」 */
function relationOf(p) {
    for (const s of p.sections) {
        if (s.kind !== 'fields') continue;
        const it = [...s.grid, ...s.long].find(i => /关系/.test(i.label));
        if (it) return it.value;
    }
    const st = CS.cardState().status?.[p.primary];
    const label = Object.keys(st?.fields || {}).find(k => /关系/.test(k));
    return label ? clean(st.fields[label]) : '';
}

function compareHtml(p) {
    const others = model.list.filter(o => o.primary !== p.primary);
    if (!others.length) return '<div class="v2cc-block"><div class="v2cc-empty">没有别人可以比</div></div>';
    if (!ui.compare || !model.byPrimary.has(ui.compare) || ui.compare === p.primary) ui.compare = others[0].primary;
    const q = model.byPrimary.get(ui.compare);
    const state = CS.cardState();
    const val = (x, word, tableKey) => {
        if (ui.privacy) return '已遮挡';
        const v = statusNumber(state.status?.[x.primary], word) ?? (tableKey ? x.numbers?.[tableKey] : undefined);
        return v === undefined ? '—' : String(v);
    };
    const rows = [
        ['好感', x => val(x, '好感', '好感')], ['臣服值', x => val(x, '臣服', '臣服值')], ['体力', x => val(x, '体力')],
        ['快感', x => val(x, '快感')], ['高潮次数', x => val(x, '高潮次数', '累计高潮次数')],
        ['在场', x => (model.present.has(x.primary) ? '在场' : '—')],
        ['上次出场', x => { const a = state.appear?.[x.primary]; return a ? `第 ${a.last} 楼` : '—'; }],
        ['token', x => String(x.tokens || 0)],
        ['和你', x => short(relationOf(x), 24) || '—'],
    ];
    const between = [];
    for (const [a, b] of [[p, q], [q, p]]) for (const s of a.sections) for (const r of s.rows) {
        if ((r.link === b.primary || r.title === b.primary) && r.meta) between.push(`${a.primary} → ${b.primary}：${r.meta}`);
    }
    const options = others.map(o => `<option value="${esc(o.primary)}"${o.primary === q.primary ? ' selected' : ''}>${esc(o.primary)}</option>`).join('');
    return `<div class="v2cc-block v2cc-compare"><div class="v2cc-blockhead"><b>对比</b><select class="v2cc-input" data-field="compare">${options}</select><span class="v2cc-sp"></span><button class="v2cc-mini" data-act="compare">关</button></div>
<div class="v2cc-cmp"><div class="v2cc-cmp-row is-head"><span></span><b>${esc(p.primary)}</b><b>${esc(q.primary)}</b></div>
${rows.map(([t, f]) => `<div class="v2cc-cmp-row"><span class="v2cc-k">${t}</span><span>${esc(f(p))}</span><span>${esc(f(q))}</span></div>`).join('')}</div>
${between.length ? `<div class="v2cc-between">${[...new Set(between)].map(t => `<div>${esc(t)}</div>`).join('')}</div>` : '<div class="v2cc-empty">关系表里没写她们俩的关系</div>'}</div>`;
}

// ---------------------------------------------------------------- HTML：名册

function rosterListHtml() {
    const list = visibleList();
    if (!list.length) return '<div class="v2cc-empty">没有匹配的人</div>';
    const state = CS.cardState();
    const pins = CS.getPins();
    return list.map(p => {
        const st = state.status?.[p.primary];
        const favor = statusNumber(st, '好感') ?? p.numbers?.好感;
        const a = state.appear?.[p.primary];
        const tags = safe(() => CS.getTags(p.primary), []);
        const meta = [a ? `上次 第 ${a.last} 楼` : '没记到出场', `${p.tokens || 0} token`, p.empty?.length ? `${p.empty.length} 列空` : ''].filter(Boolean);
        const relation = short(relationOf(p), 16);
        return `<button class="v2cc-rrow" data-act="open-row" data-name="${esc(p.primary)}">
${avatarHtml(p.primary, CS.getAvatar(p.primary), 'is-md')}
<span class="v2cc-rmain"><span class="v2cc-rline"><b>${pins.has(p.primary) ? '★' : ''}${model.present.has(p.primary) ? '<i class="v2cc-on">●</i>' : ''}${esc(p.primary)}</b>${relation ? `<span class="v2cc-meta">${esc(relation)}</span>` : ''}</span>
${Number.isFinite(favor) && !ui.privacy ? `<span class="v2cc-rfavor"><span class="v2cc-k">好感 ${favor}</span>${meterHtml(favor, 100)}</span>` : ''}
<span class="v2cc-rmeta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}${tags.map(t => `<span class="v2cc-tag">#${esc(t)}</span>`).join('')}</span></span></button>`;
    }).join('');
}

function orphansHtml() {
    const list = model.orphans || [];
    if (!list.length) return '';
    const body = ui.orphans ? `<div class="v2cc-orphans">${list.map(o => `<div class="v2cc-orphan"><div><b>${esc(o.name)}</b> <small class="v2cc-muted">在「${esc(o.sheet)}」</small></div>
<div class="v2cc-orphan-acts">${o.suggestions?.length ? o.suggestions.map(s => `<button class="v2cc-btn" data-act="alias" data-orphan="${esc(o.name)}" data-to="${esc(s)}">设为「${esc(s)}」的外号</button>`).join('') : '<span class="v2cc-muted">没有长得像的名字</span>'}</div></div>`).join('')}</div>` : '';
    return `<div class="v2cc-banner"><button class="v2cc-banner-btn" data-act="orphans">${ui.orphans ? '▾' : '▸'} 有 ${list.length} 个名字对不上任何角色，可能是错字</button>${body}</div>`;
}

function rosterHtml() {
    return `${toolsHtml(true)}${orphansHtml()}<div class="v2cc-roster">${rosterListHtml()}</div>`;
}

// ---------------------------------------------------------------- 挂载和渲染

function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = ID;
    root.className = 'v2cc';
    bindRoot(root);
    return root;
}

function removeRoot() {
    root?.remove();
    document.getElementById(ID)?.remove();
}

/** 挂到最新一条消息底部，或聊天最下面 */
function mount() {
    const chat = document.querySelector('#chat');
    if (!chat) return false;
    let parent = setting().v2_card_position === 'chat_bottom' ? chat : chat.querySelector('.last_mes .mes_text');
    if (!parent) parent = chat;
    const stray = document.getElementById(ID);
    if (stray && stray !== root) stray.remove();
    if (root.parentElement !== parent || parent.lastElementChild !== root) parent.appendChild(root);
    return true;
}

function render(rebuild = true) {
    try {
        if (!enabled()) { removeRoot(); return; }
        if (rebuild || !model) model = buildModel();
        if (!model.list.length) { removeRoot(); return; }
        ensureRoot();
        if (!mount()) return;
        root.style.setProperty('--v2cc-fs', `${Number(setting().v2_card_font_size) || 14}px`);
        root.classList.toggle('is-open', ui.open);
        root.innerHTML = barHtml() + (ui.open ? `<div class="v2cc-body">${ui.tab === 'roster' ? rosterHtml() : cardTabHtml()}</div>` : '');
        afterRender();
    } catch (error) {
        console.warn('[v2 资料卡] 渲染失败', error);
    }
}

function afterRender() {
    const body = root.querySelector('.v2cc-body');
    if (body) body.scrollTop = ui.scroll[ui.tab] || 0;
    const strip = root.querySelector('.v2cc-strip');
    if (strip) {
        strip.scrollLeft = ui.stripLeft || 0;
        if (ui.reveal) {
            const chip = strip.querySelector('.v2cc-person.is-on');
            if (chip && (chip.offsetLeft < strip.scrollLeft || chip.offsetLeft + chip.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
                strip.scrollLeft = Math.max(0, chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2);
            }
            ui.stripLeft = strip.scrollLeft;
        }
    }
    ui.reveal = false;
    markTagSummaries();
}

/** 搜索时只换名单和卡，不动输入框（手机上键盘不收起） */
function renderList() {
    if (!root || !ui.open) return;
    if (ui.tab === 'roster') {
        const box = root.querySelector('.v2cc-roster');
        if (box) box.innerHTML = rosterListHtml();
        return;
    }
    const list = visibleList();
    const p = currentProfile(list);
    const strip = root.querySelector('.v2cc-strip');
    const wrap = root.querySelector('.v2cc-profile-wrap');
    if (strip) { strip.innerHTML = stripHtml(list); strip.scrollLeft = 0; ui.stripLeft = 0; }
    if (wrap) wrap.innerHTML = p ? profileHtml(p) : '';
}

function schedule(delay = 40) {
    clearTimeout(timer);
    timer = setTimeout(() => render(true), delay);
}

/** 选中一个人 */
function select(name, { open = true, tab = 'card' } = {}) {
    const primary = resolveName(name);
    if (!primary) return false;
    if (primary !== ui.current) {
        ui.current = primary;
        ui.curve = null; ui.curvePt = -1; ui.editTags = false; ui.bookmark = '';
        if (ui.compare === primary) ui.compare = null;
    }
    if (open) ui.open = true;
    if (tab) ui.tab = tab;
    ui.collapsed = false;
    ui.reveal = true;
    // 卡片换人时回到卡片开头（名单还留在上面）
    const wrap = root?.querySelector('.v2cc-profile-wrap');
    if (wrap && ui.tab === 'card') ui.scroll.card = Math.min(ui.scroll.card, wrap.offsetTop);
    // 选人时清掉搜索里对不上她的字
    if (ui.q && !CD.searchProfiles([model.byPrimary.get(primary)], ui.q).length) ui.q = '';
    return true;
}

function step(delta) {
    const list = visibleList();
    if (!list.length) return;
    const i = list.findIndex(p => p.primary === ui.current);
    const next = list[(i + delta + list.length) % list.length];
    if (select(next.primary)) render(false);
}

// ---------------------------------------------------------------- 事件

function bindRoot(el) {
    // 别让酒馆的左右滑动（重新生成）吃掉卡片里的触摸；卡片自己的左右滑动换人
    let touch = null;
    el.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        const t = e.touches[0];
        const target = e.target;
        touch = t && target.closest?.('.v2cc-profile') && !target.closest('.v2cc-scroll, svg, input, textarea, select')
            ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('touchend', (e) => {
        e.stopPropagation();
        const t = e.changedTouches[0];
        if (!touch || !t) return;
        const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        touch = null;
        if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });

    el.addEventListener('scroll', (e) => {
        const t = e.target;
        if (t.classList?.contains('v2cc-body')) ui.scroll[ui.tab] = t.scrollTop;
        else if (t.classList?.contains('v2cc-strip')) ui.stripLeft = t.scrollLeft;
    }, true);

    el.addEventListener('toggle', (e) => {
        const d = e.target;
        const key = d?.dataset?.key;
        if (!key) return;
        if (d.open) ui.openKeys.add(key); else ui.openKeys.delete(key);
        if (d.open && key.startsWith('wi:')) loadWorldInfo(key.slice(3));
    }, true);

    el.addEventListener('click', (e) => {
        const target = e.target.closest('[data-act]');
        if (!target || !el.contains(target)) return;
        const act = target.dataset.act;
        // 摘要里的按钮别顺带开合 <details>
        if (target.closest('summary') && act !== undefined) e.preventDefault();
        e.stopPropagation();
        Promise.resolve(onAction(act, target)).catch(error => console.warn('[v2 资料卡] 操作失败', act, error));
    });

    el.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList.contains('v2cc-search')) { ui.q = t.value; renderList(); }
        else if (t.dataset.field === 'note' && ui.current) safe(() => CS.setNote(ui.current, t.value));
    });
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.field === 'sort') { ui.sort = t.value; ui.reveal = true; render(false); }
        else if (t.dataset.field === 'compare') { ui.compare = t.value; render(false); }
        else if (t.dataset.field === 'bookmark') { ui.bookmark = t.value; render(false); }
    });
    el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (e.target.dataset?.field === 'tags') { e.preventDefault(); saveTags(); }
        else if (e.target.classList?.contains('v2cc-search')) { e.preventDefault(); e.target.blur(); }
    });
}

function saveTags() {
    const input = root?.querySelector('.v2cc-tags-input');
    if (input && ui.current) safe(() => CS.setTags(ui.current, input.value));
    ui.editTags = false;
    render(false);
}

async function loadWorldInfo(primary) {
    if (ui.wi.has(primary)) return;
    const p = model?.byPrimary.get(primary);
    if (!p) return;
    ui.wi.set(primary, 'loading');
    const list = await ACT.lookupWorldInfo([p.primary, ...p.aliases]).catch(() => []);
    ui.wi.set(primary, Array.isArray(list) ? list : []);
    if (ui.current === primary) render(false);
}

async function onAction(act, t) {
    const p = ui.current ? model?.byPrimary.get(ui.current) : null;
    const st = p ? CS.cardState().status?.[p.primary] : null;
    switch (act) {
        case 'bar': ui.open = !ui.open; return render(false);
        case 'tab': ui.tab = t.dataset.tab; return render(false);
        case 'pick': if (select(t.dataset.name)) render(false); return;
        case 'open-row': if (select(t.dataset.name, { tab: 'card' })) render(false); return;
        case 'head': ui.collapsed = !ui.collapsed; return render(false);
        case 'prev': return step(-1);
        case 'next': return step(1);
        case 'sort': ui.sort = t.dataset.sort; return render(false);
        case 'group': ui.group = t.dataset.group; return render(false);
        case 'privacy': ui.privacy = !ui.privacy; return render(false);
        case 'orphans': ui.orphans = !ui.orphans; return render(false);
        case 'sec': { const k = t.dataset.key; const sec = p?.sections.find(s => `sec:${s.sheet}` === k); ui.secOpen[k] = !(ui.secOpen[k] ?? !sec?.private); return render(false); }
        case 'graph': ui.graph = !ui.graph; return render(false);
        case 'curve': ui.curve = t.dataset.field; ui.curvePt = -1; return render(false);
        case 'curve-pt': ui.curvePt = Number(t.dataset.i); return render(false);
        case 'compare': ui.compare = ui.compare === null ? '' : null; return render(false);
        case 'tags-edit': {
            ui.editTags = true; render(false);
            const input = root.querySelector('.v2cc-tags-input');
            try { input?.focus(); } catch (_) { }
            return;
        }
        case 'tags-save': return saveTags();
        case 'jump': return ACT.jumpToSheet(t.dataset.sheet);
        case 'floor': return ACT.scrollToFloor(Number(t.dataset.floor));
    }
    if (!p) return;
    switch (act) {
        case 'pin': CS.togglePin(p.primary); return render(false);
        case 'avatar': {
            const url = await ACT.pickImageAsDataUrl(96);
            if (url) { CS.setAvatar(p.primary, url); render(false); }
            return;
        }
        case 'copy': {
            const shown = ui.privacy ? { ...p, sections: p.sections.filter(s => !s.private) } : p;
            return ACT.copyText(CD.profileToText(shown, ui.privacy ? null : st));
        }
        case 'image': {
            const card = root.querySelector('.v2cc-profile');
            return ACT.exportCardImage(card, `${p.primary}.png`);
        }
        case 'summon': return ACT.insertToInput(`（让${p.primary}登场）`);
        case 'fix': { const al = lastAlerts[Number(t.dataset.i)]; if (al?.fix) ACT.insertToInput(al.fix); return; }
        case 'bm-add': {
            const fallback = `第 ${chatLength() - 1} 楼`;
            let label = fallback;
            try {
                label = EDITOR.POPUP_TYPE?.INPUT !== undefined
                    ? await EDITOR.callGenericPopup('给书签起个名字（会存下所有人现在的状态）', EDITOR.POPUP_TYPE.INPUT, fallback)
                    : window.prompt('给书签起个名字', fallback);
            } catch (_) { }
            if (label === null || label === false || label === undefined) return;
            const bm = CS.addBookmark(String(label));
            EDITOR.success?.(`已存书签「${bm?.label || label}」`);
            return render(false);
        }
        case 'bm-del': {
            if (ui.bookmark) CS.deleteBookmark(ui.bookmark);
            ui.bookmark = '';
            return render(false);
        }
        case 'condense': {
            const found = itemMap.get(t.dataset.key);
            if (!found) return;
            const { item, section } = found;
            const ok = await ACT.condenseField({ primary: p.primary, sheetUid: section.uid, rowIndex: item.rowIndex, col: item.col, label: item.label, value: item.value });
            if (ok) schedule(0);
            return;
        }
        case 'alias': return setAlias(t.dataset.orphan, t.dataset.to);
    }
}

/** 把对不上的名字写成某人的外号（主名|外号），确认后才改表 */
async function setAlias(orphan, to) {
    if (!orphan || !to) return;
    const ok = await EDITOR.callGenericPopup(`把「${esc(orphan)}」设为「${esc(to)}」的外号？<br>会写进角色表的名字格（${esc(to)}|${esc(orphan)}）。`, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: '设为外号', cancelButton: '取消' });
    if (!ok) return;
    try {
        const { piece: tablePiece } = BASE.getLastSheetsPiece();
        const { piece: currentPiece } = USER.getChatPiece();
        if (!currentPiece) return EDITOR.error('没有可以保存表格的 AI 消息，请先聊一轮');
        const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(tablePiece));
        const home = model?.byPrimary.get(to)?.home;
        const candidates = [sheets.find(s => s.uid === home?.uid), ...sheets.filter(isNameKeyedSheet)].filter(Boolean);
        let done = false;
        for (const sheet of candidates) {
            const found = findRowByName(sheet, to, { allowAlias: false });
            if (found.rowIndex === -1) continue;
            writeRowValues(sheet, found.rowIndex, { 0: `${to}|${orphan}` }, true);
            done = true;
            break;
        }
        if (!done) return EDITOR.warning(`角色表里没找到「${to}」`);
        sheets.forEach(s => s.save(currentPiece, true));
        await USER.saveChat();
        try {
            const { updateSheetsView } = await import('../../index.js');
            await updateSheetsView();
        } catch (_) { schedule(0); }
        EDITOR.success(`已把「${orphan}」设为「${to}」的外号`);
    } catch (error) {
        EDITOR.error('设为外号失败', error?.message || String(error), error);
    }
}

/** 正文里状态标签的「🌡️陈映竹数据」那行：点了打开她的卡 */
function tagSummaryName(el) {
    const text = clean(el.textContent).replace(/^[\s\p{Extended_Pictographic}\p{S}\p{P}‍️]+/u, '');
    const m = text.match(/^(.+?)的?(?:状态)?数据/) || text.match(/(\S+?)数据/);
    return m ? clean(m[1]) : '';
}

function markTagSummaries() {
    document.querySelectorAll('#chat .mes_text summary:not(.v2cc-taglink)').forEach(el => {
        if (el.closest(`#${ID}`)) return;
        const name = tagSummaryName(el);
        if (name && resolveName(name)) el.classList.add('v2cc-taglink');
    });
}

function onSummaryClick(e) {
    const el = e.target.closest?.('summary');
    if (!el || el.closest(`#${ID}`) || !el.closest('#chat .mes_text')) return;
    const name = tagSummaryName(el);
    if (!name || !model || !resolveName(name)) return;
    e.preventDefault();
    openCharacterCard(name);
}

function capture(id, onlyWithTag = false) {
    const index = Number(id);
    if (!Number.isInteger(index) || index < 0) return;
    // 渲染事件（包括打开聊天时渲染旧楼层）只在这一楼真有状态标签时才存：
    // 旧楼层的标签可能已被正则删掉，这时不能把存档里那一楼的数据当成「没了」清掉
    if (onlyWithTag) {
        const mes = String(USER.getContext()?.chat?.[index]?.mes ?? '');
        if (!mes.includes(`<${CS.statusConfig().tag}`)) {
            if (index >= chatLength() - 2) {
                model = buildModel();
                CS.markPresent(index, [...model.present]);
                CS.saveSoon();
            }
            return;
        }
    }
    model = buildModel();
    const recent = index >= chatLength() - 2;
    CS.captureFromMessage(index, model.names, recent ? [...model.present] : []);
}

// ---------------------------------------------------------------- 对外

/** 注册酒馆事件；所有回调都包了 try/catch，不往酒馆抛错 */
export function initCharacterCard() {
    if (inited) return;
    inited = true;
    const types = APP.event_types || {};
    const on = (name, fn) => {
        const type = types[name];
        if (!type || !APP.eventSource?.on) return;
        APP.eventSource.on(type, (...args) => {
            try { fn(...args); } catch (error) { console.warn(`[v2 资料卡] ${name} 处理失败`, error); }
        });
    };
    const guard = () => enabled();
    on('CHARACTER_MESSAGE_RENDERED', (id) => { if (!guard()) return removeRoot(); capture(id, true); schedule(); });
    on('MESSAGE_SWIPED', (id) => { if (!guard()) return; capture(id); schedule(); });
    on('MESSAGE_EDITED', (id) => { if (!guard()) return; capture(id); schedule(); });
    on('MESSAGE_UPDATED', () => schedule());
    on('MESSAGE_DELETED', () => { if (guard()) CS.forgetFloor(chatLength()); schedule(); });
    on('CHAT_CHANGED', () => { ui = freshUi(); model = null; removeRoot(); schedule(150); });
    try { document.addEventListener('click', (e) => { try { onSummaryClick(e); } catch (_) { } }, true); } catch (_) { }
    schedule(200);
}

/** 重新渲染（表格变了之后由 index.js 调用） */
export function refreshCharacterCard() {
    schedule();
}

/** 展开资料卡，切到卡片页并选中这个人（外号也行） */
export function openCharacterCard(name) {
    try {
        if (!enabled()) return false;
        if (!model) model = buildModel();
        if (!select(name)) return false;
        render(false);
        root?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        return true;
    } catch (error) {
        console.warn('[v2 资料卡] 打开失败', error);
        return false;
    }
}
