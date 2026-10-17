import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../host.js';
import { listSummaryConnections, buildCurrentPayload } from '../isolated-generation.js';
import { sliceHash, stMessageRow } from '../chronicle.js';

const messages = [{ role: 'system', content: 'Record only supplied events.' }, { role: 'user', content: '[1] Mina: I found the library key.' }];
const ok = content => Response.json({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 22, completion_tokens: 8 } });

function fixture() {
    const requests = [];
    const profileCalls = [];
    let generating = false;
    const ctx = {
        chatId: 'synthetic', characterId: 0, characters: [{ avatar: 'Mina.png', name: 'Mina' }], chatMetadata: { integrity: 'fixture' },
        chat: [{ is_user: true, name: 'User', mes: 'I found the library key.', swipe_id: 0, send_date: '2026-10-17T00:00:00Z' },
            { is_user: false, name: 'Mina', mes: 'Mina takes the key.', swipe_id: 0, send_date: '2026-10-17T00:01:00Z' }],
        onlineStatus: 'connected', mainApi: 'openai',
        chatCompletionSettings: {
            chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:9999/v1', temp_openai: 1.3,
            custom_include_body: 'tools: [RP_TOOL_POISON]', custom_include_headers: 'X-RP: RP_HEADER_POISON', custom_exclude_body: 'messages',
            assistant_prefill: 'RP_PREFILL_POISON', reverse_proxy: '', proxy_password: 'PROXY_SECRET', openai_max_tokens: 4000,
        },
        getChatCompletionModel: () => 'fixture-model',
        extensionSettings: { disabledExtensions: [], connectionManager: { profiles: [
            { id: 'p1', name: 'Summary profile', mode: 'cc', api: 'custom', model: 'profile-model', 'api-url': 'http://user:pw@127.0.0.1:9/v1', preset: 'RP preset', 'secret-id': 'SECRET_ID_VALUE' },
            { id: 'p2', name: 'Text profile', mode: 'tc', api: 'koboldcpp', model: 'x' },
        ] } },
        ConnectionManagerRequestService: { async sendRequest(...args) { profileCalls.push(structuredClone(args)); return reply(); } },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        generateRaw() { throw Error('RP path must not run'); },
    };
    let reply = async () => ({ choices: [{ message: { content: '{"title":"key"}' }, finish_reason: 'stop' }] });
    let httpReply = async () => ok('{"title":"key"}');
    const host = createHost({ getContext: () => ctx, isGenerating: () => generating,
        fetchImpl: async (path, options) => { requests.push({ path, body: JSON.parse(options.body), headers: options.headers }); return httpReply(); } });
    const rows = ctx.chat.map(stMessageRow);
    const options = { method: 'POST', body: { connectionId: 'current', messages: structuredClone(messages), parameters: { maxTokens: 400 }, guard: { startIndex: 0, endIndex: 1, rangeHash: sliceHash(rows, 0, 1) } } };
    return { ctx, requests, profileCalls, host, options,
        setHttp(fn) { httpReply = fn; }, setProfile(fn) { reply = fn; }, setGenerating(v) { generating = v; } };
}

test('current-connection summary sends only the allowlisted body and leaves settings untouched', async () => {
    const f = fixture();
    const before = structuredClone({ settings: f.ctx.chatCompletionSettings, chat: f.ctx.chat, meta: f.ctx.chatMetadata });
    const result = await f.host.api('generate/isolated', f.options);
    assert.equal(result.content, '{"title":"key"}');
    assert.deepEqual(result.usage, { input: 22, output: 8, measured: true });
    assert.equal(result.sourceChanged, false);
    assert.deepEqual(result.connection, { id: 'current', source: 'custom', model: 'fixture-model' });
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].path, '/api/backends/chat-completions/generate');
    assert.deepEqual(f.requests[0].body, {
        chat_completion_source: 'custom', model: 'fixture-model', messages, max_tokens: 400,
        temperature: 0.2, stream: false, use_sysprompt: true, custom_url: 'http://127.0.0.1:9999/v1',
    });
    assert.doesNotMatch(JSON.stringify(f.requests), /POISON|PROXY_SECRET|tools|custom_include|custom_exclude|assistant_prefill|char_name|user_name/);
    assert.deepEqual({ settings: f.ctx.chatCompletionSettings, chat: f.ctx.chat, meta: f.ctx.chatMetadata }, before);
});

test('saved connection profile goes through the official request service without its preset', async () => {
    const f = fixture();
    f.options.body.connectionId = 'profile:p1';
    const result = await f.host.api('generate/isolated', f.options);
    assert.equal(f.requests.length, 0);
    assert.equal(f.profileCalls.length, 1);
    const [id, sent, max, custom, override] = f.profileCalls[0];
    assert.equal(id, 'p1');
    assert.deepEqual(sent, messages);
    assert.equal(max, 400);
    assert.equal(custom.includePreset, false);
    assert.equal(custom.includeInstruct, false);
    assert.equal(custom.stream, false);
    assert.equal(custom.extractData, false);
    assert.deepEqual(override, { temperature: 0.2 });
    assert.deepEqual(result.connection, { id: 'profile:p1', source: 'custom', model: 'profile-model' });
});

test('connection list exposes labels and models only, never URLs or secret references', () => {
    const f = fixture();
    const rows = listSummaryConnections(f.ctx);
    assert.deepEqual(rows.map(r => [r.id, r.supported]), [['current', true], ['profile:p1', true], ['profile:p2', false]]);
    assert.doesNotMatch(JSON.stringify(rows), /127\.0\.0\.1|SECRET_ID_VALUE|pw@|RP preset/);
});

test('unsupported or unsafe connections and invalid input are refused before any network request', async () => {
    for (const mutate of [
        f => { f.ctx.mainApi = 'textgenerationwebui'; },
        f => { f.ctx.chatCompletionSettings.chat_completion_source = 'claude'; f.ctx.chatCompletionSettings.reverse_proxy = 'https://proxy.invalid'; },
        f => { f.ctx.getChatCompletionModel = () => ''; },
        f => { f.ctx.chatCompletionSettings.custom_url = 'file:///etc/passwd'; },
        f => { f.options.body.connectionId = 'sillytavern-current'; },
        f => { f.options.body.connectionId = 'profile:p2'; },
        f => { f.options.body.connectionId = 'profile:missing'; },
        f => { f.ctx.extensionSettings.disabledExtensions = ['connection-manager']; f.options.body.connectionId = 'profile:p1'; },
        f => { f.options.body.messages = []; },
        f => { f.options.body.messages[0] = { role: 'tool', content: 'x' }; },
        f => { f.options.body.messages[0] = { role: 'user', content: [{ type: 'image_url' }] }; },
        f => { f.options.body.messages[0] = { role: 'user', content: 'x', name: 'RP' }; },
        f => { f.options.body.messages = [{ role: 'user', content: 'x'.repeat(200001) }]; },
        f => { f.options.body.parameters.maxTokens = 0; },
        f => { f.options.body.parameters.maxTokens = 1.5; },
        f => { f.ctx.chat[1].mes = 'edited before dispatch'; },
        f => { f.setGenerating(true); },
        f => { f.ctx.streamingProcessor = { isFinished: false }; },
    ]) {
        const f = fixture();
        mutate(f);
        await assert.rejects(f.host.api('generate/isolated', f.options));
        assert.equal(f.requests.length + f.profileCalls.length, 0);
    }
});

test('other sources carry only their non-secret routing fields', () => {
    const f = fixture();
    Object.assign(f.ctx.chatCompletionSettings, { chat_completion_source: 'azure_openai', azure_base_url: 'https://a.invalid', azure_deployment_name: 'dep', azure_api_version: 'v1' });
    const body = buildCurrentPayload(f.ctx, messages, 300);
    assert.deepEqual(Object.keys(body).sort(), ['azure_api_version', 'azure_base_url', 'azure_deployment_name', 'chat_completion_source', 'max_tokens', 'messages', 'model', 'stream', 'temperature', 'use_sysprompt']);
    f.ctx.chatCompletionSettings.chat_completion_source = 'openrouter';
    assert.equal(buildCurrentPayload(f.ctx, messages, 300).custom_url, undefined);
});

test('source edits, swipes or group scope changes during the call keep the paid result but mark it changed', async () => {
    for (const mutate of [
        f => { f.ctx.chat[0].mes = 'edited'; },
        f => { f.ctx.chat[1].swipe_id = 1; },
        f => { f.ctx.groups[0].members.pop(); },
    ]) {
        const f = fixture();
        f.ctx.groupId = 'g';
        f.ctx.characters.push({ avatar: 'Bob.png', name: 'Bob' });
        f.ctx.groups = [{ id: 'g', members: ['Mina.png', 'Bob.png'], generation_mode: 0 }];
        let resolve;
        f.setHttp(() => new Promise(r => { resolve = r; }));
        const pending = f.host.api('generate/isolated', f.options);
        await new Promise(setImmediate);
        mutate(f);
        resolve(ok('late'));
        const result = await pending;
        assert.equal(result.sourceChanged, true);
        assert.equal(f.requests.length, 1);
    }
});

test('appending a new message after the range does not invalidate the result', async () => {
    const f = fixture();
    let resolve;
    f.setHttp(() => new Promise(r => { resolve = r; }));
    const pending = f.host.api('generate/isolated', f.options);
    await new Promise(setImmediate);
    f.ctx.chat.push({ is_user: true, name: 'User', mes: 'next turn', send_date: 'later' });
    resolve(ok('fine'));
    assert.equal((await pending).sourceChanged, false);
});

test('chat switch or dispose discards a late result; failures never retry', async () => {
    for (const mutate of [f => { f.ctx.chatMetadata.integrity = 'other'; }, f => f.host.dispose()]) {
        const f = fixture();
        let resolve;
        f.setHttp(() => new Promise(r => { resolve = r; }));
        const pending = f.host.api('generate/isolated', f.options);
        await new Promise(setImmediate);
        mutate(f);
        resolve(ok('late'));
        await assert.rejects(pending);
    }
    for (const reply of [
        () => new Response('unavailable', { status: 503 }),
        () => Response.json({ error: { message: 'provider failed' } }),
        () => Response.json({ choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] }),
        () => Response.json({ content: [{ type: 'text', text: 'cut' }], stop_reason: 'max_tokens' }),
        () => Response.json({ choices: [{ message: { content: ' ' }, finish_reason: 'stop' }] }),
        () => { throw Error('network failure'); },
    ]) {
        const f = fixture();
        f.setHttp(reply);
        await assert.rejects(f.host.api('generate/isolated', f.options));
        assert.equal(f.requests.length, 1);
    }
});

test('timeout keeps both model paths locked until the original request settles', async () => {
    const f = fixture();
    let resolve;
    f.setHttp(() => new Promise(r => { resolve = r; }));
    await assert.rejects(f.host.api('generate/isolated', { ...f.options, timeoutMs: 5 }), /초과/);
    await assert.rejects(f.host.api('generate/isolated', f.options), /아직 진행/);
    await assert.rejects(f.host.api('generate/raw', { method: 'POST', body: { connectionId: 'sillytavern-current', messages } }), /아직 진행/);
    assert.equal(f.requests.length, 1);
    resolve(ok('late'));
    await new Promise(setImmediate);
    f.setHttp(() => ok('fresh'));
    assert.equal((await f.host.api('generate/isolated', f.options)).content, 'fresh');
});

test('dispose before dispatch prevents the network call', async () => {
    const f = fixture();
    const pending = f.host.api('generate/isolated', f.options);
    f.host.dispose();
    await assert.rejects(pending);
    assert.equal(f.requests.length, 0);
});

test('a saved profile with an explicitly chosen reverse proxy is accepted; the extension passes no proxy fields itself', async () => {
    const f = fixture();
    f.ctx.extensionSettings.connectionManager.profiles.push({ id: 'px', name: 'Proxy profile', mode: 'cc', api: 'openai', model: 'proxy-model', proxy: 'My proxy' });
    f.options.body.connectionId = 'profile:px';
    const rows = listSummaryConnections(f.ctx);
    assert.equal(rows.find(r => r.id === 'profile:px').supported, true);
    assert.doesNotMatch(JSON.stringify(rows), /My proxy/);
    await f.host.api('generate/isolated', f.options);
    const [id, sent, , custom, override] = f.profileCalls[0];
    assert.equal(id, 'px');
    assert.deepEqual(sent, messages);
    assert.equal(custom.includePreset, false);
    assert.deepEqual(override, { temperature: 0.2 }, 'no proxy, password or other fields added by the extension');
    // The current-connection proxy path stays refused.
    const g = fixture();
    Object.assign(g.ctx.chatCompletionSettings, { chat_completion_source: 'openai', reverse_proxy: 'https://proxy.invalid' });
    await assert.rejects(g.host.api('generate/isolated', g.options), /프록시/);
    assert.equal(g.requests.length, 0);
});
