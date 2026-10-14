import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, chatIdentity, chatSnapshot, HOST_KEY } from '../host.js';

class Events {
    listeners = new Map();
    on(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn)); }
    async emit(type, ...args) { for (const fn of this.listeners.get(type) || []) await fn(...args); }
}

function fixture() {
    const disk = new Map();
    const calls = [];
    const ctx = {
        chatId: 'story', characterId: 0, characters: [{ avatar: 'Alice.png' }],
        chatMetadata: { integrity: 'slug', world_info: 'Existing world', unrelated: { untouched: true } },
        chat: [{ is_user: true, mes: 'Original message', send_date: 'today', extra: { memory: 'Summary' } }],
        extensionSettings: {}, onlineStatus: 'connected',
        eventSource: new Events(), eventTypes: { WORLDINFO_UPDATED: 'wi', WORLDINFO_ENTRIES_LOADED: 'scan', CHAT_CHANGED: 'chat' },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'fixture' }),
        saveSettingsDebounced() {},
        async saveMetadata() { disk.set('chat', [{ chat_metadata: structuredClone(ctx.chatMetadata) }]); },
        async generateRaw(params) { calls.push(params); return '{"items":[]}'; },
    };
    let failWorld = false;
    const host = createHost({ getContext: () => ctx, fetchImpl: async (path, options) => {
        const body = JSON.parse(options.body);
        calls.push({ path, body, headers: options.headers });
        if (path === '/api/worldinfo/edit') {
            if (failWorld) return new Response('failed', { status: 500 });
            disk.set(body.name, structuredClone(body.data));
            return Response.json({ ok: true });
        }
        if (path === '/api/worldinfo/get') return Response.json(disk.get(body.name) || { entries: {} });
        if (path.endsWith('/get')) return Response.json(disk.get('chat') || []);
        throw new Error(path);
    } });
    const id = chatIdentity(ctx);
    return { ctx, host, id, disk, calls, failWorld: () => { failWorld = true; } };
}

async function seed(f) {
    await f.host.beginSync(f.id);
    const book = await f.host.api('lorebooks', { method: 'POST', body: { chatId: f.id, name: 'Vault', scanDepth: 4 } });
    await f.host.api(`lorebooks/${book.id}/entries`, { method: 'POST', body: {
        content: 'Remember the promise', tag: 'memory-cabinet-promises', constant: true, enabled: true,
    } });
    await f.host.commitSync(f.id);
    f.host.endSync();
    await f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: {
        memoryCabinetV1: { ownerChatId: f.id, lorebookId: book.id, items: [] }, activeLorebookIds: [book.id],
    } });
    return book.id;
}

test('chat identity scopes character/group and survives rename using integrity', () => {
    const { ctx, id } = fixture();
    ctx.chatId = 'renamed';
    assert.equal(chatIdentity(ctx), id);
    ctx.characters[0].avatar = 'Bob.png';
    assert.notEqual(chatIdentity(ctx), id);
    ctx.groupId = 'group-1';
    assert.ok(chatIdentity(ctx).includes('group%3Agroup-1'));
    ctx.chatId = undefined;
    assert.equal(chatIdentity(ctx), '');
});

test('native summaries and messages are mapped without changing host data', async () => {
    const f = fixture();
    const original = structuredClone(f.ctx.chat);
    const view = chatSnapshot(f.ctx);
    assert.equal(view.metadata.summaryEntries[0].content, 'Summary');
    const messages = await f.host.api(`chats/${encodeURIComponent(f.id)}/messages`);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'Original message');
    view.metadata.summaryEntries[0].content = 'modified';
    assert.deepEqual(f.ctx.chat, original);
});

test('only a verified same-scope native branch inherits ownership', () => {
    const f = fixture();
    f.ctx.chatMetadata.memoryCabinetV1 = { ownerChatId: f.id };
    f.ctx.chatMetadata[HOST_KEY] = { chatName: 'story', scope: f.id.slice(0, f.id.lastIndexOf(':')) };
    f.ctx.chatMetadata.main_chat = 'story';
    f.ctx.chatMetadata.integrity = 'branch-slug';
    assert.equal(chatSnapshot(f.ctx).metadata.branchParentChatId, f.id);
    f.ctx.chatMetadata.main_chat = 'some-other-story';
    assert.equal(chatSnapshot(f.ctx).metadata.branchParentChatId, '');
});

test('sync persists real native World Info, verifies metadata, preserves existing lorebook and chat', async () => {
    const f = fixture();
    const original = structuredClone(f.ctx.chat);
    const bookId = await seed(f);
    assert.ok(f.disk.get(bookId).entries[0].constant);
    assert.equal(f.calls.filter(x => x.path === '/api/worldinfo/edit').length, 1);
    assert.equal(f.ctx.chatMetadata.world_info, 'Existing world');
    assert.deepEqual(f.ctx.chatMetadata.unrelated, { untouched: true });
    assert.deepEqual(f.ctx.chat, original);
    assert.deepEqual(f.ctx.chatMetadata[HOST_KEY].activeLorebookIds, [bookId]);
    assert.equal(f.calls.find(x => x.path === '/api/worldinfo/edit').headers['X-CSRF-Token'], 'fixture');
    const lists = { chatLore: [{ content: 'other book' }], globalLore: [] };
    await f.host.inject(lists);
    assert.equal(lists.chatLore.length, 2);
    assert.equal(lists.chatLore[1].content, 'Remember the promise');
    await f.host.inject(lists);
    assert.equal(lists.chatLore.length, 2, 'injection is idempotent');
    f.ctx.chatMetadata.memoryCabinetV1.enabled = false;
    await f.host.inject(lists);
    assert.deepEqual(lists.chatLore, [{ content: 'other book' }]);
});

test('foreign metadata and copied/global managed books cannot leak into another chat', async () => {
    const f = fixture();
    const bookId = await seed(f);
    f.ctx.chatMetadata.integrity = 'unrelated-chat';
    const lists = { chatLore: [], globalLore: Object.values(f.disk.get(bookId).entries) };
    await f.host.inject(lists);
    assert.deepEqual(lists, { chatLore: [], globalLore: [] });
    await assert.rejects(f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: {} }), /바뀌었습니다/);
});

test('swallowed native metadata failure is detected and local state rolled back', async () => {
    const f = fixture();
    f.ctx.saveMetadata = async () => {};
    await assert.rejects(f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: { memoryCabinetV1: { ownerChatId: f.id } } }), /저장을 확인/);
    assert.equal(f.ctx.chatMetadata.memoryCabinetV1, undefined);
    assert.equal(f.ctx.chatMetadata.world_info, 'Existing world');
});

test('a failed world write is not reported as synchronized', async () => {
    const f = fixture();
    f.failWorld();
    await assert.rejects(seed(f), /500/);
    assert.equal(f.ctx.chatMetadata.memoryCabinetV1, undefined);
    f.host.endSync();
});

test('generation uses host credentials/active connection without adding chat messages', async () => {
    const f = fixture();
    const messages = structuredClone(f.ctx.chat);
    const response = await f.host.api('generate/raw', { method: 'POST', chatId: f.id, body: {
        connectionId: 'sillytavern-current', messages: [{ role: 'system', content: 'Extract JSON' }], parameters: { maxTokens: 4000 },
    } });
    assert.equal(response.content, '{"items":[]}');
    assert.equal(f.calls[0].responseLength, 4000);
    assert.deepEqual(f.ctx.chat, messages);
    f.ctx.onlineStatus = 'no_connection';
    await assert.rejects(f.host.api('generate/raw', { method: 'POST', body: { connectionId: 'sillytavern-current' } }), /API 연결/);
});

test('late model results are discarded after a chat switch, even on return to same chat', async () => {
    const f = fixture();
    f.host.start();
    let resolve;
    f.ctx.generateRaw = () => new Promise(r => { resolve = r; });
    const pending = f.host.api('generate/raw', { method: 'POST', body: { connectionId: 'sillytavern-current' } });
    await Promise.resolve();
    await f.ctx.eventSource.emit('chat');
    resolve('late output');
    await assert.rejects(pending, /채팅을 전환/);
    f.host.dispose();
});

test('group metadata persistence uses the native group endpoint', async () => {
    const f = fixture();
    f.ctx.groupId = 'g';
    const id = chatIdentity(f.ctx);
    await f.host.api(`chats/${encodeURIComponent(id)}/metadata`, { method: 'PATCH', body: { memoryCabinetV1: { ownerChatId: id } } });
    assert.ok(f.calls.some(c => c.path === '/api/chats/group/get' && c.body.id === f.ctx.chatId));
});

test('scan cannot see a partially staged synchronization', async () => {
    const f = fixture();
    const bookId = await seed(f);
    await f.host.beginSync(f.id);
    await f.host.api(`lorebooks/${bookId}/entries/0`, { method: 'PATCH', body: { content: 'Uncommitted change' } });
    const lists = { chatLore: [], globalLore: [] };
    await f.host.inject(lists);
    assert.equal(lists.chatLore[0].content, 'Remember the promise');
    f.host.endSync();
});

test('a timed-out model request blocks duplicates until it settles and never returns late output', async () => {
    const f = fixture();
    let resolve;
    f.ctx.generateRaw = () => new Promise(r => { resolve = r; });
    const options = { method: 'POST', timeoutMs: 5, body: { connectionId: 'sillytavern-current' } };
    await assert.rejects(f.host.api('generate/raw', options), /초과/);
    await assert.rejects(f.host.api('generate/raw', options), /아직 진행/);
    resolve('late response');
    // Let promise adoption and its completion handler settle before a new user event.
    await new Promise(setImmediate);
    f.ctx.generateRaw = async () => 'fresh response';
    assert.equal((await f.host.api('generate/raw', options)).content, 'fresh response');
});
