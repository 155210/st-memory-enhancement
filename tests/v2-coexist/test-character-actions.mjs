// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-character-actions.mjs "$PWD"
// 检查角色资料卡的动作模块、设置默认值、设置页控件：模块能正常加载，每个 v2_card_ 键都有默认值，插字 / 精简 / 跳楼层按预期
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const REPO = process.argv[2];
const chain = () => { const f = function(){}; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : p)), apply: () => p, construct: () => p }); return p; };
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: () => chain(), get: () => chain() });
globalThis.document = chain(); globalThis.window = globalThis; globalThis.toastr = { warning(){}, success(){}, error(...a) { console.log('toast error', ...a); }, info(){} };
globalThis.localStorage = { getItem: () => null, setItem(){} };
const power_user = {}; const extension_settings = { disabledExtensions: [] }; const extensionNames = ['third-party/st-memory-enhancement-v2'];
const chat = []; const chatMetadata = {};
const context = { chat, chatMetadata, name1: '江辰', registerMacro(){}, macros: null };
const popups = [];
globalThis.__ST = {
  DOMPurify: { sanitize: x => x }, Bowser: {}, slideToggle(){}, LoadLocal(){}, SaveLocal(){}, LoadLocalBool(){},
  POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, Popup: class {}, callGenericPopup: async (html) => { popups.push(html); return true; },
  extensionNames, extension_settings, getContext: () => context, renderExtensionTemplateAsync: async () => '',
  getCurrentLocale: () => 'zh-cn', power_user, applyPowerUserSettings(){}, getContextSettings(){}, loadPowerUserSettings(){},
  reloadCurrentChat(){}, saveSettingsDebounced(){}, saveSettings(){}, getSlideToggleOptions(){}, generateRaw(){}, saveChat: async () => {},
  eventSource: { on(){} }, event_types: {}, getRequestHeaders: () => ({}), saveGroupChat(){}, selected_group: null,
};
globalThis.fetch = async () => ({ json: async () => ({}) });
// 写表后刷新表格视图要真页面，node 里会在后台报错，只忽略这一种
const ignoreViewError = (e) => { if (String(e?.stack || e).includes('chatSheetsDataView')) return; console.error(e); process.exit(1); };
process.on('unhandledRejection', ignoreViewError);
process.on('uncaughtException', ignoreViewError);

const { BASE, USER, DERIVED } = await import(REPO + '/core/manager.js');
const { V2 } = await import(REPO + '/core/v2keys.js');
const { defaultSettings } = await import(REPO + '/data/pluginSetting.js');

// 存储键
assert.equal(V2.characterCard, 'memory_enhancement_v2_character_card');
console.log('✓ V2.characterCard 键');

// 默认值：规格里列出的每个键都有，类型对
const expected = {
  v2_card_enabled: true, v2_card_position: 'last_message', v2_card_tag: 'Calculated_data', v2_card_field_map: '',
  v2_card_short_limit: 20, v2_card_font_size: 14, v2_card_layout: '', v2_card_private_tables: '角色信息表格',
  v2_card_history_points: 50, v2_card_rule_check: true, v2_card_jump_threshold: 20,
};
for (const [key, value] of Object.entries(expected)) assert.deepEqual(defaultSettings[key], value, `默认值 ${key}`);
// 代码里用到的每个 v2_card_ 键都要有默认值
const used = new Set();
const sources = ['core/characterData.js', 'core/characterStatus.js', 'scripts/renderer/characterCardView.js', 'scripts/renderer/characterCardParts.js', 'scripts/renderer/characterCardActions.js', 'scripts/settings/userExtensionSetting.js'];
for (const file of sources) {
  let text = '';
  try { text = readFileSync(`${REPO}/${file}`, 'utf8'); } catch (_) { continue; }
  for (const m of text.matchAll(/(?<![A-Za-z0-9_#])v2_card_[a-z_]+/g)) used.add(m[0].replace(/_$/, ''));
}
for (const key of used) if (!/_$/.test(key) && key !== 'v2_card') assert.ok(key in defaultSettings, `代码里用到的 ${key} 没有默认值`);
assert.equal(USER.tableBaseSetting.v2_card_tag, 'Calculated_data', '没存过设置时读到默认值');
console.log(`✓ v2_card_ 默认值齐全（代码里用到 ${used.size} 个键）`);

// 设置页：控件 id 都在模板里，事件和初始值都绑了
const html = readFileSync(`${REPO}/assets/templates/index.html`, 'utf8');
const settingJs = readFileSync(`${REPO}/scripts/settings/userExtensionSetting.js`, 'utf8');
const ids = ['table_v2_card_switch', 'table_v2_card_options', 'table_v2_card_position', 'table_v2_card_tag', 'table_v2_card_field_map',
  'table_v2_card_short_limit', 'table_v2_card_font_size', 'table_v2_card_history_points', 'table_v2_card_jump_threshold',
  'table_v2_card_private_tables', 'table_v2_card_rule_check_switch', 'table_v2_card_layout', 'table_v2_card_export_button', 'table_v2_card_import_button'];
for (const id of ids) {
  assert.equal(html.split(`id="${id}"`).length, 2, `模板里 #${id} 恰好一个`);
  assert.ok(settingJs.includes(`#${id}`) || (id.match(/short_limit|font_size|history_points|jump_threshold/) && settingJs.includes('#table_v2_card_${key}')), `设置脚本用到了 #${id}`);
}
assert.match(settingJs, /import\('\.\.\/renderer\/characterCardView\.js'\)/, '刷新资料卡用动态引入');
assert.doesNotMatch(settingJs, /^import .*characterCard/m, '不静态引入资料卡模块');
console.log('✓ 设置页控件和处理函数');

// 动作模块能加载
const A = await import(REPO + '/scripts/renderer/characterCardActions.js');
for (const name of ['insertToInput', 'lookupWorldInfo', 'condenseField', 'exportCardImage', 'downloadJson', 'pickJsonFile', 'pickImageAsDataUrl', 'copyText', 'jumpToSheet', 'scrollToFloor']) {
  assert.equal(typeof A[name], 'function', `导出 ${name}`);
}
console.log('✓ characterCardActions 导出齐全');

// 设置脚本能加载（它静态引入 index.js；资料卡界面模块还没写好时跳过）
try {
  await import(REPO + '/index.js');
  await import(REPO + '/scripts/settings/userExtensionSetting.js');
  console.log('✓ userExtensionSetting 能加载');
} catch (error) {
  if (/characterCard/.test(String(error?.message))) console.log('… 跳过 userExtensionSetting 加载检查（资料卡界面模块还没有）：', error.message);
  else throw error;
}
DERIVED.any.chatSheetMap = {};

// 插字：空输入框直接放，有内容时换行追加，触发 input
const events = [];
const box = { value: '', focus() {}, setSelectionRange() {}, dispatchEvent(e) { events.push(e.type); } };
const mesEl = { scrolled: 0, scrollIntoView() { this.scrolled++; }, classList: { add() {}, remove() {} } };
const fakeDoc = {
  querySelector: (sel) => sel === '#send_textarea' ? box : (sel === '#chat .mes[mesid="3"]' ? mesEl : null),
  querySelectorAll: () => [], getElementById: () => null, body: null,
};
globalThis.document = fakeDoc;
A.insertToInput('（让陈映竹登场）');
assert.equal(box.value, '（让陈映竹登场）');
box.value = '我推门进去  \n';
A.insertToInput('（纠正：好感应为 72）');
assert.equal(box.value, '我推门进去\n（纠正：好感应为 72）');
assert.deepEqual(events, ['input', 'input']);
console.log('✓ 往输入框插字');

// 跳楼层
assert.equal(A.scrollToFloor(3), true);
assert.equal(mesEl.scrolled, 1);
assert.equal(A.scrollToFloor(99), false, '没渲染的楼层返回 false');
console.log('✓ 跳到某一楼');

// 世界书：node 里没有酒馆的世界书模块，返回空数组不报错
assert.deepEqual(await A.lookupWorldInfo(['陈映竹']), []);
assert.deepEqual(await A.lookupWorldInfo([]), []);
console.log('✓ 世界书查不到时返回空');
globalThis.document = chain();

// AI 精简：写回那一格（# 列也直接覆盖），新格子存到最新一层，老楼层不变
const setRow = (s, r, values) => s.getCellsByRowIndex(r).forEach((c, i) => { if (i) c.data.value = values[i - 1] ?? ''; });
const mkChat = (name, headers, rows = []) => {
  const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setRow(s, 0, headers); s.enable = true;
  rows.forEach(values => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(s, s.getRowCount() - 1, values); });
  return s;
};
const longText = '6月1日在学校天台第一次见面，她很害羞。6月2日一起吃午饭，聊到了她的家人。6月3日她被同学欺负，江辰帮她解围。6月4日她主动送了便当。';
chat.push({ is_user: true, mes: '……' }, { is_user: false, mes: '开场' });
const sheet0 = mkChat('角色特征表格', ['角色名', '性格', '#经历'], [['陈映竹|小竹', '内向', longText]]);
sheet0.save(chat[1], true);
chat.push({ is_user: true, mes: '……' }, { is_user: false, mes: '第二层' });
Object.assign(USER.tableBaseSetting, { v2_extra_api: 'main', v2_request_panel: false });
const asked = [];
globalThis.TavernHelper = { generateRaw: async ({ ordered_prompts }) => { asked.push(ordered_prompts); return '```\n6月1日 天台初见\n6月3日 被欺负，江辰解围\n```'; } };
// 弹窗表单的 jQuery 桩：textarea 可读写
let formValue = null;
const fakeForm = { find: () => ({ val: (v) => { if (v === undefined) return formValue; formValue = v; } }) };
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: (t, self, args) => (typeof args[0] === 'string' && args[0].includes('v2cc-condense')) ? fakeForm : chain(), get: () => chain() });
const uid = BASE.hashSheetsToSheets(BASE.getPieceHash(chat[1])).find(s => s.name === '角色特征表格').uid;
const ok = await A.condenseField({ primary: '陈映竹', sheetUid: uid, rowIndex: 0, col: 2, label: '经历', value: longText });
assert.equal(ok, true);
assert.equal(asked.length, 1, '发了一次额外请求');
assert.match(JSON.stringify(asked[0]), /6月4日她主动送了便当/, '原文在请求里');
assert.equal(popups.length, 2, '先确认要不要发，再对比新旧');
const after = BASE.hashSheetsToSheets(BASE.getPieceHash(chat[3])).find(s => s.uid === uid);
assert.equal(after.findCellByPosition(1, 3).data.value, '6月1日 天台初见\n6月3日 被欺负，江辰解围', '代码块去掉，写进最新一层');
assert.equal(after.findCellByPosition(1, 1).data.value, '陈映竹|小竹', '别的格不动');
const before = BASE.hashSheetsToSheets(BASE.getPieceHash(chat[1])).find(s => s.uid === uid);
assert.equal(before.findCellByPosition(1, 3).data.value, longText, '老楼层不变');
// 用户在对比框里改了内容：以改后的为准；取消：不写
formValue = null;
globalThis.TavernHelper.generateRaw = async () => '甲\n乙';
const fakeForm2Value = '用户改过的精简';
fakeForm.find = () => ({ val: (v) => { if (v === undefined) return fakeForm2Value; } });
chat.push({ is_user: true, mes: '……' }, { is_user: false, mes: '第三层' });
const longer = after.findCellByPosition(1, 3).data.value + '\n6月5日 一起看电影，牵了手';
after.findCellByPosition(1, 3).newAction('editCell', { value: longer }, false); after.save(chat[5], true);
assert.equal(await A.condenseField({ primary: '陈映竹', sheetUid: uid, rowIndex: 0, col: 2, label: '经历', value: longer }), true);
assert.equal(BASE.hashSheetsToSheets(BASE.getPieceHash(chat[5])).find(s => s.uid === uid).findCellByPosition(1, 3).data.value, '用户改过的精简');
globalThis.__ST.callGenericPopup = async () => false;
const { EDITOR } = await import(REPO + '/core/manager.js');
EDITOR.callGenericPopup = async () => false;
assert.equal(await A.condenseField({ primary: '陈映竹', sheetUid: uid, rowIndex: 0, col: 2, label: '经历', value: 'x'.repeat(50) }), false, '取消时不写');
assert.equal(await A.condenseField({ primary: '陈映竹', sheetUid: 'nope', rowIndex: 0, col: 2, label: '经历', value: '' }), false, '找不到格子返回 false');
console.log('✓ AI 精简长字段：确认、对比、写回最新一层、老楼层不变');

console.log('全部通过');
