// 用法：node --import ./tests/v2-coexist/register.mjs tests/v2-coexist/test-extra.mjs "$PWD"
// 检查额外请求：排队、等正文生成完、选主 API 或自定义 API、失败原因留下
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
const ER = await import(REPO + '/core/extraRequest.js');
const { APP } = await import(REPO + '/core/manager.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 酒馆生成中：停止按钮可见
let generating = true;
globalThis.getComputedStyle = () => ({ display: generating ? 'flex' : 'none' });
globalThis.document = { getElementById: (id) => id === 'mes_stop' ? { offsetParent: generating ? {} : null } : null };
assert.equal(ER.isMainGenerating(), true);

const calls = [];
APP.generateRaw = async ({ prompt, systemPrompt }) => { calls.push({ prompt, systemPrompt, at: Date.now() }); await sleep(20); return `回复:${prompt}`; };
Object.assign(USER.tableBaseSetting, { v2_extra_api: 'main', v2_request_panel: false });

const start = Date.now();
const a = ER.askExtra('系统A', '甲', '测试A');
const b = ER.askExtra('系统B', '乙', '测试B');
await sleep(1200);
assert.equal(calls.length, 0, '正文生成中不发');
generating = false;
assert.deepEqual(await Promise.all([a, b]), ['回复:甲', '回复:乙']);
assert.deepEqual(calls.map(c => c.prompt), ['甲', '乙'], '按顺序一个一个发');
assert.ok(calls[1].at - calls[0].at >= 20, '上一个结束才发下一个');
console.log('✓ 排队、等正文生成完再发');

APP.generateRaw = async () => '';
await assert.rejects(ER.askExtra('s', 'u', '空'), /空内容/);
assert.match(DERIVED.any.lastExtraRequest.error, /空内容/, '失败原因记下来');
APP.generateRaw = async () => { throw new Error('网络断了'); };
await assert.rejects(ER.askExtra('s', 'u', '断网'), /网络断了/);
APP.generateRaw = async ({ prompt }) => `好:${prompt}`;
assert.equal(await ER.askExtra('s', '恢复', '恢复'), '好:恢复', '前一个失败不卡住队列');
console.log('✓ 失败原因留下，不卡队列');

USER.tableBaseSetting.v2_extra_api = '';
USER.tableBaseSetting.use_main_api = false;
assert.equal(ER.useMainApi(), false, '没单独设时沿用「使用主API」');
USER.tableBaseSetting.v2_extra_api = 'main';
assert.equal(ER.useMainApi(), true);
USER.tableBaseSetting.v2_extra_api = 'custom';
await assert.rejects(ER.askExtra('s', 'u', '自定义'), /地址或模型没填|Key/);
console.log('✓ 额外请求选主 API / 自定义 API');

// 套用酒馆预设
const { parsePreset, buildExtraMessages, normalizePreset, SLOT_ID, TASK_REMINDER } = await import(REPO + '/core/extraPreset.js');
const stPreset = {
  squash_system_messages: false,
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', content: '破限说明 {{user}}', enabled: false },
    { identifier: 'worldInfoBefore', name: 'World Info', marker: true },
    { identifier: 'charDescription', name: 'Char', marker: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    { identifier: 'jailbreak', name: 'Post-History', role: 'system', content: '后置指令' },
    { identifier: 'off', name: '关掉的', role: 'system', content: '不该出现' },
    { identifier: 'deep', name: '深度注入', role: 'user', content: '深度0', injection_position: 1, injection_depth: 0 },
    { identifier: 'deep1', name: '深度1', role: 'system', content: '深度1', injection_position: 1, injection_depth: 1 },
    { identifier: 'trig', name: '只在续写时', role: 'system', content: '续写', injection_trigger: ['continue'] },
    { identifier: 'orphan', name: '没放进列表的', role: 'system', content: '孤儿' },
    { identifier: 'prefill', name: '预填充', role: 'assistant', content: '好的，' },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'off', enabled: true }] },
    { character_id: 100001, order: ['main', 'worldInfoBefore', 'charDescription', 'chatHistory', 'jailbreak', 'off', 'deep', 'deep1', 'trig', 'prefill'].map(identifier => ({ identifier, enabled: identifier !== 'off' })) },
  ],
};
const parsed = parsePreset(stPreset, '我的预设');
assert.equal(parsed.name, '我的预设');
assert.deepEqual(parsed.entries.map(e => `${e.id}:${e.enabled}`), ['main:true', `${SLOT_ID}:true`, 'jailbreak:true', 'off:false', 'deep:true', 'deep1:true', 'trig:false', 'prefill:true'], '顺序和开关跟酒馆一样，只认 prompt_order 的开关，占位条目不导入');
assert.deepEqual(parsed.extras.map(e => e.id), ['orphan'], '没放进列表的单独收着');
assert.throws(() => parsePreset({ foo: 1 }), /prompts/);
assert.deepEqual(parsePreset({ data: { prompts: [{ identifier: 'a', role: 'system', content: 'A' }], prompt_order: [{ identifier: 'a', enabled: true }] } }).entries.map(e => e.id), ['a', SLOT_ID], '提示词管理器单独导出的格式也认；没有聊天记录时占位放末尾');

USER.tableBaseSetting.v2_extra_preset = parsed;
USER.tableBaseSetting.v2_extra_preset_enabled = false;
assert.equal(buildExtraMessages('S', 'U').length, 2, '没开预设只有两条');
USER.tableBaseSetting.v2_extra_preset_enabled = true;
assert.deepEqual(buildExtraMessages('S', 'U').map(m => `${m.role}:${m.content}`), ['system:破限说明 {{user}}', 'system:S', 'system:深度1', 'user:U', 'user:深度0', 'system:后置指令', `user:${TASK_REMINDER}\n\nS\n\n严格按上面要求的输出格式回答，只输出要求的内容。`, 'assistant:好的，'], '深度条目插进 v2 内容里；任务提醒放在后置指令之后、预填充之前');
// 调顺序、关条目后照新顺序发
const edited = normalizePreset(parsed);
edited.entries.reverse();
edited.entries.find(e => e.id === 'jailbreak').enabled = false;
USER.tableBaseSetting.v2_extra_preset = edited;
assert.deepEqual(buildExtraMessages('S', 'U').map(m => m.content), ['好的，', 'S', '深度1', 'U', '深度0', '破限说明 {{user}}', `${TASK_REMINDER}\n\nS\n\n严格按上面要求的输出格式回答，只输出要求的内容。`], '末尾不是预填充时提醒放最后');
USER.tableBaseSetting.v2_extra_preset = parsed;
USER.tableBaseSetting.v2_extra_api = 'main';
let sent = null;
APP.generateRaw = async (opts) => { sent = opts; return '预设回复'; };
assert.equal(await ER.askExtra('S', 'U', '预设'), '预设回复');
assert.equal(Array.isArray(sent.prompt) && sent.prompt.length, 8, '主 API 整组消息发出去');
USER.tableBaseSetting.v2_extra_preset_enabled = false;
console.log('✓ 额外请求套用酒馆预设：顺序、开关、深度、调顺序');

// 停止：正在发的立刻结束，停止前排队的也取消，之后的请求照常
let stopCalled = 0;
const ctx = USER.getContext();
const oldStop = ctx.stopGeneration;
ctx.stopGeneration = () => { stopCalled++; };
APP.generateRaw = () => new Promise(() => {});   // 模型一直不回
const hanging = ER.askExtra('s', 'u', '一直不回');
const queued = ER.askExtra('s', 'u', '排队中');
await new Promise(r => setTimeout(r, 50));
ER.stopCurrent();
await assert.rejects(hanging, /已手动停止/);
await assert.rejects(queued, /已手动停止/);
assert.equal(stopCalled, 1, '主 API 没有酒馆助手时调用酒馆的停止');
APP.generateRaw = async () => '停止后照常';
assert.equal(await ER.askExtra('s', 'u', '之后'), '停止后照常');
ctx.stopGeneration = oldStop;
console.log('✓ 停止立刻生效，排队的一起取消');

// 设置按钮的 New 标记：代码里的版本号必须和 manifest 一致，否则一直显示 New
const { readFileSync } = await import('node:fs');
const manifestVersion = JSON.parse(readFileSync(REPO + '/manifest.json', 'utf8')).version;
assert.equal(readFileSync(REPO + '/index.js', 'utf8').match(/const VERSION = '([^']+)'/)[1], manifestVersion, 'index.js 的 VERSION 和 manifest.json 一致');
console.log('✓ 版本号一致');
