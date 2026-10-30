// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-tools.mjs "$PWD"
// 检查阶段 4：回填、融合沙盒、诊断导出、关系图、配色
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
const { applyTableEditText } = await import(REPO + '/index.js');
const { planBackfill, runBackfill } = await import(REPO + '/core/backfill.js');
const { selectFloors, insertFusion } = await import(REPO + '/core/fusion.js');
const { buildDiagnostics, installErrorCapture } = await import(REPO + '/core/diagnostics.js');
const { buildGraph, layoutGraph, renderGraphSvg } = await import(REPO + '/core/relationGraph.js');
const { V2 } = await import(REPO + '/core/v2keys.js');
const { EDITOR } = await import(REPO + '/core/manager.js');

const setRow = (s, r, values) => s.getCellsByRowIndex(r).forEach((c, i) => { if (i) c.data.value = values[i - 1] ?? ''; });
const mkChat = (name, headers, rows = []) => {
  const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setRow(s, 0, headers); s.enable = true;
  rows.forEach(values => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(s, s.getRowCount() - 1, values); });
  return s;
};
const dump = (s) => { const out = []; for (let r = 1; r < s.getRowCount(); r++) out.push(s.getCellsByRowIndex(r).slice(1).map(c => c.data.value ?? '')); return out; };
const load = (piece) => { const sheets = BASE.hashSheetsToSheets(BASE.getPieceHash(piece)); return { sheets, by: n => sheets.find(s => s.name === n) }; };

// 一个新导入的聊天：第 0 条是开场白，后面 7 轮，只有第 1 层有表格（空表）
chat.push({ is_user: false, mes: '开场白' });
for (let i = 1; i <= 7; i++) { chat.push({ is_user: true, mes: `用户${i}` }); chat.push({ is_user: false, mes: `『2025年6月${10 + i}日-星期一–18:15-学校-晴』林悠悠第${i}天${i === 3 ? '和陈默吵架' : ''}<tableEdit>旧的</tableEdit>` }); }
const empty = [
  mkChat('角色特征表格', ['角色名', '性格']),
  mkChat('事件历史', ['事件', '日期']),
  mkChat('大总结', ['内容', '层级', '楼层范围', '涉及角色']),
  mkChat('重要物品表格', ['拥有人', '物品'], [['林悠悠', '书包']]),
];
empty.forEach(s => s.save(chat[0], true));
// 只有空表的楼层不算已经填过：第 0 层有一行，第 4 层是 v2 收到消息时存的空表
{
  const blank = BASE.hashSheetsToSheets(BASE.getPieceHash(chat[0]));
  const piece = {};
  blank.forEach(s => s.save(piece, true));
  const emptied = JSON.parse(JSON.stringify(piece[V2.pieceHash]));
  Object.keys(emptied).forEach(uid => { emptied[uid] = emptied[uid].slice(0, 1); });
  chat[4][V2.pieceHash] = emptied;
}
assert.equal(planBackfill({ batch: 3 }).lastFilled, 0, '空表那层不挡住回填');
assert.equal(planBackfill({ batch: 3 }).lastEmpty, 4);
Object.assign(USER.tableBaseSetting, { v2_summary_enabled: true, v2_summary_event_threshold: 100, message_template: '规则：\n{{tableData}}' });

const plan = planBackfill({ batch: 3 });
assert.equal(plan.lastFilled, 0);
assert.equal(plan.start, 1);
assert.deepEqual(plan.batches.map(b => b.target), [6, 12, 14], '每 3 条 AI 回复一批，最后一批不满也算');
assert.deepEqual(plan.batches[0].floors, [1, 2, 3, 4, 5, 6]);

const asked = [];
SM.summaryHooks.ask = async (system, user) => {
  asked.push({ system, user });
  BASE.hashSheetsToSheets({});   // 模拟等待期间别处换了楼层
  const n = asked.length;
  return `<tableEdit>\n<!--\ninsertRow(0, {"0":"林悠悠","1":"开朗${n}"})\ninsertRow(1, {"0":"第${n}批的事","1":"6月"})\n-->\n</tableEdit>`;
};
let stopAfter = 2;
const result = await runBackfill(plan, applyTableEditText, { shouldStop: () => asked.length >= stopAfter });
assert.equal(result.done, 2);
assert.equal(result.stopped, true);
assert.match(asked[0].system, /^规则：\n\* 0:角色特征表格/);
assert.match(asked[0].system, /第 1 到 6 层/);
assert.doesNotMatch(asked[0].user, /tableEdit|旧的/, '正文里旧的表格指令去掉');
assert.match(asked[1].system, /林悠悠,开朗1/, '第二批接着第一批的结果填');
let t = load(chat[12]);
assert.deepEqual(dump(t.by('角色特征表格')), [['林悠悠', '开朗2']], '同名角色合并成一行');
assert.deepEqual(dump(t.by('事件历史')).map(r => r[0]), ['第1批的事', '第2批的事']);
assert.equal(dump(load(chat[0]).by('事件历史')).length, 0, '起点之前的快照不变');
assert.equal(chat[14][V2.pieceHash], undefined, '停下后后面的楼层没动');
// 接着填
const rest = planBackfill({ batch: 3 });
assert.equal(rest.start, 13);
stopAfter = 99;
await runBackfill(rest, applyTableEditText);
assert.equal(dump(load(chat[14]).by('事件历史')).length, 3);
console.log('✓ 回填：分批、接着上一批的结果、旧快照不动、能停、能接着填');

// 融合沙盒
let sel = selectFloors({ pattern: '吵架' });
assert.deepEqual(sel.floors, [6]);
sel = selectFloors({ dateFrom: '2025-06-12', dateTo: '2025年6月13日' });
assert.deepEqual(sel.floors, [4, 5, 6, 7], '按故事日期，没有标签的用户消息沿用上一条的日期');
assert.match(selectFloors({ pattern: '(' }).error, /正则/);
// 大总结里已有两条，融合的这条按楼层范围插到中间
t = load(chat[14]);
const big = t.by('大总结');
[['早', '大', '0-2', ''], ['晚', '大', '10-14', '']].forEach(values => { big.findCellByPosition(big.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(big, big.getRowCount() - 1, values); });
t.sheets.forEach(s => s.save(chat[14], true));
const fused = insertFusion('林悠悠和陈默吵架的细节', [5, 6, 7], '大');
assert.equal(fused.range, '5-7');
assert.deepEqual(dump(load(chat[14]).by('大总结')).map(r => r[0]), ['早', '林悠悠和陈默吵架的细节', '晚']);
assert.equal(dump(load(chat[14]).by('大总结'))[1][2], '5-7（手动）');
console.log('✓ 融合沙盒：按正则、故事日期挑楼层，结果按楼层范围插进大总结');

// 诊断导出
installErrorCapture(); installErrorCapture();
EDITOR.error('测试报错', '细节', new Error('boom'));
USER.tableBaseSetting.custom_api_key_test = 'sk-secret';
const diag = buildDiagnostics('test');
assert.equal(diag.errors.length, 1, '只装一次');
assert.equal(diag.errors[0].message, '测试报错');
assert.equal(JSON.stringify(diag).includes('sk-secret'), false, '不导出密钥');
assert.equal(diag.tables.sheets.length, 4);
assert.ok(diag.lastExtraRequest === null || typeof diag.lastExtraRequest === 'object');
console.log('✓ 诊断导出：报错记录、表格概况、不含密钥');

// 关系图
const sheets = [
  mkChat('角色特征表格', ['角色名', '性格'], [['林悠悠|悠悠', '开朗'], ['陈默', '冷'], ['苏晴', '温柔']]),
  mkChat('角色与<user>社交表格', ['角色名', '对<user>关系'], [['林悠悠', '青梅竹马'], ['陈默', '室友']]),
  mkChat('大总结', ['内容', '层级', '楼层范围', '涉及角色'], [['a', '大', '1-2', '林悠悠|陈默'], ['b', '大', '3-4', '林悠悠|陈默|苏晴'], ['c', '大', '5-6', '苏晴']]),
];
context.name1 = '江辰';
const graph = buildGraph(sheets, 30);
assert.equal(graph.nodes[0].id, '江辰');
assert.deepEqual(graph.nodes.map(n => n.id).sort(), ['江辰', '林悠悠', '陈默', '苏晴'].sort());
assert.ok(graph.edges.find(e => e.kind === 'relation' && e.b === '林悠悠' && e.label === '青梅竹马'));
const together = graph.edges.filter(e => e.kind === 'together');
assert.deepEqual(together.map(e => [e.a, e.b].sort().join('-')), ['林悠悠-陈默'].map(x => x.split('-').sort().join('-')), '一起出现 2 次以上才连虚线');
const pos = layoutGraph(graph, 800, 600);
for (const [, p] of pos) { assert.ok(p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600); }
assert.deepEqual(pos.get('江辰'), { x: 400, y: 300 }, '你在中间');
const svg = renderGraphSvg(graph, pos);
assert.match(svg, /<svg[\s\S]*青梅竹马[\s\S]*<\/svg>/);
assert.equal(buildGraph(sheets, 2).nodes.length, 2, '人数上限');
console.log('✓ 关系图：关系实线、同场虚线、布局在画布内、人数上限');

const withPairs = [...sheets, mkChat('角色关系表', ['角色A', '角色B', '关系', '#关系变化'], [['悠悠', '陈默', '暗恋', ''], ['陈默', '林悠悠', '重复的一对', ''], ['苏晴', '陈默', '宿敌', ''], ['<user>', '林悠悠', '和社交表重复', ''], ['新人', '苏晴', '师徒', '']])];
const g2 = buildGraph(withPairs, 30);
const pairEdges = g2.edges.filter(e => e.kind === 'pair').map(e => `${e.a}-${e.b}-${e.label}`).sort();
assert.deepEqual(pairEdges, ['林悠悠-陈默-暗恋', '苏晴-陈默-宿敌', '新人-苏晴-师徒'].sort(), '外号换主名、同一对只画一次、和你的关系以社交表为准');
assert.ok(g2.nodes.find(n => n.id === '新人'), '只在关系表里的人也画出来');
assert.match(renderGraphSvg(g2, layoutGraph(g2, 800, 600)), /var\(--v2g-pair\)[\s\S]*宿敌/);
const longLabel = { nodes: [{ id: '甲', label: '甲', weight: 1, isUser: true }, { id: '乙', label: '乙', weight: 1, isUser: false }], edges: [{ a: '甲', b: '乙', label: '被威胁者/肉便器（被迫屈从）', weight: 1, kind: 'pair' }] };
const longSvg = renderGraphSvg(longLabel, layoutGraph(longLabel, 400, 400), 400, 400);
assert.equal((longSvg.match(/<tspan/g) || []).length, 2, '长关系词换成多行');
assert.match(longSvg, /<title>被威胁者\/肉便器（被迫屈从）<\/title>/, '完整内容放在 title 里');
console.log('✓ 关系图：角色关系表的角色之间关系');

const { applyTheme } = await import(REPO + '/core/themes.js');
const classes = new Set();
globalThis.document = { body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } } };
applyTheme('night'); assert.deepEqual([...classes], ['v2-theme-night']);
applyTheme('follow'); assert.deepEqual([...classes], []);
console.log('✓ 配色切换');

// 聊天文件大小拆分：正文、重 roll、思考、其他字段；表格快照不算进去
{
  const { chatPartsStats } = await import(REPO + '/scripts/editor/tableStatistics.js');
  const stats = chatPartsStats([
    { is_user: true, mes: 'hi', extra: {} },
    { is_user: false, mes: 'abcd', swipes: ['abcd', 'efgh'], swipe_info: [], extra: { reasoning: '思考', foo: 'x'.repeat(2048) }, hash_sheets: 'y'.repeat(5000), status_bar: 'z'.repeat(4096) },
  ], { sheets: [], note: 'n' });
  const get = (label) => stats.find(s => s.label.startsWith(label))?.value;
  assert.equal(get('其中正文'), '0.0 KB');
  assert.match(get('其中重 roll'), /1 层有，共 1 个/);
  assert.equal(stats.find(s => s.label === '其中其他字段 status_bar')?.value, '4.0 KB');
  assert.equal(stats.find(s => s.label === '其中其他字段 extra.foo')?.value, '2.0 KB');
  assert.ok(!stats.some(s => s.label.includes('hash_sheets')), '表格快照不重复算');
  console.log('✓ 聊天文件大小拆分');
}
