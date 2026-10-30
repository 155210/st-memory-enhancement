// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-character-status.mjs "$PWD"
// 检查角色资料卡：状态标签解析、按层读取、曲线、出场、规则自检、红点、书签、备份
import assert from 'node:assert/strict';
const REPO = process.argv[2];
const chain = () => { const f = function(){}; const p = new Proxy(f, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : (k === 'length' ? 0 : p)), apply: () => p, construct: () => p }); return p; };
globalThis.$ = globalThis.jQuery = new Proxy(function(){}, { apply: () => chain(), get: () => chain() });
globalThis.document = chain(); globalThis.window = globalThis; globalThis.toastr = { warning(){}, success(){}, error(...a) { console.log('toast error', ...a); }, info(){} };
globalThis.localStorage = { getItem: () => null, setItem(){} };
const power_user = {}; const extension_settings = { disabledExtensions: [] }; const extensionNames = ['third-party/st-memory-enhancement-v2'];
const chat = []; const chatMetadata = {};
const context = { chat, chatMetadata, name1: '江辰', chatId: 'chat-1', registerMacro(){}, macros: null };
let saves = 0;
globalThis.__ST = {
  DOMPurify: { sanitize: x => x }, Bowser: {}, slideToggle(){}, LoadLocal(){}, SaveLocal(){}, LoadLocalBool(){},
  POPUP_TYPE: { CONFIRM: 1, TEXT: 2 }, Popup: class {}, callGenericPopup: async () => true,
  extensionNames, extension_settings, getContext: () => context, renderExtensionTemplateAsync: async () => '',
  getCurrentLocale: () => 'zh-cn', power_user, applyPowerUserSettings(){}, getContextSettings(){}, loadPowerUserSettings(){},
  reloadCurrentChat(){}, saveSettingsDebounced(){}, saveSettings(){}, getSlideToggleOptions(){}, generateRaw(){}, saveChat: async () => { saves++; },
  eventSource: { on(){} }, event_types: {}, getRequestHeaders: () => ({}), saveGroupChat(){}, selected_group: null,
};
globalThis.fetch = async () => ({ json: async () => ({}) });

const { USER, DERIVED } = await import(REPO + '/core/manager.js');
await import(REPO + '/index.js');
DERIVED.any.chatSheetMap = {};
const { V2 } = await import(REPO + '/core/v2keys.js');
const CS = await import(REPO + '/core/characterStatus.js');
const KEY = V2.characterCard ?? 'memory_enhancement_v2_character_card';

// ---------------------------------------------------------------- 解析示例标签
const EXAMPLE = `<Calculated_data>
<summary style="color:#69ffb4"> 🌡️陈映竹数据</summary>

对{{user}}称呼:小江
对{{user}}关系:同学
对{{user}}态度:亲近
对{{user}}好感: 72 /100(+5)被救了
被拘束时间地点和拘束状态:无

💅外貌: 黑长直，个子不高 | 腹部平坦

🔄动作和体位:坐在床边

👚当前服装:
上身:白衬衫 / 胸罩:白色蕾丝
下身:百褶裙 / 内裤:白色棉质
腿部:黑丝 / 鞋子:乐福鞋
道具或配饰&特殊装置:无 / 小穴内道具:无 / 菊花内道具:无

-体力: 60 /100(-10)跑步
-快感: 35 /100(+35)亲吻
-臣服值: 40 /100(+2)被安抚
-累计高潮次数: 3 (+1)卧室床上

💘性爱次数:亲吻:5;口交:0;性交:1;肛交:0

🍲胃部状态:牛奶:200ml+面包:150ml =350ml/1000ml(+200)

🎈膀胱内液体量:尿液:120ml =120ml/500ml(+20)

🥛小穴内液体量:精液:50ml =50ml/300ml(+50)
小穴堵塞状态:无

💧菊花内液体量:无 =0ml/300ml(0)
菊花堵塞状态:实心:肛塞

当前阶段: 排卵期,剩余时间2天
怀孕检查:当前阶段:排卵期|1d36=31 结论:已怀孕
🤰怀孕状态:受精时间2025年6月15日,当前已怀孕第1天,精子来自于我
</Calculated_data>`;

const blocks = CS.parseStatusBlocks('正文开头\n' + EXAMPLE + '\n正文结尾');
assert.equal(blocks.length, 1);
assert.equal(blocks[0].name, '陈映竹');
assert.deepEqual(Object.fromEntries(blocks[0].fields), {
  '对<user>称呼': '小江',
  '对<user>关系': '同学',
  '对<user>态度': '亲近',
  '对<user>好感': '72 /100(+5)被救了',
  '被拘束时间地点和拘束状态': '无',
  '外貌': '黑长直，个子不高 | 腹部平坦',
  '动作和体位': '坐在床边',
  '当前服装': '上身:白衬衫 / 胸罩:白色蕾丝\n下身:百褶裙 / 内裤:白色棉质\n腿部:黑丝 / 鞋子:乐福鞋\n道具或配饰&特殊装置:无 / 小穴内道具:无 / 菊花内道具:无',
  '体力': '60 /100(-10)跑步',
  '快感': '35 /100(+35)亲吻',
  '臣服值': '40 /100(+2)被安抚',
  '累计高潮次数': '3 (+1)卧室床上',
  '性爱次数': '亲吻:5;口交:0;性交:1;肛交:0',
  '胃部状态': '牛奶:200ml+面包:150ml =350ml/1000ml(+200)',
  '膀胱内液体量': '尿液:120ml =120ml/500ml(+20)',
  '小穴内液体量': '精液:50ml =50ml/300ml(+50)',
  '小穴堵塞状态': '无',
  '菊花内液体量': '无 =0ml/300ml(0)',
  '菊花堵塞状态': '实心:肛塞',
  '当前阶段': '排卵期,剩余时间2天',
  '怀孕检查': '当前阶段:排卵期|1d36=31 结论:已怀孕',
  '怀孕状态': '受精时间2025年6月15日,当前已怀孕第1天,精子来自于我',
});
assert.match(blocks[0].raw, /陈映竹数据/);
console.log('✓ 示例标签所有字段');

assert.deepEqual(CS.parseValue('72 /100(+5)被救了'), { num: 72, max: 100, delta: 5, reason: '被救了' });
assert.deepEqual(CS.parseValue('牛奶:200ml+面包:150ml =350ml/1000ml(+200)'), { ml: 350, max: 1000, delta: 200 });
assert.deepEqual(CS.parseValue('无 =0ml/300ml(0)'), { ml: 0, max: 300, delta: 0 });
assert.deepEqual(CS.parseValue('3 (+1)卧室床上'), { num: 3, delta: 1, reason: '卧室床上' });
assert.deepEqual(CS.parseValue('60 /100（-10）跑步'), { num: 60, max: 100, delta: -10, reason: '跑步' }, '全角括号');
assert.deepEqual(CS.parseValue('排卵期,剩余时间2天'), {}, '不是数字开头不算');
assert.deepEqual(CS.parseValue(''), {});
console.log('✓ 数值拆分');

// 两块、全角冒号、没有闭合标签、字段映射
USER.tableBaseSetting.v2_card_field_map = '对{{user}}好感=好感\n不存在=无';
const two = CS.parseStatusBlocks('<Calculated_data><summary>🌡️苏晴数据</summary>\n对<user>好感：50 /100(+1)\n</Calculated_data>\n<Calculated_data>\n<summary>林悠悠的数据</summary>\n体力:10 /100');
assert.deepEqual(two.map(b => b.name), ['苏晴', '林悠悠']);
assert.equal(two[0].fields.get('好感'), '50 /100(+1)', '字段映射');
assert.equal(two[1].fields.get('体力'), '10 /100', '没闭合也能读');
USER.tableBaseSetting.v2_card_field_map = '';
assert.equal(CS.parseStatusBlocks('<my_tag>\n<summary>A某数据</summary>\nx:1\n</my_tag>', 'my_tag')[0].fields.get('x'), '1', '自定义标签名');
assert.equal(CS.parseStatusBlocks('没有标签').length, 0);
console.log('✓ 多块、全角冒号、未闭合、字段映射');

// ---------------------------------------------------------------- 默认状态
const state0 = CS.cardState();
assert.deepEqual(state0, { status: {}, history: {}, appear: {}, bookmarks: [], viewed: {}, pins: [], tags: {}, notes: {}, avatars: {}, avatarFull: {}, version: 1 });
assert.equal(chatMetadata[KEY], state0, '存在 chatMetadata 里');
console.log('✓ cardState 默认值');

// ---------------------------------------------------------------- 按层读取
const names = new Map([['陈映竹', '陈映竹'], ['小竹', '陈映竹'], ['苏晴', '苏晴']]);
const ai = (mes, extra = {}) => ({ is_user: false, mes, ...extra });
const tag = (name, lines) => `<Calculated_data>\n<summary>🌡️${name}数据</summary>\n${lines.join('\n')}\n</Calculated_data>`;
chat.push({ is_user: true, mes: '你好' });                         // 0
chat.push(ai('正文\n' + EXAMPLE, { swipe_id: 0 }));                // 1
assert.deepEqual(CS.captureFromMessage(0, names), [], '用户消息不读');
assert.deepEqual(CS.captureFromMessage(1, names, ['苏晴', '陈映竹']), ['陈映竹']);
let st = CS.cardState().status['陈映竹'];
assert.equal(st.floor, 1);
assert.equal(st.swipe, 0);
assert.equal(st.prev, null);
assert.equal(st.fields['对<user>好感'], '72 /100(+5)被救了');
assert.deepEqual(CS.cardState().history['陈映竹'].好感, [{ f: 1, v: 72, d: 5, r: '被救了' }]);
assert.deepEqual(Object.keys(CS.cardState().history['陈映竹']).sort(), ['体力', '好感', '快感', '累计高潮次数', '臣服值'].sort());
assert.deepEqual(CS.cardState().appear['陈映竹'], { first: 1, last: 1, count: 1, recent: [1] });
assert.deepEqual(CS.cardState().appear['苏晴'], { first: 1, last: 1, count: 1, recent: [1] }, '在场没标签也记出场');

// 重 roll 同一层：替换，不叠加
chat[1] = ai(tag('小竹', ['对{{user}}好感: 70 /100(+3)换了个说法', '-体力: 55 /100']), { swipe_id: 1 });
assert.deepEqual(CS.captureFromMessage(1, names), ['陈映竹'], '外号解析到主名');
st = CS.cardState().status['陈映竹'];
assert.equal(st.swipe, 1);
assert.equal(st.prev, null, '同层重读保留原来的 prev');
assert.deepEqual(CS.cardState().history['陈映竹'].好感, [{ f: 1, v: 70, d: 3, r: '换了个说法' }]);
assert.equal(CS.cardState().history['陈映竹'].快感, undefined, '这层没有的字段去掉了');
assert.equal(CS.cardState().appear['陈映竹'].count, 1, '同一层只算一次');

// 下一层：prev 是上一层
chat.push({ is_user: true, mes: '继续' });                          // 2
chat.push(ai(tag('陈映竹', ['对{{user}}好感: 75 /100(+5)', '-体力: 50 /100'])));  // 3
CS.captureFromMessage(3, names);
st = CS.cardState().status['陈映竹'];
assert.equal(st.prevFloor, 1);
assert.equal(st.prev['对<user>好感'], '70 /100(+3)换了个说法');
assert.deepEqual(CS.cardState().history['陈映竹'].好感.map(p => p.v), [70, 75]);
assert.deepEqual(CS.cardState().appear['陈映竹'], { first: 1, last: 3, count: 2, recent: [1, 3] });
// 再读第 3 层：prev 还是第 1 层的
CS.captureFromMessage(3, names);
assert.equal(CS.cardState().status['陈映竹'].prevFloor, 1);
// 编辑更早的楼层不覆盖最新快照
chat[1] = ai(tag('陈映竹', ['对{{user}}好感: 68 /100']));
CS.captureFromMessage(1, names);
assert.equal(CS.cardState().status['陈映竹'].floor, 3);
assert.deepEqual(CS.cardState().history['陈映竹'].好感.map(p => p.v), [68, 75]);
// 未知名字原样保留
chat.push(ai(tag('路人甲', ['体力: 10 /100'])));                    // 4
assert.deepEqual(CS.captureFromMessage(4, names), ['路人甲']);
console.log('✓ 按层读取：外号、同层替换、prev、出场只算一次、未知名字');

// 曲线上限
USER.tableBaseSetting.v2_card_history_points = 5;
for (let i = 10; i < 20; i++) { chat[i] = ai(tag('苏晴', [`好感: ${i} /100`])); CS.captureFromMessage(i, names); }
assert.deepEqual(CS.cardState().history['苏晴'].好感.map(p => p.f), [15, 16, 17, 18, 19]);
USER.tableBaseSetting.v2_card_history_points = 50;
console.log('✓ 曲线点数上限');

// 删消息
CS.forgetFloor(19);
assert.equal(CS.cardState().status['苏晴'].floor, 18, '退回上一份快照');
CS.forgetFloor(17);
assert.deepEqual(CS.cardState().history['苏晴'].好感.map(p => p.f), [15, 16]);
assert.equal(CS.cardState().status['苏晴'], undefined, '更早的快照没存，去掉');
assert.equal(CS.cardState().appear['苏晴'].last, 16);
assert.equal(CS.cardState().appear['苏晴'].recent.includes(17), false);
chat.length = 17;
console.log('✓ 删消息后回退');

// markPresent
CS.markPresent(16, ['林悠悠']);
CS.markPresent(16, ['林悠悠']);
assert.equal(CS.cardState().appear['林悠悠'].count, 1);
console.log('✓ markPresent');

// ---------------------------------------------------------------- 规则自检
const ruleCase = (prevLines, curLines, curText = '') => {
  const s = CS.cardState();
  delete s.status['测试'];
  chat[20] = ai(tag('测试', prevLines)); CS.captureFromMessage(20, new Map());
  chat[22] = ai(curText + tag('测试', curLines)); CS.captureFromMessage(22, new Map());
  return CS.checkRules('测试').map(a => a.code);
};
assert.deepEqual(ruleCase(['小穴内液体量:精液:50ml =50ml/300ml'], ['小穴内液体量:精液:20ml =20ml/300ml(-30)']), ['P9'], '没清洗就减少');
assert.deepEqual(ruleCase(['小穴内液体量:精液:50ml =50ml/300ml'], ['小穴内液体量:精液:0ml =0ml/300ml(-50)洗澡冲掉']), [], '洗澡可以减少');
assert.deepEqual(ruleCase(['小穴内液体量:精液:50ml =50ml/300ml'], ['小穴内液体量:精液:0ml =0ml/300ml(-50)'], '她去浴室洗澡了。'), [], '正文里洗澡也算');
assert.deepEqual(ruleCase(['菊花内液体量:精液:500ml =500ml/800ml'], ['菊花内液体量:精液:300ml =300ml/800ml(-200)'], '肛塞被拔出，'), [], '塞子拔出可以喷到 300');
assert.deepEqual(ruleCase(['菊花内液体量:精液:500ml =500ml/800ml'], ['菊花内液体量:精液:200ml =200ml/800ml(-300)'], '肛塞被拔出，'), ['A6'], '低于 300 仍然报');
assert.deepEqual(ruleCase(['菊花内液体量:精液:500ml =500ml/800ml'], ['菊花内液体量:精液:300ml =300ml/800ml(-200)']), ['A6'], '没拔出不能降到 300');
assert.deepEqual(ruleCase([], ['胃部状态:水:1200ml =1200ml/1000ml(+500)']), ['S2']);
assert.deepEqual(ruleCase([], ['胃部状态:水:1200ml =1200ml/1000ml(+500)'], '她忍不住呕吐了'), []);
assert.deepEqual(ruleCase([], ['膀胱内液体量:尿液:900ml =900ml/500ml(+100)']), ['B4']);
assert.deepEqual(ruleCase([], ['膀胱内液体量:尿液:900ml =900ml/500ml(+100)'], '失禁了'), []);
assert.deepEqual(ruleCase(['累计高潮次数: 3'], ['累计高潮次数: 2 (-1)']), ['ORG']);
assert.deepEqual(ruleCase(['累计高潮次数: 3'], ['累计高潮次数: 4 (+1)']), []);
assert.deepEqual(ruleCase(['好感: 40 /100'], ['好感: 70 /100(+30)']), ['JUMP']);
assert.deepEqual(ruleCase(['好感: 40 /100'], ['好感: 55 /100(+15)']), []);
assert.deepEqual(ruleCase([], ['累计高潮次数: 多次']), ['VAGUE']);
assert.deepEqual(ruleCase([], ['性爱次数:亲吻:不详;口交:0']), ['VAGUE']);
assert.deepEqual(ruleCase([], ['对{{user}}态度:未知']), [], '不是数值字段不管');
const alert = CS.checkRules('测试')[0] ?? (ruleCase(['小穴内液体量:精液:50ml =50ml/300ml'], ['小穴内液体量:精液:20ml =20ml/300ml']), CS.checkRules('测试')[0]);
assert.ok(alert.text && alert.fix.includes('测试'), '有说明和纠正句');
USER.tableBaseSetting.v2_card_rule_check = false;
assert.deepEqual(CS.checkRules('测试'), [], '关掉自检');
USER.tableBaseSetting.v2_card_rule_check = true;
console.log('✓ 规则自检 P9/A6/S2/B4/ORG/JUMP/VAGUE');

// 表格和标签不一致
chat[23] = ai(tag('陈映竹', ['对{{user}}好感: 80 /100', '-臣服值: 40 /100', '-累计高潮次数: 3']));
CS.captureFromMessage(23, names);
const mm = CS.mismatchAlerts('陈映竹', { numbers: { 好感: 60, 臣服值: 40 } });
assert.deepEqual(mm.map(a => [a.code, a.field]), [['MISMATCH', '好感']]);
assert.match(mm[0].text, /表格可能还没更新/);
assert.deepEqual(CS.mismatchAlerts('陈映竹', null), []);
assert.deepEqual(CS.mismatchAlerts('没这人', { numbers: { 好感: 1 } }), []);
console.log('✓ 表格和标签不一致');

// ---------------------------------------------------------------- 红点
const items = [{ key: 'a', value: '1' }, { key: 'b', value: '2' }];
assert.equal(CS.changedKeys('陈映竹', items).size, 0, '没看过不标');
CS.markViewed('陈映竹', items);
assert.equal(CS.changedKeys('陈映竹', items).size, 0);
assert.deepEqual([...CS.changedKeys('陈映竹', [{ key: 'a', value: '1' }, { key: 'b', value: '3' }, { key: 'c', value: 'x' }])], ['b', 'c']);
console.log('✓ 红点');

// ---------------------------------------------------------------- 书签
const bm = CS.addBookmark('救人之后');
assert.equal(bm.label, '救人之后');
assert.equal(bm.floor, 23);
chat[25] = ai(tag('陈映竹', ['对{{user}}好感: 90 /100(+10)', '-臣服值: 40 /100', '-累计高潮次数: 4']));
CS.captureFromMessage(25, names);
assert.deepEqual(CS.bookmarkDiff(bm.id, '陈映竹'), [{ field: '对<user>好感', from: 80, to: 90 }, { field: '累计高潮次数', from: 3, to: 4 }]);
const bm2 = CS.addBookmark('');
assert.equal(CS.listBookmarks().length, 2);
assert.equal(CS.deleteBookmark(bm2.id), true);
assert.equal(CS.deleteBookmark('nope'), false);
assert.deepEqual(CS.listBookmarks().map(b => b.id), [bm.id]);
console.log('✓ 书签');

// ---------------------------------------------------------------- 置顶、标签、备注、头像
assert.equal(CS.togglePin('陈映竹'), true);
assert.deepEqual([...CS.getPins()], ['陈映竹']);
assert.equal(CS.togglePin('陈映竹'), false);
assert.equal(CS.getPins().size, 0);
CS.togglePin('苏晴');
assert.deepEqual(CS.setTags('陈映竹', '同学， 后宫,同学'), ['同学', '后宫']);
CS.setTags('苏晴', ['同事']);
assert.deepEqual(CS.getTags('陈映竹'), ['同学', '后宫']);
assert.deepEqual(CS.allTags().sort(), ['同事', '同学', '后宫'].sort());
CS.setTags('苏晴', []);
assert.deepEqual(CS.getTags('苏晴'), []);
CS.setNote('陈映竹', '怕黑');
assert.equal(CS.getNote('陈映竹'), '怕黑');
CS.setAvatar('陈映竹', 'data:image/jpeg;base64,AAA');
assert.equal(CS.getAvatar('陈映竹'), 'data:image/jpeg;base64,AAA');
CS.setAvatar('苏晴', 'javascript:alert(1)');
assert.equal(CS.getAvatar('苏晴'), '', '只收图片 dataURL');
CS.setAvatar('陈映竹', 'data:image/jpeg;base64,BBB', '/user/images/%E6%9F%8F/a.png');
assert.equal(CS.getAvatarFull('陈映竹'), '/user/images/%E6%9F%8F/a.png', '原图只存路径');
CS.setAvatar('陈映竹', 'data:image/jpeg;base64,CCC', 'https://evil/x.png');
assert.equal(CS.getAvatarFull('陈映竹'), '', '外站地址不收');
CS.setAvatar('陈映竹', 'data:image/jpeg;base64,AAA');
console.log('✓ 置顶、分组标签、备注、头像');

// ---------------------------------------------------------------- 备份
const backup = JSON.parse(JSON.stringify(CS.exportBackup({ text: '资料' })));
assert.equal(backup.version, 1);
assert.equal(backup.chat, 'chat-1');
assert.equal(backup.extra.text, '资料');
assert.equal(backup.card.status['陈映竹'].floor, 25);
delete chatMetadata[KEY];
assert.deepEqual(CS.cardState().status, {}, '换了聊天是空的');
assert.equal(CS.importBackup({ nope: 1 }).ok, false);
assert.equal(CS.importBackup(null).ok, false);
const res = CS.importBackup(backup);
assert.equal(res.ok, true);
assert.ok(res.characters >= 3);
assert.deepEqual(JSON.parse(JSON.stringify(CS.cardState())), backup.card, '导入后和导出一致');
// 再导入一次不重复
CS.importBackup(backup);
assert.deepEqual(JSON.parse(JSON.stringify(CS.cardState())), backup.card, '重复导入不叠加');
console.log('✓ 备份导出导入');

// 保存有节流
await new Promise(r => setTimeout(r, 1100));
assert.ok(saves >= 1 && saves <= 2, `保存次数 ${saves}`);
console.log('✓ 保存节流');
console.log('全部通过');
