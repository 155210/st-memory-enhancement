import { USER } from './manager.js';

/**
 * @description 找人名用的正文：去掉填表指令、思考、HTML 注释，以及设置里「找人名时跳过的标签」
 * @description 判断在场、找回旧事、触发发送都用它，正文里列了一堆人的状态栏之类的标签可以填进设置里跳过
 */

/** 设置里填的标签名：逗号、顿号、空格、换行分隔，可以带尖括号 */
export function ignoredTags() {
    return String(USER.tableBaseSetting.v2_ignore_tags || '')
        .split(/[,，、\s]+/)
        .map(t => t.replace(/^<\/?|>$/g, '').trim())
        .filter(Boolean);
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function cleanChatText(text, tags = ignoredTags()) {
    let out = String(text ?? '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of tags) {
        const t = escapeRe(tag);
        out = out.replace(new RegExp(`<${t}(\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'gi'), '');
    }
    return out;
}
