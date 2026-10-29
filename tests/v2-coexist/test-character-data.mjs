// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-character-data.mjs "$PWD"
// 检查角色资料卡的数据层：按人收拢各表内容、外号、对不上的名字、搜索、排序、复制文本
import assert from 'node:assert/strict';
const REPO = process.argv[2];
const chain = () => { const f = function(){}; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : p)), apply: () => p, construct: () => p }); return p; };
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: () => chain(), get: () => chain() });
globalThis.document = chain(); globalThis.window = globalThis; globalThis.toastr = { warning(){}, success(){}, error(){}, info(){} };
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

const { USER } = await import(REPO + '/core/manager.js');
const CD = await import(REPO + '/core/characterData.js');

// 最小的假表：第 0 行表头、第 0 列行号
let uidSeq = 0;
const mk = (name, headers, rows) => {
  const grid = [['', ...headers], ...rows.map((r, i) => [String(i), ...headers.map((_, c) => r[c] ?? '')])].map(r => r.map(v => ({ data: { value: v } })));
  return { name, uid: 'u' + (++uidSeq), getRowCount: () => grid.length, getCellsByRowIndex: (r) => grid[r], findCellByPosition: (r, c) => grid[r]?.[c] };
};

// ---------- 小工具 ----------
assert.equal(CD.estimateTokens(''), 0);
assert.equal(CD.estimateTokens('林雪'), 2);
assert.equal(CD.estimateTokens('abcd'), 1);
assert.equal(CD.estimateTokens('林雪abcde'), 4, '2 + ceil(5/4)');
assert.equal(CD.estimateTokens('，。'), 2, '全角标点算一个');
assert.equal(CD.parseNumber('72 /100(+5)'), 72);
assert.equal(CD.parseNumber('好感-5'), -5);
assert.equal(CD.parseNumber('3.5 次'), 3.5);
assert.ok(Number.isNaN(CD.parseNumber('多次')));
assert.ok(Number.isNaN(CD.parseNumber(undefined)));
console.log('✓ estimateTokens / parseNumber');

const DEFAULT_LAYOUT = { order: [], hidden: {}, forceLong: [], forceShort: [] };
USER.tableBaseSetting.v2_card_layout = '';
assert.deepEqual(CD.cardLayout(), DEFAULT_LAYOUT);
USER.tableBaseSetting.v2_card_layout = '{坏了';
assert.deepEqual(CD.cardLayout(), DEFAULT_LAYOUT, 'JSON 写坏了用默认');
USER.tableBaseSetting.v2_card_layout = JSON.stringify({ order: ['角色关系表'], hidden: { 角色特征表格: ['性格'], 悬念簿: true }, forceLong: ['外貌'], forceShort: 3 });
assert.deepEqual(CD.cardLayout(), { order: ['角色关系表'], hidden: { 角色特征表格: ['性格'], 悬念簿: ['*'] }, forceLong: ['外貌'], forceShort: [] });
USER.tableBaseSetting.v2_card_layout = '';
console.log('✓ cardLayout 默认值、坏 JSON、整表隐藏');

// ---------- 建档 ----------
const LONG = '长'.repeat(25);
const sheets = [
  mk('角色特征表格', ['角色名', '性格', '外貌', '#经历', '爱好'], [
    ['林雪|小雪|师姐', '冷淡', LONG, '入学；被救', ''],
    ['苏晴', '开朗', '短发', '', ''],
    ['江辰', '主角', '', '', ''],
    ['<user>', '主角', '', '', ''],
  ]),
  mk('角色与<user>社交表格', ['角色名', '对<user>关系', '对<user>好感', '臣服值', '累计高潮次数'], [
    ['小雪', '同学', '72/100', '40', '3次'],
    ['苏晴', '医生', '50', '', ''],
  ]),
  mk('角色信息表格', ['角色名', '身体'], [['林雪', '健康']]),
  mk('角色关系表', ['角色A', '角色B', '关系', '#关系变化'], [
    ['林雪', '苏晴', '闺蜜', '初识；和好'],
    ['小雪', '王芳', '对手', ''],
    ['苏晴', '<user>', '医患', ''],
    ['林血', '苏晴', '同事', ''],
  ]),
  mk('任务、命令或者约定表格', ['角色', '任务', '进度', '期限'], [
    ['林雪', '找回项链', '进行中 50%', '三天'],
    ['苏晴、小雪', '一起逛街', '', '周末'],
    ['苏青', '买药', '完成', ''],
  ]),
  mk('重要物品表格', ['拥有人', '物品', '描述'], [['林雪', '项链', '母亲遗物']]),
  mk('悬念簿', ['悬念', '涉及角色', '状态'], [['项链的来历', '林雪|苏晴 王芳', '未解'], ['无关', '无', '']]),
  mk('时空表', ['日期', '地点', '此地角色'], [['6月15日', '学校', '林雪']]),
  mk('事件历史', ['事件', '涉及角色'], [['开学', '林雪']]),
  mk('大总结', ['内容', '涉及角色'], [['总结', '林雪']]),
  mk('总结归档', ['内容', '涉及角色'], [['归档', '林雪']]),
];
USER.tableBaseSetting.v2_card_private_tables = '角色信息表格';
const { list, index, orphans } = CD.buildProfiles(sheets, { shortLimit: 20, layout: DEFAULT_LAYOUT, userName: '江辰' });
assert.deepEqual(list.map(p => p.primary), ['林雪', '苏晴'], '<user> 和自己的名字不建档');
assert.equal(index.get('小雪'), '林雪');
assert.equal(index.get('林雪'), '林雪');
assert.equal(index.has('师姐'), false, '通称不当外号');
const lin = list[0], su = list[1];
const sec0 = (p, name) => p.sections.find(s => s.sheet === name);
assert.deepEqual(lin.aliases, ['小雪']);
assert.deepEqual(lin.home, { sheet: '角色特征表格', uid: sheets[0].uid, rowIndex: 0 });
assert.deepEqual(sec0(lin, '角色与<user>社交表格').grid.map(i => i.value), ['同学', '72/100', '40', '3次'], '社交表只写外号的行归到主名');
// 同一张表里「林雪|小雪」和「小雪」两行都在：是两个人
const twin = CD.buildProfiles([mk('角色特征表格', ['角色名', '性格'], [['林雪|小雪', 'a'], ['小雪', 'b']]), mk('角色与<user>社交表格', ['角色名', '关系'], [['小雪', '同学']])], { layout: DEFAULT_LAYOUT, userName: '' });
assert.deepEqual(twin.list.map(p => p.primary), ['林雪', '小雪']);
assert.equal(twin.list[1].sections.length, 2);
assert.equal(twin.list[0].sections.length, 1);
// 先出现外号行、后面的表才写「主名|外号」也能归到一起
const late = CD.buildProfiles([mk('角色特征表格', ['角色名', '性格'], [['小雪', 'a']]), mk('角色与<user>社交表格', ['角色名', '关系'], [['林雪|小雪', '同学']])], { layout: DEFAULT_LAYOUT, userName: '' });
assert.deepEqual(late.list.map(p => [p.primary, p.aliases]), [['林雪', ['小雪']]]);
console.log('✓ 只从角色类表建档；外号进索引');

const sec = (p, name) => p.sections.find(s => s.sheet === name);
assert.deepEqual(lin.sections.map(s => s.sheet), ['角色特征表格', '角色与<user>社交表格', '角色信息表格', '角色关系表', '任务、命令或者约定表格', '重要物品表格', '悬念簿'], '默认顺序：角色类表、关系表、一行一条的表、涉及角色表；时空/事件/总结不收');
const feat = sec(lin, '角色特征表格');
assert.equal(feat.kind, 'fields');
assert.equal(feat.private, false);
assert.deepEqual(feat.grid.map(i => i.label), ['性格']);
assert.deepEqual(feat.long.map(i => i.label), ['外貌', '经历'], '长内容和 # 列折叠');
const exp = feat.long[1];
assert.deepEqual(exp, { key: `${sheets[0].uid}:0:3`, label: '经历', header: '#经历', value: '入学；被救', rowIndex: 0, col: 3, append: true });
assert.deepEqual(lin.empty, [{ sheet: '角色特征表格', col: '爱好' }]);
assert.equal(sec(lin, '角色信息表格').private, true, '私密表');
assert.deepEqual(lin.numbers, { 好感: 72, 臣服值: 40, 累计高潮次数: 3 });
assert.ok(lin.fieldLabels.has('对<user>好感') && lin.fieldLabels.has('身体') && !lin.fieldLabels.has('爱好'));
assert.deepEqual(su.empty.map(e => e.col), ['经历', '爱好', '臣服值', '累计高潮次数']);
assert.deepEqual(su.numbers, { 好感: 50 });
console.log('✓ 格子分短/长、# 列、空列、私密表、数值、列名集合');

const rel = sec(lin, '角色关系表');
assert.equal(rel.kind, 'rows');
assert.deepEqual(rel.rows.map(r => [r.title, r.meta, r.detail, r.link]), [['苏晴', '闺蜜', '关系变化：初识；和好', '苏晴'], ['王芳', '对手', '', null]]);
const suRel = sec(su, '角色关系表').rows;
assert.deepEqual(suRel.map(r => [r.title, r.link]), [['林雪', '林雪'], ['<user>', null], ['林血', null]]);
console.log('✓ 关系表：对面的人做标题，能跳转的才有 link');

const task = sec(lin, '任务、命令或者约定表格');
assert.deepEqual(task.rows.map(r => [r.title, r.meta, r.detail]), [['找回项链', '进行中 50%', '期限：三天'], ['一起逛街', '', '期限：周末']], '任务表带进度');
assert.deepEqual(sec(su, '任务、命令或者约定表格').rows.map(r => r.title), ['一起逛街'], '一格多个名字');
assert.deepEqual(sec(lin, '重要物品表格').rows.map(r => [r.title, r.detail]), [['项链', '描述：母亲遗物']]);
const mystery = sec(lin, '悬念簿').rows;
assert.deepEqual(mystery.map(r => [r.title, r.meta]), [['项链的来历', '未解']]);
assert.equal(sec(su, '悬念簿').rows.length, 1);
assert.equal(mystery[0].key, `${sheets[6].uid}:0`);
console.log('✓ 任务/物品表一行一条（标题、进度、其余列）；悬念簿按涉及角色');

const orphanNames = orphans.map(o => o.name).sort();
assert.deepEqual(orphanNames, ['林血', '王芳', '苏青'].sort(), '无、<user> 不算');
assert.deepEqual(orphans.find(o => o.name === '林血').suggestions, ['林雪']);
assert.deepEqual(orphans.find(o => o.name === '苏青').suggestions, ['苏晴']);
assert.deepEqual(orphans.find(o => o.name === '王芳').suggestions, []);
assert.equal(orphans.find(o => o.name === '林血').sheet, '角色关系表');
// 包含关系也算像
const o2 = CD.buildProfiles([mk('角色特征表格', ['角色名'], [['林雪儿']]), mk('悬念簿', ['悬念', '涉及角色'], [['x', '林雪']])], { layout: DEFAULT_LAYOUT, userName: '' }).orphans;
assert.deepEqual(o2, [{ name: '林雪', sheet: '悬念簿', suggestions: ['林雪儿'] }]);
console.log('✓ 对不上的名字和建议（差一个字、包含）');

assert.ok(lin.text.includes('母亲遗物') && lin.text.includes('小雪'));
assert.equal(lin.tokens, CD.estimateTokens(lin.text));
assert.ok(lin.tokens > su.tokens);
console.log('✓ 全文和 token');

// 布局：排序、隐藏列、强制长短
const custom = CD.buildProfiles(sheets, { shortLimit: 20, userName: '江辰', layout: { order: ['悬念簿', '角色关系表'], hidden: { 角色特征表格: ['性格', '#经历'], 重要物品表格: ['*'] }, forceLong: ['身体'], forceShort: ['外貌'] } }).list[0];
assert.deepEqual(custom.sections.map(s => s.sheet), ['悬念簿', '角色关系表', '角色特征表格', '角色与<user>社交表格', '角色信息表格', '任务、命令或者约定表格']);
assert.deepEqual(sec(custom, '角色特征表格').grid.map(i => i.label), ['外貌']);
assert.deepEqual(sec(custom, '角色特征表格').long.map(i => i.label), []);
assert.deepEqual(sec(custom, '角色信息表格').long.map(i => i.label), ['身体']);
assert.ok(!custom.empty.some(e => e.col === '性格'));
// 默认 opts 读设置
USER.tableBaseSetting.v2_card_layout = JSON.stringify({ hidden: { 角色特征表格: ['外貌'] } });
assert.ok(!sec(CD.buildProfiles(sheets).list[0], '角色特征表格').long.some(i => i.label === '外貌'), '不传 layout 时读设置');
USER.tableBaseSetting.v2_card_layout = '';
assert.deepEqual(CD.buildProfiles(sheets).list.map(p => p.primary), ['林雪', '苏晴'], '不传 userName 时读 name1');
assert.deepEqual(CD.buildProfiles([]), { list: [], index: new Map(), orphans: [] });
console.log('✓ 布局：调顺序、隐藏列/整表、强制长短；默认读设置');

// ---------- 搜索 ----------
assert.deepEqual(CD.searchProfiles(list, '').map(p => p.primary), ['林雪', '苏晴']);
assert.deepEqual(CD.searchProfiles(list, '小雪').map(p => p.primary), ['林雪']);
assert.deepEqual(CD.searchProfiles(list, '医生').map(p => p.primary), ['苏晴']);
assert.deepEqual(CD.searchProfiles(list, '项链').map(p => p.primary), ['林雪', '苏晴'], '苏晴的悬念里也有项链');
const ab = CD.buildProfiles([mk('角色特征表格', ['角色名', '备注'], [['Alice', 'Likes TEA'], ['Bob', '']])], { layout: DEFAULT_LAYOUT, userName: '' }).list;
assert.deepEqual(CD.searchProfiles(ab, 'tea').map(p => p.primary), ['Alice'], '不分大小写');
console.log('✓ 搜索');

// ---------- 排序 ----------
const P = (primary, numbers = {}, tokens = 0) => ({ primary, aliases: [], numbers, tokens, text: '' });
const people = [P('张三', { 好感: 10, 臣服值: 90 }, 5), P('李四', { 好感: 80 }, 50), P('王五', {}, 20), P('赵六', { 好感: 40, 臣服值: 10 }, 1)];
const appear = { 张三: { last: 30 }, 李四: { last: 5 }, 赵六: { last: 100 } };
const names = (arr) => arr.map(p => p.primary);
assert.deepEqual(names(CD.sortProfiles(people, 'recent', { appear, present: new Set(['李四']) })), ['李四', '赵六', '张三', '王五'], '在场在前，然后最近出场');
assert.deepEqual(names(CD.sortProfiles(people, 'absent', { appear })), ['李四', '张三', '赵六', '王五'], '最久没出场在前，没出场过的在最后');
assert.deepEqual(names(CD.sortProfiles(people, 'favor')), ['李四', '赵六', '张三', '王五']);
assert.deepEqual(names(CD.sortProfiles(people, 'submit')), ['张三', '赵六', '李四', '王五']);
assert.deepEqual(names(CD.sortProfiles(people, 'tokens')), ['李四', '王五', '张三', '赵六']);
assert.deepEqual(names(CD.sortProfiles(people, 'name')), names([...people].sort((a, b) => a.primary.localeCompare(b.primary, 'zh'))));
assert.deepEqual(names(CD.sortProfiles(people, 'favor', { pins: new Set(['王五']) })), ['王五', '李四', '赵六', '张三'], '置顶永远在前');
assert.deepEqual(names(CD.sortProfiles(people, 'favor', { numbers: { 张三: { 好感: 99 } } })), ['张三', '李四', '赵六', '王五'], '状态标签的数值优先');
assert.deepEqual(names(people), ['张三', '李四', '王五', '赵六'], '不改原数组');
assert.deepEqual(names(CD.sortProfiles(people, 'unknown')), ['张三', '李四', '王五', '赵六']);
console.log('✓ 排序');

// ---------- 复制文本 ----------
const text = CD.profileToText(lin, { floor: 12, fields: { 体力: '60 /100(-10)跑步', 当前服装: '上身:白衬衫\n下身:百褶裙' } });
assert.ok(text.startsWith('【林雪】外号：小雪'));
assert.ok(text.includes('== 角色特征表格 ==\n性格：冷淡'));
assert.ok(text.includes('经历：入学；被救'));
assert.ok(text.includes('- 苏晴（闺蜜）\n  关系变化：初识；和好'));
assert.ok(text.includes('- 找回项链（进行中 50%）\n  期限：三天'));
assert.ok(text.includes('== 最新状态（第 12 楼） ==') || text.includes('== 最新状态（第 12 楼）=='));
assert.ok(text.includes('体力：60 /100(-10)跑步'));
assert.ok(text.includes('当前服装：\n  上身:白衬衫\n  下身:百褶裙'));
const t2 = CD.profileToText(su, { fields: new Map([['快感', '35']]) });
assert.ok(t2.includes('快感：35') && !t2.includes('外号'));
assert.ok(!CD.profileToText(su).includes('最新状态'));
console.log('✓ profileToText');
console.log('全部通过');
