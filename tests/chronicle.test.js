import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';
import { parseImport, exportData } from '../migration.js';

const { buildRange, normalizeRange, locateRange, completedResponses, normalizeEpisodeChronicle, normalizeChronicleState,
    normalizeReview, assertChronicleSize, holdImportedChronicle, rangeAfterCut, messageFingerprint, MAX_CHRONICLE_BYTES } = chronicleLib;

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const row = (i, content = `line ${i}`, role = i % 2 ? 'assistant' : 'user') => ({ id: `st-message:${i}`, role, content, createdAt: `2026-10-17T00:${String(i % 60).padStart(2, '0')}:00Z`, name: role === 'user' ? 'User' : 'Mina', activeSwipeIndex: 0 });
const rows = n => Array.from({ length: n }, (_, i) => row(i));
const rangeScene = (range, extra = {}) => ({ id: 'ep-r', title: '도서관 열쇠', keywords: ['열쇠'], event: { summary: '미나가 열쇠를 숨겼다.' },
    chronicle: { mode: 'range', revision: 2, status: 'approved', range, contextRefs: [{ kind: 'episode', id: 'ep-0', revision: 1, hash: 'h' }],
        generation: { requestId: 'r1', connectionId: 'current', model: 'm', promptVersion: 'scene-delta-v1', usage: { input: 10, output: 5, measured: true } } }, ...extra });

test('long ranges keep every ordered fingerprint without the legacy 24/48 caps', () => {
    const list = rows(1500);
    const range = buildRange(list, 10, 1409);
    assert.equal(range.count, 1400);
    assert.equal(range.fingerprints.length, 1400);
    const c = core(['normalizeEpisode']);
    const ep = c.normalizeEpisode(rangeScene(range));
    assert.equal(ep.chronicle.range.fingerprints.length, 1400);
    assert.deepEqual(ep.chronicle.range.fingerprints, range.fingerprints);
    assert.equal(ep.chronicle.status, 'approved');
    assert.equal(ep.chronicle.revision, 2);
    assert.equal(ep.sourceIds.length, 0);
    assert.throws(() => buildRange(rows(2100), 0, 2000), /2000/);
    assert.equal(completedResponses(list, 0, 9), 5);
});

test('legacy scenes stay untouched while range summaries get their own cap', () => {
    const c = core(['normalizeEpisode']);
    const legacy = c.normalizeEpisode({ id: 'old', title: '옛 장면', event: { summary: 'x'.repeat(1200) } });
    assert.equal(legacy.chronicle, undefined);
    assert.equal(legacy.event.summary.length, 800);
    const range = buildRange(rows(4), 0, 3);
    const ranged = c.normalizeEpisode({ ...rangeScene(range), event: { summary: 'y'.repeat(2500) } });
    assert.equal(ranged.event.summary.length, 2000);
});

test('message deletion before a range is a move, editing or swiping inside it is a change', () => {
    const list = rows(30);
    const range = buildRange(list, 10, 14);
    assert.equal(locateRange(list, range).status, 'exact');
    const deleted = list.filter((_, i) => i !== 3);
    assert.deepEqual(locateRange(deleted, range), { status: 'moved', startIndex: 9, endIndex: 13 });
    const inserted = [...list.slice(0, 5), row(99, 'inserted'), ...list.slice(5)];
    assert.equal(locateRange(inserted, range).status, 'moved');
    const edited = list.map((r, i) => (i === 12 ? { ...r, content: 'edited' } : r));
    assert.equal(locateRange(edited, range).status, 'changed');
    const swiped = list.map((r, i) => (i === 13 ? { ...r, activeSwipeIndex: 1 } : r));
    assert.equal(locateRange(swiped, range).status, 'changed');
    const middleRemoved = list.filter((_, i) => i !== 12);
    assert.equal(locateRange(middleRemoved, range).status, 'changed');
});

test('duplicated source text is ambiguous and never silently re-linked', () => {
    const same = i => ({ id: `st-message:${i}`, role: 'user', content: 'Again.', createdAt: '', name: 'User', activeSwipeIndex: 0 });
    const list = [same(0), same(1), same(2), same(3)];
    const range = buildRange(list, 1, 2);
    const shifted = list.slice(1);
    const located = locateRange(shifted, range);
    assert.equal(located.status, 'ambiguous');
    assert.ok(located.candidates.length > 1);
});

test('forged or truncated ranges are held, not repaired', () => {
    const range = buildRange(rows(5), 0, 4);
    assert.equal(normalizeRange({ ...range, rangeHash: 'forged' }), null);
    assert.equal(normalizeRange({ ...range, fingerprints: range.fingerprints.slice(1) }), null);
    assert.equal(normalizeRange({ ...range, fingerprints: [...range.fingerprints.slice(1), 'NOT-A-HASH'] }), null);
    const held = normalizeEpisodeChronicle({ mode: 'range', status: 'approved', range: { ...range, rangeHash: 'x' } });
    assert.equal(held.status, 'held');
    assert.equal(held.invalidReason, 'range-invalid');
    assert.equal(normalizeEpisodeChronicle({ mode: 'legacy' }), null);
    assert.equal(normalizeReview({ id: 'x', range: { ...range, rangeHash: 'x' } }), null);
});

test('chronicle settings use the approved conservative defaults and clamp values', () => {
    const s = normalizeChronicleState({}).settings;
    assert.deepEqual([s.reviewBeforeApply, s.autoEnabled, s.autoMergeEnabled, s.ghostEnabled], [true, false, false, false]);
    assert.deepEqual([s.autoEveryResponses, s.autoBuffer, s.recentScenes, s.recentChapters], [10, 2, 3, 1]);
    assert.deepEqual([s.mergeCountThreshold, s.mergeTokenThreshold, s.mergeTriggerMode, s.maxCallsPerRun, s.budgetTokens], [5, 2000, 'or', 1, 2400]);
    const forced = normalizeChronicleState({ settings: { ghostEnabled: true, sceneMaxTokens: 999999, mergeTriggerMode: 'x' } }).settings;
    assert.equal(forced.ghostEnabled, false);
    assert.equal(forced.sceneMaxTokens, 1200);
    assert.equal(forced.mergeTriggerMode, 'or');
});

test('export/import round-trip keeps range fields, then holds them and drops pending reviews', () => {
    const c = core(['normalizeData', 'prepareScopeImport', 'state']);
    const range = buildRange(rows(40), 5, 25);
    const review = { id: 'rv', status: 'ready', range, candidate: { title: 'pending' } };
    const data = c.normalizeData({ items: [], episodes: [rangeScene(range)], chronicle: { reviews: [review] } });
    assert.equal(data.chronicle.reviews.length, 1);
    const parsed = parseImport(exportData(data));
    assert.deepEqual(parsed.episodes[0].chronicle.range.fingerprints, range.fingerprints);
    const imported = c.normalizeData(c.prepareScopeImport(parsed));
    assert.equal(imported.episodes[0].chronicle.status, 'held');
    assert.equal(imported.episodes[0].chronicle.invalidReason, 'imported');
    assert.equal(imported.episodes[0].chronicle.revision, 2);
    assert.deepEqual(imported.chronicle.reviews, []);
    assert.throws(() => parseImport(JSON.stringify({ items: [], episodes: [{ title: 'x', chronicle: 'bad' }] })), /형식/);
    assert.throws(() => parseImport(JSON.stringify({ items: [], episodes: [{ title: 'x', chronicle: { range: { fingerprints: Array(2001).fill('a') } } }] })), /형식/);
    assert.throws(() => parseImport(JSON.stringify({ items: [], chronicle: [] })), /형식/);
});

test('held and imported range scenes are never injected; approved and legacy ones are', () => {
    const c = core(['normalizeData', 'episodeEntryPlans', 'state']);
    const range = buildRange(rows(8), 0, 7);
    const chat = { id: 'c', name: 'FILE', metadata: {} };
    const data = c.normalizeData({ items: [], episodes: [
        rangeScene(range, { id: 'ok', keywords: ['열쇠'] }),
        rangeScene(range, { id: 'held', keywords: ['창고'], chronicle: { ...rangeScene(range).chronicle, status: 'held' } }),
        rangeScene(range, { id: 'stale', keywords: ['지하'], chronicle: { ...rangeScene(range).chronicle, status: 'stale' } }),
        { id: 'legacy', title: '옛 장면', keywords: ['우산'], event: { summary: '우산을 빌렸다' } },
    ] });
    const ids = c.episodeEntryPlans(chat, data).map(p => p.episodeId);
    assert.deepEqual(ids.sort(), ['legacy', 'ok']);
});

test('branch inheritance holds range scenes that end after the cut and drops pending reviews', () => {
    const c = core(['holdPostBranchRecords', 'normalizeData']);
    const list = rows(30);
    const before = rangeScene(buildRange(list, 0, 9), { id: 'before', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const across = rangeScene(buildRange(list, 8, 19), { id: 'across', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    const child = c.holdPostBranchRecords({ items: [], episodes: [before, across], chronicle: { reviews: [{ id: 'r', status: 'ready', range: buildRange(list, 0, 1) }] } },
        { at: '2026-06-01T00:00:00Z', messageId: 'st-message:14' }, 'parent');
    assert.deepEqual(child.episodes.map(e => e.id), ['before']);
    assert.equal(child.branchHold.episodes[0].id, 'across');
    assert.equal(child.branchHold.episodes[0].holdReason, 'range-after-cut');
    assert.deepEqual(child.chronicle.reviews, []);
    assert.equal(rangeAfterCut({ range: buildRange(list, 0, 3) }, Number.NaN), true);
});

test('capacity is checked before save and an over-limit write is refused, not truncated', () => {
    const list = rows(2000);
    const range = buildRange(list, 0, 1999);
    const data = { episodes: [], chronicle: { reviews: [] } };
    data.episodes.push(rangeScene(range));
    assert.doesNotThrow(() => assertChronicleSize(data));
    const big = { episodes: Array.from({ length: 60 }, (_, i) => rangeScene(range, { id: `e${i}` })), chronicle: {} };
    assert.ok(chronicleLib.chronicleBytes(big) > MAX_CHRONICLE_BYTES);
    assert.throws(() => assertChronicleSize(big), /2 MiB/);
    assert.equal(big.episodes.length, 60);
});

test('fingerprints include speaker and swipe so group lines with equal text differ', () => {
    const a = { role: 'assistant', content: 'Yes.', createdAt: 't', name: 'Mina', activeSwipeIndex: 0 };
    assert.notEqual(messageFingerprint(a), messageFingerprint({ ...a, name: 'Bob' }));
    assert.notEqual(messageFingerprint(a), messageFingerprint({ ...a, activeSwipeIndex: 2 }));
    assert.match(messageFingerprint(a), /^[0-9a-z]{22}$/);
    assert.equal(holdImportedChronicle(null), null);
});
