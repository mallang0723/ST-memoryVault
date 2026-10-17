// 원문 대조 (re-verify an imported range scene) on a real SillyTavern 1.19 install.
// exact/moved -> approved again; changed/ambiguous -> stays held. Fake provider only.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8019';
const shots = process.env.SHOT_DIR || 'test-results';
const captures = [];
const provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    captures.push(JSON.parse(text || '{}'));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: 'Bell tower', summary: 'They climbed the bell tower.', knownBy: ['all'], lines: [1, 2], facts: [{ text: 'GOLF-FACT the bell is cracked.', knownBy: ['all'], lines: [1] }], keywords: ['bell tower'] }) }, finish_reason: 'stop' }] }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], blocked = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.origin !== new URL(base).origin) { blocked.push(u.origin); return route.abort(); }
    if (u.pathname.startsWith('/api/backends/') && /generate|embeddings|status|tokenize/.test(u.pathname)) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (u.pathname !== '/api/backends/chat-completions/generate' || body.custom_url !== providerUrl) { blocked.push(u.pathname); return route.abort(); }
    }
    if (/\/api\/(openai|vector|extensions\/(update|version))/.test(u.pathname)) { blocked.push(u.pathname); return route.abort(); }
    return route.continue();
});
const root = page.locator('#mmc-root-v1');
const act = (action, extra = '') => root.locator(`[data-action="${action}"]${extra}`).filter({ visible: true }).first();
const data = () => page.evaluate(() => structuredClone(SillyTavern.getContext().chatMetadata.memoryCabinetV1));
const idle = async () => { await page.waitForFunction(() => !document.querySelector('#mmc-root-v1 .mmc-busy') && !document.getElementById('mmc-root-v1')?.hasAttribute('aria-busy'), null, { timeout: 60000 }); await page.waitForTimeout(300); };
const check = m => console.log(`PASS ${m}`);
const editChat = fn => page.evaluate(async src => { const ctx = SillyTavern.getContext(); (0, eval)(src)(ctx.chat); await ctx.saveChat(); }, fn.toString());
async function importData(exported) {
    await act('settings').click();
    await root.locator('[data-action="settings-tab"][data-settings-tab="data"]').click();
    const chooser = page.waitForEvent('filechooser');
    await act('import-memory').click();
    await (await chooser).setFiles({ name: 'memory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'memory-vault', version: 1, data: exported })) });
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes?.[0]?.chronicle?.invalidReason === 'imported');
    await idle();
    if (await root.locator('.mmc-layer [data-action="close-layer"]').count()) await root.locator('.mmc-layer [data-action="close-layer"]').first().click({ force: true });
    await root.locator('.mmc-tab[data-tab="overview"]').click();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
}
async function reconfirm(id) {
    await root.locator(`[data-episode-id="${id}"] [data-action="chronicle-reconfirm"]`).first().click();
    await idle();
    return (await data()).episodes.find(e => e.id === id).chronicle;
}
try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    if (await onboarding.count()) { await onboarding.locator('textarea').fill('QA User'); await onboarding.getByText('Save', { exact: true }).click(); }
    await page.evaluate(async providerUrl => {
        const ctx = SillyTavern.getContext();
        const st = await import('/script.js');
        if (!ctx.characters.some(c => c.name === 'QA Mina')) {
            await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'QA Mina', first_mes: 'Hi.' }) });
            await st.getCharacters();
        }
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'QA Mina'));
        await st.doNewChat({ deleteCurrentChat: false });
        const chat = SillyTavern.getContext().chat;
        chat.length = 0;
        for (let i = 0; i < 10; i++) chat.push({ name: i % 2 ? 'QA Mina' : 'QA User', is_user: i % 2 === 0, mes: `Tower line ${i + 1}.`, send_date: new Date(Date.UTC(2026, 9, 17, 10, i)).toISOString(), swipe_id: 0, swipes: [`Tower line ${i + 1}.`], extra: {} });
        await SillyTavern.getContext().saveChat();
        await st.reloadCurrentChat();
        if (st.main_api !== 'openai') $('#main_api').val('openai').trigger('change');
        const { oai_settings } = await import('/scripts/openai.js');
        Object.assign(oai_settings, { chat_completion_source: 'custom', custom_url: providerUrl, custom_model: 'fake-summary', reverse_proxy: '' });
    }, providerUrl);
    await page.locator('#mmc-launcher-v1').click();
    await root.locator('.mmc-shell').waitFor({ state: 'visible' });
    await idle();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await page.locator('#mmc-chr-start').fill('3'); await page.locator('#mmc-chr-start').dispatchEvent('change');
    await page.locator('#mmc-chr-end').fill('6'); await page.locator('#mmc-chr-end').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('.mmc-chr-summary b')?.textContent.includes('#3~#6'));
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes || []).length === 1);
    await idle();
    const exported = await data();
    const id = exported.episodes[0].id;

    // exact
    await importData(exported);
    let c = await reconfirm(id);
    assert.deepEqual([c.status, c.invalidReason, c.range.startIndex], ['approved', '', 2]);
    check('원문 대조 · exact: imported scene re-approved');

    // moved: a message inserted before the range
    await editChat(chat => chat.unshift({ name: 'QA User', is_user: true, mes: 'Inserted prologue.', send_date: '2026-10-17T09:59:00.000Z', swipe_id: 0, swipes: ['Inserted prologue.'], extra: {} }));
    await importData(exported);
    c = await reconfirm(id);
    assert.deepEqual([c.status, c.range.startIndex], ['approved', 3]);
    assert.match(await root.locator(`[data-episode-id="${id}"]`).innerText(), /#4~#7/);
    check('원문 대조 · moved: re-approved at the new position #4~#7');

    // ambiguous: the same four lines appear twice
    await editChat(chat => { chat.push(...structuredClone(chat.slice(3, 7))); });
    await importData(exported);
    c = await reconfirm(id);
    assert.deepEqual([c.status, c.invalidReason], ['held', 'imported']);
    assert.match(await page.locator('.mmc-toast').last().innerText(), /여러 곳/);
    check('원문 대조 · ambiguous: stays held with an explanation');

    // changed: duplicates removed, one line inside the range edited
    await editChat(chat => { chat.splice(11); chat[4].mes = 'Tower line 4, edited.'; chat[4].swipes = [chat[4].mes]; });
    await importData(exported);
    c = await reconfirm(id);
    assert.deepEqual([c.status, c.invalidReason], ['held', 'imported']);
    assert.match(await page.locator('.mmc-toast').last().innerText(), /원문이 바뀌어/);
    await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/verify-held-desktop.png` });
    check('원문 대조 · changed: stays held, regenerate is required');
    assert.deepEqual(errors, []);
    assert.equal(captures.length, 1, 'only the one scene request; verification makes no model call');
    check(`one fake-provider request, zero real model calls; blocked=${blocked.length}`);
} catch (error) {
    await page.screenshot({ path: `${shots}/verify-failure.png` }).catch(() => {});
    throw error;
} finally {
    await browser.close();
    await new Promise(resolve => provider.close(resolve));
}
