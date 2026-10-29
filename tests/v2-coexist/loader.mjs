// 把酒馆的绝对路径模块（/script.js、/scripts/...）换成测试桩
const NAMES = {
  '/lib.js': ['DOMPurify','Bowser','slideToggle'],
  '/scripts/f-localStorage.js': ['LoadLocal','SaveLocal','LoadLocalBool'],
  '/scripts/popup.js': ['POPUP_TYPE','Popup','callGenericPopup'],
  '/scripts/extensions.js': ['extensionNames','extension_settings','getContext','renderExtensionTemplateAsync'],
  '/scripts/i18n.js': ['getCurrentLocale'],
  '/scripts/power-user.js': ['power_user','applyPowerUserSettings','getContextSettings','loadPowerUserSettings'],
  '/script.js': ['reloadCurrentChat','saveSettingsDebounced','saveSettings','getSlideToggleOptions','generateRaw','saveChat','eventSource','event_types','getRequestHeaders','doNavbarIconClick'],
  '/scripts/group-chats.js': ['saveGroupChat','selected_group'],
  '/scripts/custom-request.js': ['ChatCompletionService','TextCompletionService'],
};
export async function resolve(spec, ctx, next) {
  if (NAMES[spec]) return { url: 'stub:' + spec, shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith('stub:')) {
    const spec = url.slice(5);
    const src = NAMES[spec].map(n => `export const ${n} = globalThis.__ST[${JSON.stringify(n)}];`).join('\n');
    return { format: 'module', source: src, shortCircuit: true };
  }
  return next(url, ctx);
}
