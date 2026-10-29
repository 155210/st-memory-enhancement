// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-rows.mjs "$PWD"
// 检查角色类表按名字去重、外号、列写入规则
import assert from 'node:assert/strict';
const REPO = process.argv[2];
const chain = () => { const f = function(){}; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : p)), apply: () => p, construct: () => p }); return p; };
const readyFns = [];
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: (t, self, [a]) => { if (typeof a === 'function') { readyFns.push(a); return chain(); } return chain(); }, get: () => chain() });
globalThis.document = chain(); globalThis.window = globalThis; globalThis.toastr = { warning: (...a) => toasts.push(a), success(){}, error(){}, info(){} };
globalThis.localStorage = { getItem: () => null, setItem(){} };
const toasts = [];
const power_user = {}; const extension_settings = { disabledExtensions: [] }; const extensionNames = ['third-party/st-memory-enhancement-v2'];
const chat = []; const chatMetadata = {};
const context = { chat, chatMetadata, registerMacro(){}, macros: null };
let popupAnswer = true;
globalThis.__ST = {
  DOMPurify: { sanitize: x => x }, Bowser: {}, slideToggle(){}, LoadLocal(){}, SaveLocal(){}, LoadLocalBool(){},
  POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, Popup: class {}, callGenericPopup: async () => popupAnswer,
  extensionNames, extension_settings, getContext: () => context, renderExtensionTemplateAsync: async () => '',
  getCurrentLocale: () => 'zh-cn', power_user, applyPowerUserSettings(){}, getContextSettings(){}, loadPowerUserSettings(){},
  reloadCurrentChat(){}, saveSettingsDebounced(){}, saveSettings(){}, getSlideToggleOptions(){}, generateRaw(){}, saveChat: async () => {},
  eventSource: { on(){} }, event_types: {}, getRequestHeaders: () => ({}), saveGroupChat(){}, selected_group: null,
};
globalThis.fetch = async () => ({ json: async () => ({}) });

const { BASE, USER, DERIVED } = await import(REPO + '/core/manager.js');
const { V2, ORIGINAL } = await import(REPO + '/core/v2keys.js');
const coexist = await import(REPO + '/core/v2coexist.js');
await import(REPO + '/index.js');

DERIVED.any.chatSheetMap = {};

const { executeTableEditActions } = await import(REPO + '/index.js');
const rows = await import(REPO + '/core/rowIdentity.js');
DERIVED.any.chatSheetMap = {};
for (let i = 0; i < 2; i++) chat.push({ is_user: i % 2 === 0, mes: 'm' + i });
const mk = (name, headers) => { const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; s.getCellsByRowIndex(0).forEach((c, i) => { if (i) c.data.value = headers[i - 1]; }); s.enable = true; s.save(chat[1], true); return s; };
const people = mk('角色特征表格', ['角色名', '性格', '#经历', '!初见地点']);
const events = mk('事件历史', ['事件', '日期']);
const dump = (s) => { const out = []; for (let r = 1; r < s.getRowCount(); r++) out.push(s.getCellsByRowIndex(r).slice(1).map(c => c.data.value ?? '')); return out; };
const run = (...lines) => executeTableEditActions(lines, null);

run('insertRow(0, {0:"林雪|小雪", 1:"冷淡", 2:"入学", 3:"图书馆"})');
run('insertRow(0, {0:"苏晴", 1:"开朗", 2:"", 3:"医院"})');
assert.equal(dump(people).length, 2);
// 同主名再插入 → 更新，外号合并，空值不覆盖，# 追加，! 不覆盖
run('insertRow(0, {0:"林雪|雪儿|师姐", 1:"", 2:"被救", 3:"操场"})');
let d = dump(people);
assert.equal(d.length, 2, '同名不该多一行');
assert.deepEqual(d[0], ['林雪|小雪|雪儿', '冷淡', '入学；被救', '图书馆']);
console.log('✓ 同名 insertRow 改为更新；外号合并、通称不进外号；空值不覆盖；# 追加；! 只填一次');
// 用外号 insert 不合并（K1）
run('insertRow(0, {0:"小雪", 1:"x"})');
assert.equal(dump(people).length, 3);
console.log('✓ 只用外号的 insertRow 不合并');
// 外号撞车：小雪现在既是林雪的外号又是第三行主名 → 按主名命中第三行
run('updateRow(0, {0:"小雪", 1:"y"})');
assert.equal(dump(people)[2][1], 'y');
// 两人共享外号「阿雪」→ 只写外号的更新跳过
run('updateRow(0, 0, {0:"林雪|阿雪"})', 'updateRow(0, 1, {0:"苏晴|阿雪"})');
const before = JSON.stringify(dump(people));
run('updateRow(0, {0:"阿雪", 1:"改坏"})');
assert.equal(JSON.stringify(dump(people)), before);
console.log('✓ 外号对上两个人时跳过更新');
// 漏写行号、按名字找（P3）
run('updateRow(0, {0:"苏晴", 1:"温柔"})');
assert.equal(dump(people)[1][1], '温柔');
assert.equal(dump(people)[0][1], '冷淡', '第 0 行不该被改');
// 行号和名字对不上 → 按名字
run('updateRow(0, 0, {0:"苏晴", 1:"体贴"})');
assert.equal(dump(people)[1][1], '体贴'); assert.equal(dump(people)[0][1], '冷淡');
// 行号越界 → 按名字找
run('updateRow(0, 99, {0:"林雪", 1:"傲娇"})');
assert.equal(dump(people)[0][1], '傲娇'); assert.equal(dump(people).length, 3);
// 名字不在表里、行号指向别人 → 插入新角色
run('updateRow(0, 0, {0:"王芳", 1:"安静"})');
assert.equal(dump(people).length, 4); assert.equal(dump(people)[0][0].startsWith('林雪'), true);
console.log('✓ 漏写行号 / 行号越界 / 行号对不上都按名字找，找不到就新建');
// 非角色表照原版：没行号的 update 不再改第 0 行；允许清空
run('insertRow(1, {0:"开学", 1:"9月1日"})');
run('updateRow(1, {1:"9月2日"})');
assert.equal(dump(events)[0][1], '9月1日');
run('updateRow(1, 0, {1:""})');
assert.equal(dump(events)[0][1], '');
run('insertRow(1, {0:"开学", 1:"9月1日"})');
assert.equal(dump(events).length, 2, '非角色表不去重');
console.log('✓ 非角色表不去重、可清空、漏行号不改第 0 行');
assert.deepEqual(rows.parseNameCell('林雪 | 小雪 |小雪| 师姐'), { primary: '林雪', aliases: ['小雪'] });

// ---------- 老档迁移：合并已有的重复行 ----------
const legacy = mk('角色与<user>社交表格', ['角色名', '关系', '#往事']);
// 模拟原版留下的重复：直接插行，不走去重
const rawInsert = (s, vals) => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); s.getCellsByRowIndex(s.getRowCount() - 1).forEach((c, i) => { if (i) c.data.value = vals[i - 1] ?? ''; }); };
rawInsert(legacy, ['林雪', '同学', '入学']);
rawInsert(legacy, ['苏晴', '医生', '']);
rawInsert(legacy, ['林雪', '', '被救']);
rawInsert(legacy, ['林雪|小雪', '恋人', '']);
const report = rows.mergeDuplicateRows([legacy, events]);
assert.deepEqual(report, [{ sheet: '角色与<user>社交表格', name: '林雪', merged: 2 }]);
assert.deepEqual(dump(legacy), [['林雪|小雪', '恋人', '入学；被救'], ['苏晴', '医生', '']]);
console.log('✓ 迁移：重复行合并到最早一行，后面的删掉');
console.log('全部通过');
