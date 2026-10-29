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
const { parsePreset, buildExtraMessages } = await import(REPO + '/core/extraPreset.js');
const stPreset = {
  prompts: [
    { identifier: 'main', name: 'Main Prompt', role: 'system', content: '破限说明 {{user}}' },
    { identifier: 'worldInfoBefore', name: 'World Info', marker: true },
    { identifier: 'charDescription', name: 'Char', marker: true },
    { identifier: 'chatHistory', name: 'Chat History', marker: true },
    { identifier: 'jailbreak', name: 'Post-History', role: 'system', content: '后置指令' },
    { identifier: 'off', name: '关掉的', role: 'system', content: '不该出现' },
    { identifier: 'empty', name: '空的', role: 'system', content: '  ' },
    { identifier: 'deep', name: '深度注入', role: 'user', content: '深度0', injection_position: 1, injection_depth: 0 },
    { identifier: 'prefill', name: '预填充', role: 'assistant', content: '好的，' },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: 'off', enabled: true }] },
    { character_id: 100001, order: ['main', 'worldInfoBefore', 'charDescription', 'chatHistory', 'jailbreak', 'off', 'empty', 'deep', 'prefill'].map(identifier => ({ identifier, enabled: identifier !== 'off' })) },
  ],
};
const parsed = parsePreset(stPreset, '我的预设');
assert.equal(parsed.name, '我的预设');
assert.deepEqual(parsed.items.map(i => i.slot ? '[v2]' : i.content), ['破限说明 {{user}}', '[v2]', '深度0', '后置指令', '好的，'], '按顺序、跳过关掉的和空的、v2 内容放在聊天记录位置');
assert.throws(() => parsePreset({ foo: 1 }), /对话补全预设/);
const noSlot = parsePreset({ prompts: [{ identifier: 'a', role: 'system', content: 'A' }, { identifier: 'p', role: 'assistant', content: '预填' }] });
assert.deepEqual(noSlot.items.map(i => i.slot ? '[v2]' : i.content), ['A', '[v2]', '预填'], '没有聊天记录位置时放在预填充前面');

USER.tableBaseSetting.v2_extra_preset = parsed;
USER.tableBaseSetting.v2_extra_preset_enabled = false;
assert.equal(buildExtraMessages('S', 'U').length, 2, '没开预设只有两条');
USER.tableBaseSetting.v2_extra_preset_enabled = true;
assert.deepEqual(buildExtraMessages('S', 'U').map(m => `${m.role}:${m.content}`), ['system:破限说明 {{user}}', 'system:S', 'user:U', 'user:深度0', 'system:后置指令', 'assistant:好的，']);
USER.tableBaseSetting.v2_extra_api = 'main';
let sent = null;
APP.generateRaw = async (opts) => { sent = opts; return '预设回复'; };
assert.equal(await ER.askExtra('S', 'U', '预设'), '预设回复');
assert.equal(Array.isArray(sent.prompt) && sent.prompt.length, 6, '主 API 整组消息发出去');
USER.tableBaseSetting.v2_extra_preset_enabled = false;
console.log('✓ 额外请求套用酒馆预设');
