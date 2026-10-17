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
export const SCENE_STATUSES = ['approved', 'stale', 'held', 'deleted', 'undone'];
export const MAX_MERGE_CHILDREN = 24;
export const MERGE_PROMPT_VERSION = 'chapter-merge-v1';
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
 * episode.chronicle for range scenes (mode range) and merged chapters (mode chapter).
 * Legacy episodes have no field. An unverifiable record is kept but held, never repaired.
 */
export function normalizeChildRefs(raw) {
    return (Array.isArray(raw) ? raw : []).filter(rec).slice(0, MAX_MERGE_CHILDREN)
        .map(r => ({ id: str(r.id, 120), revision: int(r.revision, 1, 1e6, 1) })).filter(r => r.id);
}
function normalizePrevious(raw) {
    return (Array.isArray(raw) ? raw : []).filter(rec).slice(-MAX_PREVIOUS_VERSIONS).map(p => ({
        revision: int(p.revision, 1, 1e6, 1), savedAt: str(p.savedAt, 40), reason: str(p.reason, 40),
        title: str(p.title, 120), summary: str(p.summary, RANGE_SUMMARY_MAX), keywords: (Array.isArray(p.keywords) ? p.keywords : []).map(k => str(k, 60)).slice(0, 8),
    }));
}
export function normalizeEpisodeChronicle(raw) {
    if (!rec(raw) || !['range', 'chapter'].includes(raw.mode)) return null;
    let status = SCENE_STATUSES.includes(raw.status) ? raw.status : 'held';
    let invalidReason = str(raw.invalidReason, 200);
    const common = {
        revision: int(raw.revision, 1, 1e6, 1), contextRefs: normalizeContextRefs(raw.contextRefs), generation: normalizeGeneration(raw.generation),
        approvedAt: str(raw.approvedAt, 40), previous: normalizePrevious(raw.previous),
        archivedBy: str(raw.archivedBy, 120), archivedAt: str(raw.archivedAt, 40),
        deletedAt: str(raw.deletedAt, 40), statusBeforeDelete: SCENE_STATUSES.includes(raw.statusBeforeDelete) && raw.statusBeforeDelete !== 'deleted' ? raw.statusBeforeDelete : '',
    };
    if (raw.mode === 'chapter') {
        const childRefs = normalizeChildRefs(raw.childRefs);
        if (childRefs.length < 2 || new Set(childRefs.map(c => c.id)).size !== childRefs.length) { status = status === 'undone' ? status : 'held'; invalidReason = invalidReason || 'children-invalid'; }
        return { mode: 'chapter', level: int(raw.level, 1, 64, 1), status, invalidReason, childRefs, mergedAt: str(raw.mergedAt, 40), undoneAt: str(raw.undoneAt, 40), ...common };
    }
    const range = normalizeRange(raw.range);
    if (!range) { status = 'held'; invalidReason = invalidReason || 'range-invalid'; }
    return {
        mode: 'range', status, invalidReason,
        range: range || (rec(raw.range) ? { startIndex: int(raw.range.startIndex, 0, 1e7, 0), count: 0, fingerprints: [], rangeHash: '' } : null),
        injectionPolicy: 'keyword', ...common,
    };
}

/** Pending candidate from one isolated call: a scene (range) or a merge (children). */
export function normalizeReview(raw) {
    if (!rec(raw)) return null;
    const kind = raw.kind === 'merge' ? 'merge' : 'scene';
    const range = kind === 'scene' ? normalizeRange(raw.range) : null;
    const childRefs = kind === 'merge' ? normalizeChildRefs(raw.childRefs) : [];
    if (kind === 'scene' ? !range : childRefs.length < 2) return null;
    const status = ['ready', 'held', 'failed'].includes(raw.status) ? raw.status : 'held';
    return {
        id: str(raw.id, 80) || `chr_${Date.now().toString(36)}`, kind, status, reason: str(raw.reason, 300),
        ...(kind === 'scene' ? { range } : { childRefs, auto: raw.auto === true, inputHash: str(raw.inputHash, 40) }),
        replacesEpisodeId: str(raw.replacesEpisodeId, 120), contextRefs: normalizeContextRefs(raw.contextRefs),
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
        // Reserved and kept verbatim. Merged chapters live in episodes[] (chronicle.mode 'chapter').
        chapters: (Array.isArray(r.chapters) ? r.chapters : []).filter(rec).map(c => structuredClone(c)),
        // Input hashes of merges the user just undid: auto-merge must not redo them.
        suppressedMerges: (Array.isArray(r.suppressedMerges) ? r.suppressedMerges : []).map(h => str(h, 40)).filter(Boolean).slice(-50),
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

// ── Validity, dependencies and the active frontier (phases D/F) ──
// Effective states: approved (injectable), stale, held, deleted, undone, archived.

function chronicleNodes(episodes) {
    const map = new Map();
    for (const ep of Array.isArray(episodes) ? episodes : []) {
        if (!rec(ep) || ep.replacedBy) continue;
        const c = normalizeEpisodeChronicle(ep.chronicle);
        if (c && ep.id) map.set(String(ep.id), { ep, c });
    }
    return map;
}

/**
 * Evaluates every chronicle node against the current messages.
 * Returns Map id -> { state, reason, loc, own } where `own` ignores archiving.
 */
export function evaluateChronicle(episodes, rows) {
    const nodes = chronicleNodes(episodes);
    const memo = new Map();
    const visiting = new Set();
    const own = (id) => {
        if (memo.has(id)) return memo.get(id);
        const node = nodes.get(id);
        if (!node) return { state: 'missing', reason: 'missing' };
        if (visiting.has(id)) return { state: 'held', reason: 'cycle' };
        visiting.add(id);
        const { c } = node;
        let out;
        if (c.status === 'deleted' || c.status === 'undone') out = { state: c.status, reason: c.invalidReason };
        else if (c.mode === 'range') {
            const loc = c.range?.count ? locateRange(rows, c.range) : { status: 'invalid' };
            if (c.status === 'held') out = { state: 'held', reason: c.invalidReason || 'held', loc };
            else if (loc.status === 'changed' || loc.status === 'invalid') out = { state: 'stale', reason: 'source-changed', loc };
            else if (loc.status === 'ambiguous') out = { state: 'held', reason: 'ambiguous', loc };
            else out = { state: c.status === 'stale' ? 'stale' : 'approved', reason: c.status === 'stale' ? c.invalidReason || 'stale' : '', loc };
        } else {
            const kids = c.childRefs.map(ref => ({ ref, node: nodes.get(ref.id), res: own(ref.id) }));
            const locs = kids.map(k => k.res.loc).filter(Boolean);
            const located = locs.length === kids.length && locs.every(l => l.status === 'exact' || l.status === 'moved' || l.status === 'merged');
            const loc = located ? { status: 'merged', startIndex: Math.min(...locs.map(l => l.startIndex)), endIndex: Math.max(...locs.map(l => l.endIndex)) } : { status: 'changed' };
            const childBad = kids.some(k => !k.node || ['stale', 'held', 'deleted', 'undone', 'missing'].includes(k.res.state));
            const childEdited = kids.some(k => k.node && k.node.c.revision !== k.ref.revision);
            if (c.status === 'held') out = { state: 'held', reason: c.invalidReason || 'held', loc };
            else if (childBad || childEdited || !located) out = { state: 'stale', reason: 'child-changed', loc };
            else out = { state: c.status === 'stale' ? 'stale' : 'approved', reason: c.status === 'stale' ? c.invalidReason || 'stale' : '', loc };
        }
        // A delta written against an earlier record depends on that exact revision.
        if (out.state === 'approved') {
            for (const ref of c.contextRefs) {
                const target = nodes.get(ref.id);
                const res = own(ref.id);
                if (!target || target.c.revision !== ref.revision || !['approved'].includes(res.state)) { out = { ...out, state: 'stale', reason: 'dependency-changed' }; break; }
            }
        }
        visiting.delete(id);
        memo.set(id, out);
        return out;
    };
    const result = new Map();
    for (const [id, { c }] of nodes) {
        const base = own(id);
        let state = base.state;
        // Archived under a live (not undone/deleted) parent: kept, never injected.
        if (c.archivedBy && nodes.has(c.archivedBy) && !['undone', 'deleted'].includes(nodes.get(c.archivedBy).c.status) && state !== 'deleted') state = 'archived';
        result.set(id, { ...base, state, own: base.state });
    }
    return result;
}

/** Chronicle node ids that must not be injected now (generation-time guard). */
export function blockedChronicleIds(episodes, rows) {
    const blocked = new Set();
    for (const [id, res] of evaluateChronicle(episodes, rows)) if (res.state !== 'approved') blocked.add(id);
    return blocked;
}

/** Active frontier: not archived/deleted/undone, ordered by current coverage. */
export function chronicleFrontier(episodes, rows, evaluation = evaluateChronicle(episodes, rows)) {
    const nodes = chronicleNodes(episodes);
    return [...evaluation].filter(([, res]) => !['archived', 'deleted', 'undone'].includes(res.state))
        .map(([id, res]) => ({ id, ep: nodes.get(id).ep, c: nodes.get(id).c, res }))
        .sort((a, b) => (a.res.loc?.startIndex ?? 1e9) - (b.res.loc?.startIndex ?? 1e9));
}

/** Leaf range ids under a node (a range node is its own leaf). */
export function leafIds(episodes, id) {
    const nodes = chronicleNodes(episodes);
    const out = [];
    const walk = (nid, depth) => {
        const n = nodes.get(nid);
        if (!n || depth > 64) return;
        if (n.c.mode === 'range') out.push(nid); else n.c.childRefs.forEach(r => walk(r.id, depth + 1));
    };
    walk(id, 0);
    return out;
}

/** Leaf-coverage overlap between injected nodes; must be empty. */
export function injectedCoverageOverlap(episodes, rows) {
    const injected = [...evaluateChronicle(episodes, rows)].filter(([, r]) => r.state === 'approved').map(([id]) => id);
    const seen = new Map();
    const overlaps = [];
    for (const id of injected) for (const leaf of leafIds(episodes, id)) {
        if (seen.has(leaf)) overlaps.push([seen.get(leaf), id, leaf]); else seen.set(leaf, id);
    }
    return overlaps;
}

export function scopeSignature(ep) {
    const ids = (v) => (Array.isArray(v) ? v.map(String).sort() : []);
    const parts = [ids(ep?.event?.knownBy), ...(Array.isArray(ep?.facts) ? ep.facts : []).map(f => ids(f?.knownBy))].filter(list => list.length).map(list => list.join(','));
    return [...new Set(parts)].sort().join('|');
}
export function mergeInputHash(nodes) {
    return strongHash(nodes.map(n => `${n.ep.id}@${n.c.revision}`).join(';'));
}

/**
 * Checks a merge selection: 2+ active, approved, contiguous, non-overlapping
 * frontier nodes with one shared knowledge scope.
 */
export function validateMerge(episodes, rows, ids) {
    const evaluation = evaluateChronicle(episodes, rows);
    const frontier = chronicleFrontier(episodes, rows, evaluation);
    const wanted = new Set(ids.map(String));
    const nodes = frontier.filter(n => wanted.has(n.id));
    if (wanted.size < 2) return { ok: false, error: '합칠 구간을 두 개 이상 고르세요.' };
    if (wanted.size > MAX_MERGE_CHILDREN) return { ok: false, error: `한 번에 ${MAX_MERGE_CHILDREN}개까지 합칠 수 있어요.` };
    if (nodes.length !== wanted.size) return { ok: false, error: '보관된 기록이나 조상·자손이 섞였어요. 활성 구간만 고르세요.' };
    const bad = nodes.find(n => n.res.state !== 'approved');
    if (bad) return { ok: false, error: `'${bad.ep.title}'은 갱신이 필요하거나 보류된 기록이에요. 먼저 고친 뒤 합쳐 주세요.` };
    for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1].res.loc, cur = nodes[i].res.loc;
        if (cur.startIndex <= prev.endIndex) return { ok: false, error: '고른 구간이 서로 겹쳐요.' };
        if (cur.startIndex !== prev.endIndex + 1) return { ok: false, error: '고른 구간 사이에 기록되지 않은 메시지가 있어요. 이어진 구간만 합칠 수 있어요.' };
    }
    const scopes = new Set(nodes.map(n => scopeSignature(n.ep)));
    if (scopes.size > 1) return { ok: false, error: '아는 인물 범위가 다른 기록은 함께 합치지 않아요.' };
    const level = 1 + Math.max(...nodes.map(n => (n.c.mode === 'chapter' ? n.c.level : 0)));
    return { ok: true, nodes, level, restricted: [...scopes][0] !== '', inputHash: mergeInputHash(nodes),
        coverage: { startIndex: nodes[0].res.loc.startIndex, endIndex: nodes[nodes.length - 1].res.loc.endIndex } };
}

/**
 * Auto-merge plan: once the eligible public frontier reaches the count and/or
 * token threshold, merge the oldest contiguous run (at least 2), keeping the
 * newest node unmerged. Skips nodes with pending work and just-undone inputs.
 */
export function planAutoMerge(episodes, rows, settings, { pendingIds = new Set(), suppressed = [], estimate = () => 0 } = {}) {
    if (!settings.autoMergeEnabled) return null;
    const frontier = chronicleFrontier(episodes, rows).filter(n => n.res.state === 'approved' && scopeSignature(n.ep) === '' && !pendingIds.has(n.id));
    if (frontier.length < 3) return null;
    const tokens = frontier.reduce((sum, n) => sum + estimate(n.ep), 0);
    const byCount = frontier.length >= settings.mergeCountThreshold;
    const byTokens = tokens >= settings.mergeTokenThreshold;
    if (settings.mergeTriggerMode === 'and' ? !(byCount && byTokens) : !(byCount || byTokens)) return null;
    const pool = frontier.slice(0, -1);
    for (let start = 0; start < pool.length - 1; start++) {
        const run = [pool[start]];
        for (let i = start + 1; i < pool.length && run.length < Math.max(2, settings.mergeCountThreshold); i++) {
            if (pool[i].res.loc.startIndex !== run[run.length - 1].res.loc.endIndex + 1) break;
            run.push(pool[i]);
        }
        if (run.length < 2) continue;
        const hash = mergeInputHash(run);
        if (suppressed.includes(hash)) continue;
        return { ids: run.map(n => n.id), inputHash: hash, tokens };
    }
    return null;
}

/** Applies an approved merge in one step: parent added, direct children archived. */
export function applyMerge(episodes, parent, childIds, now) {
    const ids = new Set(childIds);
    for (const ep of episodes) {
        if (!ids.has(ep.id)) continue;
        if (ep.chronicle?.archivedBy) throw new Error('이미 다른 합본에 들어간 기록이 있어요.');
        ep.chronicle = { ...ep.chronicle, archivedBy: parent.id, archivedAt: now };
    }
    episodes.push(parent);
    return episodes;
}

/**
 * Undoes a merge without any model call: the parent becomes inactive history
 * and its direct children become active again. Active ancestors are undone first.
 */
export function undoMerge(episodes, chapterId, now) {
    const byId = new Map(episodes.filter(rec).map(ep => [String(ep.id), ep]));
    const chain = [];
    let cur = byId.get(chapterId);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.chronicle?.mode !== 'chapter') throw new Error('합본만 합치기를 취소할 수 있어요.');
        chain.unshift(cur);
        const parentId = cur.chronicle.archivedBy;
        const parent = parentId ? byId.get(parentId) : null;
        cur = parent && !['undone', 'deleted'].includes(parent.chronicle?.status) ? parent : null;
    }
    for (const node of chain) {
        node.chronicle = { ...node.chronicle, status: 'undone', undoneAt: now, archivedBy: '', archivedAt: '' };
        for (const ref of node.chronicle.childRefs || []) {
            const child = byId.get(ref.id);
            if (child && child.chronicle?.archivedBy === node.id) child.chronicle = { ...child.chronicle, archivedBy: '', archivedAt: '' };
        }
    }
    return chain.map(n => n.id);
}
