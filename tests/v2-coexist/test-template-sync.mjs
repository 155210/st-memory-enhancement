// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-template-sync.mjs "$PWD"
// 检查把全局模板同步到老聊天：只改规则和表头、追加新列和新表，不动数据
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

const { syncChatSheetsWithTemplates } = await import(REPO + '/core/templateSync.js');
DERIVED.any.chatSheetMap = {};
for (let i = 0; i < 2; i++) chat.push({ is_user: i % 2 === 0, mes: 'm' + i });
const setHeaders = (s, headers) => s.getCellsByRowIndex(0).forEach((c, i) => { if (i) c.data.value = headers[i - 1]; });
const mkTemplate = (name, headers, rules) => { const t = new BASE.SheetTemplate(); t.domain = 'global'; t.createNewTemplate(headers.length + 1, 1, false); t.name = name; setHeaders(t, headers); Object.assign(t.source.data, rules); t.enable = true; t.save(); return t; };
const mkChat = (name, headers, rules) => { const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setHeaders(s, headers); Object.assign(s.source.data, rules); s.enable = true; return s; };
const dump = (s) => { const out = []; for (let r = 0; r < s.getRowCount(); r++) out.push(s.getCellsByRowIndex(r).slice(1).map(c => c.data.value ?? '')); return out; };
const people = mkChat('角色与<user>社交表格', ['角色名', '对<user>关系'], { note: '旧说明' });
people.findCellByPosition(0, 0).newAction('insertDownRow', {}, false);
people.getCellsByRowIndex(1).forEach((c, i) => { if (i) c.data.value = ['林雪', '同学'][i - 1]; });
const events = mkChat('事件历史', ['事件', '日期'], { insertNode: '旧插入规则' });
const odd = mkChat('重要物品表格', ['拥有人', '物品'], {});
const templates = [
  mkTemplate('角色与<user>社交表格', ['!角色名', '对<user>关系', '#对<user>的了解'], { note: '新说明' }),
  mkTemplate('事件历史', ['事件', '日期'], { insertNode: '新插入规则' }),
  mkTemplate('重要物品表格', ['物品名', '拥有人'], { note: 'x' }),
  mkTemplate('悬念簿', ['悬念', '状态'], { note: '伏笔' }),
];
const chatSheets = [people, events, odd];
const preview = syncChatSheetsWithTemplates(chatSheets, BASE.templates, true);
assert.deepEqual(dump(people), [['角色名', '对<user>关系'], ['林雪', '同学']], '预览不该改东西');
const report = syncChatSheetsWithTemplates(chatSheets, BASE.templates);
assert.deepEqual(report, preview);
console.log(report);
assert.deepEqual(dump(people), [['!角色名', '对<user>关系', '#对<user>的了解'], ['林雪', '同学', '']]);
assert.equal(people.data.note, '新说明');
assert.equal(events.data.insertNode, '新插入规则');
assert.deepEqual(dump(odd)[0], ['拥有人', '物品'], '列对不上时表头不动');
assert.equal(odd.data.note, 'x');
chatSheets.forEach(s => s.save(chat[1], true));
const names = BASE.getChatSheets().map(s => s.name);
assert.equal(names[names.length - 1], '悬念簿', '新表排最后');
console.log('✓ 规则同步、表头加标记、追加新列、新表排最后、列对不上只报告；数据不动');
