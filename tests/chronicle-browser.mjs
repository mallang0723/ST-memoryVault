// Scene chronicle UI flow on a real SillyTavern 1.19 install (disposable QA data root).
// The model is a local fake provider; every other generation/embedding request is aborted.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8019';
const shots = process.env.SHOT_DIR || 'test-results';
const captures = [];
let gate = null;
let replyFor = () => null;
const scene = (title, summary, lines, extra = {}) => JSON.stringify({ title, background: { place: extra.place || '' }, summary, participants: ['QA User', 'QA Mina'], knownBy: ['all'], lines,
    facts: [{ text: extra.fact || `${title} happened.`, status: 'current', knownBy: ['all'], lines: lines.slice(0, 2) }], keywords: extra.keywords || [title.split(' ')[0].toLowerCase()], openQuestions: [] });
const provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || '{}');
    captures.push({ path: req.url, body });
    if (gate) await gate.promise;
    const content = replyFor(body) || scene('Library key', 'QA User found a key and QA Mina hid it in the library.', [1, 2, 3]);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 60 } }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const blocked = [], errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.route('**/*', route => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.origin !== new URL(base).origin) { blocked.push(u.origin); return route.abort(); }
    if (u.pathname.startsWith('/api/backends/') && /generate|embeddings|status|tokenize/.test(u.pathname)) {
        if (u.pathname !== '/api/backends/chat-completions/generate') { blocked.push(u.pathname); return route.abort(); }
        const body = JSON.parse(request.postData() || '{}');
        if (body.chat_completion_source !== 'custom' || body.custom_url !== providerUrl) { blocked.push(`${u.pathname}:${body.chat_completion_source}`); return route.abort(); }
    }
    if (/\/api\/(openai|vector|extensions\/(update|version))/.test(u.pathname)) { blocked.push(u.pathname); return route.abort(); }
    return route.continue();
});
const root = page.locator('#mmc-root-v1');
const act = (action, extra = '') => root.locator(`[data-action="${action}"]${extra}`).filter({ visible: true }).first();
const data = () => page.evaluate(() => structuredClone(SillyTavern.getContext().chatMetadata.memoryCabinetV1));
const idle = async () => { await page.waitForFunction(() => !document.querySelector('#mmc-root-v1 .mmc-busy'), null, { timeout: 60000 }); await page.waitForTimeout(400); };
const check = message => console.log(`PASS ${message}`);
const lines = [
    ['QA User', 'Mina, I found an old brass key under the library desk.'], ['QA Mina', 'Mina takes the brass key and hides it in her coat. "Tell no one."'],
    ['QA User', 'Then we meet at the library again tonight.'], ['QA Mina', 'Mina nods and agrees to meet at the library at nine.'],
    ['QA User', 'Should we tell the librarian about the key?'], ['QA Mina', 'Mina says the librarian must not know yet.'],
    ['QA User', 'At nine I wait by the north gate with a lantern.'], ['QA Mina', 'Mina arrives late and unlocks the archive door with the brass key.'],
    ['QA User', 'Inside the archive we find a sealed letter.'], ['QA Mina', 'Mina reads the letter: her brother is alive in the harbor town.'],
    ['QA User', 'We decide to leave for the harbor at dawn.'], ['QA Mina', 'Mina packs the letter and the key for the trip.'],
];
async function chooseRange(start, end) {
    await page.locator('#mmc-chr-start').fill(String(start));
    await page.locator('#mmc-chr-start').dispatchEvent('change');
    await page.locator('#mmc-chr-end').fill(String(end));
    await page.locator('#mmc-chr-end').dispatchEvent('change');
    await page.waitForFunction(([s, e]) => document.querySelector('.mmc-chr-summary b')?.textContent.includes(`#${s}~#${e}`), [start, end]);
}
async function scan(text) {
    return page.evaluate(async text => {
        const wi = await import('/scripts/world-info.js');
        return (await wi.getWorldInfoPrompt([text], 32768, true, {})).worldInfoString;
    }, text);
}
const evidence = {};
try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    if (await onboarding.count()) { await onboarding.locator('textarea').fill('QA User'); await onboarding.getByText('Save', { exact: true }).click(); }
    const chatFile = await page.evaluate(async ({ lines, providerUrl }) => {
        const ctx = SillyTavern.getContext();
        const st = await import('/script.js');
        if (!ctx.characters.some(c => c.name === 'QA Mina')) {
            const r = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'QA Mina', description: 'CARD_DESCRIPTION_CANARY', scenario: 'SCENARIO_CANARY', mes_example: '<START>\nEXAMPLE_CANARY', first_mes: 'Synthetic greeting.' }) });
            if (!r.ok) throw new Error('synthetic character create');
            await st.getCharacters();
        }
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'QA Mina'));
        await st.doNewChat({ deleteCurrentChat: false });
        const chat = SillyTavern.getContext().chat;
        chat.length = 0;
        lines.forEach(([name, mes], i) => chat.push({ name, is_user: name === 'QA User', mes, send_date: new Date(Date.UTC(2026, 9, 17, 9, i)).toISOString(), swipe_id: 0, swipes: [mes], extra: {} }));
        await SillyTavern.getContext().saveChat();
        await st.reloadCurrentChat();
        if (st.main_api !== 'openai') $('#main_api').val('openai').trigger('change');
        const { oai_settings } = await import('/scripts/openai.js');
        Object.assign(oai_settings, { chat_completion_source: 'custom', custom_url: providerUrl, custom_model: 'fake-summary', reverse_proxy: '',
            custom_include_body: 'tools: [{type: function, function: {name: RP_TOOL_POISON}}]', custom_include_headers: 'X-RP-Canary: RP_HEADER_POISON', assistant_prefill: 'RP_PREFILL_POISON' });
        ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_PROMPT_READY, e => { (e.chat || []).push({ role: 'system', content: 'RP_HOOK_POISON' }); });
        return String(SillyTavern.getContext().chatId);
    }, { lines, providerUrl });
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.length), 12);
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.some(m => m.extra?.memory)), false, 'Summarize output is not used');

    await page.locator('#mmc-launcher-v1').click();
    await root.locator('.mmc-shell').waitFor({ state: 'visible' });
    await idle();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await chooseRange(1, 6);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-range-desktop.png` });
    replyFor = () => scene('Library key', 'QA User found a brass key under the library desk; QA Mina hid it and they agreed to meet at the library at nine without telling the librarian.', [1, 2, 3, 4, 5, 6], { place: 'library', keywords: ['brass key', 'library'], fact: 'Mina keeps the brass key hidden in her coat.' });
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    assert.equal(captures.length, 1);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-review-desktop.png` });
    await page.locator('#mmc-chr-title').fill('Library key (edited)');
    await act('chronicle-approve').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1?.episodes || []).length === 1 && !document.querySelector('.mmc-chronicle-review'));
    await idle();
    let d = await data();
    assert.equal(d.episodes[0].title, 'Library key (edited)');
    assert.equal(d.episodes[0].chronicle.mode, 'range');
    assert.equal(d.episodes[0].chronicle.status, 'approved');
    assert.equal(d.episodes[0].chronicle.range.count, 6);
    assert.equal(d.episodes[0].chronicle.revision, 1);
    assert.deepEqual(d.episodes[0].facts[0].lines, [1, 2]);
    assert.equal(d.chronicle.reviews.length, 0);
    check('range #1~#6 -> one isolated request -> review side by side -> edited approve saves a range scene');

    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    assert.equal(await page.locator('#mmc-chr-start').inputValue(), '7', 'next range starts after the last recorded one');
    await chooseRange(7, 12);
    replyFor = () => scene('Archive letter', 'QA Mina opened the archive with the brass key; the sealed letter says her brother is alive in the harbor town, so they leave at dawn.', [1, 2, 3, 4, 5, 6], { place: 'archive', keywords: ['archive', 'harbor'], fact: 'Mina\'s brother is alive in the harbor town.' });
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1?.episodes || []).length === 2 && !document.querySelector('.mmc-chronicle-review'));
    await idle();
    assert.equal(captures.length, 2);
    d = await data();
    const second = captures[1].body.messages[1].content;
    assert.match(second, /EARLIER SCENES \(reference only\):\n- Library key \(edited\)/, 'delta prompt uses the approved earlier scene body');
    assert.equal(d.episodes[1].chronicle.contextRefs[0].id, d.episodes[0].id);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-list-desktop.png` });
    check('second range #7~#12 references the approved earlier scene as delta context; list shows both ranges');

    const wiHit = await scan('We should go back to the archive.');
    assert.ok(wiHit.includes('archive') && wiHit.includes('brother is alive'), wiHit);
    assert.doesNotMatch(wiHit, /MEMORY_CABINET|§|기억 ?보관함|memoryCabinet/);
    assert.ok(!wiHit.includes(chatFile));
    check('approved range scene reaches the native World Info scan by keyword without internal labels');

    // Manual edit bumps the revision and keeps the previous version.
    await root.locator(`[data-episode-id="${d.episodes[0].id}"] [data-action="edit-episode"]`).click();
    await page.locator('#mmc-ep-summary').fill('QA User found a brass key; QA Mina hid it. They will meet at the library at nine.');
    await act('save-episode').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.revision === 2, d.episodes[0].id);
    await idle();
    check('editing a range scene raises its revision and stores the previous text');

    // Regenerate the first scene: new candidate, approval replaces in place.
    await root.locator(`[data-episode-id="${d.episodes[0].id}"] [data-action="chronicle-regenerate"]`).click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    assert.equal(await page.locator('#mmc-chr-start').inputValue(), '1');
    assert.equal(await page.locator('#mmc-chr-end').inputValue(), '6');
    replyFor = () => scene('Brass key', 'QA User found the brass key and QA Mina hid it; they agreed to keep it from the librarian and meet at nine.', [1, 2, 6], { place: 'library', keywords: ['brass key'] });
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    assert.match(await root.locator('.mmc-chronicle-review').innerText(), /이전 판을 보관/);
    await act('chronicle-approve').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.revision === 3, d.episodes[0].id);
    await idle();
    d = await data();
    assert.equal(d.episodes.length, 2);
    assert.equal(d.episodes[0].title, 'Brass key');
    assert.deepEqual(d.episodes[0].chronicle.previous.map(p => p.reason), ['edited', 'regenerated']);
    check('regenerate replaces the same scene after approval (revision 3, previous versions kept)');

    // Cancel: the late response is discarded.
    gate = deferred();
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await chooseRange(9, 12);
    await act('chronicle-run').click();
    await root.locator('[data-action="chronicle-cancel"]').click();
    await idle();
    gate.resolve(); gate = null;
    await page.waitForTimeout(1500);
    d = await data();
    assert.equal((d.chronicle.reviews || []).length, 0);
    assert.equal(captures.length, 4);
    check('cancelled request: late response is not saved');

    // Source edit during the call: the paid result is kept but held and cannot be approved.
    gate = deferred();
    replyFor = () => scene('Harbor plan', 'They plan to leave for the harbor at dawn.', [1, 2, 3]);
    await act('chronicle-run').click();
    while (captures.length < 5) await page.waitForTimeout(100);
    await page.evaluate(async () => { const ctx = SillyTavern.getContext(); ctx.chat[9].mes = 'Mina reads the letter twice.'; await ctx.saveChat(); });
    gate.resolve(); gate = null;
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    d = await data();
    assert.equal(d.chronicle.reviews[0].status, 'held');
    assert.equal(await act('chronicle-approve').isDisabled(), true);
    assert.match(await root.locator('.mmc-chr-source').innerText(), /그대로 찾을 수 없어요/);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-review-held-desktop.png` });
    await act('chronicle-discard').click();
    await page.waitForFunction(() => !(SillyTavern.getContext().chatMetadata.memoryCabinetV1.chronicle.reviews || []).length);
    await idle();
    check('source edited during the call: result held, approve disabled, discard works');

    // The edited source invalidates the second scene: persisted stale, card badge, WI withheld.
    await root.locator('.mmc-tab[data-tab="overview"]').click();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
    const secondId = d.episodes[1].id;
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.status === 'stale', secondId);
    await idle();
    assert.match(await root.locator(`[data-episode-id="${secondId}"]`).innerText(), /원문 변경 · 주입 보류/);
    const staleScan = await scan('We should go back to the archive near the harbor.');
    assert.ok(!staleScan.includes('brother is alive'), staleScan);
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-stale-desktop.png` });
    check('edited source: scene persisted as stale, badge shown, World Info withholds it');

    // Delete is a tombstone: restore brings it back (still stale), purge removes it.
    await root.locator(`[data-episode-id="${secondId}"] [data-action="edit-episode"]`).click();
    await act('delete-episode').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.status === 'deleted', secondId);
    await idle();
    await root.locator('.mmc-chr-archive summary').click();
    await root.locator(`[data-episode-id="${secondId}"] [data-action="chronicle-restore"]`).click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.status === 'stale', secondId);
    await idle();
    await root.locator(`[data-episode-id="${secondId}"] [data-action="edit-episode"]`).click();
    await act('delete-episode').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.status === 'deleted', secondId);
    await idle();
    await root.locator('.mmc-chr-archive summary').click();
    await root.locator(`[data-episode-id="${secondId}"] [data-action="chronicle-purge"]`).click();
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.length === 1);
    await idle();
    check('delete keeps a tombstone with restore; purge removes it permanently');

    // Export -> import puts range scenes on hold; 원문 대조 restores the one that still matches.
    const exported = await data();
    await act('settings').click();
    await root.locator('[data-action="settings-tab"][data-settings-tab="data"]').click();
    const chooser = page.waitForEvent('filechooser');
    await act('import-memory').click();
    await (await chooser).setFiles({ name: 'memory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'memory-vault', version: 1, data: exported })) });
    await page.waitForFunction(() => document.querySelector('.mmc-toast')?.textContent.includes('가져왔습니다'));
    await page.waitForFunction(() => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes[0]?.chronicle.invalidReason === 'imported');
    await idle();
    if (await root.locator('.mmc-layer [data-action="close-layer"]').count()) await root.locator('.mmc-layer [data-action="close-layer"]').first().click();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();
    const firstId = exported.episodes[0].id;
    assert.ok(!(await scan('the brass key')).includes('librarian'), 'imported scene is not injected before verification');
    await root.locator(`[data-episode-id="${firstId}"] [data-action="chronicle-reconfirm"]`).click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.status === 'approved', firstId);
    await idle();
    assert.ok((await scan('the brass key')).includes('librarian'));
    check('imported range scene is held until 원문 대조 confirms the source, then injects again');

    // Mobile layout.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert.ok(await root.locator('.mmc-shell').evaluate(n => n.getBoundingClientRect().width <= innerWidth));
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-list-mobile.png` });
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-range-mobile.png` });
    assert.ok(await root.locator('.mmc-chronicle-layer').evaluate(n => n.scrollWidth <= innerWidth + 1));
    await chooseRange(7, 12);
    replyFor = () => scene('Archive letter', 'QA Mina opened the archive and read that her brother is alive.', [1, 2, 3, 4]);
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-review-mobile.png` });
    assert.ok(await root.locator('.mmc-chronicle-review').evaluate(n => n.scrollWidth <= innerWidth + 1));
    await page.setViewportSize({ width: 1440, height: 1000 });
    check('mobile 390px: list, range picker and review fit the viewport');

    // Final request audit: every model request carried only our two messages.
    for (const capture of captures) {
        assert.equal(capture.path, '/v1/chat/completions');
        assert.deepEqual(capture.body.messages.map(m => m.role), ['system', 'user']);
        assert.equal(capture.body.tools, undefined);
        assert.equal(capture.body.model, 'fake-summary');
    }
    const all = JSON.stringify(captures);
    assert.doesNotMatch(all, /POISON|CANARY|MEMORY_CABINET|memoryCabinet|기억 ?보관함|Memory Vault|§|st-message:/);
    assert.ok(!all.includes(chatFile), 'chat file name never reaches the model');
    assert.match(all, /QA Mina: Mina takes the brass key/, 'speaker names in the source are kept');
    assert.deepEqual(errors, []);
    Object.assign(evidence, { chatFile, requests: captures.length, captures, blocked, errors, realModelCalls: 0 });
    await mkdir(shots, { recursive: true });
    await writeFile(`${shots}/chronicle-evidence.json`, JSON.stringify(evidence, null, 2));
    check(`request audit: ${captures.length} fake-provider requests, only system+user summary messages, no RP preset/card/hook/tool/internal labels/chat file name; blocked=${blocked.length}`);
} catch (error) {
    await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/chronicle-failure.png` }).catch(() => {});
    throw error;
} finally {
    await browser.close();
    await new Promise(resolve => provider.close(resolve));
}
