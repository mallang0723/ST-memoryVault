// Request-scoped summary transport for the scene chronicle.
// It never enters SillyTavern's RP prompt builder, never changes global
// connection/preset settings and never reads API keys or proxy passwords:
// credentials are resolved by the authenticated ST backend.

export const CURRENT_CONNECTION = 'current';
const PROFILE_PREFIX = 'profile:';
const ENDPOINT = '/api/backends/chat-completions/generate';
const TEMPERATURE = 0.2;
export const MAX_INPUT_CHARS = 200000;
export const MAX_OUTPUT_TOKENS = 8192;

// Non-secret routing fields some sources need besides source/model.
const ROUTING_FIELDS = {
    custom: ['custom_url'],
    azure_openai: ['azure_base_url', 'azure_deployment_name', 'azure_api_version'],
    vertexai: ['vertexai_auth_mode', 'vertexai_region', 'vertexai_express_project_id'],
    zai: ['zai_endpoint'],
    pollinations: ['pollinations_endpoint'],
    siliconflow: ['siliconflow_endpoint'],
    minimax: ['minimax_endpoint'],
    workers_ai: ['workers_ai_account_id'],
};
// Sources where ST would attach a reverse proxy (and its password) from global settings.
const PROXY_SOURCES = ['claude', 'openai', 'mistralai', 'makersuite', 'vertexai', 'deepseek', 'xai', 'zai', 'moonshot'];

function connectionManagerProfiles(ctx) {
    if (ctx.extensionSettings?.disabledExtensions?.includes('connection-manager')) return [];
    const rows = ctx.extensionSettings?.connectionManager?.profiles;
    return Array.isArray(rows) ? rows.filter(p => p && typeof p.id === 'string' && p.id) : [];
}

function describeCurrent(ctx) {
    const settings = ctx.chatCompletionSettings || {};
    const source = String(settings.chat_completion_source || '');
    let model = '';
    try { model = String(ctx.getChatCompletionModel?.() || ''); } catch { model = ''; }
    const row = { id: CURRENT_CONNECTION, label: '현재 연결 (요약 전용 격리 요청)', source, model, supported: true, reason: '' };
    if (ctx.mainApi !== 'openai') return { ...row, source: '', model: '', supported: false, reason: '현재 API가 Chat Completion이 아닙니다. 요약용 연결 프로필을 선택해 주세요.' };
    if (!source) return { ...row, supported: false, reason: 'Chat Completion 제공자를 확인할 수 없습니다.' };
    if (settings.reverse_proxy && PROXY_SOURCES.includes(source)) return { ...row, supported: false, reason: '현재 연결이 리버스 프록시를 사용합니다. 프록시가 저장된 연결 프로필을 선택해 주세요.' };
    if (!model) return { ...row, supported: false, reason: '현재 연결의 모델을 확인할 수 없습니다.' };
    if (source === 'custom' && !/^https?:\/\//i.test(String(settings.custom_url || ''))) return { ...row, supported: false, reason: '사용자 지정 연결의 주소를 확인해 주세요.' };
    return row;
}

/** Lists selectable summary connections without exposing secrets or URLs. */
export function listSummaryConnections(ctx) {
    const rows = [describeCurrent(ctx)];
    for (const profile of connectionManagerProfiles(ctx)) {
        const chat = profile.mode === 'cc';
        rows.push({
            id: PROFILE_PREFIX + profile.id, label: `연결 프로필 · ${String(profile.name || profile.id)}`,
            source: String(profile.api || ''), model: String(profile.model || ''),
            supported: chat && !!profile.api, reason: chat ? (profile.api ? '' : '프로필에 API가 없습니다.') : 'Text Completion 프로필은 아직 지원하지 않습니다.',
        });
    }
    return rows;
}

export function validateSummaryMessages(messages, maxTokens) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 1000
        || messages.some(m => !m || typeof m !== 'object' || !['system', 'user', 'assistant'].includes(m.role)
            || typeof m.content !== 'string' || !m.content.trim() || Object.keys(m).some(k => k !== 'role' && k !== 'content'))
        || JSON.stringify(messages).length > MAX_INPUT_CHARS || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_OUTPUT_TOKENS) {
        throw new Error('요약 요청 입력 또는 출력 한도가 유효하지 않습니다. 구간을 나누어 주세요.');
    }
}

/** Builds the exact request body for the "current connection" mode. */
export function buildCurrentPayload(ctx, messages, maxTokens) {
    const row = describeCurrent(ctx);
    if (!row.supported) throw new Error(`${row.reason} RP 호출로 대체하지 않습니다.`);
    const settings = ctx.chatCompletionSettings;
    const payload = {
        chat_completion_source: row.source, model: row.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: maxTokens, temperature: TEMPERATURE, stream: false, use_sysprompt: true,
    };
    for (const key of ROUTING_FIELDS[row.source] || []) {
        if (settings[key] !== undefined && settings[key] !== '') payload[key] = String(settings[key]);
    }
    return payload;
}

function readResponse(ctx, data) {
    if (!data || typeof data !== 'object' || data.error) throw new Error('요약 요청이 실패했습니다. 자동 재시도하지 않습니다.');
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const finish = String(choice?.finish_reason || data.stop_reason || data.candidates?.[0]?.finishReason || '').toLowerCase();
    if (['length', 'max_tokens', 'max_output_tokens'].includes(finish)) throw new Error('요약 응답이 출력 한도에서 잘렸습니다. 출력 한도를 늘리거나 구간을 줄여 주세요. 자동 재시도하지 않습니다.');
    let content = '';
    try { content = ctx.extractMessageFromData ? ctx.extractMessageFromData(data, 'openai') : ''; } catch { content = ''; }
    if (typeof content !== 'string' || !content.trim()) content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!content.trim()) throw new Error('요약 응답이 비었습니다. 자동 재시도하지 않습니다.');
    const usage = data.usage && typeof data.usage === 'object' ? {
        input: Number(data.usage.prompt_tokens ?? data.usage.input_tokens) || 0,
        output: Number(data.usage.completion_tokens ?? data.usage.output_tokens) || 0,
        measured: true,
    } : null;
    return { content, usage };
}

/**
 * Sends one isolated summary request. connectionId is CURRENT_CONNECTION or
 * `profile:<id>`. Returns { content, usage, connection } without secrets.
 */
export async function generateIsolated({ ctx, connectionId, messages, maxTokens, fetchImpl, signal }) {
    validateSummaryMessages(messages, maxTokens);
    const clean = messages.map(m => ({ role: m.role, content: m.content }));
    if (connectionId === CURRENT_CONNECTION) {
        const payload = buildCurrentPayload(ctx, clean, maxTokens);
        const response = await fetchImpl(ENDPOINT, {
            method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify(payload), cache: 'no-store', ...(signal ? { signal } : {}),
        });
        if (!response.ok) throw new Error(`요약 요청 실패 (${response.status}). 자동 재시도하지 않습니다.`);
        return { ...readResponse(ctx, await response.json()), connection: { id: CURRENT_CONNECTION, source: payload.chat_completion_source, model: payload.model } };
    }
    if (typeof connectionId === 'string' && connectionId.startsWith(PROFILE_PREFIX)) {
        const id = connectionId.slice(PROFILE_PREFIX.length);
        const profile = connectionManagerProfiles(ctx).find(p => p.id === id);
        if (!profile) throw new Error('선택한 연결 프로필을 찾을 수 없습니다. RP 호출로 대체하지 않습니다.');
        if (profile.mode !== 'cc' || !profile.api) throw new Error('Chat Completion 연결 프로필만 지원합니다. RP 호출로 대체하지 않습니다.');
        const service = ctx.ConnectionManagerRequestService;
        if (!service?.sendRequest) throw new Error('이 SillyTavern에는 연결 프로필 요청 기능이 없습니다.');
        // includePreset:false keeps the profile's RP preset (prompts, samplers) out of the request.
        const data = await service.sendRequest(id, clean, maxTokens, {
            stream: false, extractData: false, includePreset: false, includeInstruct: false, signal: signal || null,
        }, { temperature: TEMPERATURE });
        return { ...readResponse(ctx, data), connection: { id: connectionId, source: String(profile.api), model: String(profile.model || '') } };
    }
    throw new Error('요약용 연결을 선택해 주세요. RP 호출로 대체하지 않습니다.');
}
