import { APP, DERIVED, USER } from './manager.js';
import { LLMApiService } from '../services/llmApi.js';
import { getDecryptedApiKey } from '../scripts/settings/standaloneAPI.js';

/**
 * @description v2 额外请求（写大总结、压缩、回填、融合、画地图）统一从这里发：
 * @description - 排队一个一个发，正文还在生成时先等它生成完，不和正文抢
 * @description - 屏幕底部有个面板，流式显示模型正在输出什么；失败原因留在面板上，不会一闪而过
 * @description - 面板上可以停止；用主 API 时优先走「酒馆助手」的流式接口，没装就用酒馆自带的（不流式，显示等待秒数）
 */

const PANEL_ID = 'v2_request_panel';
const WAIT_LIMIT_MS = 10 * 60 * 1000;

let chain = Promise.resolve();
let current = null;   // { stopped, generationId }

/** 正文是否正在生成：酒馆生成时会显示停止按钮 */
export function isMainGenerating() {
    try {
        const stop = globalThis.document?.getElementById?.('mes_stop');
        if (!stop) return false;
        return stop.offsetParent !== null && getComputedStyle(stop).display !== 'none';
    } catch (_) {
        return false;
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** 额外请求用哪个 API：v2 设置优先，没设时沿用「表格总结/整理」里的「使用主API」 */
export function useMainApi() {
    const choice = USER.tableBaseSetting.v2_extra_api;
    if (choice === 'main') return true;
    if (choice === 'custom') return false;
    return USER.tableBaseSetting.use_main_api !== false;
}

// ---------------------------------------------------------------- 面板

const panelEnabled = () => USER.tableBaseSetting.v2_request_panel !== false && !!globalThis.document?.body;

function panel() {
    if (!panelEnabled()) return null;
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML = `
        <div class="v2rp-head">
            <b class="v2rp-title"></b>
            <span class="v2rp-status"></span>
            <span class="v2rp-buttons">
                <button class="menu_button v2rp-stop" type="button">停止</button>
                <button class="menu_button v2rp-toggle" type="button">收起</button>
                <button class="menu_button v2rp-close" type="button">关闭</button>
            </span>
        </div>
        <pre class="v2rp-body"></pre>`;
    document.body.appendChild(el);
    el.querySelector('.v2rp-stop').addEventListener('click', () => stopCurrent());
    el.querySelector('.v2rp-close').addEventListener('click', () => { el.style.display = 'none'; });
    el.querySelector('.v2rp-toggle').addEventListener('click', () => {
        const body = el.querySelector('.v2rp-body');
        const hidden = body.style.display === 'none';
        body.style.display = hidden ? '' : 'none';
        el.querySelector('.v2rp-toggle').textContent = hidden ? '收起' : '展开';
    });
    return el;
}

function showPanel(title) {
    const el = panel();
    if (!el) return;
    el.style.display = '';
    el.dataset.state = 'running';
    el.querySelector('.v2rp-title').textContent = title;
    el.querySelector('.v2rp-status').textContent = '';
    el.querySelector('.v2rp-body').textContent = '';
    el.querySelector('.v2rp-stop').style.display = '';
}

function setStatus(text, state) {
    const el = panel();
    if (!el) return;
    el.querySelector('.v2rp-status').textContent = text;
    if (state) el.dataset.state = state;
    if (state && state !== 'running' && state !== 'waiting') el.querySelector('.v2rp-stop').style.display = 'none';
}

function setBody(text) {
    const el = panel();
    if (!el) return;
    const body = el.querySelector('.v2rp-body');
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
    body.textContent = text;
    if (atBottom) body.scrollTop = body.scrollHeight;
}

/** 停止当前请求 */
export function stopCurrent() {
    if (!current) return;
    current.stopped = true;
    try {
        if (current.generationId && typeof globalThis.TavernHelper?.stopGenerationById === 'function') {
            globalThis.TavernHelper.stopGenerationById(current.generationId);
        }
    } catch (_) { }
    setStatus('已停止', 'stopped');
}

// ---------------------------------------------------------------- 发送

async function waitForIdle(title) {
    const start = Date.now();
    while (isMainGenerating()) {
        if (current?.stopped) throw new Error('已手动停止');
        if (Date.now() - start > WAIT_LIMIT_MS) throw new Error('正文一直在生成，等了 10 分钟没等到，先不发了');
        setStatus(`等正文生成完再发…${Math.round((Date.now() - start) / 1000)} 秒`, 'waiting');
        await sleep(1000);
    }
    // 正文刚结束时酒馆还要收尾（保存、渲染），稍等一下
    if (Date.now() - start > 0 && Date.now() - start >= 1000) await sleep(1500);
}

async function viaMainApi(system, user, onText) {
    const helper = globalThis.TavernHelper;
    if (typeof helper?.generateRaw === 'function') {
        const generationId = `memory_v2_${Date.now()}`;
        current.generationId = generationId;
        const source = APP.eventSource;
        const listener = (text, id) => { if (id === generationId || id === undefined) onText(String(text ?? '')); };
        source?.on?.('js_stream_token_received_fully', listener);
        try {
            return await helper.generateRaw({
                ordered_prompts: [{ role: 'system', content: system }, { role: 'user', content: user }],
                should_stream: true,
                generation_id: generationId,
            });
        } finally {
            source?.removeListener?.('js_stream_token_received_fully', listener);
        }
    }
    if (typeof APP.generateRaw !== 'function') throw new Error('酒馆版本太旧，没有 generateRaw，请更新酒馆或安装酒馆助手');
    return await APP.generateRaw({ prompt: user, systemPrompt: system, trimNames: false });
}

async function viaCustomApi(system, user, onText) {
    const privacy = USER.IMPORTANT_USER_PRIVACY_DATA || {};
    if (!privacy.custom_api_url || !privacy.custom_model_name) throw new Error('自定义 API 的地址或模型没填');
    const keys = String(await getDecryptedApiKey() || '').split(',').map(k => k.trim()).filter(Boolean);
    if (!keys.length) throw new Error('自定义 API 的 Key 没填或解密失败');
    const service = new LLMApiService({
        api_url: privacy.custom_api_url,
        api_key: keys[0],
        model_name: privacy.custom_model_name,
        system_prompt: system,
        temperature: USER.tableBaseSetting.custom_temperature,
        max_tokens: Number(USER.tableBaseSetting.custom_max_tokens) || 4096,
    });
    let text = '';
    return await service.callLLM(user, (chunk) => { text += chunk; onText(text); });
}

async function run(system, user, title) {
    current = { stopped: false, generationId: null };
    const started = Date.now();
    showPanel(title);
    let timer = null;
    let received = '';
    try {
        await waitForIdle(title);
        const main = useMainApi();
        setStatus(`${main ? '主 API' : '自定义 API'} 生成中…`, 'running');
        timer = setInterval(() => {
            if (current?.stopped) return;
            setStatus(`${main ? '主 API' : '自定义 API'} 生成中… ${((Date.now() - started) / 1000).toFixed(0)} 秒，已收到 ${received.length} 字`, 'running');
        }, 1000);
        const onText = (text) => { received = text; setBody(text); };
        const result = main ? await viaMainApi(system, user, onText) : await viaCustomApi(system, user, onText);
        if (current.stopped) throw new Error('已手动停止');
        const text = typeof result === 'string' ? result : String(result ?? '');
        DERIVED.any.lastExtraRequest = { at: new Date().toISOString(), title, system, user, result: text };
        if (!text.trim()) throw new Error('模型返回了空内容');
        setBody(text);
        setStatus(`完成，用时 ${((Date.now() - started) / 1000).toFixed(0)} 秒`, 'done');
        return text;
    } catch (error) {
        DERIVED.any.lastExtraRequest = { at: new Date().toISOString(), title, system, user, result: received, error: String(error?.message || error) };
        setStatus(`失败：${error?.message || error}`, 'error');
        if (received) setBody(received);
        throw error;
    } finally {
        clearInterval(timer);
        current = null;
    }
}

/**
 * 发一个额外请求（排队、等正文、流式显示）
 * @param {string} system
 * @param {string} user
 * @param {string} title 面板标题，例如「写大总结」
 * @returns {Promise<string>}
 */
export function askExtra(system, user, title = '记忆表格 v2 额外请求') {
    const task = chain.then(() => run(system, user, title));
    chain = task.catch(() => {});
    return task;
}
