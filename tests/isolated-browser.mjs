// Isolated summary transport against a real SillyTavern 1.19 backend.
// Use only a disposable QA data root. The model provider below is a local fake;
// any other generation/embedding request is aborted.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ST_BASE_URL || 'http://127.0.0.1:8019';
const captures = [];
const provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    // Authentication headers are never recorded.
    captures.push({ path: req.url, body: JSON.parse(text || '{}'), rpCanaryHeader: Object.hasOwn(req.headers, 'x-rp-canary') });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '{"title":"key"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 9 } }));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const blocked = [], errors = [], forwarded = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.route('**/*', route => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.origin !== new URL(base).origin) { blocked.push(u.origin); return route.abort(); }
    if (/generate|embeddings|tokenize|status/.test(u.pathname) && u.pathname.startsWith('/api/backends/') ) {
        if (u.pathname !== '/api/backends/chat-completions/generate') { blocked.push(u.pathname); return route.abort(); }
        const body = JSON.parse(request.postData() || '{}');
        // Only forward requests whose final destination is the local fake.
        if (body.chat_completion_source !== 'custom' || (body.custom_url && body.custom_url !== providerUrl)) { blocked.push(`${u.pathname}:${body.chat_completion_source}`); return route.abort(); }
        forwarded.push(body);
    }
    return route.continue();
});
try {
    await page.goto(base);
    await page.waitForFunction(() => window.SillyTavern?.getContext && document.getElementById('mmc-launcher-v1'), null, { timeout: 60000 });
    const onboarding = page.locator('dialog[open]').filter({ hasText: 'Welcome to SillyTavern!' });
    await page.waitForTimeout(1500);
    if (await onboarding.count()) { await onboarding.locator('textarea').fill('QA User'); await onboarding.getByText('Save', { exact: true }).click(); }
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        if (!ctx.characters.some(c => c.name === 'QA Mina')) {
            const r = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ ch_name: 'QA Mina', description: 'CARD_DESCRIPTION_CANARY', scenario: 'SCENARIO_CANARY', mes_example: '<START>\nEXAMPLE_CANARY', first_mes: 'Synthetic greeting.' }) });
            if (!r.ok) throw new Error('synthetic character create');
            await (await import('/script.js')).getCharacters();
        }
        const id = ctx.characters.findIndex(c => c.name === 'QA Mina');
        await ctx.selectCharacterById(id);
        await (await import('/script.js')).doNewChat({ deleteCurrentChat: false });
    });
    await page.waitForFunction(() => SillyTavern.getContext().chat.length >= 1);
    const result = await page.evaluate(async providerUrl => {
        const ctx = SillyTavern.getContext();
        const { createHost } = await import('/scripts/extensions/third-party/memoryVaultSilly/host.js');
        const { stMessageRow, sliceHash } = await import('/scripts/extensions/third-party/memoryVaultSilly/chronicle.js');
        const st = await import('/script.js');
        const { oai_settings } = await import('/scripts/openai.js');
        const { extension_settings } = await import('/scripts/extensions.js');
        ctx.chat.push({ is_user: true, name: 'QA User', mes: 'Mina, I found the library key.', send_date: '2026-10-17T00:00:00Z', swipe_id: 0 },
            { is_user: false, name: 'QA Mina', mes: 'Mina takes the key and hides it.', send_date: '2026-10-17T00:01:00Z', swipe_id: 0 });
        await ctx.saveChat();
        // Point the active connection at the fake and poison every RP-only setting.
        if (st.main_api !== 'openai') { $('#main_api').val('openai').trigger('change'); }
        const saved = structuredClone(oai_settings);
        Object.assign(oai_settings, {
            chat_completion_source: 'custom', custom_url: providerUrl, custom_model: 'fake-summary', temp_openai: 1.7,
            custom_include_body: 'tools: [{type: function, function: {name: RP_TOOL_POISON}}]', custom_exclude_body: 'messages',
            custom_include_headers: 'X-RP-Canary: RP_HEADER_POISON', assistant_prefill: 'RP_PREFILL_POISON', reverse_proxy: '',
        });
        extension_settings.connectionManager ||= { profiles: [] };
        extension_settings.connectionManager.profiles = (extension_settings.connectionManager.profiles || []).filter(p => p.id !== 'qa-summary');
        extension_settings.connectionManager.profiles.push({ id: 'qa-summary', name: 'QA summary', mode: 'cc', api: 'custom', model: 'profile-model', 'api-url': providerUrl, preset: 'Default' });
        const beforeSettings = JSON.stringify(oai_settings);
        let hooks = 0;
        const poison = event => { hooks++; (event.chat || []).push({ role: 'system', content: 'RP_HOOK_POISON' }); };
        ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_PROMPT_READY, poison);
        const host = createHost({ getContext: () => SillyTavern.getContext(), isGenerating: st.isGenerating });
        const rows = SillyTavern.getContext().chat.map(stMessageRow);
        const end = rows.length - 1;
        const messages = [{ role: 'system', content: 'Record supplied events only. Do not continue the dialogue.' },
            { role: 'user', content: '[1] QA User: Mina, I found the library key.\n[2] QA Mina: Mina takes the key and hides it.' }];
        const body = { messages, parameters: { maxTokens: 400 }, guard: { startIndex: end - 1, endIndex: end, rangeHash: sliceHash(rows, end - 1, end) } };
        const original = JSON.stringify({ chat: ctx.chat, metadata: ctx.chatMetadata });
        try {
            host.start();
            const connections = await host.api('chronicle/connections');
            const current = await host.api('generate/isolated', { method: 'POST', body: { ...body, connectionId: 'current' } });
            const profile = await host.api('generate/isolated', { method: 'POST', body: { ...body, connectionId: 'profile:qa-summary' } });
            return { connections, current, profile, hooks, messages, settingsUnchanged: beforeSettings === JSON.stringify(oai_settings),
                chatUnchanged: original === JSON.stringify({ chat: ctx.chat, metadata: ctx.chatMetadata }) };
        } finally {
            ctx.eventSource.removeListener(ctx.eventTypes.CHAT_COMPLETION_PROMPT_READY, poison);
            Object.assign(oai_settings, saved);
            host.dispose();
        }
    }, providerUrl);
    assert.equal(captures.length, 2, JSON.stringify(captures));
    for (const capture of captures) {
        assert.equal(capture.path, '/v1/chat/completions');
        assert.deepEqual(capture.body.messages, result.messages);
        assert.equal(capture.body.max_tokens, 400);
        assert.equal(capture.body.temperature, 0.2);
        assert.equal(capture.rpCanaryHeader, false);
        assert.equal(capture.body.tools, undefined);
        assert.equal(capture.body.tool_choice, undefined);
    }
    assert.equal(captures[0].body.model, 'fake-summary');
    assert.equal(captures[1].body.model, 'profile-model');
    assert.doesNotMatch(JSON.stringify(captures), /POISON|CANARY|QA summary|Default/);
    assert.equal(result.hooks, 0);
    assert.equal(result.settingsUnchanged, true);
    assert.equal(result.chatUnchanged, true);
    assert.equal(result.current.content, '{"title":"key"}');
    assert.equal(result.current.sourceChanged, false);
    assert.equal(result.profile.connection.id, 'profile:qa-summary');
    assert.doesNotMatch(JSON.stringify(result.connections), /127\.0\.0\.1/);
    assert.deepEqual(errors, []);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/isolated-generation.json', JSON.stringify({ result, forwarded, captures, errors, blocked, realModelCalls: 0 }, null, 2));
    console.log('PASS real ST backend -> local fake provider: current connection and saved profile send only allowlisted messages; no RP preset/card/hooks/tools/headers; settings and chat unchanged; zero real model calls');
} finally {
    await browser.close();
    await new Promise(resolve => provider.close(resolve));
}
