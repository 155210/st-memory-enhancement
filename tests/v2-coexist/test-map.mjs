// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-map.mjs "$PWD"
// 检查阶段 5：时间标签拆地点、地点树、框图、AI 地图缓存、地名召回、同区域分档
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
const LT = await import(REPO + '/core/locationTree.js');
const WM = await import(REPO + '/core/worldMap.js');
const { computeTiers, rowTier } = await import(REPO + '/core/sendTiers.js');
const { V2 } = await import(REPO + '/core/v2keys.js');

assert.deepEqual(LT.parseTimeTag('『2025年6月15日-星期日–18:15-城南安置房7栋6楼走廊-闷热·天色暗沉』'), { date: '2025年6月15日', time: '18:15', place: '城南安置房7栋6楼走廊', weather: '闷热·天色暗沉' });
assert.equal(LT.parseTimeTag('2025年6月15日–星期日-学校天台').place, '学校天台', '没有时间段也认');
assert.deepEqual(LT.splitPlace('城南安置房7栋6楼走廊'), ['城南安置房', '7栋', '6楼', '走廊']);
assert.deepEqual(LT.splitPlace('异世界>王都>酒馆'), ['异世界', '王都', '酒馆']);
assert.deepEqual(LT.splitPlace('学校天台'), ['学校', '天台']);
assert.deepEqual(LT.splitPlace('宿舍'), ['宿舍']);
console.log('✓ 时间标签拆地点、地点拆层级');

const ai = (mes) => ({ is_user: false, mes });
const chatLog = [
  ai('『2025年6月15日-星期日–18:15-城南安置房7栋6楼走廊-闷热』'),
  { is_user: true, mes: '进屋' },
  ai('『2025年6月15日-星期日–18:20-城南安置房7栋6楼602室-闷热』…『2025年6月15日-星期日–18:40-6楼走廊-闷热』'),
  ai('『2025年6月16日-星期一–08:00-学校天台-晴』'),
  ai('『2025年6月16日-星期一–09:00-城南安置房7栋6楼走廊-晴』'),
];
const tree = LT.buildLocationTree(chatLog, []);
assert.deepEqual([...tree.root.children.keys()], ['城南安置房', '学校'], '同一个地方不重复建根');
const hallway = tree.root.children.get('城南安置房').children.get('7栋').children.get('6楼');
assert.deepEqual([...hallway.children.keys()], ['走廊', '602室'], '「6楼走廊」接回当前所在的楼');
assert.equal(hallway.children.get('走廊').visits, 3);
assert.equal(LT.currentPlacePath(tree), '城南安置房>7栋>6楼>走廊', '一轮多个标签取最后一个，最后一轮为准');
assert.equal(tree.currentFloor, 4);
assert.match(LT.renderTreeText(tree), /- 走廊 ★当前/);
console.log('✓ 地点树：同名复用、相对地点接回、当前地点');

const svg = WM.renderBoxMap(tree, ['林悠悠']);
assert.match(svg, /^<svg class="v2-world-map"/);
assert.match(svg, /城南安置房/);
assert.match(svg, /走廊 ★/);
assert.match(svg, /在场：林悠悠/);
assert.doesNotMatch(svg, /学校/, '只画当前所在的大区域');
console.log('✓ 程序框图');

const cleaned = WM.sanitizeSvg('前言<svg onload="alert(1)"><script>x</script><a href="javascript:alert(1)">a</a><rect onclick="y" width="1"/></svg>后记');
assert.match(cleaned, /^<svg[\s\S]*<rect width="1"\/><\/svg>$/);
assert.doesNotMatch(cleaned, /script|onload|onclick|javascript|前言|后记/);
assert.equal(WM.sanitizeSvg('没有图'), '');
console.log('✓ AI 返回的 SVG 去掉脚本和事件');

// AI 地图：按地点缓存
chat.push(...chatLog);
const setRow = (s, r, values) => s.getCellsByRowIndex(r).forEach((c, i) => { if (i) c.data.value = values[i - 1] ?? ''; });
const mkChat = (name, headers, rows = []) => {
  const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setRow(s, 0, headers); s.enable = true;
  rows.forEach(values => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(s, s.getRowCount() - 1, values); });
  return s;
};
const sheets = [
  mkChat('时空表格', ['日期', '时间', '地点', '此地角色'], [['2025年6月16日', '09:00', '走廊', '<user>/林悠悠']]),
  mkChat('角色特征表格', ['角色名', '住所'], [['林悠悠', '学校宿舍'], ['陈默', '城南安置房7栋'], ['苏晴', '市中心']]),
  mkChat('大总结', ['内容', '层级', '楼层范围', '涉及角色']),
  mkChat('总结归档', ['内容', '层级', '楼层范围', '涉及角色'], [['在城南安置房捡到猫', '大', '1-5', ''], ['在学校考试', '大', '6-9', '']]),
];
sheets.forEach(s => s.save(chat[4], true));
let asks = 0;
SM.summaryHooks.ask = async (system, prompt) => { asks++; assert.match(prompt, /当前地点：城南安置房>7栋>6楼>走廊/); assert.match(prompt, /在场人物：<user>、林悠悠/); return '好的<svg viewBox="0 0 600 400"><rect width="10" height="10"/></svg>'; };
Object.assign(USER.tableBaseSetting, { v2_map_mode: 'ai', v2_summary_enabled: true, v2_tier_enabled: true, v2_tier_main_count: 0 });
let r = await WM.maybeDrawOnNewPlace();
assert.equal(r.cached, false);
r = await WM.maybeDrawOnNewPlace();
assert.equal(r.cached, true);
assert.equal(asks, 1, '同一地点只画一次');
assert.ok(chatMetadata[V2.mapCache]['城南安置房>7栋>6楼>走廊'].svg.startsWith('<svg'));
USER.tableBaseSetting.v2_map_mode = 'box';
assert.equal(await WM.maybeDrawOnNewPlace(), null, '框图模式不发请求');
assert.match(WM.mapPanelHtml(LT.buildLocationTree(chat, sheets), ['林悠悠'], 'box'), /v2-world-map/);
console.log('✓ AI 地图按地点缓存，框图模式不花 token');

// 地名召回：本轮没人出场，按地点找回
const recall = SM.buildRecallBlock(sheets);
assert.match(recall, /捡到猫/);
assert.doesNotMatch(recall, /考试/);
// 同区域：住所在城南安置房的人发简要
const tiers = computeTiers(sheets);
assert.equal(rowTier('陈默', tiers), 'brief');
assert.equal(rowTier('苏晴', tiers), 'roster');
console.log('✓ 按地名召回旧事、住所同区域的人发简要');
