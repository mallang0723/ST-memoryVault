import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Mounted extension + native ST generation, synthetic fixtures only.
export async function verifyV211({ page, root, click, importMemory, waitSaved, getData, scan, check }) {
    const avatars = await page.evaluate(() => SillyTavern.getContext().characters.slice(0, 2).map(c => c.avatar));
    assert.equal(avatars.length, 2);
    await page.evaluate(avatars => {
        const ctx = SillyTavern.getContext();
        const group = ctx.groups.find(g => String(g.id) === String(ctx.groupId));
        group.members = avatars;
        group.generation_mode = 0;
    }, avatars);
    const fixture = {
        version: 1, ownerChatId: 'synthetic-import', items: [
            { id: 'public', type: 'promise', title: 'Public promise', content: 'QA_PUBLIC_MARKER', status: 'active' },
            { id: 'secret', type: 'promise', title: 'Private promise', content: 'QA_SECRET_PROMISE', status: 'active', knownBy: [avatars[0]] },
            { id: 'unknown', type: 'promise', title: 'Unknown identity', content: 'QA_UNKNOWN_SECRET', status: 'active', knownBy: ['unresolved-import-id'] },
        ],
        episodes: [{ id: 'scene', title: 'QA scene', keywords: ['QAKey'], background: { place: 'QA room' }, event: { summary: 'QA_PUBLIC_SCENE' }, facts: [{ text: 'QA_SECRET_FACT', status: 'current', knownBy: [avatars[0]] }] }],
        threads: [
            { id: 'thread', title: 'QA thread', status: 'open', currentState: 'QA_SECRET_THREAD', history: [{ id: 'public-history', at: '2026-01-01T00:00:00Z', status: 'open', state: 'QA_PUBLIC_THREAD' }, { id: 'private-history', at: '2026-01-02T00:00:00Z', status: 'open', state: 'QA_SECRET_THREAD', knownBy: [avatars[0]] }] },
            { id: 'empty-thread', title: 'QA empty thread', status: 'open', currentState: 'QA_SECRET_EMPTY_THREAD', history: [{ at: '2026-01-01T00:00:00Z', status: 'hold', state: '' }, { at: '2026-01-02T00:00:00Z', status: 'open', state: 'QA_SECRET_EMPTY_THREAD', knownBy: [avatars[0]] }] },
        ],
    };
    await importMemory(fixture);
    let data = await getData();
    assert.equal(data.scopeReviewHold.length, 5);
    assert.equal(data.items.length, 1);
    assert.ok(!(await scan('QAKey')).includes('QA_SECRET'));
    check('all imported identities, including matching avatars, stay held before explicit confirmation');
    await click('settings');
    await root.locator('[data-action="settings-tab"][data-settings-tab="data"]').click();
    // Confirm only records whose original identities are already resolvable.
    for (const title of ['Private promise', 'QA scene', 'QA thread', 'QA empty thread']) {
        const index = (await getData()).scopeReviewHold.findIndex(row => row.record.title === title);
        assert.ok(index >= 0);
        await root.locator(`[data-action="confirm-import-scope"][data-index="${index}"]`).click();
        await page.waitForFunction(title => !SillyTavern.getContext().chatMetadata.memoryCabinetV1.scopeReviewHold.some(row => row.record.title === title), title);
        await waitSaved();
        await page.waitForFunction(() => document.querySelectorAll('#mmc-root-v1 [data-action="confirm-import-scope"]').length === SillyTavern.getContext().chatMetadata.memoryCabinetV1.scopeReviewHold.length);
    }
    data = await getData();
    assert.equal(data.scopeReviewHold.length, 1);
    assert.equal(data.episodes.length, 1);
    assert.equal(data.threads.length, 2);
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const name = ctx.chatMetadata.memoryCabinetV1.lorebookId;
        const post = async (path, body) => {
            const response = await fetch(path, { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(body) });
            if (!response.ok) throw Error(`fixture WI failed: ${response.status}`);
            return response.json();
        };
        const data = await post('/api/worldinfo/get', { name });
        Object.values(data.entries).find(e => e.extensions?.memoryVault).content = 'QA_MANUAL_WI_EDIT';
        data.entries[90000] = { uid: 90000, content: 'QA_EXTERNAL_WI', disable: true };
        data.extensions.qaExternal = { preserved: true };
        await post('/api/worldinfo/edit', { name, data });
    });
    await root.locator('.mmc-setting-card [data-action="sync"]').click();
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.lastSyncError.includes('충돌'));
    await click('sync-overwrite');
    await page.waitForFunction(() => !SillyTavern.getContext().chatMetadata.memoryCabinetV1.lastSyncError);
    await root.locator('[data-action="sync-overwrite"]').waitFor({ state: 'detached' });
    await waitSaved();
    const repaired = await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        return (await fetch('/api/worldinfo/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name: ctx.chatMetadata.memoryCabinetV1.lorebookId }) })).json();
    });
    assert.equal(Object.values(repaired.entries).some(e => e.content === 'QA_MANUAL_WI_EDIT'), false);
    assert.equal(repaired.entries[90000].content, 'QA_EXTERNAL_WI');
    assert.equal(repaired.extensions.qaExternal.preserved, true);
    check('managed WI conflict is repaired by explicit UI overwrite while external data survives');
    await click('close-layer');
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    assert.ok((await root.innerText()).includes('QA scene'));
    await root.locator('.mmc-tab[data-tab="thread"]').click();
    assert.ok((await root.innerText()).includes('QA thread'));
    await root.locator('[data-action="edit-thread"][data-id="thread"]').click();
    await page.locator('#mmc-th-state').fill('QA_SECRET_THREAD_EDITED');
    await click('save-thread');
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.threads.find(t => t.id === 'thread').history.at(-1).state === 'QA_SECRET_THREAD_EDITED');
    await waitSaved();
    const edited = (await getData()).threads.find(t => t.id === 'thread');
    assert.deepEqual(edited.history.at(-1).knownBy, [avatars[0]]);
    const publicPrompt = await scan('QAKey');
    assert.ok(publicPrompt.includes('QA_PUBLIC_THREAD'));
    assert.ok(!publicPrompt.includes('QA_SECRET_THREAD_EDITED'));
    assert.ok(!publicPrompt.includes('QA_SECRET_EMPTY_THREAD'));
    check('direct private-state edit retains its audience; empty public history never inherits a private state');
    await page.setViewportSize({ width: 360, height: 800 });
    assert.ok(await root.locator('.mmc-shell').evaluate(n => n.getBoundingClientRect().width <= innerWidth));
    await page.screenshot({ path: 'test-results/v211-360px.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await click('close');
    check('six-layer import and explicit scope confirmation render scene/thread tabs at 360px');

    const prompts = [];
    await page.unroute('**/api/backends/chat-completions/generate');
    await page.route('**/api/backends/chat-completions/generate', async route => {
        prompts.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Synthetic QA response.' } }] }) });
    });
    const cases = [];
    for (const [mode, responder, allowed] of [[0, 0, true], [0, 1, false], [1, 0, false], [2, 0, false]]) {
        const before = prompts.length;
        await page.evaluate(async ({ mode, responder }) => {
            const st = await import('/script.js');
            const ctx = SillyTavern.getContext();
            ctx.groups.find(g => String(g.id) === String(ctx.groupId)).generation_mode = mode;
            st.setOnlineStatus('Synthetic QA connected');
            document.getElementById('send_textarea').value = 'QAKey. Continue this synthetic scene.';
            await st.Generate('normal', { force_chid: responder });
        }, { mode, responder });
        assert.equal(prompts.length, before + 1, 'native generation must reach the fake provider exactly once');
        const prompt = JSON.stringify(prompts.at(-1).messages);
        assert.ok(prompt.includes('QA_PUBLIC_MARKER'), prompt);
        for (const marker of ['QA_SECRET_PROMISE', 'QA_SECRET_FACT', 'QA_SECRET_THREAD_EDITED', 'QA_SECRET_EMPTY_THREAD']) assert.equal(prompt.includes(marker), allowed, `${mode}/${responder}: ${marker}`);
        assert.ok(!prompt.includes('QA_UNKNOWN_SECRET'));
        assert.ok(!prompt.includes('MEMORY_CABINET_BACKUP'));
        cases.push({ mode, responder, allowed, passed: true });
    }
    await writeFile('test-results/v211-prompts.json', JSON.stringify({ cases, prompts }, null, 2));
    check('real assembled fake-provider prompts: SWAP allowed/denied responders, APPEND and APPEND_DISABLED withhold all secrets');
    // Reopen/reload confirmed scope must remain confirmed, unresolved identity held.
    const currentName = await page.evaluate(() => SillyTavern.getContext().chatId);
    const groupId = await page.evaluate(() => SillyTavern.getContext().groupId);
    await page.reload();
    await page.waitForFunction(id => window.SillyTavern?.getContext().groups.some(g => String(g.id) === String(id)), groupId);
    await page.evaluate(async ({ groupId, currentName }) => {
        const groups = await import('/scripts/group-chats.js');
        // Loading messages alone does not select the native group after reload.
        await groups.openGroupById(groupId);
        await groups.openGroupChat(groupId, currentName);
    }, { groupId, currentName });
    await page.locator('#mmc-launcher-v1').click();
    await page.waitForFunction(() => !!document.querySelector('#mmc-root-v1 .mmc-shell') && !document.querySelector('#mmc-root-v1 .mmc-busy'));
    assert.equal((await getData()).scopeReviewHold.length, 1);
    assert.equal((await getData()).items.length, 2);
    check('confirmed avatar scopes survive reload while unresolved imported identity remains held');

    await click('close');
    const parentData = await getData();
    const checkpointContext = await page.evaluate(() => {
        const ctx = SillyTavern.getContext();
        return { groupId: ctx.groupId, characterId: ctx.characterId, messages: ctx.chat.length };
    });
    assert.equal(String(checkpointContext.groupId), String(groupId), 'native checkpoint requires a selected group, not only loaded group messages');
    const checkpointName = await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        if (!ctx.chat.length) {
            ctx.chat.push({ name: 'QA User', is_user: true, mes: 'Synthetic checkpoint boundary.', send_date: new Date().toISOString() });
            await ctx.saveChat();
        }
        const { createNewBookmark } = await import('/scripts/bookmarks.js');
        return createNewBookmark(ctx.chat.length - 1, { forceName: `QA checkpoint ${Date.now()}` });
    });
    assert.ok(checkpointName);
    await page.evaluate(async ({ groupId, checkpointName }) => {
        await (await import('/scripts/group-chats.js')).openGroupChat(groupId, checkpointName);
    }, { groupId, checkpointName });
    await page.waitForFunction(owner => {
        const data = SillyTavern.getContext().chatMetadata.memoryCabinetV1;
        return data?.ownerChatId && data.ownerChatId !== owner && data.lastSyncAt && !data.lastSyncError;
    }, parentData.ownerChatId);
    const checkpoint = await getData();
    assert.notEqual(checkpoint.lorebookId, parentData.lorebookId);
    assert.equal(checkpoint.pendingReview, null);
    assert.equal(checkpoint.lastAutoReviewUndo, null);
    assert.equal(checkpoint.scopeReviewHold.length, 0);
    assert.equal(checkpoint.branchHold.scopeReviewHold.length, 1);
    assert.ok(!(await scan('QAKey')).includes('QA_UNKNOWN_SECRET'));
    const diskParent = await page.evaluate(async currentName => {
        const ctx = SillyTavern.getContext();
        const response = await fetch('/api/chats/group/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ id: currentName }) });
        if (!response.ok) throw new Error('read synthetic parent');
        return (await response.json())[0].chat_metadata.memoryCabinetV1;
    }, currentName);
    assert.deepEqual(diskParent, parentData, 'native checkpoint must not modify parent memories');
    check('native checkpoint splits books, removes parent pending/undo, retains independent branch+identity gates and leaves parent unchanged');
}
