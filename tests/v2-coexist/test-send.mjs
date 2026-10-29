// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-send.mjs "$PWD"
// 检查阶段 3：角色分档发送、条件块、定时提醒、注入预览
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
// 阶段 3：角色分档发送、条件块、定时提醒、注入预览
const { getTablePromptByPiece, initTableData } = await import(REPO + '/index.js');
const { computeTiers, rowTier, buildTieredRows } = await import(REPO + '/core/sendTiers.js');
const { applyConditionalBlocks, dueReminderText, lastInjection, parseReminders } = await import(REPO + '/core/promptExtras.js');

const setRow = (s, r, values) => s.getCellsByRowIndex(r).forEach((c, i) => { if (i) c.data.value = values[i - 1] ?? ''; });
const mkChat = (name, headers, rows = [], rules = {}) => {
  const s = BASE.createChatSheet(headers.length + 1, 1); s.name = name; setRow(s, 0, headers); s.enable = true; Object.assign(s.source.data, rules);
  rows.forEach(values => { s.findCellByPosition(s.getRowCount() - 1, 0).newAction('insertDownRow', {}, false); setRow(s, s.getRowCount() - 1, values); });
  return s;
};
const pushFloor = (user, ai) => { chat.push({ is_user: true, mes: user }); chat.push({ is_user: false, mes: ai }); return chat.length - 1; };

// 30 层里：林悠悠、陈默常出场；苏晴出现过一次；王五从没出现
for (let i = 0; i < 12; i++) pushFloor('……', i % 2 ? '林悠悠笑了' : '陈默点头');
pushFloor('……', '苏晴路过');
for (let i = 0; i < 4; i++) pushFloor('……', '林悠悠和陈默聊天');
pushFloor('……', '林悠悠独自看书');
const last = pushFloor('去找林悠悠', '林悠悠在宿舍');
const long = '很长的描写'.repeat(20);
const sheets = [
  mkChat('时空表格', ['日期', '时间', '地点', '此地角色'], [['2025年6月15日', '18:15', '宿舍', '<user>/林悠悠/赵六']]),
  mkChat('角色特征表格', ['角色名', '身体特征', '#往事'], [['<user>', '男', ''], ['林悠悠|悠悠', long, ''], ['陈默', long, '很早的一件事'.repeat(6) + '；最近的事'], ['苏晴', '温柔', ''], ['王五', '路人', ''], ['赵六', '店主', '']], { insertNode: '新角色插入' }),
  mkChat('角色与<user>社交表格', ['角色名', '对<user>关系'], [['林悠悠', '同学'], ['王五', '邻居'], ['陈默', '室友']]),
  mkChat('事件历史', ['事件', '日期'], Array.from({ length: 5 }, (_, i) => [`事${i}`, ''])),
  mkChat('大总结', ['内容', '层级'], [['2025年6月1日/学校/开学', '大']], { insertNode: '禁止插入', deleteNode: '禁止删除' }),
  mkChat('悬念簿', ['悬念'], [['伏笔']], { deleteNode: '{{#if 悬念簿>=8}}删最早的{{/if}}{{#if 事件历史>=5}}事件多了{{else}}事件少{{/if}}' }),
];
sheets.forEach(s => s.save(chat[last], true));
Object.assign(USER.tableBaseSetting, { v2_tier_enabled: true, v2_tier_main_count: 2, v2_summary_enabled: true, v2_reminders_enabled: true, v2_reminders: '10|检查伏笔\n3|推进主线\n乱写的一行' });

const tiers = computeTiers(sheets);
assert.deepEqual([...tiers.present].sort(), ['林悠悠', '赵六'].sort(), '在场：最近正文 + 此地角色');
assert.deepEqual([...tiers.main].sort(), ['林悠悠', '陈默'].sort(), '主要角色按最近出场次数');
assert.equal(rowTier('<user>', tiers), 'full');
assert.equal(rowTier('悠悠', tiers), 'full', '外号也算');
assert.equal(rowTier('陈默', tiers), 'brief');
assert.equal(rowTier('王五', tiers), 'roster');

const prompt = getTablePromptByPiece(chat[last]);
const roleBlock = prompt.slice(prompt.indexOf('1:角色特征表格'), prompt.indexOf('2:角色与'));
assert.match(roleBlock, /\n0,<user>,男,/, '<user> 完整');
assert.match(roleBlock, new RegExp(`\\n1,林悠悠\\|悠悠,${long}`), '在场完整，行号不变');
assert.match(roleBlock, /\n2,陈默,很长的描写.*…,…最近的事/, '主要角色简要，追加列只留最后一段');
assert.match(roleBlock, /【名册[^\n]*3:苏晴、4:王五/, '其余进名册，带原行号');
assert.match(roleBlock, /5,赵六,店主/, '此地角色算在场');
assert.match(roleBlock, /插入：新角色插入/, '规则照发');
const socialBlock = prompt.slice(prompt.indexOf('2:角色与'), prompt.indexOf('3:事件历史'));
assert.match(socialBlock, /1:王五\(邻居\)/, '名册带关系');
const bigBlock = prompt.slice(prompt.indexOf('4:大总结'), prompt.indexOf('5:悬念簿'));
assert.doesNotMatch(bigBlock, /禁止插入/, '程序维护的大总结不发增删改规则');
const hookBlock = prompt.slice(prompt.indexOf('5:悬念簿'));
assert.doesNotMatch(hookBlock, /删最早的/, '条件不成立不发');
assert.match(hookBlock, /事件多了/);
assert.doesNotMatch(hookBlock, /事件少/);
console.log('✓ 角色分档：在场完整、主要简要、其余名册、行号不变；大总结不发规则；条件块');

const pairSheet = mkChat('角色关系表', ['角色A', '角色B', '关系', '#关系变化'], [['悠悠', '陈默', '暗恋', ''], ['王五', '苏晴', '邻居', ''], ['陈默', '王五', '旧识', ''], ['<user>', '苏晴', '同事', '']]);
const pairRows = buildTieredRows(pairSheet, tiers);
assert.match(pairRows.text, /^0,悠悠,陈默,暗恋/m, '有一个在场就发整行');
assert.match(pairRows.text, /^2,陈默,王五,旧识/m, '有一个是主要角色也发整行');
assert.doesNotMatch(pairRows.text, /^3,/m, '和你的关系看另一个人');
assert.match(pairRows.text, /【以下关系[^\n]*1:王五-苏晴、3:<user>-苏晴/, '两个人都不在场只列行号和名字');
console.log('✓ 角色关系表按在场发送');

assert.equal(applyConditionalBlocks('a{{#if 不存在的表>1}}b{{/if}}c{{#if 写错了}}d{{/if}}', sheets), 'acd', '没有的表不成立，写错的条件不吞内容');
assert.equal(applyConditionalBlocks('{{#if 轮次>=1}}x{{/if}}', sheets), 'x');
assert.equal(parseReminders().length, 2);
assert.match(dueReminderText(30), /检查伏笔[\s\S]*推进主线/);
assert.equal(dueReminderText(7), '');
assert.match(dueReminderText(9), /推进主线/);
console.log('✓ 定时提醒按轮次');

power_user['message_template_v2'] = undefined;
USER.tableBaseSetting.message_template = '前言{{#if 事件历史>=20}}大总结说明{{/if}}\n{{tableData}}';
chat.push({ is_user: true, mes: '继续' });   // 生成时最后一条是用户消息
const full = initTableData();
assert.doesNotMatch(full, /大总结说明/);
const entry = lastInjection();
assert.equal(entry.totalChars, full.length);
assert.ok(entry.sheets.find(x => x.name === '角色特征表格').tiers.roster === 2);
assert.equal(entry.turn, chat.filter(m => !m.is_user).length + 1);
console.log('✓ 消息模板条件块、注入预览记录');

USER.tableBaseSetting.v2_tier_enabled = false;
assert.match(getTablePromptByPiece(chat[last]), /\n4,王五,路人/, '关掉分档后整表照发');
console.log('✓ 关掉分档整表照发');

const { resolveCellWrite } = await import(REPO + '/core/rowIdentity.js');
assert.equal(resolveCellWrite('身体特征', long, '很长的描写很长的描写…'), undefined, 'AI 抄回截短的格子不覆盖');
assert.equal(resolveCellWrite('#往事', '早；最近的事', '…最近的事'), undefined);
assert.equal(resolveCellWrite('身体特征', '旧', '新的…描写'), '新的…描写', '真的新内容照写');
console.log('✓ 截短的格子抄回来不覆盖原文');

// 判断在场时不看填表指令和思考
chat.length = 0;
chat.push({ is_user: true, mes: '去找林悠悠' });
chat.push({ is_user: false, mes: '<think>陈默在哪</think>林悠悠在门口。<tableEdit>\n<!--\nupdateRow(1, 2, {"1":"苏晴 冷淡"})\n-->\n</tableEdit>' });
const recent = SM.recentText(1);
assert.match(recent, /林悠悠在门口/);
assert.doesNotMatch(recent, /陈默|苏晴|updateRow/);
console.log('✓ 在场判断不算填表指令和思考里的人');
