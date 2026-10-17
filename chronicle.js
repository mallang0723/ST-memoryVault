// Scene chronicle: message anchors, range identity and validation.
// Pure functions shared by host.js and extension.js. No DOM, no network.

function mix53(text, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
/** 106-bit non-cryptographic content hash: change detection, not security. */
export function strongHash(value) {
    const text = String(value ?? '');
    return mix53(text, 0x9e3779b1) + mix53(text, 0x85ebca77);
}

/** Message row as exposed by host `chats/:id/messages`. */
export function messageFingerprint(row) {
    return strongHash([String(row?.role || ''), Number(row?.activeSwipeIndex) || 0, String(row?.createdAt || ''), String(row?.name || ''), String(row?.content || '')].join('␟'));
}
export function stMessageRow(message, index) {
    return {
        id: `st-message:${index}`, role: message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant',
        content: String(message?.mes || ''), createdAt: String(message?.send_date || ''), name: message?.name,
        activeSwipeIndex: Number(message?.swipe_id) || 0,
    };
}
export function rangeHashOf(fingerprints) { return strongHash(fingerprints.join('|')); }
/** Hash of the inclusive [start,end] slice of host message rows. */
export function sliceHash(rows, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= rows.length) return '';
    return rangeHashOf(rows.slice(start, end + 1).map(messageFingerprint));
}

// ── Schema (chat_metadata.memoryCabinetV1.chronicle + episode.chronicle) ──
export const SCHEMA_VERSION = 1;
export const SCENE_PROMPT_VERSION = 'scene-delta-v1';
export const MAX_RANGE_MESSAGES = 2000;
export const MAX_REVIEWS = 12;
export const MAX_PREVIOUS_VERSIONS = 3;
export const MAX_CONTEXT_REFS = 12;
export const RANGE_SUMMARY_MAX = 2000;
// Whole chronicle footprint inside chat metadata (range scenes + reviews).
export const MAX_CHRONICLE_BYTES = 2 * 1024 * 1024;
export const SCENE_STATUSES = ['approved', 'stale', 'held', 'deleted'];
export const DEFAULT_SETTINGS = Object.freeze({
    connectionId: 'current', sceneMaxTokens: 1200, reviewBeforeApply: true,
    autoEnabled: false, autoEveryResponses: 10, autoBuffer: 2,
    recentScenes: 3, recentChapters: 1, budgetTokens: 2400, oldDetailTokens: 700, ghostEnabled: false,
    autoMergeEnabled: false, mergeCountThreshold: 5, mergeTokenThreshold: 2000, mergeTriggerMode: 'or',
    mergeReviewBeforeApply: true, maxCallsPerRun: 1,
});

const FP = /^[0-9a-z]{22}$/;
const rec = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v, min, max, fallback) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

/** Range from host message rows, inclusive indices. Throws on invalid input. */
export function buildRange(rows, start, end) {
    if (!Array.isArray(rows) || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= rows.length) throw new Error('구간의 시작과 끝을 다시 선택해 주세요.');
    if (end - start + 1 > MAX_RANGE_MESSAGES) throw new Error(`한 구간은 메시지 ${MAX_RANGE_MESSAGES}개까지입니다. 구간을 나누어 주세요.`);
    const fingerprints = rows.slice(start, end + 1).map(messageFingerprint);
    return { startIndex: start, endIndex: end, count: fingerprints.length, fingerprints, rangeHash: rangeHashOf(fingerprints) };
}

/** Returns a verified range or null; indices are hints, fingerprints are identity. */
export function normalizeRange(raw) {
    if (!rec(raw) || !Array.isArray(raw.fingerprints)) return null;
    const fingerprints = raw.fingerprints.map(String);
    if (!fingerprints.length || fingerprints.length > MAX_RANGE_MESSAGES || fingerprints.some(fp => !FP.test(fp))) return null;
    if (String(raw.rangeHash || '') !== rangeHashOf(fingerprints)) return null;
    const startIndex = int(raw.startIndex, 0, 1e7, 0);
    return { startIndex, endIndex: startIndex + fingerprints.length - 1, count: fingerprints.length, fingerprints, rangeHash: rangeHashOf(fingerprints) };
}

/**
 * Finds a stored range in the current messages.
 * exact: same place; moved: unique match elsewhere (insert/delete before it);
 * ambiguous: several identical matches (held); changed: no contiguous match.
 */
export function locateRange(rows, range) {
    const r = normalizeRange(range);
    if (!r) return { status: 'invalid' };
    const fps = (rows || []).map(messageFingerprint);
    const matchAt = i => i >= 0 && i + r.count <= fps.length && r.fingerprints.every((fp, j) => fps[i + j] === fp);
    const hits = [];
    for (let i = 0; i + r.count <= fps.length; i++) if (fps[i] === r.fingerprints[0] && matchAt(i)) hits.push(i);
    if (!hits.length) return { status: 'changed' };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits.slice(0, 5) };
    const startIndex = hits[0];
    return { status: startIndex === r.startIndex ? 'exact' : 'moved', startIndex, endIndex: startIndex + r.count - 1 };
}

export function rangesOverlap(a, b) { return a.startIndex <= b.endIndex && b.startIndex <= a.endIndex; }

/** Completed assistant responses inside a range; swipes are not new turns. */
export function completedResponses(rows, start, end) {
    let n = 0;
    for (let i = start; i <= end; i++) if (rows[i]?.role === 'assistant' && String(rows[i].content || '').trim()) n++;
    return n;
}

function normalizeUsage(raw) {
    if (!rec(raw)) return null;
    return { input: int(raw.input, 0, 1e9, 0), output: int(raw.output, 0, 1e9, 0), measured: raw.measured === true };
}
export function normalizeGeneration(raw) {
    if (!rec(raw)) return null;
    return {
        requestId: str(raw.requestId, 80), connectionId: str(raw.connectionId, 160), source: str(raw.source, 60), model: str(raw.model, 160),
        promptVersion: str(raw.promptVersion, 40), inputHash: str(raw.inputHash, 40),
        requestedAt: str(raw.requestedAt, 40), completedAt: str(raw.completedAt, 40), usage: normalizeUsage(raw.usage),
    };
}
export function normalizeContextRefs(raw) {
    return (Array.isArray(raw) ? raw : []).filter(rec).slice(0, MAX_CONTEXT_REFS)
        .map(r => ({ kind: r.kind === 'chapter' ? 'chapter' : 'episode', id: str(r.id, 120), revision: int(r.revision, 1, 1e6, 1), hash: str(r.hash, 40) }))
        .filter(r => r.id);
}

/**
 * episode.chronicle for range scenes. Legacy episodes have no field (mode legacy).
 * An unverifiable range is kept but held, never silently repaired.
 */
export function normalizeEpisodeChronicle(raw) {
    if (!rec(raw) || raw.mode !== 'range') return null;
    const range = normalizeRange(raw.range);
    let status = SCENE_STATUSES.includes(raw.status) ? raw.status : 'held';
    let invalidReason = str(raw.invalidReason, 200);
    if (!range) { status = 'held'; invalidReason = invalidReason || 'range-invalid'; }
    return {
        mode: 'range', revision: int(raw.revision, 1, 1e6, 1), status,
        range: range || (rec(raw.range) ? { startIndex: int(raw.range.startIndex, 0, 1e7, 0), count: 0, fingerprints: [], rangeHash: '' } : null),
        contextRefs: normalizeContextRefs(raw.contextRefs), generation: normalizeGeneration(raw.generation),
        injectionPolicy: raw.injectionPolicy === 'archived' ? 'archived' : 'keyword',
        invalidReason, approvedAt: str(raw.approvedAt, 40),
        previous: (Array.isArray(raw.previous) ? raw.previous : []).filter(rec).slice(-MAX_PREVIOUS_VERSIONS).map(p => ({
            revision: int(p.revision, 1, 1e6, 1), savedAt: str(p.savedAt, 40), reason: str(p.reason, 40),
            title: str(p.title, 120), summary: str(p.summary, RANGE_SUMMARY_MAX), keywords: (Array.isArray(p.keywords) ? p.keywords : []).map(k => str(k, 60)).slice(0, 8),
        })),
    };
}

/** Pending scene candidate produced by one isolated call (or a failed/held call). */
export function normalizeReview(raw) {
    if (!rec(raw)) return null;
    const range = normalizeRange(raw.range);
    if (!range) return null;
    const status = ['ready', 'held', 'failed'].includes(raw.status) ? raw.status : 'held';
    return {
        id: str(raw.id, 80) || `chr_${Date.now().toString(36)}`, kind: 'scene', status, reason: str(raw.reason, 300),
        range, replacesEpisodeId: str(raw.replacesEpisodeId, 120), contextRefs: normalizeContextRefs(raw.contextRefs),
        generation: normalizeGeneration(raw.generation), candidate: rec(raw.candidate) ? structuredClone(raw.candidate) : null,
        rawText: str(raw.rawText, 20000), createdAt: str(raw.createdAt, 40),
    };
}

export function normalizeSettings(raw) {
    const r = rec(raw) ? raw : {};
    const d = DEFAULT_SETTINGS;
    return {
        connectionId: typeof r.connectionId === 'string' && r.connectionId ? str(r.connectionId, 160) : d.connectionId,
        sceneMaxTokens: int(r.sceneMaxTokens, 200, 8192, d.sceneMaxTokens),
        reviewBeforeApply: r.reviewBeforeApply !== false,
        autoEnabled: r.autoEnabled === true, autoEveryResponses: int(r.autoEveryResponses, 2, 100, d.autoEveryResponses), autoBuffer: int(r.autoBuffer, 0, 20, d.autoBuffer),
        recentScenes: int(r.recentScenes, 0, 12, d.recentScenes), recentChapters: int(r.recentChapters, 0, 4, d.recentChapters),
        budgetTokens: int(r.budgetTokens, 200, 20000, d.budgetTokens), oldDetailTokens: int(r.oldDetailTokens, 0, 8000, d.oldDetailTokens),
        ghostEnabled: false, // Not offered until the generation projection hook is verified.
        autoMergeEnabled: r.autoMergeEnabled === true, mergeCountThreshold: int(r.mergeCountThreshold, 2, 50, d.mergeCountThreshold),
        mergeTokenThreshold: int(r.mergeTokenThreshold, 200, 50000, d.mergeTokenThreshold), mergeTriggerMode: r.mergeTriggerMode === 'and' ? 'and' : 'or',
        mergeReviewBeforeApply: r.mergeReviewBeforeApply !== false, maxCallsPerRun: int(r.maxCallsPerRun, 1, 5, d.maxCallsPerRun),
    };
}

export function normalizeChronicleState(raw) {
    const r = rec(raw) ? raw : {};
    return {
        schemaVersion: SCHEMA_VERSION, settings: normalizeSettings(r.settings),
        reviews: (Array.isArray(r.reviews) ? r.reviews : []).map(normalizeReview).filter(Boolean).slice(-MAX_REVIEWS),
        // Recursive chapters arrive in a later phase; keep records verbatim until then.
        chapters: (Array.isArray(r.chapters) ? r.chapters : []).filter(rec).map(c => structuredClone(c)),
    };
}

/** Bytes of chronicle data (state + range scenes) as stored in chat metadata. */
export function chronicleBytes(data) {
    const scenes = (Array.isArray(data?.episodes) ? data.episodes : []).filter(ep => ep?.chronicle?.mode === 'range');
    return new TextEncoder().encode(JSON.stringify([data?.chronicle || null, scenes])).length;
}
export function assertChronicleSize(data) {
    if (chronicleBytes(data) > MAX_CHRONICLE_BYTES) throw new Error('장면 연대기 저장 용량 한도(2 MiB)를 넘습니다. 기존 데이터는 그대로 두었습니다. 오래된 후보를 정리하거나 내보낸 뒤 다시 시도해 주세요.');
}

/** Import: range scenes stay held until the user re-verifies their source. */
export function holdImportedChronicle(data) {
    if (!rec(data)) return data;
    if (Array.isArray(data.episodes)) for (const ep of data.episodes) {
        if (rec(ep) && rec(ep.chronicle) && ep.chronicle.mode === 'range' && ep.chronicle.status !== 'deleted') {
            ep.chronicle.status = 'held';
            ep.chronicle.invalidReason = 'imported';
        }
    }
    if (rec(data.chronicle)) data.chronicle.reviews = [];
    return data;
}

/** Branch: keep range scenes that end at or before the cut message; hold the rest. */
export function rangeAfterCut(chronicle, cutIndex) {
    const r = normalizeRange(chronicle?.range);
    return !r || !Number.isInteger(cutIndex) || r.endIndex > cutIndex;
}
