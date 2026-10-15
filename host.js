import { DATA_KEY } from './migration.js';
import { WORLD_KEY, compileWorldInfo, compileLegacyWorldInfo, removeManagedEntries } from './world-info.js';

export const HOST_KEY = 'memoryVaultHost';
export const SETTINGS_KEY = 'memoryVault';
const clone = value => value === undefined ? undefined : structuredClone(value);
function characterScope(ctx) {
    const group = (ctx.groups || []).find(g => String(g.id) === String(ctx.groupId));
    const characters = ctx.groupId ? (ctx.characters || []).filter(c => group?.members?.includes(c.avatar)) : [ctx.characters?.[ctx.characterId]].filter(Boolean);
    const raw = group?.generation_mode;
    const mode = !ctx.groupId || raw === 0 || raw === '0' || raw === 'swap' ? 'swap' : raw === 1 || raw === '1' ? 'append' : 'append_disabled';
    return { characters, mode };
}
function normalizedDate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value < 1e11 ? value * 1000 : value).toISOString();
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return '';
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}
async function messageBoundary(chat, hashString) {
    const text = JSON.stringify((chat || []).map(m => [!!m.is_user, !!m.is_system, m.mes, m.send_date, m.swipe_id]));
    const hash = hashString ? await hashString(text) : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
    return { count: chat?.length || 0, hash, at: normalizedDate(chat?.at(-1)?.send_date) };
}

export function chatIdentity(ctx) {
    if (!ctx.chatId || (!ctx.groupId && ctx.characterId === undefined)) return '';
    const scope = ctx.groupId ? `group:${ctx.groupId}` : `character:${ctx.characters?.[ctx.characterId]?.avatar || ctx.characterId}`;
    // The host integrity slug survives a chat rename and changes on a branch.
    return `st:${encodeURIComponent(scope)}:${encodeURIComponent(ctx.chatMetadata?.integrity || ctx.chatId)}`;
}

export function chatSnapshot(ctx) {
    const id = chatIdentity(ctx);
    if (!id) return null;
    const metadata = clone(ctx.chatMetadata || {});
    const storedHost = metadata[HOST_KEY] || {};
    const scope = id.slice(0, id.lastIndexOf(':'));
    const owner = metadata[DATA_KEY]?.ownerChatId;
    // Only a host-created branch whose parent name and scope match may inherit.
    metadata.branchParentChatId = owner && owner !== id && metadata.main_chat
        && metadata.main_chat === storedHost.chatName && storedHost.scope === scope ? owner : '';
    metadata.branchName = metadata.main_chat ? String(ctx.chatId) : '';
    metadata.activeLorebookIds = clone(storedHost.activeLorebookIds || []);
    metadata.enableAgents = false;
    metadata.advancedMemory = { enabled: false };
    metadata.summaryEntries = (ctx.chat || []).flatMap((message, index) => {
        const content = message.extra?.memory;
        return !message.is_system && typeof content === 'string' && content.trim() && !/\{\{#if\s+char\s*==/i.test(content) ? [{
            id: `st-summary:${index}`, title: `${index + 1}번째 메시지 요약`, content,
            enabled: true, origin: 'sillytavern-summary', updatedAt: String(message.send_date || ''),
        }] : [];
    });
    metadata.summary = metadata.summaryEntries.at(-1)?.content || '';
    const scopeInfo = characterScope(ctx);
    metadata.groupChatMode = scopeInfo.mode === 'swap' ? 'individual' : 'merged';
    return { id, name: String(ctx.chatId), mode: 'rp', characterIds: scopeInfo.characters.map(c => c.avatar), connectionId: 'sillytavern-current', metadata };
}

export function createHost({ getContext, fetchImpl = globalThis.fetch, worldInfo = {}, reportError = console.error, isGenerating = () => false, hashString }) {
    const cache = new Map();
    const listeners = new Set();
    const cleanup = [];
    let transaction = null;
    let rawGeneration = null;
    let epoch = 0;
    let timer;
    let lastSummary = '';

    function assertChat(id) {
        const ctx = getContext();
        if (!id || chatIdentity(ctx) !== id) throw new Error('열린 채팅이 바뀌었습니다. 보관함을 다시 열어 주세요.');
        return ctx;
    }

    async function post(path, body) {
        const response = await fetchImpl(path, {
            method: 'POST', headers: getContext().getRequestHeaders(),
            body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`SillyTavern 저장/읽기 실패 (${response.status}, ${path})`);
        const type = response.headers.get('content-type') || '';
        return type.includes('json') ? response.json() : null;
    }

    async function bookName(chatId) {
        // ST's bundled SHA-256 also works on LAN HTTP, where Web Crypto's
        // subtle API is unavailable. The fallback is for non-browser hosts/tests.
        const hash = hashString ? await hashString(chatId) : Array.from(new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chatId)),
        ), n => n.toString(16).padStart(2, '0')).join('');
        return `MemoryVault_${hash.slice(0, 32)}`;
    }

    async function readBook(id, committedOnly = false) {
        if (!/^MemoryVault_[a-f0-9]{32}$/.test(id || '')) return null;
        if (!committedOnly && transaction?.book?.id === id) return clone(transaction.book);
        if (cache.has(id)) return clone(cache.get(id));
        const data = await post('/api/worldinfo/get', { name: id });
        const book = data?.extensions?.[WORLD_KEY];
        if (!book || book.id !== id) return null;
        cache.set(id, clone(book));
        return clone(book);
    }

    async function saveMetadata(chatId, patch) {
        const ctx = assertChat(chatId);
        const target = ctx.chatMetadata;
        const hostState = {
            ...(target[HOST_KEY] || {}),
            chatName: String(ctx.chatId), scope: chatId.slice(0, chatId.lastIndexOf(':')),
            sourceBoundary: await messageBoundary(ctx.chat, hashString),
        };
        if (patch.activeLorebookIds) hostState.activeLorebookIds = clone(patch.activeLorebookIds);
        const allowed = Object.fromEntries(Object.entries(patch).filter(([key]) => [DATA_KEY, 'memoryVaultImportBackup'].includes(key)));
        const update = { ...allowed, [HOST_KEY]: hostState };
        const previous = Object.fromEntries(Object.keys(update).map(key => [key, clone(target[key])]));
        const readPath = ctx.groupId ? '/api/chats/group/get' : '/api/chats/get';
        const readBody = ctx.groupId ? { id: ctx.chatId }
            : { file_name: ctx.chatId, avatar_url: ctx.characters[ctx.characterId].avatar };
        Object.assign(target, clone(update));
        try {
            await ctx.saveMetadata();
            // Native saveMetadata logs some failures instead of rejecting. Verify
            // our own fields on disk before reporting a successful write.
            const rows = await post(readPath, readBody);
            const saved = rows?.[0]?.chat_metadata || {};
            for (const key of Object.keys(update)) {
                if (JSON.stringify(saved[key]) !== JSON.stringify(update[key])) throw new Error('채팅 저장을 확인하지 못했습니다. 서버 연결을 확인한 뒤 다시 저장해 주세요.');
            }
            assertChat(chatId);
        } catch (error) {
            for (const key of Object.keys(update)) {
                // Do not overwrite a concurrent editor's newer metadata.
                if (JSON.stringify(target[key]) !== JSON.stringify(update[key])) continue;
                if (previous[key] === undefined) delete target[key]; else target[key] = previous[key];
            }
            throw error;
        }
    }

    async function beginSync(chatId) {
        assertChat(chatId);
        if (transaction) throw new Error('로어북 동기화가 이미 진행 중입니다.');
        transaction = { chatId, book: null };
    }

    async function commitSync(chatId, { overwriteManaged = false } = {}) {
        assertChat(chatId);
        if (transaction?.chatId !== chatId || !transaction.book) throw new Error('동기화할 로어북이 없습니다.');
        const book = clone(transaction.book);
        const data = compileWorldInfo(book, worldInfo.template, characterScope(getContext()));
        const existing = await post('/api/worldinfo/get', { name: book.id });
        const previous = existing?.extensions?.[WORLD_KEY];
        let baseline = existing?.extensions?.memoryVaultBaseline;
        const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
        if (previous && !baseline) {
            try { baseline = compileLegacyWorldInfo(previous, worldInfo.template).entries; }
            catch { if (!overwriteManaged) throw new Error('관리 World Info 직접 편집 충돌: 이전 구조화 책의 기준을 재구성할 수 없습니다. 원본을 보존했습니다.'); }
        }
        for (const key of Object.keys(baseline || {})) {
            if (!overwriteManaged && (!existing.entries?.[key] || canonical(existing.entries[key]) !== canonical(baseline[key]))) throw new Error('관리 World Info 직접 편집 충돌: 항목이 삭제되거나 변경되었습니다.');
        }
        for (const [key, entry] of Object.entries(existing?.entries || {})) {
            if (entry.extensions?.[WORLD_KEY] || (overwriteManaged && Object.hasOwn(baseline || {}, key))) {
                const expected = baseline?.[key];
                if (!overwriteManaged && (!expected || canonical(entry) !== canonical(expected))) throw new Error('관리 World Info 직접 편집 충돌: 변경 내용을 보관함에 반영한 뒤 다시 동기화해 주세요.');
            } else {
                let uid = Number(key);
                while (Object.hasOwn(data.entries, uid)) uid++;
                data.entries[uid] = { ...clone(entry), uid };
            }
        }
        data.extensions = { ...clone(existing?.extensions || {}), ...data.extensions, memoryVaultBaseline: clone(Object.fromEntries(Object.entries(data.entries).filter(([, entry]) => entry.extensions?.[WORLD_KEY]))) };
        await post('/api/worldinfo/edit', { name: book.id, data: { ...clone(existing || {}), ...data } });
        cache.set(book.id, clone(book));
        worldInfo.cache?.set(book.id, clone(data));
        await getContext().eventSource.emit(getContext().eventTypes.WORLDINFO_UPDATED, book.id, clone(data));
        // Refresh the editor list; this is presentation, not part of persistence.
        try { await worldInfo.updateList?.(); } catch (error) { console.warn('[Memory Vault] World Info list refresh', error); }
        assertChat(chatId);
    }

    function endSync() { transaction = null; }

    async function generate(body, timeoutMs) {
        const ctx = getContext();
        const id = chatIdentity(ctx);
        assertChat(id);
        if (body.connectionId !== 'sillytavern-current') throw new Error('모델 설정에서 SillyTavern 현재 연결을 선택해 주세요.');
        if (rawGeneration) throw new Error('이전 보관함 모델 요청이 아직 진행 중입니다. 완료 후 다시 시도해 주세요.');
        if (isGenerating()) throw new Error('채팅 응답 생성이 끝난 뒤 실행해 주세요.');
        if (ctx.streamingProcessor && !ctx.streamingProcessor.isFinished) throw new Error('채팅 응답 생성이 끝난 뒤 실행해 주세요.');
        if (!ctx.onlineStatus || ctx.onlineStatus === 'no_connection') throw new Error('SillyTavern API 연결을 먼저 설정해 주세요. 수동 편집은 연결 없이 사용할 수 있습니다.');
        const startedEpoch = epoch;
        const pending = Promise.resolve().then(() => ctx.generateRaw({
            prompt: clone(body.messages || []), responseLength: body.parameters?.maxTokens || 1800,
            trimNames: false,
        }));
        rawGeneration = pending;
        pending.then(() => { if (rawGeneration === pending) rawGeneration = null; }, () => { if (rawGeneration === pending) rawGeneration = null; });
        let timeout;
        try {
            const result = await Promise.race([pending, new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('모델 응답 대기 시간이 초과됐습니다. 늦은 응답은 적용하지 않습니다. 서버 요청이 끝날 때까지 재요청은 잠깁니다.')), timeoutMs || 180000);
            })]);
            assertChat(id);
            if (startedEpoch !== epoch) throw new Error('모델 요청 중 채팅을 전환해 결과를 적용하지 않았습니다.');
            return { content: result };
        } finally { clearTimeout(timeout); }
    }

    async function api(path, options = {}) {
        if (options.chatId) assertChat(options.chatId);
        const url = new URL(String(path).replace(/^\/?api\//, ''), 'https://memory-vault.invalid/');
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const method = (options.method || 'GET').toUpperCase();
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
        if (parts[0] === 'characters' && method === 'GET') {
            const rows = characterScope(getContext()).characters.filter(c => c.avatar === parts[1]);
            if (rows.length !== 1) throw new Error('인물 ID를 확인할 수 없습니다.');
            return { id: rows[0].avatar, name: rows[0].name || rows[0].avatar };
        }
        if (parts[0] === 'chats') {
            const view = chatSnapshot(getContext());
            if (parts.length === 1) return view ? [view] : [];
            const ctx = assertChat(parts[1]);
            if (parts[2] === 'metadata' && method === 'PATCH') return saveMetadata(parts[1], body);
            if (parts[2] === 'messages' && method === 'GET') {
                const messages = ctx.chat.map((m, i) => ({
                    id: `st-message:${i}`, role: m.is_system ? 'system' : m.is_user ? 'user' : 'assistant',
                    content: String(m.mes || ''), createdAt: String(m.send_date || ''), name: m.name,
                    activeSwipeIndex: Number(m.swipe_id) || 0,
                }));
                const limit = Number(url.searchParams.get('limit'));
                return limit > 0 ? messages.slice(-limit) : messages;
            }
            if (parts.length === 2 && method === 'GET') return view;
        }
        if (parts[0] === 'connections' && method === 'GET') return [{
            id: 'sillytavern-current', name: 'SillyTavern 현재 API 연결', model: 'current', provider: 'sillytavern',
        }];
        if (parts[0] === 'agents' && method === 'GET') return [];
        if (parts.join('/') === 'generate/raw' && method === 'POST') return generate(body, options.timeoutMs);
        if (parts[0] === 'lorebooks') {
            if (parts.length === 1 && method === 'GET') {
                const chatId = url.searchParams.get('chatId');
                assertChat(chatId);
                const book = await readBook(await bookName(chatId));
                assertChat(chatId);
                return book ? [book] : [];
            }
            if (parts.length === 1 && method === 'POST') {
                assertChat(body.chatId);
                if (transaction?.chatId !== body.chatId) throw new Error('로어북 생성은 동기화 안에서만 허용됩니다.');
                const id = await bookName(body.chatId);
                const book = { ...clone(body), id, entries: {} };
                transaction.book = book;
                return clone(book);
            }
            const book = await readBook(parts[1]);
            if (!book) throw new Error('전용 로어북을 찾을 수 없습니다.');
            if (method === 'GET') return parts[2] === 'entries' ? Object.values(book.entries || {}) : book;
            assertChat(book.chatId);
            if (transaction?.chatId !== book.chatId) throw new Error('다른 채팅의 로어북은 수정할 수 없습니다.');
            if (parts.length === 2 && method === 'PATCH') {
                transaction.book = { ...book, ...clone(body), id: book.id, entries: book.entries };
                return clone(transaction.book);
            }
            if (parts[2] === 'entries') {
                const entries = book.entries || {};
                if (method === 'POST') {
                    const id = String(Math.max(-1, ...Object.keys(entries).map(Number)) + 1);
                    entries[id] = { ...clone(body), id };
                    transaction.book = { ...book, entries };
                    return clone(entries[id]);
                }
                if (method === 'PATCH' && entries[parts[3]]) {
                    entries[parts[3]] = { ...entries[parts[3]], ...clone(body), id: parts[3] };
                    transaction.book = { ...book, entries };
                    return clone(entries[parts[3]]);
                }
            }
        }
        throw new Error(`지원하지 않는 호스트 작업: ${method} ${url.pathname}`);
    }

    async function inject(lists) {
        removeManagedEntries(lists);
        const ctx = getContext();
        const chatId = chatIdentity(ctx);
        const data = ctx.chatMetadata?.[DATA_KEY];
        if (!chatId || !data || data.ownerChatId !== chatId || data.enabled === false || !data.lorebookId) return;
        try {
            const book = await readBook(data.lorebookId, true);
            assertChat(chatId);
            if (!book || book.chatId !== chatId) return;
            const scope = characterScope(ctx);
            const compiled = compileWorldInfo(book, worldInfo.template, scope);
            const responder = ctx.characters?.[ctx.characterId]?.avatar?.replace(/\.[^.]+$/, '');
            lists.chatLore.push(...Object.values(compiled.entries).filter(entry => !entry.disable)
                .filter(entry => !entry.characterFilter.names.length || entry.characterFilter.names.includes(responder))
                .map(entry => ({ ...entry, world: book.id })));
        } catch (error) { reportError(error); }
    }

    function summaryFingerprint() {
        const ctx = getContext();
        return JSON.stringify([chatIdentity(ctx), ctx.chat?.map(m => [m.send_date, m.extra?.memory])]);
    }

    function emitChange() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const view = chatSnapshot(getContext());
            lastSummary = summaryFingerprint();
            for (const listener of listeners) Promise.resolve(listener(view)).catch(reportError);
        }, 150);
    }

    function start() {
        const { eventSource, eventTypes } = getContext();
        if (!eventTypes.WORLDINFO_ENTRIES_LOADED) throw new Error('SillyTavern 1.19.0 이상이 필요합니다.');
        const subscribe = (type, callback) => {
            if (!type) return;
            eventSource.on(type, callback);
            cleanup.push(() => eventSource.removeListener(type, callback));
        };
        subscribe(eventTypes.WORLDINFO_ENTRIES_LOADED, inject);
        subscribe(eventTypes.CHAT_CHANGED, () => { epoch++; emitChange(); });
        for (const key of ['APP_READY', 'CHAT_RENAMED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'GENERATION_ENDED']) subscribe(eventTypes[key], emitChange);
        subscribe(eventTypes.WORLDINFO_UPDATED, name => cache.delete(name));
        // Summarize saves extra.memory without a dedicated change event. This
        // in-memory comparison also detects manual summary edits; no polling API.
        const interval = setInterval(() => {
            // Do not clone large vault/wiki metadata on every timer tick.
            const signature = summaryFingerprint();
            if (signature !== lastSummary) emitChange();
        }, 2000);
        cleanup.push(() => clearInterval(interval));
    }

    return {
        api, beginSync, commitSync, endSync, start, inject,
        async getBranchCutPoint(id) {
            const ctx = assertChat(id);
            const view = chatSnapshot(ctx);
            if (!view.metadata.branchParentChatId) return null;
            const saved = ctx.chatMetadata?.[HOST_KEY]?.sourceBoundary;
            const current = await messageBoundary(ctx.chat, hashString);
            assertChat(id);
            if (!saved?.at || saved.count !== current.count || saved.hash !== current.hash || saved.at !== current.at) return null;
            return { at: saved.at, messageId: `st-message:${saved.count - 1}` };
        },
        getCurrentChatId: () => chatIdentity(getContext()),
        onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        storage: {
            async get() { return clone(getContext().extensionSettings[SETTINGS_KEY] || {}); },
            async patch(patch) {
                const ctx = getContext();
                ctx.extensionSettings[SETTINGS_KEY] = { ...(ctx.extensionSettings[SETTINGS_KEY] || {}), ...clone(patch) };
                ctx.saveSettingsDebounced();
            },
        },
        dispose() { clearTimeout(timer); cleanup.splice(0).forEach(fn => fn()); listeners.clear(); },
    };
}
