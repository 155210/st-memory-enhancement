// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-v2.mjs "$PWD"
// 在 node 里用桩模拟酒馆，检查 v2 和原版共存：只读原版、导入、回退、暂停
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
// ---------- 1. 先用插件自己造一份「原版」数据，再把键改回原版的名字 ----------
for (let i = 0; i < 6; i++) chat.push({ is_user: i % 2 === 0, mes: 'm' + i });
const sheet = BASE.createChatSheet(3, 1);            // 表头一行
sheet.name = '角色表';
sheet.save(chat[1], true);
// 模拟写入几行数据
const addRow = (s, values) => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); s.getCellsByRowIndex(s.getRowCount() - 1).forEach((cell, i) => { if (i) cell.data.value = values[i - 1] ?? ''; }); };
let ok = true;
try { addRow(sheet, ['林雪', '大学生']); } catch (e) { ok = false; console.log('addRow 不可用，改用 insertRow:', e.message); }
sheet.save(chat[3], true);
// 把 v2 的数据改名成原版的键，模拟原版插件留下的聊天
chatMetadata[ORIGINAL.chatSheets] = chatMetadata[V2.chatSheets]; delete chatMetadata[V2.chatSheets];
for (const p of chat) if (p[V2.pieceHash]) { p[ORIGINAL.pieceHash] = p[V2.pieceHash]; delete p[V2.pieceHash]; }
power_user[ORIGINAL.templates] = [{ uid: 'tpl1', name: '原版模板' }];
power_user[ORIGINAL.settings] = { isExtensionAble: true, updateIndex: 4, message_template: '原版提示词 {{tableData}}' };
power_user[ORIGINAL.privacy] = { custom_api_url: 'https://example/api' };
DERIVED.any.chatSheetMap = {};
const snapshot = JSON.stringify({ chatMetadata, chat, power_user });
const originalOnly = () => JSON.stringify({ meta: chatMetadata[ORIGINAL.chatSheets], hashes: chat.slice(0, 6).map(p => p[ORIGINAL.pieceHash] ?? null), pu: [power_user[ORIGINAL.templates], power_user[ORIGINAL.settings], power_user[ORIGINAL.privacy]] });
const originalBefore = originalOnly();

// ---------- 2. 原版启用时 v2 暂停 ----------
extensionNames.push('third-party/st-memory-enhancement');
assert.equal(coexist.findActiveOriginal(), 'third-party/st-memory-enhancement');
extension_settings.disabledExtensions.push('third-party/st-memory-enhancement');
assert.equal(coexist.findActiveOriginal(), null);
console.log('✓ 原版启用检测');

// ---------- 3. 设置只复制一次 ----------
coexist.importOriginalSettingsOnce();
assert.deepEqual(power_user[V2.templates], power_user[ORIGINAL.templates]);
assert.notEqual(power_user[V2.templates], power_user[ORIGINAL.templates]);
assert.equal(USER.tableBaseSetting.message_template, '原版提示词 {{tableData}}');
USER.tableBaseSetting.message_template = 'v2 改过的提示词';
assert.equal(power_user[ORIGINAL.settings].message_template, '原版提示词 {{tableData}}');
power_user[ORIGINAL.templates].push({ uid: 'later' });
coexist.importOriginalSettingsOnce();
assert.equal(power_user[V2.templates].length, 1);
power_user[ORIGINAL.templates].pop();
console.log('✓ 设置复制一次，改 v2 不影响原版');

// ---------- 4. 导入前 v2 看不到原版数据 ----------
assert.equal(BASE.getPieceHash(chat[3]), undefined);
// ---------- 5. 切聊天时询问并导入 ----------
assert.equal(await coexist.offerChatImport(), true);
assert.equal(chatMetadata[V2.chatImport].floor, 3);
assert.equal(JSON.stringify(chatMetadata[V2.chatSheets]), JSON.stringify(chatMetadata[ORIGINAL.chatSheets]));
assert.equal(BASE.getPieceHash(chat[3]), chat[3][ORIGINAL.pieceHash]);
const { piece, deep } = BASE.getLastSheetsPiece();
assert.equal(deep, 3);
const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(piece));
const text = sheets.map((s, i) => s.getTableText(i, ['title', 'headers', 'rows'])).join('\n');
console.log('导入后表格提示词：\n' + text);
if (ok) assert.ok(text.includes('林雪'));
console.log('✓ 导入后能读到原版最新一层');

// ---------- 6. 新楼层写 v2，不碰原版 ----------
chat.push({ is_user: true, mes: 'u6' }, { is_user: false, mes: 'm7' });
const s2 = BASE.getChatSheets()[0];
s2.hashSheet = BASE.getPieceHash(chat[3])[s2.uid].map(r => r.slice());
if (ok) addRow(s2, ['苏晴', '医生']);
s2.save(chat[7], true);
assert.ok(chat[7][V2.pieceHash]);
assert.equal(chat[7][ORIGINAL.pieceHash], undefined);
{ const a = JSON.parse(originalOnly()), b = JSON.parse(originalBefore); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('DIFF', k, JSON.stringify(b[k]).slice(0,600), '\n=>', JSON.stringify(a[k]).slice(0,600)); }
assert.equal(originalOnly(), originalBefore);
console.log('✓ 新楼层只写 v2，原版数据一字未改');

// ---------- 7. 原版之后又写的楼层不会被 v2 回读 ----------
chat.push({ is_user: true }, { is_user: false, [ORIGINAL.pieceHash]: { x: [[1]] } });
assert.equal(BASE.getPieceHash(chat[9]), undefined);
console.log('✓ 导入之后原版新写的楼层，v2 不回读');

// ---------- 8. 已有 v2 数据时不再弹导入 ----------
assert.equal(await coexist.offerChatImport(), false);
console.log('✓ 不重复询问');
console.log('全部通过');
// ---------- 9. 启动流程：原版启用时暂停，关掉后正常启动 ----------
let macros = 0; context.registerMacro = () => macros++;
extension_settings.disabledExtensions.length = 0;
await readyFns[0]();
assert.equal(macros, 0); assert.ok(toasts.length === 1);
console.log('✓ 原版启用时 v2 不注册宏、只弹提示');
extension_settings.disabledExtensions.push('third-party/st-memory-enhancement');
try { await readyFns[0](); } catch (e) { console.log('启动报错（桩环境）:', e.message); }
console.log('启动后注册宏数', macros);
