import { USER } from './manager.js';

/**
 * @description U4 多主题：表格面板换配色，只是给 body 加一个 class，样式在 style.css 里
 * @description 「跟随酒馆主题」不加 class，沿用酒馆的主题颜色
 */
export const THEMES = ['follow', 'paper', 'night', 'mint', 'contrast'];

export function applyTheme(name = USER.tableBaseSetting.v2_theme || 'follow') {
    const body = globalThis.document?.body;
    if (!body?.classList) return;
    THEMES.forEach(theme => body.classList.remove(`v2-theme-${theme}`));
    if (name !== 'follow' && THEMES.includes(name)) body.classList.add(`v2-theme-${name}`);
}
