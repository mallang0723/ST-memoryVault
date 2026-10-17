// Automatic range records on a real SillyTavern 1.19 install (disposable QA data root).
// Fake provider only. Checks: auto run after new turns, no confirm, no duplicate,
// reload during a request -> "결과 미확정" candidate and no automatic retry.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8019';
const shots = process.env.SHOT_DIR || 'test-results';
const captures = [];
let gate = null;
const provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    captures.push(JSON.parse(text || '{}'));
    if (gate) await gate.promise;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ title: `Auto ${captures.length}`, summary: 'They kept talking about the trip.', knownBy: ['all'], lines: [1, 2], facts: [{ text: `HOTEL-FACT ${captures.length}`, knownBy: ['all'], lines: [2] }], keywords: ['trip'] }) }, finish_reason: 'stop' }] }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [], blocked = [];
let page;
let root;
async function openPage() {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    root = page.locator('#mmc-root-v1');
}
await openPage();

const act = (action, extra = '') => root.locator(`[data-action="${action}"]${extra}`).filter({ visible: true }).first();
const meta = () => page.evaluate(() => structuredClone(SillyTavern.getContext().chatMetadata.memoryCabinetV1));
const idle = async () => { await page.waitForFunction(() => !document.querySelector('#mmc-root-v1 .mmc-busy') && !document.getElementById('mmc-root-v1')?.hasAttribute('aria-busy'), null, { timeout: 60000 }); await page.waitForTimeout(300); };
const check = m => console.log(`PASS ${m}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setupConnection() {
    await page.evaluate(async providerUrl => {
        const st = await import('/script.js');
        if (st.main_api !== 'openai') $('#main_api').val('openai').trigger('change');
        const { oai_settings } = await import('/scripts/openai.js');
        Object.assign(oai_settings, { chat_completion_source: 'custom', custom_url: providerUrl, custom_model: 'fake-summary', reverse_proxy: '' });
    }, providerUrl);
}
async function addTurns(n) {
    await page.evaluate(async n => {
        const ctx = SillyTavern.getContext();
        for (let i = 0; i < n; i++) {
            const k = ctx.chat.length;
            ctx.chat.push({ name: k % 2 ? 'QA Mina' : 'QA User', is_user: k % 2 === 0, mes: `Trip line ${k + 1}.`, send_date: new Date(Date.UTC(2026, 9, 17, 12, k)).toISOString(), swipe_id: 0, swipes: [`Trip line ${k + 1}.`], extra: {} });
        }
        await ctx.saveChat();
        await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, ctx.chat.length - 1);
        await ctx.eventSource.emit(ctx.eventTypes.GENERATION_ENDED);
    }, n);
}
async function reopen(chatFile) {
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1') && SillyTavern.getContext().characters.some(c => c.name === 'QA Mina'), null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate(async name => { const ctx = SillyTavern.getContext(); await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'QA Mina')); await SillyTavern.getContext().openCharacterChat(name); }, chatFile);
    await page.waitForFunction(name => String(SillyTavern.getContext().chatId) === name, chatFile);
}
async function openScenes() {
    if (await root.locator('.mmc-shell').isVisible()) return;
    await page.locator('#mmc-launcher-v1').click();
    await root.locator('.mmc-shell').waitFor({ state: 'visible' });
    await idle();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
}
try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    if (await onboarding.count()) { await onboarding.locator('textarea').fill('QA User'); await onboarding.getByText('Save', { exact: true }).click(); }
    const chatFile = await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const st = await import('/script.js');
        if (!ctx.characters.some(c => c.name === 'QA Mina')) {
            await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'QA Mina', first_mes: 'Hi.' }) });
            await st.getCharacters();
        }
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'QA Mina'));
        await st.doNewChat({ deleteCurrentChat: false });
        SillyTavern.getContext().chat.length = 0;
        await SillyTavern.getContext().saveChat();
        return String(SillyTavern.getContext().chatId);
    });
    await setupConnection();
    await addTurns(6);
    // One manual record first (the auto toggle is locked until then).
    await openScenes();
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await page.locator('#mmc-chr-start').fill('1'); await page.locator('#mmc-chr-start').dispatchEvent('change');
    await page.locator('#mmc-chr-end').fill('6'); await page.locator('#mmc-chr-end').dispatchEvent('change');
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes || []).length === 1);
    await idle();
    await act('chronicle-settings').click();
    await page.locator('#mmc-chr-set-scene-auto').check();
    await page.locator('#mmc-chr-set-every').fill('3');
    await page.locator('#mmc-chr-set-buffer').fill('1');
    await act('chronicle-save-settings').click();
    await idle();
    assert.match(await root.locator('[data-chr-auto]').innerText(), /완료 응답 4개 남음/);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/auto-waiting-desktop.png` });
    await act('close').click().catch(() => {});
    await root.locator('[data-action="close"]').first().click({ force: true }).catch(() => {});
    check('auto toggle unlocked after one manual record; header shows how many responses remain');

    // Four new turns (2 responses) are not enough; eight more turns trigger exactly one request.
    const before = captures.length;
    await addTurns(4);
    await page.waitForTimeout(1500);
    assert.equal(captures.length, before, 'below K + buffer: no call');
    await addTurns(4);
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.chronicle.reviews || []).length === 1, null, { timeout: 30000 });
    assert.equal(captures.length, before + 1);
    let m = await meta();
    assert.equal(m.chronicle.reviews[0].range.startIndex, 6);
    assert.equal(m.chronicle.reviews[0].range.count, 6, '#7~#12: three responses, ends on the assistant line');
    await addTurns(2);
    await page.waitForTimeout(1500);
    assert.equal(captures.length, before + 1, 'pending candidate blocks another paid call');
    await page.reload();
    await reopen(chatFile);
    await setupConnection();
    await page.waitForTimeout(1500);
    assert.equal(captures.length, before + 1, 'a reload is not a paid retry trigger');
    check('auto run after K completed responses with the buffer kept; no duplicate on later events or reload');

    // Approve the auto candidate, then lose the next request to a reload mid-flight.
    await openScenes();
    await act('chronicle-open-review').click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes || []).length === 2);
    await idle();
    await root.locator('[data-action="close"]').first().click({ force: true });
    gate = deferred();
    await addTurns(6);
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.chronicle.jobs || []).length === 1, null, { timeout: 30000 });
    const sent = captures.length + 1;
    while (captures.length < sent) await new Promise(r => setTimeout(r, 100)); // the request reached the provider
    // Simulate a crash/closed tab mid-request: the page's JS is gone before the answer arrives.
    await page.close({ runBeforeUnload: false });
    gate.resolve(); gate = null;
    await new Promise(r => setTimeout(r, 1500));
    await openPage();
    await page.goto(base);
    await reopen(chatFile);
    await setupConnection();
    await openScenes();
    await page.waitForFunction(() => { const c = SillyTavern.getContext().chatMetadata.memoryCabinetV1.chronicle; return !(c.jobs || []).length && (c.reviews || []).some(r => r.status === 'failed' && r.reason.startsWith('결과 미확정')); });
    await idle();
    assert.match(await root.locator('[data-chr-auto]').innerText(), /결과 미확정|검토 대기/);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/auto-uncertain-desktop.png` });
    await root.locator('[data-action="close"]').first().click({ force: true });
    await addTurns(6);
    await page.waitForTimeout(2000);
    assert.equal(captures.length, sent, 'no automatic retry after an uncertain request');
    check('reload during an auto request: recorded as 결과 미확정, never retried automatically');
    for (const body of captures) assert.deepEqual(body.messages.map(x => x.role), ['system', 'user']);
    assert.doesNotMatch(JSON.stringify(captures), /MEMORY_CABINET|memoryCabinet|기억 ?보관함|§|st-message:/);
    assert.ok(!JSON.stringify(captures).includes(chatFile));
    assert.deepEqual(errors, []);
    check(`${captures.length} fake-provider requests, zero real model calls; blocked=${blocked.length}`);
} catch (error) {
    await page.screenshot({ path: `${shots}/auto-failure.png` }).catch(() => {});
    console.log('DEBUG', JSON.stringify(await meta().then(m => ({ reviews: m.chronicle.reviews.map(r => [r.id, r.status, r.reason?.slice(0, 40), r.candidate?.title]), jobs: m.chronicle.jobs })).catch(e => String(e))), captures.length);
    throw error;
} finally {
    await browser.close();
    await new Promise(resolve => provider.close(resolve));
}
