import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, chatIdentity, chatSnapshot, HOST_KEY } from '../host.js';
import { compileWorldInfo as oldCompile } from './fixtures/world-info-2.0.0.js';
test('2.0.0 baseline reconstruction upgrades faithful old output and preserves edited or unreadable books', async () => {
    for (const mode of ['clean', 'edited', 'unreadable']) {
        const f = fixture({ worldInfo: { template: { customTemplateField: 'kept' } } });
        const id = await seed(f);
        const book = f.disk.get(id).extensions.memoryVault;
        const old = oldCompile(book, { customTemplateField: 'kept' });
        old.entries[99] = { uid: 99, content: 'manual entry' };
        if (mode === 'edited') old.entries[0].content = 'manual edit';
        if (mode === 'unreadable') old.extensions.memoryVault.entries = null;
        f.disk.set(id, old);
        const before = structuredClone(old);
        await f.host.beginSync(f.id);
        await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'upgraded' } });
        if (mode === 'clean') {
            await f.host.commitSync(f.id);
            assert.ok(f.disk.get(id).extensions.memoryVaultBaseline);
            assert.equal(f.disk.get(id).entries[99].content, 'manual entry');
            assert.ok(f.disk.get(id).entries[0].characterFilter);
        } else {
            await assert.rejects(f.host.commitSync(f.id), /충돌/);
            assert.deepEqual(f.disk.get(id), before);
        }
    }
});

class Events {
    listeners = new Map();
    on(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) || []), fn]); }
    removeListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x !== fn)); }
    async emit(type, ...args) { for (const fn of this.listeners.get(type) || []) await fn(...args); }
}

function fixture(options = {}) {
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
    const faults = {};
    const host = createHost({ ...options, getContext: () => ctx, fetchImpl: async (path, options) => {
        const body = JSON.parse(options.body);
        calls.push({ path, body, headers: options.headers });
        if (path === '/api/worldinfo/edit') {
            if (failWorld || faults.save) return new Response('failed', { status: 500 });
            disk.set(body.name, faults.verify ? { entries: {} } : structuredClone(body.data));
            return Response.json({ ok: true });
        }
        if (path === '/api/worldinfo/get') return Response.json(disk.get(body.name) || { entries: {} });
        if (path === '/api/worldinfo/list') {
            const rows = [...disk].filter(([name]) => name !== 'chat').map(([file_id, data]) => ({ file_id, extensions: data.extensions || {} }));
            faults.afterList?.();
            return Response.json(rows);
        }
        if (path === '/api/worldinfo/delete') {
            if (faults.delete) return new Response('failed', { status: 500 });
            disk.delete(body.name); return new Response('OK');
        }
        if (path.endsWith('/get')) return Response.json(disk.get('chat') || []);
        throw new Error(path);
    } });
    const id = chatIdentity(ctx);
    return { ctx, host, id, disk, calls, faults, failWorld: () => { failWorld = true; } };
}
test('new book names are readable, filename-safe and bounded in UTF-8 bytes', async () => {
    const f = fixture();
    f.ctx.characters[0].name = '한글 / 캐릭터:*?"<>|\\';
    f.ctx.chatId = '긴 채팅 '.repeat(100);
    const id = await seed(f);
    assert.match(id, /^기억보관함 - 한글 캐릭터 - 긴 채팅/);
    assert.match(id, /\([a-f0-9]{6}\)$/);
    assert.ok(!/[\/\\:*?"<>|\x00-\x1f]/.test(id));
    assert.ok(Buffer.byteLength(id + '.json') <= 240);
});
test('ST default chat filenames become date-only labels without changing the chat', async () => {
    const f = fixture({ hashString: async () => '68fd4a' + '0'.repeat(58) });
    f.ctx.characters[0].name = 'Seraphina';
    f.ctx.chatId = 'Seraphina - 2023-5-12 @21h 32m 29s 224ms';
    assert.equal(await seed(f), '기억보관함 - Seraphina - 2023-05-12 (68fd4a)');
    assert.equal(f.ctx.chatId, 'Seraphina - 2023-5-12 @21h 32m 29s 224ms');
});
test('custom chat labels stay intact except for one leading duplicate character name', async () => {
    for (const [chat, label] of [
        ['Seraphina - 우리들의 첫날', '우리들의 첫날'],
        ['우리들의 첫날 - Seraphina', '우리들의 첫날 - Seraphina'],
        ['2023-5-12 @21h 32m 29s 224ms', '2023-5-12 @21h 32m 29s 224ms'],
        ['Seraphina - 2023-5-12 @21h 32m 29s 224ms 후일담', '2023-5-12 @21h 32m 29s 224ms 후일담'],
        ['2026-10-07@09h05m03s007ms', '2026-10-07@09h05m03s007ms'],
        ['Seraphina - 2026-10-07@09h05m03s007ms 후일담', '2026-10-07@09h05m03s007ms 후일담'],
    ]) {
        const f = fixture({ hashString: async () => '68fd4a' + '0'.repeat(58) });
        f.ctx.characters[0].name = 'Seraphina';
        f.ctx.chatId = chat;
        assert.equal(await seed(f), `기억보관함 - Seraphina - ${label} (68fd4a)`);
    }
});
test('ST 1.19 zero-padded timestamps become dates and st.3 names relocate again', async () => {
    for (const stamp of ['2026-10-16@21h59m59s123ms', '2026-10-07@09h05m03s007ms']) {
        const f = fixture({ hashString: async () => '68fd4a' + '0'.repeat(58), worldInfo: { retargetLinks: async () => {} } });
        f.ctx.characters[0].name = 'Seraphina';
        f.ctx.chatId = `Seraphina - ${stamp}`;
        const id = await seed(f);
        assert.equal(id, `기억보관함 - Seraphina - ${stamp.slice(0, 10)} (68fd4a)`);
        const old = `기억보관함 - Seraphina - ${stamp} (68fd4a)`;
        const data = { ...structuredClone(f.disk.get(id)), name: old };
        f.disk.delete(id); f.disk.set(old, data);
        await f.host.beginSync(f.id);
        f.host.endSync();
        assert.equal(f.disk.has(old), false);
        assert.deepEqual(f.disk.get(id), { ...data, name: id });
        assert.equal(f.ctx.chatId, `Seraphina - ${stamp}`);
    }
});
test('marker discovery survives display/file renames and ignores unrelated files', async () => {
    const f = fixture();
    const id = await seed(f);
    const before = f.disk.get(id);
    f.disk.set('사용자가 고친 이름', before);
    f.disk.delete(id);
    f.disk.set('unrelated', { entries: {} });
    f.ctx.characters[0].name = '새 캐릭터명';
    f.ctx.chatId = 'renamed';
    const books = await f.host.api(`lorebooks?chatId=${encodeURIComponent(f.id)}`);
    assert.equal(books.length, 1);
    assert.equal(books[0].id, id);
    await f.host.beginSync(f.id);
    await f.host.api(`lorebooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name: 'new display' } });
    await f.host.commitSync(f.id);
    assert.equal(f.disk.has(id), false);
    assert.equal(f.disk.get('사용자가 고친 이름').extensions.memoryVault.chatId, f.id);
});
test('legacy relocation verifies a lossless copy before links and deletion; failures preserve source', async () => {
    for (const failure of ['', 'save', 'verify', 'links', 'delete', 'target-changed', 'metadata']) {
        const order = [];
        const f = fixture({ worldInfo: { async retargetLinks(oldName, newName) {
            order.push('links');
            assert.ok(f.disk.has(oldName));
            assert.ok(f.disk.has(newName));
            if (failure === 'links') throw Error('link failed');
            if (failure === 'target-changed') f.disk.get(newName).custom = { changed: true };
        } } });
        const id = await seed(f);
        const old = 'MemoryVault_12345678901234567890123456789012';
        const data = structuredClone(f.disk.get(id));
        data.extensions.memoryVault.id = old;
        data.extensions.external = { untouched: ['한글', 42] };
        data.entries[88] = { uid: 88, content: '직접 수정 보존', custom: true };
        data.custom = { kept: true };
        f.disk.delete(id);
        f.disk.set(old, data);
        f.ctx.chatMetadata.memoryCabinetV1.lorebookId = old;
        f.ctx.chatMetadata.world_info = old;
        f.faults.save = failure === 'save';
        f.faults.verify = failure === 'verify';
        f.faults.delete = failure === 'delete';
        if (failure === 'metadata') f.ctx.saveMetadata = async () => {};
        if (failure) {
            await assert.rejects(f.host.beginSync(f.id));
            assert.deepEqual(f.disk.get(old), data);
        } else {
            await f.host.beginSync(f.id);
            assert.equal(f.disk.has(old), false);
            const target = [...f.disk.keys()].find(key => key.startsWith('기억보관함'));
            const moved = f.disk.get(target);
            assert.deepEqual({ ...moved, name: data.name }, data);
            assert.equal(f.ctx.chatMetadata.world_info, target);
            assert.equal(f.ctx.chatMetadata.memoryCabinetV1.lorebookId, old, 'logical ID is stable');
            assert.deepEqual(order, ['links']);
            assert.equal((await f.host.api(`lorebooks/${old}`)).id, old);
        }
    }
});
test('interrupted relocation reuses one identical copy on retry and preserves logical ID', async () => {
    let fail = true;
    const f = fixture({ worldInfo: { retargetLinks: async () => { if (fail) throw Error('offline'); } } });
    const id = await seed(f);
    const old = 'MemoryVault_12345678901234567890123456789012';
    const data = structuredClone(f.disk.get(id));
    data.extensions.memoryVault.id = old;
    f.disk.delete(id); f.disk.set(old, data);
    await assert.rejects(f.host.beginSync(f.id), /offline/);
    const copyName = [...f.disk.keys()].find(name => name.startsWith('기억보관함'));
    fail = false;
    await f.host.beginSync(f.id);
    assert.equal(f.disk.has(old), false);
    assert.equal([...f.disk.keys()].filter(name => name.startsWith('기억보관함')).length, 1);
    assert.equal(f.disk.get(copyName).extensions.memoryVault.id, old);
});
test('st.2 long-name relocation is lossless, retryable and never deletes an unverified source', async () => {
    for (const failure of ['', 'save', 'verify', 'links', 'delete']) {
        let failLinks = failure === 'links';
        const f = fixture({ hashString: async () => '68fd4a' + '0'.repeat(58), worldInfo: {
            async retargetLinks(oldName, newName) {
                assert.ok(f.disk.has(oldName));
                assert.deepEqual(f.disk.get(newName), { ...f.disk.get(oldName), name: newName });
                if (failLinks) throw Error('offline');
            },
        } });
        f.ctx.characters[0].name = 'Seraphina';
        f.ctx.chatId = 'Seraphina - 2023-5-12 @21h 32m 29s 224ms';
        const id = await seed(f);
        const old = '기억보관함 - Seraphina - Seraphina - 2023-5-12 @21h 32m 29s 224ms (68fd4a)';
        const data = structuredClone(f.disk.get(id));
        data.name = old;
        data.extensions.external = { kept: true };
        data.entries[99] = { uid: 99, content: 'external entry' };
        f.disk.delete(id); f.disk.set(old, data);
        f.ctx.chatMetadata.world_info = old;
        f.faults[failure] = true;
        if (failure) {
            await assert.rejects(f.host.beginSync(f.id));
            assert.deepEqual(f.disk.get(old), data);
            if (failure === 'verify') continue; // A corrupted copy must remain blocked, not silently reused.
            f.faults[failure] = false;
            failLinks = false;
        }
        await f.host.beginSync(f.id);
        f.host.endSync();
        assert.equal(f.disk.has(old), false);
        assert.deepEqual(f.disk.get(id), { ...data, name: id });
        assert.equal(f.ctx.chatMetadata.world_info, id);
        assert.equal(f.ctx.chatMetadata.memoryCabinetV1.lorebookId, id);
        await f.host.beginSync(f.id);
        f.host.endSync();
        assert.equal([...f.disk.keys()].filter(n => n.startsWith('기억보관함')).length, 1);
    }
});
test('relocation rechecks a name claimed after allocation and preserves both books', async () => {
    const f = fixture({ hashString: async () => 'abcdef' + '0'.repeat(58), worldInfo: { retargetLinks: async () => {} } });
    const id = await seed(f);
    const old = 'MemoryVault_12345678901234567890123456789012';
    const original = structuredClone(f.disk.get(id));
    f.disk.delete(id); f.disk.set(old, original);
    const foreign = { entries: { 0: { content: 'foreign data' } } };
    let lists = 0;
    f.faults.afterList = () => { if (++lists === 2) f.disk.set(id, structuredClone(foreign)); };
    await assert.rejects(f.host.beginSync(f.id), /충돌/);
    assert.deepEqual(f.disk.get(id), foreign);
    assert.deepEqual(f.disk.get(old), original);
});
test('group names use group title and collision suffix grows without overwriting a foreign book', async () => {
    const f = fixture({ hashString: async () => 'abcdef12' + '0'.repeat(56) });
    f.ctx.groupId = 'g';
    f.ctx.groups = [{ id: 'g', name: '한글 그룹', members: [] }];
    f.id = chatIdentity(f.ctx);
    const collision = '기억보관함 - 한글 그룹 - story (abcdef)';
    f.disk.set(collision, { entries: { 0: { content: 'user world' } } });
    const id = await seed(f);
    assert.equal(id, '기억보관함 - 한글 그룹 - story (abcdef12)');
    assert.equal(f.disk.get(collision).entries[0].content, 'user world');
});
test('sync acquisition rejects simultaneous begin calls while discovery is pending', async () => {
    const f = fixture();
    const first = f.host.beginSync(f.id);
    await assert.rejects(f.host.beginSync(f.id), /진행 중/);
    await first;
    f.host.endSync();
});
test('a name claimed after allocation is never overwritten by commit', async () => {
    const f = fixture();
    await f.host.beginSync(f.id);
    const book = await f.host.api('lorebooks', { method: 'POST', body: { chatId: f.id } });
    const foreign = { entries: {}, extensions: { external: true } };
    f.disk.set(book.id, foreign);
    await assert.rejects(f.host.commitSync(f.id), /충돌/);
    assert.deepEqual(f.disk.get(book.id), foreign);
});
test('LAN metadata and branch boundary use supplied hash', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    try {
        const f = fixture({ hashString: async text => (await import('node:crypto')).createHash('sha256').update(text).digest('hex') });
        await seed(f);
        const first = f.ctx.chatMetadata[HOST_KEY].sourceBoundary.hash;
        await f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: {} });
        assert.equal(f.ctx.chatMetadata[HOST_KEY].sourceBoundary.hash, first);
    } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original }); }
});
test('all persisted WI fields detect conflicts and extensions survive', async () => {
    for (const field of ['disable', 'characterFilter', 'position', 'probability']) {
        const f = fixture(); const id = await seed(f);
        f.disk.get(id).entries[0][field] = field === 'characterFilter' ? { names: ['other'] } : 27;
        await f.host.beginSync(f.id);
        await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'changed' } });
        await assert.rejects(f.host.commitSync(f.id), /충돌/);
    }
});

test('explicit managed overwrite repairs conflicts once and preserves external WI data', async () => {
    for (const mode of ['edited', 'deleted', 'marker-removed', 'legacy']) {
        const f = fixture(); const id = await seed(f);
        const data = f.disk.get(id);
        data.extensions.external = { kept: true };
        data.entries[99] = { uid: 99, content: 'external' };
        if (mode === 'deleted') delete data.entries[0];
        else data.entries[0].content = 'manual edit';
        if (mode === 'marker-removed') delete data.entries[0].extensions;
        if (mode === 'legacy') delete data.extensions.memoryVaultBaseline;
        const before = structuredClone(data);
        await f.host.beginSync(f.id);
        await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'repaired' } });
        await assert.rejects(f.host.commitSync(f.id), /충돌/);
        assert.deepEqual(f.disk.get(id), before);
        await f.host.commitSync(f.id, { overwriteManaged: true });
        assert.equal(f.disk.get(id).entries[0].content, 'Remember the promise');
        assert.equal(f.disk.get(id).entries[99].content, 'external');
        assert.deepEqual(f.disk.get(id).extensions.external, { kept: true });
        assert.equal(Object.values(f.disk.get(id).entries).some(e => e.content === 'manual edit'), false);
        f.host.endSync();
        f.disk.get(id).entries[0].content = 'second edit';
        await f.host.beginSync(f.id);
        await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'next' } });
        await assert.rejects(f.host.commitSync(f.id), /충돌/);
    }
});

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
test('avatar identity and summary source exclusion', async () => {
    const f = fixture();
    f.ctx.chat.push({ is_system: true, mes: 'hidden', extra: { memory: 'secret' } });
    f.ctx.chat.push({ mes: 'conditional', extra: { memory: '{{#if char == "a"}}secret{{/if}}' } });
    const view = chatSnapshot(f.ctx);
    assert.deepEqual(view.characterIds, ['Alice.png']);
    assert.equal(view.metadata.summaryEntries.length, 1);
    assert.equal((await f.host.api('characters/Alice.png')).id, 'Alice.png');
});
test('branch cutoff requires a matching saved message boundary', async () => {
    const f = fixture();
    f.ctx.chat[0].send_date = '2026-10-14T01:00:00Z';
    await seed(f);
    f.ctx.chatMetadata.main_chat = 'story';
    f.ctx.chatMetadata.integrity = 'child';
    f.ctx.chatId = 'branch';
    const id = chatIdentity(f.ctx);
    assert.equal((await f.host.getBranchCutPoint(id)).at, '2026-10-14T01:00:00.000Z');
    f.ctx.chat.push({ mes: 'new after branch', send_date: '2026-10-15T00:00:00Z' });
    assert.equal(await f.host.getBranchCutPoint(id), null);
});
test('sync preserves external WI and rejects edits to generated entries', async () => {
    const f = fixture();
    const id = await seed(f);
    f.disk.get(id).entries[99] = { uid: 99, content: 'external' };
    await f.host.beginSync(f.id);
    await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'changed' } });
    await f.host.commitSync(f.id);
    f.host.endSync();
    assert.equal(f.disk.get(id).entries[99].content, 'external');
    f.disk.get(id).entries[0].content = 'manual edit';
    await f.host.beginSync(f.id);
    await f.host.api(`lorebooks/${id}`, { method: 'PATCH', body: { name: 'again' } });
    await assert.rejects(f.host.commitSync(f.id), /충돌/);
    f.host.endSync();
});

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

test('generation-time guard drops chronicle scenes whose source changed even before re-sync', async () => {
    const { buildRange, stMessageRow } = await import('../chronicle.js');
    const f = fixture();
    f.ctx.chat = [{ is_user: true, name: 'U', mes: 'one', send_date: 'a' }, { is_user: false, name: 'M', mes: 'two', send_date: 'b' },
        { is_user: true, name: 'U', mes: 'three', send_date: 'c' }, { is_user: false, name: 'M', mes: 'four', send_date: 'd' }];
    await f.host.beginSync(f.id);
    const book = await f.host.api('lorebooks', { method: 'POST', body: { chatId: f.id, name: 'Vault', scanDepth: 4 } });
    // ep-b was written against ep-a: both constant, ep-a ordered first (as the extension syncs them).
    for (const [id, order] of [['ep-a', 48], ['ep-b', 49]]) await f.host.api(`lorebooks/${book.id}/entries`, { method: 'POST', body: {
        content: `scene ${id}`, tag: 'memory-cabinet-episode', keys: ['key'], constant: true, order, enabled: true, dynamicState: { memoryCabinetEpisodeId: id },
    } });
    await f.host.commitSync(f.id);
    f.host.endSync();
    const rows = f.ctx.chat.map(stMessageRow);
    const episodes = [
        { id: 'ep-a', title: 'A', chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, 0, 1) } },
        { id: 'ep-b', title: 'B', chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, 2, 3), contextRefs: [{ id: 'ep-a', revision: 1 }] } },
    ];
    await f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: { memoryCabinetV1: { ownerChatId: f.id, lorebookId: book.id, items: [], episodes } } });
    const lists = { chatLore: [], globalLore: [] };
    await f.host.inject(lists);
    assert.deepEqual(lists.chatLore.map(e => e.content).sort(), ['scene ep-a', 'scene ep-b']);
    f.ctx.chat[1].mes = 'edited';
    await f.host.inject(lists);
    assert.deepEqual(lists.chatLore, [], 'edited source and its dependent delta are both withheld');
});

test('generation-time guard holds a dependent whose dependency is not guaranteed ahead of it in this request', async () => {
    const { buildRange, stMessageRow } = await import('../chronicle.js');
    const f = fixture();
    f.ctx.chat = Array.from({ length: 6 }, (_, i) => ({ is_user: i % 2 === 0, name: i % 2 ? 'M' : 'U', mes: `line ${i}`, send_date: `t${i}` }));
    const rows = f.ctx.chat.map(stMessageRow);
    const episodes = [
        { id: 'A', title: 'A', chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, 0, 1) } },
        { id: 'B', title: 'B', chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, 2, 3), contextRefs: [{ id: 'A', revision: 1 }] } },
        { id: 'C', title: 'C', chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, 4, 5), contextRefs: [{ id: 'B', revision: 1 }] } },
    ];
    await f.host.beginSync(f.id);
    const book = await f.host.api('lorebooks', { method: 'POST', body: { chatId: f.id, name: 'Vault', scanDepth: 4 } });
    const ids = {};
    for (const id of ['A', 'B', 'C']) ids[id] = (await f.host.api(`lorebooks/${book.id}/entries`, { method: 'POST', body: {
        content: `scene ${id}`, tag: 'memory-cabinet-episode', keys: [`kw-${id}`], constant: true, order: 48, enabled: true, dynamicState: { memoryCabinetEpisodeId: id, memoryCabinetScope: 'main' },
    } })).id;
    await f.host.commitSync(f.id);
    f.host.endSync();
    await f.host.api(`chats/${encodeURIComponent(f.id)}/metadata`, { method: 'PATCH', body: { memoryCabinetV1: { ownerChatId: f.id, lorebookId: book.id, items: [], episodes } } });
    const run = async (spec) => {
        await f.host.beginSync(f.id);
        for (const [id, [constant, order]] of Object.entries(spec)) await f.host.api(`lorebooks/${book.id}/entries/${ids[id]}`, { method: 'PATCH', body: { constant, order } });
        await f.host.commitSync(f.id);
        f.host.endSync();
        const lists = { chatLore: [], globalLore: [] };
        await f.host.inject(lists);
        return lists.chatLore.map(e => e.content).sort();
    };
    assert.deepEqual(await run({ A: [true, 48], B: [true, 49], C: [true, 50] }), ['scene A', 'scene B', 'scene C']);
    assert.deepEqual(await run({ A: [false, 47], B: [true, 49], C: [true, 50] }), ['scene A'], 'A keyword-only: B and C are held, not sent partially');
    assert.deepEqual(await run({ A: [true, 48], B: [true, 51], C: [true, 50] }), ['scene A', 'scene B'], 'C ordered ahead of its dependency B is held; B itself is fine');
});
