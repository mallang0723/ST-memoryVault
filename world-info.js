// Translate the original vault's entries to native SillyTavern World Info.
// Collapse Marinara's recursive proxy entries into literal OR/AND conditions.
// This preserves retrieval even when SillyTavern's global recursion is disabled.
export const WORLD_KEY = 'memoryVault';
const TRIGGER_TAGS = new Set(['memory-cabinet-element-trigger', 'memory-cabinet-wiki-trigger']);
const BACKUP_TAG = 'memory-cabinet-structured-backup';

function literal(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

export function literalKey(value) {
    // ST recognizes /.../flags automatically; user keywords must stay literal.
    return `/${literal(value)}/i`;
}

export function conditionKeys(entry) {
    const primary = (entry.keys || []).filter(Boolean);
    const secondary = (entry.secondaryKeys || []).filter(Boolean);
    if (!entry.selective || !secondary.length) return primary.map(literalKey);
    // The source extension only creates AND_ALL groups.
    return primary.map(key => `/^(?=[\\s\\S]*${literal(key)})${secondary.map(term => `(?=[\\s\\S]*${literal(term)})`).join('')}[\\s\\S]*$/i`);
}

function entityKey(entry) {
    const d = entry.dynamicState || {};
    return d.memoryCabinetElementId ? `element:${d.memoryCabinetElementId}` : `wiki:${d.memoryCabinetWikiId}`;
}

export function compileWorldInfo(book, template = {}) {
    const source = Object.values(book.entries || {});
    const triggers = new Map();
    for (const entry of source) {
        if (!TRIGGER_TAGS.has(entry.tag) || entry.enabled === false) continue;
        const key = entityKey(entry);
        triggers.set(key, [...(triggers.get(key) || []), ...conditionKeys(entry)]);
    }
    const entries = {};
    for (const entry of source) {
        if (TRIGGER_TAGS.has(entry.tag)) continue;
        const isBody = ['memory-cabinet-element-facts', 'memory-cabinet-wiki-doc'].includes(entry.tag);
        const keys = isBody ? (triggers.get(entityKey(entry)) || []) : conditionKeys(entry);
        const uid = Number(entry.id);
        if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('잘못된 로어북 항목 ID입니다.');
        entries[uid] = {
            ...structuredClone(template),
            uid, key: keys, keysecondary: [], comment: entry.name || '',
            content: String(entry.content || ''), constant: entry.constant === true,
            selective: false, selectiveLogic: 0,
            disable: entry.enabled === false || entry.tag === BACKUP_TAG || (!entry.constant && !keys.length),
            order: 1000 - (Number(entry.order) || 0), position: 0, depth: 4, role: 0,
            probability: 100, useProbability: false, vectorized: false, ignoreBudget: false,
            scanDepth: Number(book.scanDepth) || 4, caseSensitive: false, matchWholeWords: false,
            preventRecursion: true, excludeRecursion: true, delayUntilRecursion: 0,
            group: '', groupOverride: false, groupWeight: 100, sticky: null, cooldown: null, delay: null,
            triggers: [], automationId: '',
            extensions: { [WORLD_KEY]: { ownerChatId: book.chatId, sourceEntryId: entry.id, tag: entry.tag } },
        };
    }
    return { name: book.name, entries, extensions: { [WORLD_KEY]: structuredClone(book) } };
}

export function removeManagedEntries(lists) {
    for (const list of Object.values(lists)) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.extensions?.[WORLD_KEY]) list.splice(i, 1);
        }
    }
}
