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
function hiddenIds(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(v => String(v ?? '').trim()).filter(Boolean))].sort();
}
/** Per-character AI-hidden IDs of a host message row (empty when the line is visible to all). */
export function rowHiddenFrom(row) { return hiddenIds(row?.extra?.hiddenFromAICharacterIds); }
export function messageFingerprint(row) {
    const parts = [String(row?.role || ''), Number(row?.activeSwipeIndex) || 0, String(row?.createdAt || ''), String(row?.name || ''), String(row?.content || '')];
    // A change of who may see the line is a source change. Visible lines keep their old fingerprint.
    const hidden = rowHiddenFrom(row);
    if (hidden.length) parts.push(`hidden:${hidden.join(',')}`);
    return strongHash(parts.join('␟'));
}
export function stMessageRow(message, index) {
    const hidden = hiddenIds(message?.extra?.hiddenFromAICharacterIds);
    return {
        id: `st-message:${index}`, role: message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant',
        content: String(message?.mes || ''), createdAt: String(message?.send_date || ''), name: message?.name,
        activeSwipeIndex: Number(message?.swipe_id) || 0,
        // Per-character visibility must survive the host boundary; summaries depend on it.
        ...(hidden.length ? { extra: { hiddenFromAICharacterIds: hidden } } : {}),
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
        // Set only by an explicit detach (branch hold moved the chapter away): lets that chapter re-link on restore.
        detachedFrom: str(raw.detachedFrom, 120),
        // The user confirmed this revision reads on its own without the records it was written against.
        standaloneRevision: int(raw.standaloneRevision, 0, 1e6, 0),
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
        // Never evict paid candidates here; the count limit is enforced before a model call.
        reviews: (Array.isArray(r.reviews) ? r.reviews : []).map(normalizeReview).filter(Boolean),
        // Reserved and kept verbatim. Merged chapters live in episodes[] (chronicle.mode 'chapter').
        chapters: (Array.isArray(r.chapters) ? r.chapters : []).filter(rec).map(c => structuredClone(c)),
        // Input hashes of merges the user just undid: auto-merge must not redo them.
        suppressedMerges: (Array.isArray(r.suppressedMerges) ? r.suppressedMerges : []).map(h => str(h, 40)).filter(Boolean).slice(-50),
        // Requests sent but not yet answered. Survives a reload so an unknown outcome is shown, never retried.
        jobs: (Array.isArray(r.jobs) ? r.jobs : []).filter(rec).map(j => ({ id: str(j.id, 80), startedAt: str(j.startedAt, 40), auto: j.auto === true, review: rec(j.review) ? structuredClone(j.review) : null })).filter(j => j.id && j.review),
    };
}

/** Bytes of chronicle data (state + range scenes) as stored in chat metadata. */
export function chronicleBytes(data) {
    const scenes = (Array.isArray(data?.episodes) ? data.episodes : []).filter(ep => ['range', 'chapter'].includes(ep?.chronicle?.mode));
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

const liveStatus = c => !['undone', 'deleted'].includes(c.status);
// Reasons computed from the stored graph itself. They are never persisted as the
// record's own status: fixing the graph (e.g. undoing a merge) clears them.
export const STRUCTURAL_REASONS = Object.freeze(['graph-invalid', 'coverage-invalid', 'coverage-overlap']);

/**
 * Graph integrity of the merge forest: every child of a live chapter must point
 * back to it (archivedBy), belong to one live chapter only, and every archivedBy
 * must point to an existing chapter that lists the node. Offending parents and the
 * records they claim are held; nothing is deleted or re-activated. A record whose
 * archivedBy names a missing parent is corrupted, not released: the only legitimate
 * way out of a chapter is an explicit detach (undoMerge, detachMissingArchiveParents).
 */
function graphIssues(nodes) {
    const bad = new Map();
    const mark = (id, reason = 'graph-invalid') => { if (!bad.has(id)) bad.set(id, reason); };
    const claims = new Map();
    for (const [id, { c }] of nodes) {
        if (c.mode !== 'chapter' || !liveStatus(c)) continue;
        for (const ref of c.childRefs) claims.set(ref.id, [...(claims.get(ref.id) || []), id]);
    }
    for (const [id, { c }] of nodes) {
        if (c.mode !== 'chapter' || !liveStatus(c)) continue;
        for (const ref of c.childRefs) {
            const child = nodes.get(ref.id);
            if (ref.id === id) { mark(id); continue; }
            if (child && child.c.archivedBy !== id) { mark(id); mark(ref.id); }
            if ((claims.get(ref.id) || []).length > 1) claims.get(ref.id).forEach(pid => mark(pid));
        }
    }
    for (const [id, { c }] of nodes) {
        if (!c.archivedBy) continue;
        const parent = nodes.get(c.archivedBy);
        if (!parent) { mark(id); continue; } // dangling archive reference: hold, never silently re-activate
        if (parent.c.mode !== 'chapter') { mark(id); continue; }
        if (liveStatus(parent.c) && !parent.c.childRefs.some(ref => ref.id === id)) { mark(c.archivedBy); mark(id); }
    }
    return bad;
}

function evaluateOnce(nodes, rows, forced) {
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
            if (forced.has(id)) out = { state: 'held', reason: forced.get(id), loc };
            else if (c.status === 'held') out = { state: 'held', reason: c.invalidReason || 'held', loc };
            else if (loc.status === 'changed' || loc.status === 'invalid') out = { state: 'stale', reason: 'source-changed', loc };
            else if (loc.status === 'ambiguous') out = { state: 'held', reason: 'ambiguous', loc };
            else out = { state: c.status === 'stale' ? 'stale' : 'approved', reason: c.status === 'stale' ? c.invalidReason || 'stale' : '', loc };
        } else {
            const kids = c.childRefs.map(ref => ({ ref, node: nodes.get(ref.id), res: own(ref.id) }));
            const locs = kids.map(k => k.res.loc).filter(Boolean);
            const located = locs.length === kids.length && locs.every(l => l.status === 'exact' || l.status === 'moved' || l.status === 'merged');
            // Children must tile one gap-free run in order: no gap, no overlap.
            const contiguous = located && locs.every((l, i) => i === 0 || l.startIndex === locs[i - 1].endIndex + 1);
            const loc = located ? { status: 'merged', startIndex: Math.min(...locs.map(l => l.startIndex)), endIndex: Math.max(...locs.map(l => l.endIndex)) } : { status: 'changed' };
            const childBad = kids.some(k => !k.node || ['stale', 'held', 'deleted', 'undone', 'missing'].includes(k.res.state));
            const childEdited = kids.some(k => k.node && k.node.c.revision !== k.ref.revision);
            if (forced.has(id)) out = { state: 'held', reason: forced.get(id), loc };
            else if (c.status === 'held') out = { state: 'held', reason: c.invalidReason || 'held', loc };
            else if (located && !contiguous) out = { state: 'held', reason: 'coverage-invalid', loc };
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
        if (c.archivedBy && nodes.has(c.archivedBy) && liveStatus(nodes.get(c.archivedBy).c) && state !== 'deleted') state = 'archived';
        result.set(id, { ...base, state, own: base.state });
    }
    return result;
}

/**
 * Evaluates every chronicle node against the current messages.
 * Returns Map id -> { state, reason, loc, own } where `own` ignores archiving.
 * Graph errors (backlinks, two parents, gaps) and message-range overlap between
 * two injectable records hold the records involved (final duplicate guard).
 */
export function evaluateChronicle(episodes, rows) {
    const nodes = chronicleNodes(episodes);
    const forced = graphIssues(nodes);
    for (let round = 0; round <= nodes.size; round++) {
        const result = evaluateOnce(nodes, rows, forced);
        const live = [...result].filter(([, r]) => r.state === 'approved' && r.loc && ['exact', 'moved', 'merged'].includes(r.loc.status))
            .sort((a, b) => a[1].loc.startIndex - b[1].loc.startIndex);
        let added = false;
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length && live[j][1].loc.startIndex <= live[i][1].loc.endIndex; j++) {
                for (const id of [live[i][0], live[j][0]]) if (!forced.has(id)) { forced.set(id, 'coverage-overlap'); added = true; }
            }
        }
        if (!added) return result;
    }
    return evaluateOnce(nodes, rows, forced);
}

/** Chronicle node ids that must not be injected now (generation-time guard). */
export function blockedChronicleIds(episodes, rows, evaluation = evaluateChronicle(episodes, rows)) {
    const blocked = new Set();
    for (const [id, res] of evaluation) if (res.state !== 'approved') blocked.add(id);
    // A record whose dependency closure is not injectable now is withheld with it.
    const nodes = chronicleNodes(episodes);
    for (const [id, res] of evaluation) if (res.state === 'approved' && closureIn(nodes, id, evaluation).missing.length) blocked.add(id);
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
/**
 * The one audience allowed to read every part of a record: the intersection of the
 * event and every fact scope. A public part (no knownBy) does not narrow it.
 * null = public (everyone); [] = no one can read all of it (cannot be merged).
 */
export function sceneAudience(ep) {
    const ids = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))].sort() : []);
    const parts = [ids(ep?.event?.knownBy), ...(Array.isArray(ep?.facts) ? ep.facts : []).map(f => ids(f?.knownBy))].filter(list => list.length);
    if (!parts.length) return null;
    return parts.reduce((acc, list) => acc.filter(id => list.includes(id)));
}
/** Audience of a merge request over these records, or { error } when they cannot share one. */
export function mergeAudience(eps) {
    const audiences = eps.map(sceneAudience);
    if (audiences.some(a => a && !a.length)) return { error: '사건과 사실의 아는 인물 범위가 서로 겹치지 않는 기록이 있어요(범위를 나눌 수 없음). 그런 기록은 합치지 않아요. 모델을 호출하지 않았어요.' };
    const restricted = audiences.filter(Boolean);
    if (restricted.length && restricted.length !== audiences.length) return { error: '공개 기록과 아는 인물 범위가 있는 기록은 함께 합치지 않아요.' };
    if (!restricted.length) return { audience: null };
    const audience = restricted.reduce((acc, list) => acc.filter(id => list.includes(id)));
    if (!audience.length) return { error: '고른 기록들의 아는 인물 범위가 겹치지 않아요(교집합 없음). 합치지 않아요. 모델을 호출하지 않았어요.' };
    return { audience };
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
    if (bad?.res.reason === 'coverage-overlap') return { ok: false, error: '고른 구간이 서로 겹쳐요(다른 기록과 겹친 구간은 보류돼요).' };
    if (bad) return { ok: false, error: `'${bad.ep.title}'은 갱신이 필요하거나 보류된 기록이에요. 먼저 고친 뒤 합쳐 주세요.` };
    for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1].res.loc, cur = nodes[i].res.loc;
        if (cur.startIndex <= prev.endIndex) return { ok: false, error: '고른 구간이 서로 겹쳐요.' };
        if (cur.startIndex !== prev.endIndex + 1) return { ok: false, error: '고른 구간 사이에 기록되지 않은 메시지가 있어요. 이어진 구간만 합칠 수 있어요.' };
    }
    const scopes = new Set(nodes.map(n => scopeSignature(n.ep)));
    if (scopes.size > 1) return { ok: false, error: '아는 인물 범위가 다른 기록은 함께 합치지 않아요.' };
    // Same list-set signature is not enough: the whole request must be readable by one audience.
    const scope = mergeAudience(nodes.map(n => n.ep));
    if (scope.error) return { ok: false, error: scope.error };
    const level = 1 + Math.max(...nodes.map(n => (n.c.mode === 'chapter' ? n.c.level : 0)));
    return { ok: true, nodes, level, restricted: scope.audience !== null, audience: scope.audience, inputHash: mergeInputHash(nodes),
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
        ep.chronicle = { ...ep.chronicle, archivedBy: parent.id, archivedAt: now, detachedFrom: '' };
    }
    episodes.push(parent);
    return episodes;
}

/**
 * Explicit detach for records whose chapter was moved out of this list on purpose
 * (branch hold). Only parents named in `removedIds` are detached; any other missing
 * parent stays a dangling reference and is held by the graph check.
 * Returns the detached record ids.
 */
export function detachMissingArchiveParents(episodes, removedIds) {
    const removed = new Set([...(removedIds || [])].map(String));
    const present = new Set((Array.isArray(episodes) ? episodes : []).filter(rec).map(ep => String(ep.id)));
    const out = [];
    for (const ep of Array.isArray(episodes) ? episodes : []) {
        const parentId = rec(ep) && rec(ep.chronicle) ? String(ep.chronicle.archivedBy || '') : '';
        if (!parentId || present.has(parentId) || !removed.has(parentId)) continue;
        ep.chronicle = { ...ep.chronicle, archivedBy: '', archivedAt: '', detachedFrom: parentId };
        out.push(String(ep.id));
    }
    return out;
}

/**
 * When a detached chapter comes back, its listed children that were detached
 * from it (and joined nothing else since) are archived under it again.
 */
export function reattachDetachedChildren(episodes, chapterId, now) {
    const list = (Array.isArray(episodes) ? episodes : []).filter(rec);
    const chapter = list.find(ep => String(ep.id) === String(chapterId));
    if (!chapter || chapter.chronicle?.mode !== 'chapter') return [];
    const out = [];
    for (const ref of chapter.chronicle.childRefs || []) {
        const child = list.find(ep => String(ep.id) === String(ref.id));
        if (!child || !rec(child.chronicle) || child.chronicle.archivedBy || child.chronicle.detachedFrom !== String(chapterId)) continue;
        child.chronicle = { ...child.chronicle, archivedBy: String(chapterId), archivedAt: now, detachedFrom: '' };
        out.push(String(child.id));
    }
    return out;
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

/**
 * Before a paid call: refuse when the pending-candidate list is full or the
 * stored chronicle would exceed the size limit with one more worst-case candidate.
 */
export function assertReviewRoom(data, maxTokens) {
    const reviews = Array.isArray(data?.chronicle?.reviews) ? data.chronicle.reviews : [];
    const jobs = Array.isArray(data?.chronicle?.jobs) ? data.chronicle.jobs : [];
    if (reviews.length + jobs.length >= MAX_REVIEWS) throw new Error(`검토 대기 후보가 ${MAX_REVIEWS}개예요. 승인하거나 버린 뒤 다시 시도해 주세요. 모델을 호출하지 않았어요.`);
    // Worst case: raw response kept for a failed candidate (~4 chars per token, UTF-8 up to 3 bytes) plus parsed fields.
    const projected = chronicleBytes(data) + Math.min(20000, Number(maxTokens || 0) * 4) * 3 + 16000;
    if (projected > MAX_CHRONICLE_BYTES) throw new Error('새 후보를 저장할 공간이 부족해요(장면 연대기 2 MiB). 대기 후보나 오래된 기록을 정리한 뒤 다시 시도해 주세요. 모델을 호출하지 않았어요.');
}

// ── Automatic range creation (phase E) ──
/**
 * Plans the next automatic range. The checkpoint only advances over a gap-free
 * run of active records from message 0; a gap stops automation (never skipped).
 * The range covers K completed assistant responses (swipes are not new turns,
 * system/empty lines do not count), ends on that assistant line so a following
 * user line stays with its own turn, and the newest `buffer` responses stay out.
 */
export function planAutoScene(episodes, rows, settings, evaluation = evaluateChronicle(episodes, rows)) {
    if (!settings.autoEnabled) return { ok: false, reason: 'off' };
    let cursor = 0;
    for (const node of chronicleFrontier(episodes, rows, evaluation)) {
        const loc = node.res.loc;
        if (!loc || !['exact', 'moved', 'merged'].includes(loc.status)) return { ok: false, reason: 'unlocated', id: node.id };
        if (loc.startIndex > cursor) return { ok: false, reason: 'gap', gapStart: cursor, gapEnd: loc.startIndex - 1 };
        if (node.res.state !== 'approved') return { ok: false, reason: 'not-approved', id: node.id };
        cursor = Math.max(cursor, loc.endIndex + 1);
    }
    const responses = [];
    for (let i = cursor; i < rows.length; i++) if (rows[i]?.role === 'assistant' && String(rows[i].content || '').trim()) responses.push(i);
    const need = settings.autoEveryResponses + settings.autoBuffer;
    if (responses.length < need) return { ok: false, reason: 'waiting', have: responses.length, need, start: cursor };
    return { ok: true, start: cursor, end: responses[settings.autoEveryResponses - 1], responses: settings.autoEveryResponses };
}

// ── Injection plan (phase G) ──
/** The active (non-archived) node standing for `id`: itself, or its live merged ancestor. */
export function activeRepresentative(episodes, id, evaluation) {
    return representativeIn(chronicleNodes(episodes), id, evaluation);
}
function representativeIn(nodes, id, evaluation) {
    let cur = id;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        const res = evaluation.get(cur);
        if (!res) return '';
        if (res.state !== 'archived') return cur;
        cur = nodes.get(cur)?.c.archivedBy || '';
    }
    return '';
}

/** True when this exact revision was confirmed by the user to read on its own. */
export function isStandalone(c) { return !!c && c.standaloneRevision > 0 && c.standaloneRevision === c.revision; }

/**
 * Context references a node relies on: its own and those of its archived
 * descendants (a chapter was written from them), minus references that stay
 * inside the node. A standalone-confirmed record contributes none, and neither
 * does anything below it (confirming a chapter covers the subtree it was written from).
 */
function externalRefs(nodes, id) {
    const inside = new Set();
    const covered = new Set();
    const walk = (nid, depth, cut) => {
        const n = nodes.get(nid);
        if (!n || inside.has(nid) || depth > 64) return;
        inside.add(nid);
        const here = cut || isStandalone(n.c);
        if (here) covered.add(nid);
        if (n.c.mode === 'chapter') n.c.childRefs.forEach(r => walk(r.id, depth + 1, here));
    };
    walk(id, 0, false);
    const refs = [];
    for (const nid of inside) {
        if (covered.has(nid)) continue;
        const n = nodes.get(nid);
        for (const ref of n.c.contextRefs) if (!inside.has(ref.id)) refs.push(ref.id);
    }
    return [...new Set(refs)];
}

/**
 * Transitive dependency closure of a record via live representatives
 * (an archived reference is served by its live merged ancestor, whose own
 * dependencies are followed too). `missing` lists references with no
 * injectable representative. `direct` maps each member to its direct deps.
 */
export function dependencyClosure(episodes, id, evaluation) {
    return closureIn(chronicleNodes(episodes), id, evaluation);
}
function closureIn(nodes, id, evaluation) {
    const deps = new Set();
    const missing = [];
    const direct = new Map();
    const queue = [id];
    const seen = new Set([id]);
    while (queue.length) {
        const cur = queue.shift();
        const reps = [];
        for (const ref of externalRefs(nodes, cur)) {
            const rep = representativeIn(nodes, ref, evaluation);
            if (!rep || evaluation.get(rep)?.state !== 'approved') { missing.push(ref); continue; }
            if (rep === id || rep === cur) continue;
            reps.push(rep);
            if (!seen.has(rep)) { seen.add(rep); deps.add(rep); queue.push(rep); }
        }
        direct.set(cur, [...new Set(reps)]);
    }
    return { deps, missing: [...new Set(missing)], direct };
}

/** Records needing other records in the same request: id -> Set of dependency ids. */
export function injectionDependencies(episodes, rows, evaluation = evaluateChronicle(episodes, rows)) {
    const out = new Map();
    const nodes = chronicleNodes(episodes);
    for (const [id, res] of evaluation) {
        if (res.state !== 'approved') continue;
        const { deps } = closureIn(nodes, id, evaluation);
        if (deps.size) out.set(id, deps);
    }
    return out;
}

/** Without current messages: does this record (or its subtree) rely on other records at all? */
export function hasDependencies(episodes, id) {
    return externalRefs(chronicleNodes(episodes), id).length > 0;
}

/**
 * Decides how each valid frontier record is injected.
 * - constant: the newest N range scenes and J chapters, newest first, within
 *   (budgetTokens - oldDetailTokens), together with their full transitive
 *   dependency closure. If the closure does not fit, the record is held.
 * - keyword: older records that rely on no other record (or were confirmed
 *   standalone). A record with dependencies is never keyword-only: the native
 *   keyword scan could fire it without them.
 * - held: dependencies not included in this request, or not injectable.
 * `depth` orders WI entries so every dependency sorts ahead of its dependents.
 * Archived, stale, held, deleted and undone records are not injected at all.
 */
export function planChronicleInjection(episodes, rows, settings, tokensOf, evaluation = evaluateChronicle(episodes, rows)) {
    const frontier = chronicleFrontier(episodes, rows, evaluation).filter(n => n.res.state === 'approved');
    const nodes = chronicleNodes(episodes);
    const closures = new Map(frontier.map(n => [n.id, closureIn(nodes, n.id, evaluation)]));
    const plan = new Map(frontier.map(n => {
        const cl = closures.get(n.id);
        const base = { tokens: tokensOf(n.ep), depth: 0 };
        if (cl.missing.length) return [n.id, { ...base, mode: 'held', reason: 'dependency-unavailable' }];
        return [n.id, { ...base, ...(cl.deps.size ? { mode: 'held', reason: 'dependency-not-included' } : { mode: 'keyword', reason: 'older' }) }];
    }));
    const newest = frontier.slice().sort((a, b) => (b.res.loc?.endIndex ?? -1) - (a.res.loc?.endIndex ?? -1));
    const recent = [
        ...newest.filter(n => n.c.mode === 'range').slice(0, settings.recentScenes),
        ...newest.filter(n => n.c.mode === 'chapter').slice(0, settings.recentChapters),
    ].sort((a, b) => (b.res.loc?.endIndex ?? -1) - (a.res.loc?.endIndex ?? -1));
    const cap = Math.max(0, settings.budgetTokens - settings.oldDetailTokens);
    let used = 0;
    for (const node of recent) {
        const entry = plan.get(node.id);
        const cl = closures.get(node.id);
        if (entry.mode === 'constant' || cl.missing.length) continue;
        const deps = [...cl.deps].filter(id => plan.has(id) && plan.get(id).mode !== 'constant');
        if ([...cl.deps].some(id => !plan.has(id))) { Object.assign(entry, { mode: 'held', reason: 'dependency-unavailable' }); continue; }
        const cost = entry.tokens + deps.reduce((sum, id) => sum + plan.get(id).tokens, 0);
        if (used + cost > cap) {
            if (cl.deps.size) Object.assign(entry, { mode: 'held', reason: 'dependency-budget' });
            else entry.reason = 'budget';
            continue;
        }
        used += cost;
        Object.assign(entry, { mode: 'constant', reason: 'recent' });
        for (const id of deps) Object.assign(plan.get(id), { mode: 'constant', reason: 'dependency' });
    }
    // Depth = longest dependency path below a record; dependencies get lower depth.
    const depthMemo = new Map();
    const depthOf = (id, trail = new Set()) => {
        if (depthMemo.has(id)) return depthMemo.get(id);
        if (trail.has(id)) return 0;
        trail.add(id);
        const direct = closures.get(id)?.direct.get(id) || [];
        const d = direct.length ? 1 + Math.max(...direct.map(dep => depthOf(dep, trail))) : 0;
        trail.delete(id);
        depthMemo.set(id, d);
        return d;
    };
    for (const [id, entry] of plan) entry.depth = entry.mode === 'constant' ? depthOf(id) : 0;
    return { plan, constantTokens: used, cap, keywordTokens: [...plan.values()].filter(e => e.mode === 'keyword').reduce((s, e) => s + e.tokens, 0) };
}
