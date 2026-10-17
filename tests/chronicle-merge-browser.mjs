// Recursive merge + range tree UI on a real SillyTavern 1.19 install (disposable QA data root).
// The model is a local fake provider; every other generation/embedding request is aborted.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8019';
const shots = process.env.SHOT_DIR || 'test-results';
const captures = [];
const replies = [];
const provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || '{}');
    captures.push({ path: req.url, body });
    const user = body.messages?.[1]?.content || '';
    const next = replies.shift();
    const content = typeof next === 'function' ? next(user) : next || JSON.stringify({ title: 'Fallback', summary: 'Fallback summary.', knownBy: ['all'], facts: [], keywords: [] });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 80 } }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const sceneJson = (title, summary, keyword, fact) => JSON.stringify({ title, background: { place: '' }, summary, participants: ['QA User', 'QA Mina'], knownBy: ['all'], lines: [1, 2],
    facts: [{ text: fact, status: 'current', knownBy: ['all'], lines: [1, 2] }], keywords: [keyword], openQuestions: [] });
const mergeJson = (title, summary, keyword, fact) => JSON.stringify({ title, background: { place: '' }, summary, participants: ['QA User', 'QA Mina'], knownBy: ['all'],
    facts: [{ text: fact, status: 'current', knownBy: ['all'], parts: [1, 2] }], keywords: [keyword], openQuestions: [] });

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
const shot = async name => { await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/${name}.png` }); };
const check = message => console.log(`PASS ${message}`);
const card = id => root.locator(`[data-episode-id="${id}"]`).first();
async function scan(text) {
    return page.evaluate(async text => {
        const wi = await import('/scripts/world-info.js');
        return (await wi.getWorldInfoPrompt([text], 32768, true, {})).worldInfoString;
    }, text);
}
async function makeScene(start, end, reply) {
    await act('chronicle-new').click();
    await root.locator('.mmc-chronicle-layer').waitFor();
    await page.locator('#mmc-chr-start').fill(String(start)); await page.locator('#mmc-chr-start').dispatchEvent('change');
    await page.locator('#mmc-chr-end').fill(String(end)); await page.locator('#mmc-chr-end').dispatchEvent('change');
    await page.waitForFunction(([s, e]) => document.querySelector('.mmc-chr-summary b')?.textContent.includes(`#${s}~#${e}`), [start, end]);
    replies.push(reply);
    await act('chronicle-run').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    const before = (await data()).episodes?.length || 0;
    await act('chronicle-approve').click();
    await page.waitForFunction(n => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes || []).length === n + 1 && !document.querySelector('.mmc-chronicle-review'), before);
    await idle();
    return (await data()).episodes.at(-1).id;
}
async function select(id) { await root.locator(`input[data-chr-select="${id}"]`).first().check(); await idle(); }
async function merge(reply, screenshot = '') {
    replies.push(reply);
    await act('chronicle-merge-selected').click();
    await root.locator('.mmc-chronicle-review').waitFor();
    await idle();
    if (screenshot) await shot(screenshot);
    await act('chronicle-approve').click();
    await page.waitForFunction(() => !document.querySelector('.mmc-chronicle-review'));
    await idle();
}
const stateOf = id => root.locator(`[data-episode-id="${id}"] [data-chr-state]`).first().getAttribute('data-chr-state');
async function expand(id) {
    const btn = root.locator(`[data-action="chronicle-toggle-node"][data-id="${id}"]`).first();
    if ((await btn.getAttribute('aria-expanded')) !== 'true') { await btn.click(); await idle(); }
}

try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    if (await onboarding.count()) { await onboarding.locator('textarea').fill('QA User'); await onboarding.getByText('Save', { exact: true }).click(); }
    const chatFile = await page.evaluate(async providerUrl => {
        const ctx = SillyTavern.getContext();
        const st = await import('/script.js');
        if (!ctx.characters.some(c => c.name === 'QA Mina')) {
            const r = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'QA Mina', description: 'CARD_DESCRIPTION_CANARY', first_mes: 'Synthetic greeting.' }) });
            if (!r.ok) throw new Error('synthetic character create');
            await st.getCharacters();
        }
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'QA Mina'));
        await st.doNewChat({ deleteCurrentChat: false });
        const chat = SillyTavern.getContext().chat;
        chat.length = 0;
        for (let i = 0; i < 20; i++) chat.push({ name: i % 2 ? 'QA Mina' : 'QA User', is_user: i % 2 === 0, mes: `Synthetic line ${i + 1} about the journey.`, send_date: new Date(Date.UTC(2026, 9, 17, 9, i)).toISOString(), swipe_id: 0, swipes: [`Synthetic line ${i + 1} about the journey.`], extra: {} });
        await SillyTavern.getContext().saveChat();
        await st.reloadCurrentChat();
        if (st.main_api !== 'openai') $('#main_api').val('openai').trigger('change');
        const { oai_settings } = await import('/scripts/openai.js');
        Object.assign(oai_settings, { chat_completion_source: 'custom', custom_url: providerUrl, custom_model: 'fake-summary', reverse_proxy: '', custom_include_body: 'tools: [RP_TOOL_POISON]' });
        return String(SillyTavern.getContext().chatId);
    }, providerUrl);
    await page.locator('#mmc-launcher-v1').click();
    await root.locator('.mmc-shell').waitFor({ state: 'visible' });
    await idle();
    await root.locator('.mmc-tab[data-tab="episode"]').click();
    await idle();

    const A = await makeScene(1, 5, sceneJson('Lantern night', 'QA User lit the lantern; QA Mina found the map.', 'lantern', 'ALPHA-FACT the map is torn.'));
    const B = await makeScene(6, 10, sceneJson('River crossing', 'They crossed the river on a raft.', 'raft', 'BRAVO-FACT the raft is broken.'));
    const D = await makeScene(11, 20, sceneJson('Harbor arrival', 'They reached the harbor at dawn.', 'harbor', 'DELTA-FACT the ship leaves at noon.'));
    check('three range scenes #1~#5, #6~#10, #11~#20 created through the scene tab');

    await select(A); await select(B);
    await shot('merge-select-desktop');
    await merge(user => { assert.match(user, /^PARTS \(oldest first\):\n\nPART 1\nTitle: Lantern night/); return mergeJson('Road to the river', 'QA User lit the lantern and QA Mina found the map; then they crossed the river on a raft.', 'river road', 'CHARLIE-FACT the map leads east.'); }, 'merge-review-desktop');
    let d = await data();
    const C = d.episodes.find(e => e.chronicle?.mode === 'chapter').id;
    assert.equal(await stateOf(C), 'approved');
    assert.deepEqual(d.episodes.filter(e => [A, B].includes(e.id)).map(e => e.chronicle.archivedBy), [C, C]);
    let hit = await scan('lantern raft river road harbor');
    assert.ok(hit.includes('CHARLIE-FACT') && hit.includes('DELTA-FACT'));
    assert.ok(!hit.includes('ALPHA-FACT') && !hit.includes('BRAVO-FACT'), 'archived originals are not injected even by their keywords');
    check('#1~#5 + #6~#10 -> #1~#10: chapter injected, originals archived and not injected by keyword');

    await select(C); await select(D);
    await merge(() => mergeJson('Journey to the harbor', 'They followed the map east, crossed the river and reached the harbor at dawn.', 'journey', 'ECHO-FACT the ship leaves at noon.'));
    d = await data();
    const E = d.episodes.find(e => e.chronicle?.mode === 'chapter' && e.chronicle.level === 2).id;
    assert.match(await card(E).innerText(), /#1~#20/);
    assert.match(await card(E).innerText(), /장 2단계/);
    hit = await scan('lantern raft river road harbor journey');
    assert.ok(hit.includes('ECHO-FACT'));
    for (const f of ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA']) assert.ok(!hit.includes(`${f}-FACT`), `${f} must not be injected while #1~#20 is active`);
    await expand(E); await expand(C);
    await shot('tree-expanded-desktop');
    assert.equal(await stateOf(C), 'archived');
    assert.equal(await stateOf(A), 'archived');
    check('#1~#10 + #11~#20 -> #1~#20 (level 2): only the root is injected; tree expands archived originals two levels');

    // Edit an archived leaf: every ancestor needs refresh and nothing in the range is injected.
    await root.locator(`[data-episode-id="${A}"] [data-action="edit-episode"]`).first().click();
    await page.locator('#mmc-ep-summary').fill('QA User lit the lantern; QA Mina found a torn map.');
    await act('save-episode').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.revision === 2, A);
    await idle();
    await root.locator('.mmc-tab[data-tab="overview"]').click(); await root.locator('.mmc-tab[data-tab="episode"]').click(); await idle();
    await expand(E); await expand(C);
    assert.equal(await stateOf(E), 'stale');
    assert.equal(await root.locator(`[data-episode-id="${C}"] [data-chr-own]`).first().getAttribute('data-chr-own'), 'stale');
    assert.match(await card(C).innerText(), /갱신 필요/);
    assert.match(await card(E).innerText(), /갱신 필요 · 주입 보류/);
    hit = await scan('lantern raft river road harbor journey');
    for (const f of ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO']) assert.ok(!hit.includes(`${f}-FACT`), `${f} withheld after child edit`);
    await shot('tree-stale-desktop');
    check('editing an archived leaf marks #1~#10 and #1~#20 as needing refresh; nothing re-enters injection');

    // B and D were written with A as earlier context: they need a re-check, not a silent pass.
    await expand(E); await expand(C);
    assert.match(await card(B).innerText(), /참고한 기록 변경/);
    for (const id of [B, D]) {
        await root.locator(`[data-episode-id="${id}"] [data-action="chronicle-reconfirm"]`).first().click();
        await page.waitForFunction(([x, a]) => { const c = SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === x)?.chronicle; return c?.status === 'approved' && (c.contextRefs || []).every(r => r.id !== a || r.revision === 2); }, [id, A]);
        await idle();
    }
    // Regenerate bottom-up: C from its current children, then E.
    replies.push(() => mergeJson('Road to the river', 'QA User lit the lantern, QA Mina found a torn map, and they crossed the river.', 'river road', 'CHARLIE-FACT the torn map leads east.'));
    await root.locator(`[data-episode-id="${C}"] [data-action="chronicle-regenerate"]`).first().click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.revision === 2, C);
    await idle();
    replies.push(() => mergeJson('Journey to the harbor', 'They followed the torn map east, crossed the river and reached the harbor at dawn.', 'journey', 'ECHO-FACT the ship leaves at noon.'));
    await root.locator(`[data-episode-id="${E}"] [data-action="chronicle-regenerate"]`).first().click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    await act('chronicle-approve').click();
    await page.waitForFunction(id => SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes.find(e => e.id === id)?.chronicle.revision === 2, E);
    await idle();
    assert.equal(await stateOf(E), 'approved');
    assert.ok((await scan('journey')).includes('ECHO-FACT'));
    check('merged chapters regenerate from their current children bottom-up and become active again');

    // Undo the inner chapter while the outer one is active: ancestor-first confirm, both undone.
    await expand(E);
    await root.locator(`[data-episode-id="${C}"] [data-action="chronicle-undo-merge"]`).first().click();
    await page.waitForFunction(([c, e]) => { const eps = SillyTavern.getContext().chatMetadata.memoryCabinetV1.episodes; return eps.find(x => x.id === c).chronicle.status === 'undone' && eps.find(x => x.id === e).chronicle.status === 'undone'; }, [C, E]);
    await idle();
    for (const id of [A, B, D]) assert.equal(await stateOf(id), 'approved');
    hit = await scan('lantern raft river road harbor journey');
    assert.ok(hit.includes('ALPHA-FACT') && hit.includes('BRAVO-FACT') && hit.includes('DELTA-FACT'));
    assert.ok(!hit.includes('CHARLIE-FACT') && !hit.includes('ECHO-FACT'));
    await shot('tree-after-undo-desktop');
    check('undo of #1~#10 under #1~#20 undoes the ancestor first (no model call); originals return, history kept');

    // List view.
    await act('chronicle-view', '[data-view="list"]').click(); await idle();
    assert.equal(await root.locator('.mmc-chr-tr:not(.is-head)').count(), 5);
    await shot('list-desktop');
    await act('chronicle-view', '[data-view="tree"]').click(); await idle();

    // Auto-merge with review ON: creates a candidate only.
    await act('chronicle-settings').click();
    await page.locator('#mmc-chr-set-auto').check();
    await page.locator('#mmc-chr-set-count').fill('3');
    replies.push(() => mergeJson('Auto chapter', 'Auto merged recap.', 'auto', 'FOXTROT-FACT auto.'));
    await act('chronicle-save-settings').click();
    await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata.memoryCabinetV1.chronicle.reviews || []).some(r => r.kind === 'merge' && r.auto));
    await idle();
    for (const id of [A, B, D]) assert.equal(await stateOf(id), 'approved', 'review ON keeps originals active');
    check('auto-merge (count 3, review ON) produced one pending candidate and changed nothing else');

    // Mobile.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert.ok(await root.locator('.mmc-shell').evaluate(n => n.scrollWidth <= innerWidth + 1));
    await shot('tree-mobile');
    await act('chronicle-view', '[data-view="list"]').click(); await idle();
    assert.ok(await root.locator('.mmc-body').evaluate(n => n.scrollWidth <= n.clientWidth + 1));
    await shot('list-mobile');
    await act('chronicle-open-review').click();
    await root.locator('.mmc-chronicle-review').waitFor(); await idle();
    assert.ok(await root.locator('.mmc-chronicle-review').evaluate(n => n.scrollWidth <= innerWidth + 1));
    await shot('merge-review-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
    check('390px: tree, list and merge review fit the viewport');

    for (const capture of captures) {
        assert.deepEqual(capture.body.messages.map(m => m.role), ['system', 'user']);
        assert.equal(capture.body.tools, undefined);
    }
    const merges = captures.filter(c => c.body.messages[1].content.startsWith('PARTS'));
    assert.equal(merges.length, 5);
    const all = JSON.stringify(captures);
    assert.doesNotMatch(all, /POISON|CANARY|MEMORY_CABINET|memoryCabinet|기억 ?보관함|Memory Vault|§|st-message:/);
    assert.doesNotMatch(JSON.stringify(merges), /#\d+~#\d+|"ep_|chr_/, 'merge prompts carry no range labels or internal ids');
    assert.ok(!all.includes(chatFile));
    assert.deepEqual(errors, []);
    await mkdir(shots, { recursive: true });
    await writeFile(`${shots}/merge-evidence.json`, JSON.stringify({ chatFile, requests: captures.length, merges: merges.length, captures, blocked, errors, realModelCalls: 0 }, null, 2));
    check(`request audit: ${captures.length} fake-provider requests (${merges.length} merges), system+user only, no internal labels/ids/file name; blocked=${blocked.length}`);
} catch (error) {
    await page.screenshot({ path: `${shots}/merge-failure.png` }).catch(() => {});
    throw error;
} finally {
    await browser.close();
    await new Promise(resolve => provider.close(resolve));
}
