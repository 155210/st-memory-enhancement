// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-summary.mjs "$PWD"
// 检查大总结交给程序管：事件满了写大总结、逐级压缩进归档、往事、召回、几天前、AI 指令拦截、老档迁移
import assert from 'node:assert/strict';
const REPO = process.argv[2];
const chain = () => { const f = function(){}; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : p)), apply: () => p, construct: () => p }); return p; };
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: () => chain(), get: () => chain() });
globalThis.document = chain(); globalThis.window = globalThis; globalThis.toastr = { warning(){}, success(){}, error(...a) { console.log('toast error', ...a); }, info(){} };
globalThis.localStorage = { getItem: () => null, setItem(){} };
const power_user = {}; const extension_settings = { disabledExtensions: [] }; const extensionNames = ['third-party/st-memory-enhancement-v2'];
const chat = []; const chatMetadata = {};
const context = { chat, chatMetadata, name1: '江辰', registerMacro(){}, macros: null };
globalThis.__ST = {
  DOMPurify: { sanitize: x => x }, Bowser: {}, slideToggle(){}, LoadLocal(){}, SaveLocal(){}, LoadLocalBool(){},
  POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, Popup: class {}, callGenericPopup: async () => true,
  extensionNames, extension_settings, getContext: () => context, renderExtensionTemplateAsync: async () => '',
  getCurrentLocale: () => 'zh-cn', power_user, applyPowerUserSettings(){}, getContextSettings(){}, loadPowerUserSettings(){},
  reloadCurrentChat(){}, saveSettingsDebounced(){}, saveSettings(){}, getSlideToggleOptions(){}, generateRaw(){}, saveChat: async () => {},
  eventSource: { on(){} }, event_types: {}, getRequestHeaders: () => ({}), saveGroupChat(){}, selected_group: null,
};
globalThis.fetch = async () => ({ json: async () => ({}) });

const { BASE, USER, DERIVED } = await import(REPO + '/core/manager.js');
await import(REPO + '/index.js');
const SM = await import(REPO + '/core/summaryManager.js');
DERIVED.any.chatSheetMap = {};

Object.assign(USER.tableBaseSetting, { v2_summary_enabled: true, v2_summary_event_threshold: 3, v2_summary_batch: 2, v2_summary_keep: 1, v2_summary_recall_count: 5, use_main_api: true });

const setRow = (s, r, values) => s.getCellsByRowIndex(r).forEach((c, i) => { if (i) c.data.value = values[i - 1] ?? ''; });
const mkChat = (name, headers, rows = []) => {
  const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setRow(s, 0, headers); s.enable = true;
  rows.forEach(values => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(s, s.getRowCount() - 1, values); });
  return s;
};
const dump = (s) => { const out = []; for (let r = 1; r < s.getRowCount(); r++) out.push(s.getCellsByRowIndex(r).slice(1).map(c => c.data.value ?? '')); return out; };
const load = (piece) => { const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(piece)); const by = n => sheets.find(s => s.name === n); return { sheets, by }; };
const addEvents = (piece, target, list) => { const { sheets, by } = load(piece); const ev = by('事件历史'); list.forEach(values => { ev.findCellByPosition(ev.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(ev, ev.getRowCount() - 1, values); }); sheets.forEach(s => s.save(target, true)); };
const pushFloor = (mes) => { chat.push({ is_user: true, mes: '……' }); chat.push({ is_user: false, mes }); return chat.length - 1; };

// 模型桩：记录请求；等待期间把共用的表格实例换成空表，模拟别处在读别的楼层
const asked = [];
SM.summaryHooks.ask = async (system, prompt) => {
  asked.push({ system, prompt });
  BASE.hashSheetsToSheets({});
  if (system.includes('大总结')) {
    const n = asked.length;
    return `<think>想想</think><summary>2025年6月1${n}日/学校/林悠悠和陈默第${n}件事→结果${n}</summary>\n<past>\n林悠悠：第${n}次经历\n路人甲：不在表里\n</past>`;
  }
  return `<summary>压缩：${prompt.split('\n').length}条</summary>`;
};

// 初始表格存在第 1 层
const f1 = pushFloor('开场');
const sheets0 = [
  mkChat('角色特征表格', ['角色名', '性格', '#往事'], [['林悠悠|悠悠', '开朗', ''], ['陈默', '冷淡', ''], ['苏晴', '温柔', '']]),
  mkChat('事件历史', ['事件', '日期', '地点', '情绪'], []),
  mkChat('大总结', ['内容', '层级', '楼层范围', '涉及角色'], []),
  mkChat('总结归档', ['内容', '层级', '楼层范围', '涉及角色'], []),
];
sheets0.forEach(s => s.save(chat[f1], true));

// 事件不够：什么都不做
const f2 = pushFloor('第二层');
addEvents(chat[f1], chat[f2], [['悠悠对陈默说早安', '2025-06-10', '学校', '开心'], ['陈默无视了悠悠', '2025-06-10', '学校', '冷']]);
assert.deepEqual(await SM.runSummaryPipeline(chat[f2], f2), []);
assert.equal(asked.length, 0);

// 第 3 条事件 → 一条大总结
const f3 = pushFloor('第三层');
addEvents(chat[f2], chat[f3], [['林悠悠哭了', '2025-06-11', '天台', '难过']]);
let log = await SM.runSummaryPipeline(chat[f3], f3);
assert.equal(log.length, 1, log.join());
let t = load(chat[f3]);
assert.deepEqual(dump(t.by('事件历史')), [], '事件写成大总结后清空');
assert.deepEqual(dump(t.by('大总结')), [['2025年6月11日/学校/林悠悠和陈默第1件事→结果1', '大', `0-${f3}`, '林悠悠|陈默']]);
assert.equal(dump(t.by('角色特征表格'))[0][2], '第1次经历', '往事写进角色表，不在表里的人跳过');
assert.equal(dump(load(chat[f2]).by('事件历史')).length, 2, '上一层的事件不受影响，可以回退');

// 重 roll 第 3 层：同样输入不再请求，楼层范围不变
const before = asked.length;
addEvents(chat[f2], chat[f3], [['林悠悠哭了', '2025-06-11', '天台', '难过']]);
log = await SM.runSummaryPipeline(chat[f3], f3);
assert.equal(asked.length, before, '缓存命中');
assert.equal(dump(load(chat[f3]).by('大总结'))[0][2], `0-${f3}`);

// 再来两轮：第 3 条大总结出现时，最早 2 条压成「卷」，原文进归档，最近 1 条不压
let last = f3;
for (let round = 0; round < 2; round++) {
  const f = pushFloor('又一层');
  addEvents(chat[last], chat[f], [['陈默帮苏晴搬书', '2025-06-12', '图书馆', '平静'], ['苏晴道谢', '2025-06-12', '图书馆', '开心'], ['陈默离开', '2025-06-12', '走廊', '平静']]);
  log = await SM.runSummaryPipeline(chat[f], f);
  last = f;
}
console.log(log);
t = load(chat[last]);
const summary = dump(t.by('大总结'));
assert.equal(summary.length, 2, JSON.stringify(summary));
assert.equal(summary[0][1], '卷');
assert.equal(summary[0][0], '压缩：2条');
assert.equal(summary[0][2], `0-${f3 + 2}`, '卷的楼层范围合并');
assert.equal(summary[1][1], '大');
assert.equal(summary[1][2], `${f3 + 3}-${last}`, '楼层范围从上次大总结的下一层开始');
const archive = dump(t.by('总结归档'));
assert.equal(archive.length, 2);
assert.equal(archive[0][1], '大', '原文一字不改进归档');
assert.equal(dump(t.by('角色特征表格'))[0][2], '第1次经历；第4次经历；第5次经历'.replace('第4次', `第${asked.filter(a => a.system.includes('大总结')).length - 1}次`).replace('第5次', `第${asked.filter(a => a.system.includes('大总结')).length}次`), '往事追加');
console.log('✓ 事件满了写大总结、楼层范围、往事、缓存、逐级压缩进归档、回退不受影响');

// AI 指令拦截
const by = load(chat[last]).by;
assert.equal(SM.shouldIgnoreAiEdit(by('大总结'), 'insert'), true);
assert.equal(SM.shouldIgnoreAiEdit(by('大总结'), 'update'), false);
assert.equal(SM.shouldIgnoreAiEdit(by('事件历史'), 'delete'), true);
assert.equal(SM.shouldIgnoreAiEdit(by('事件历史'), 'insert'), false);
assert.equal(SM.shouldIgnoreAiEdit(by('角色特征表格'), 'delete'), false);
console.log('✓ 只拦 AI 对大总结的增删、对事件的删除');

// 召回、几天前
chat.push({ is_user: true, mes: '去找陈默' });
chat.push({ is_user: false, mes: '『2025年6月15日-星期日–18:15-城南安置房7栋6楼走廊-闷热』走廊里…『2025年6月18日-星期三–20:00-学校天台-晴』陈默站在天台' });
const all = load(chat[last]).sheets;
const recall = SM.buildRecallBlock(all);
assert.match(recall, /相关旧事/);
assert.equal(recall.split('\n').filter(l => l.startsWith('- ')).length, 2);
const now = SM.currentStoryDate(all);
assert.equal(now.getDate(), 18, '同一轮多个时间标签取最后一个');
assert.equal(SM.annotateRelativeDates('2025年6月11日/学校/事', now), '2025年6月11日（7天前）/学校/事');
assert.equal(SM.annotateRelativeDates('2025年6月20日/未来', now), '2025年6月20日/未来');
assert.equal(SM.isArchiveSheet(by('总结归档')), true);
console.log('✓ 按人名召回归档、时间标签取最后一个、几天前');

// 发给 AI 的表格：不含归档表，大总结带几天前，末尾附旧事
const { getTablePromptByPiece, parseTableEditTag } = await import(REPO + '/index.js');
const prompt = getTablePromptByPiece(chat[last]);
assert.doesNotMatch(prompt, /总结归档/);
assert.match(prompt, /天前）/);
assert.match(prompt, /相关旧事/);
assert.equal(getTablePromptByPiece(chat[last], true).includes('相关旧事'), false, '纯数据（分步填表、重整理）不附旧事');
// 实时收到的消息里 AI 想插大总结、删事件：跳过；改角色照常
const bigBefore = dump(load(chat[last]).by('大总结')).length;
const msg = { is_user: false, mes: '正文<tableEdit>\n<!--\ninsertRow(2, {"0":"AI 自己写的大总结"})\ninsertRow(1, {"0":"事件A"})\nupdateRow(0, 1, {"1":"变温柔了"})\n-->\n</tableEdit>' };
chat.push({ is_user: true, mes: '嗯' }); chat.push(msg);
parseTableEditTag(msg, -1, true);
const live = load(msg);
assert.equal(dump(live.by('大总结')).length, bigBefore, 'AI 的大总结插入被跳过');
assert.equal(dump(live.by('事件历史')).at(-1)[0], '事件A', '事件照常插入');
assert.equal(dump(live.by('角色特征表格'))[1][1], '变温柔了');
console.log('✓ 发送时去掉归档表并附旧事；实时消息里只拦大总结的增删');

// 老档迁移：只有「内容」的 44 条旧大总结
DERIVED.any.chatSheetMap = {};
chat.length = 0; Object.keys(chatMetadata).forEach(k => delete chatMetadata[k]); asked.length = 0;
const g1 = pushFloor('老档');
const old = [
  mkChat('角色特征表格', ['角色名', '性格'], [['林悠悠', '开朗'], ['陈默', '冷']]),
  mkChat('事件历史', ['事件', '日期', '地点', '情绪'], []),
  mkChat('大总结', ['内容', '层级', '楼层范围', '涉及角色'], Array.from({ length: 7 }, (_, i) => [`第${i}条/林悠悠${i % 2 ? '和陈默' : ''}`])),
  mkChat('总结归档', ['内容', '层级', '楼层范围', '涉及角色'], []),
];
old.forEach(s => s.save(chat[g1], true));
const g2 = pushFloor('最新');
const preview = await SM.migrateOldSummaries(true);
assert.deepEqual(preview.missing, []);
assert.equal(preview.total, 7);
const result = await SM.migrateOldSummaries();
assert.equal(result.filled, 7);
assert.equal(result.log.length, 4, result.log.join());   // 7 条大：压 3 组（留 1）→ 3 条卷：再压 1 组成篇
t = load(chat[g2]);
const after = dump(t.by('大总结'));
console.log(after);
assert.deepEqual(after.map(r => r[1]), ['篇', '卷', '大']);
assert.equal(dump(t.by('总结归档')).length, 8);
assert.equal(dump(t.by('总结归档'))[0][2], '迁移前');
assert.equal(dump(load(chat[g1]).by('大总结'))[0][1], '', '老楼层的快照不变');
console.log('✓ 老档迁移：补层级和楼层范围、连续压缩、老楼层不变');
