// Run against an isolated SillyTavern 1.19+ server with this extension installed.
// Creates test chats/worlds; never point this at a production data directory.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8000';
const chatName = `MemoryVault test ${Date.now()}`;
await mkdir('test-results', { recursive: true });
const root = page.locator('#mmc-root-v1');
const click = action => root.locator(`[data-action="${action}"]`).filter({ visible: true }).first().click();
const check = (message) => console.log(`PASS ${message}`);
const getData = () => page.evaluate(() => structuredClone(SillyTavern.getContext().chatMetadata.memoryCabinetV1));
const waitSaved = async () => {
    await page.waitForFunction(() => {
        const d = SillyTavern.getContext().chatMetadata.memoryCabinetV1;
        return d?.lastSyncAt && !d.lastSyncError;
    });
    await page.waitForFunction(() => !document.querySelector('#mmc-root-v1 .mmc-busy'));
};
async function openVault() {
    await page.locator('#mmc-launcher-v1').click();
    await root.locator('.mmc-shell').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#mmc-root-v1 .mmc-busy'));
}
async function importMemory(data) {
    await click('settings');
    await root.locator('[data-action="settings-tab"][data-settings-tab="data"]').click();
    const chooser = page.waitForEvent('filechooser');
    await click('import-memory');
    await (await chooser).setFiles({ name: 'memory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => document.querySelector('.mmc-toast')?.textContent.includes('가져왔습니다'));
    await waitSaved();
}
const memory = {
    version: 1, ownerChatId: 'marinara-source', enabled: true,
    items: [
        { id: 'promise-fixture', type: 'promise', status: 'active', title: 'Appointment', content: 'Meet at dawn by the river.', contentKo: '새벽 강가에서 만난다.', priority: 'high' },
        { id: 'anchor-fixture', type: 'anchor', status: 'active', activation: 'keyword', keywords: ['lighthouse'], title: 'Beacon', content: 'The lighthouse is blue.' },
    ],
    elementMemory: { injectionEnabled: true, entities: [{ id: 'cup', name: 'Cup', currentFacts: [{ text: 'The cup is yellow.' }], historyFacts: [], standaloneTriggers: [], triggerGroups: [['Jihee','cup']], aliases: [] }] },
    wiki: { injectionEnabled: true, docs: [
        { id: 'gate', title: 'Archive gate', category: 'place', summary: 'An iron gate.', keywordsEn: ['ArchiveGate'], sections: [{ id: 'gate-body', heading: 'History', body: 'The gate was built in 1900.', managed: 'user' }], images: [{url: '/backgrounds/royal.jpg', alt: 'IMAGE_SHOULD_NOT_INJECT'}] },
        { id: 'private', title: 'Private notes', summary: 'SECRET_NOT_INJECTED', excludeFromContext: true, alwaysRemember: true, keywordsEn: ['private'], sections: [{ heading: 'Notes', body: 'SECRET_NOT_INJECTED' }] },
    ] },
};
try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    await page.waitForFunction(() => SillyTavern.getContext().characters.length || [...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('Welcome to SillyTavern!')));
    if (await onboarding.count()) {
        await onboarding.locator('textarea').fill('QA User');
        await onboarding.getByText('Save', { exact: true }).click();
    }
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        for (const name of ['QA Alice', 'QA Bob']) {
            if (ctx.characters.some(c => c.name === name)) continue;
            const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: name, description: `Synthetic ${name}`, first_mes: 'Synthetic QA greeting.' }) });
            if (!response.ok) throw new Error('synthetic character create');
        }
        await (await import('/script.js')).getCharacters();
    });
    await page.waitForFunction(() => SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    check('extension module and native settings/menu load');
    await page.evaluate(async name => {
        await SillyTavern.getContext().selectCharacterById(0);
        await SillyTavern.getContext().openCharacterChat(name);
        const ctx = SillyTavern.getContext();
        ctx.chat.forEach(m => { m.send_date = new Date().toISOString(); });
        ctx.chatMetadata.world_info = 'Eldoria';
        await ctx.saveMetadata();
    }, chatName);
    await openVault();
    await root.locator('.mmc-tab[data-tab="promise"]').click();
    await click('new-item');
    await page.locator('#mmc-draft-title').fill('Browser promise');
    await page.locator('#mmc-draft-content').fill('Keep this promise after reload.');
    await click('save-draft');
    await waitSaved();
    assert.equal((await getData()).items[0].title, 'Browser promise');
    check('manual promise saves through native metadata and World Info');
    await importMemory(memory);
    const saved = await getData();
    assert.equal(saved.items.length, 2);
    assert.equal(saved.elementMemory.entities.length, 1);
    assert.equal(saved.wiki.docs.length, 2);
    assert.ok(saved.ownerChatId.startsWith('st:'));
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chatMetadata.world_info), 'Eldoria');
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chatMetadata.memoryVaultImportBackup.items[0].title), 'Browser promise');
    check('Marinara JSON import rebinds ownership, retains prior backup and user lorebook');

    async function scan(text) {
        return page.evaluate(async text => {
            const wi = await import('/scripts/world-info.js');
            return (await wi.getWorldInfoPrompt([text], 32768, true, {})).worldInfoString;
        }, text);
    }
    const miss = await scan('A quiet night with a cup.');
    assert.ok(miss.includes('Meet at dawn by the river.'));
    assert.ok(!miss.includes('The cup is yellow.'));
    assert.ok(!miss.includes('The lighthouse is blue.'));
    assert.ok(!miss.includes('gate was built'));
    const hit = await scan('Jihee found a cup near the lighthouse.\nArchiveGate private');
    assert.ok(hit.includes('The cup is yellow.'), hit);
    assert.ok(hit.includes('The lighthouse is blue.'));
    assert.ok(hit.includes('The gate was built in 1900.'));
    assert.ok(!hit.includes('SECRET_NOT_INJECTED'));
    assert.ok(!hit.includes('IMAGE_SHOULD_NOT_INJECT'));
    assert.ok(!hit.includes('새벽 강가'));
    assert.ok(!hit.includes('MEMORY_CABINET_BACKUP'));
    check('real native scanner: constant, keyword, AND groups, wiki, excluded docs, canonical language');

    await root.locator('.mmc-tab[data-tab="wiki"]').click();
    await page.screenshot({ path: 'test-results/wiki-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await root.locator('.mmc-shell').isVisible());
    assert.ok(await root.locator('.mmc-shell').evaluate(n => n.getBoundingClientRect().width <= innerWidth));
    await page.screenshot({ path: 'test-results/wiki-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    check('desktop and mobile layouts render within viewport');

    await page.reload();
    await page.waitForFunction(() => window.SillyTavern?.getContext().characters.length > 0);
    await page.evaluate(async name => {
        await SillyTavern.getContext().selectCharacterById(0);
        await SillyTavern.getContext().openCharacterChat(name);
    }, chatName);
    await page.waitForFunction(() => window.SillyTavern?.getContext().chatMetadata?.memoryCabinetV1?.items?.length === 2, null, { timeout: 60000 });
    await openVault();
    assert.equal((await getData()).wiki.docs[0].sections[0].managed, 'user');
    assert.ok((await scan('Jihee cup')).includes('The cup is yellow.'));
    check('reload restores data, manual wiki locks and injection without opening model connection');

    await click('close');
    await page.evaluate(async () => {
        const { branchChat } = await import('/scripts/bookmarks.js');
        await branchChat(SillyTavern.getContext().chat.length - 1);
    });
    await page.waitForFunction(oldBook => {
        const d = SillyTavern.getContext().chatMetadata.memoryCabinetV1;
        return d?.lorebookId && d.lorebookId !== oldBook && d.ownerChatId.startsWith('st:');
    }, saved.lorebookId, { timeout: 30000 });
    const branch = await getData();
    assert.equal(branch.items.length, 0);
    assert.equal(branch.branchHold.items.length, 2);
    assert.notEqual(branch.ownerChatId, saved.ownerChatId);
    assert.ok(!(await scan('Jihee cup')).includes('The cup is yellow.'));
    check('native branch splits ownership and holds post-cutoff or uncertain memory without injection');

    await page.evaluate(async name => { await SillyTavern.getContext().openCharacterChat(name); }, `${chatName} unrelated`);
    await openVault();
    const unrelatedPrompt = await scan('Jihee cup lighthouse ArchiveGate');
    assert.ok(!unrelatedPrompt.includes('The cup is yellow.'));
    assert.ok(!unrelatedPrompt.includes('Meet at dawn'));
    check('switching to unrelated chat never injects previous chat memory');
    await click('close');

    const group = await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const response = await fetch('/api/groups/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name: 'MemoryVault browser test group', members: [ctx.characters[0].avatar] }) });
        if (!response.ok) throw new Error('group create');
        return response.json();
    });
    await page.reload();
    await page.waitForFunction(id => window.SillyTavern?.getContext().groups.some(g => g.id === id), group.id);
    await page.evaluate(async group => {
        const { openGroupById } = await import('/scripts/group-chats.js');
        await openGroupById(group.id);
    }, group);
    await openVault();
    await importMemory(memory);
    assert.ok((await getData()).ownerChatId.includes('group%3A'));
    assert.ok((await scan('Jihee cup')).includes('The cup is yellow.'));
    check('native group chat supports import, metadata persistence and retrieval');

    // Exercise the real generateRaw pipeline with a deterministic local HTTP
    // response. No API key and no external provider request are used here.
    let modelCalls = 0;
    await page.locator('#main_api').selectOption('openai', { force: true });
    await page.evaluate(async () => {
        const { oai_settings } = await import('/scripts/openai.js');
        oai_settings.stream_openai = false;
    });
    await page.route('**/api/backends/chat-completions/generate', async route => {
        const request = route.request().postDataJSON();
        const prompt = JSON.stringify(request.messages);
        assert.ok(prompt.includes('SOURCE MESSAGES'));
        const sourceIndex = Number(prompt.match(/\[M(\d+) (?:assistant|user)\][^\n]*?RelayBell/)?.[1] ?? 0);
        modelCalls++;
        const content = JSON.stringify({ entities: [{
            action: 'create', name: 'RelayBell', aliases: [], standaloneTriggers: ['RelayBell'], triggerGroups: [],
            currentFacts: [{ text: 'RelayBell is brass.' }], historyFacts: [], evidence: [sourceIndex],
        }] });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }) });
    });
    await page.evaluate(async () => {
        const { setOnlineStatus } = await import('/script.js');
        const ctx = SillyTavern.getContext();
        ctx.chat.push({ name: ctx.name1, is_user: true, mes: 'I see RelayBell.', send_date: new Date().toISOString() });
        ctx.chat.push({ name: 'Narrator', is_user: false, mes: 'RelayBell is brass.', send_date: new Date().toISOString() });
        await ctx.saveMetadata();
        setOnlineStatus('Test connection');
    });
    const messageCount = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await root.locator('.mmc-tab[data-tab="element"]').click();
    await click('extract-elements');
    await page.locator('#mmc-ec-name-0').waitFor();
    assert.equal(await page.locator('#mmc-ec-name-0').inputValue(), 'RelayBell');
    assert.equal((await getData()).elementMemory.entities.length, 1, 'model candidates must not auto-save');
    await click('save-element-candidates');
    await page.waitForFunction(() => document.querySelector('.mmc-toast')?.textContent === '요소 기억 1개를 저장했습니다.');
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.elementMemory.entities.length === 2);
    assert.equal(modelCalls, 1);
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.length), messageCount, 'analysis must not append a chat response');
    await waitSaved();
    assert.ok((await scan('RelayBell')).includes('RelayBell is brass.'));
    check('real generateRaw + mocked provider: source extraction, candidate review, explicit save, no added chat message');

    const { verifyV211 } = await import('./browser-v211.mjs');
    await verifyV211({ page, root, click, importMemory, waitSaved, getData, scan, check });
    assert.deepEqual(errors, [], 'browser must not have uncaught errors');
    console.log('All browser scenarios passed; no real model provider was called.');
} catch (error) {
    console.error('Browser failure:', error);
    console.error('Uncaught errors:', errors);
    console.error('Vault toast:', await page.locator('.mmc-toast').allTextContents());
    await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
    process.exitCode = 1;
} finally { await browser.close(); }
