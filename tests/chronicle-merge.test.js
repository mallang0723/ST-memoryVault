import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';

const { buildRange, stMessageRow, evaluateChronicle, blockedChronicleIds, chronicleFrontier, validateMerge, applyMerge, undoMerge,
    planAutoMerge, injectedCoverageOverlap, normalizeSettings, mergeInputHash } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

const chat = Array.from({ length: 30 }, (_, i) => ({ is_user: i % 2 === 0, name: i % 2 ? 'Mina' : 'Hana', mes: `line ${i + 1}`, send_date: `2026-10-17T00:${String(i).padStart(2, '0')}:00Z` }));
const rows = chat.map(stMessageRow);
const scene = (id, s, e, extra = {}) => ({ id, title: `scene ${id}`, keywords: [`kw-${id}`], event: { summary: `summary ${id}` }, facts: [{ text: `fact ${id}` }], createdAt: '2026-01-01T00:00:00Z',
    chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, s, e), ...extra } });
const chapter = (id, kids, level = 1) => ({ id, title: `chapter ${id}`, keywords: [`kw-${id}`], event: { summary: `recap ${id}` }, facts: [],
    chronicle: { mode: 'chapter', level, status: 'approved', revision: 1, childRefs: kids.map(k => ({ id: k.id, revision: k.chronicle.revision })) } });
const states = eps => Object.fromEntries([...evaluateChronicle(eps, rows)].map(([id, r]) => [id, r.state]));

test('#1~#5 + #6~#10 -> #1~#10, then + #11~#20 -> #1~#20 with archived originals and zero coverage duplication', () => {
    const A = scene('A', 0, 4), B = scene('B', 5, 9), D = scene('D', 10, 19);
    const eps = [A, B, D];
    const first = validateMerge(eps, rows, ['A', 'B']);
    assert.equal(first.ok, true);
    assert.equal(first.level, 1);
    assert.deepEqual(first.coverage, { startIndex: 0, endIndex: 9 });
    const C = chapter('C', [A, B]);
    applyMerge(eps, C, ['A', 'B'], 'now');
    assert.deepEqual(states(eps), { A: 'archived', B: 'archived', D: 'approved', C: 'approved' });
    assert.deepEqual(evaluateChronicle(eps, rows).get('C').loc, { status: 'merged', startIndex: 0, endIndex: 9 });
    const second = validateMerge(eps, rows, ['C', 'D']);
    assert.equal(second.ok, true, second.error);
    assert.equal(second.level, 2);
    const E = chapter('E', [C, D], 2);
    applyMerge(eps, E, ['C', 'D'], 'now');
    assert.deepEqual(states(eps), { A: 'archived', B: 'archived', D: 'archived', C: 'archived', E: 'approved' });
    assert.deepEqual(evaluateChronicle(eps, rows).get('E').loc, { status: 'merged', startIndex: 0, endIndex: 19 });
    assert.deepEqual([...blockedChronicleIds(eps, rows)].sort(), ['A', 'B', 'C', 'D']);
    assert.deepEqual(injectedCoverageOverlap(eps, rows), []);
    assert.deepEqual(chronicleFrontier(eps, rows).map(n => n.id), ['E']);
    assert.throws(() => applyMerge(eps, chapter('X', [A, D]), ['A'], 'now'), /이미/);
});

test('merge selection rules: two or more, contiguous, active frontier only, valid, one shared scope', () => {
    const A = scene('A', 0, 4), B = scene('B', 5, 9), G = scene('G', 12, 15), S = scene('S', 10, 11, { status: 'stale', invalidReason: 'x' });
    assert.match(validateMerge([A, B], rows, ['A']).error, /두 개/);
    assert.match(validateMerge([A, G], rows, ['A', 'G']).error, /기록되지 않은/);
    assert.match(validateMerge([A, B, S], rows, ['B', 'S']).error, /갱신/);
    const secret = scene('B', 5, 9); secret.facts = [{ text: 'secret', knownBy: ['Mina.png'] }];
    assert.match(validateMerge([A, secret], rows, ['A', 'B']).error, /범위/);
    const overlap = scene('O', 3, 7);
    assert.match(validateMerge([A, overlap], rows, ['A', 'O']).error, /겹쳐/);
    const eps = [A, B, scene('D', 10, 19)];
    applyMerge(eps, chapter('C', [A, B]), ['A', 'B'], 'now');
    assert.match(validateMerge(eps, rows, ['A', 'D']).error, /보관된/);
    assert.match(validateMerge(eps, rows, ['C', 'A']).error, /보관된/);
    const restricted = [scene('R1', 0, 4), scene('R2', 5, 9)];
    restricted.forEach(r => { r.event.knownBy = ['Mina.png']; });
    assert.equal(validateMerge(restricted, rows, ['R1', 'R2']).restricted, true);
});

test('editing an archived child marks every ancestor stale; originals are not re-injected', () => {
    const A = scene('A', 0, 4), B = scene('B', 5, 9), D = scene('D', 10, 19);
    const eps = [A, B, D];
    const C = chapter('C', [A, B]); applyMerge(eps, C, ['A', 'B'], 'now');
    const E = chapter('E', [C, D], 2); applyMerge(eps, E, ['C', 'D'], 'now');
    A.chronicle.revision = 2;
    const ev = evaluateChronicle(eps, rows);
    assert.deepEqual([ev.get('C').own, ev.get('C').reason], ['stale', 'child-changed']);
    assert.deepEqual([ev.get('E').own, ev.get('E').reason], ['stale', 'child-changed']);
    assert.deepEqual([...blockedChronicleIds(eps, rows)].sort(), ['A', 'B', 'C', 'D', 'E'], 'source text stays in the chat; no descendant re-enters');
    // A source edit under the tree also stales the whole chain.
    A.chronicle.revision = 1;
    const edited = chat.map((m, i) => (i === 2 ? { ...m, mes: 'changed' } : m)).map(stMessageRow);
    const ev2 = evaluateChronicle(eps, edited);
    assert.deepEqual([ev2.get('A').own, ev2.get('C').own, ev2.get('E').own], ['stale', 'stale', 'stale']);
});

test('undo two levels without model calls; undoing an archived chapter undoes its active ancestors first', () => {
    const build = () => {
        const A = scene('A', 0, 4), B = scene('B', 5, 9), D = scene('D', 10, 19);
        const eps = [A, B, D];
        const C = chapter('C', [A, B]); applyMerge(eps, C, ['A', 'B'], 'now');
        applyMerge(eps, chapter('E', [C, D], 2), ['C', 'D'], 'now');
        return eps;
    };
    const eps = build();
    assert.deepEqual(undoMerge(eps, 'E', 'later'), ['E']);
    assert.deepEqual(states(eps), { A: 'archived', B: 'archived', C: 'approved', D: 'approved', E: 'undone' });
    assert.deepEqual(injectedCoverageOverlap(eps, rows), []);
    assert.deepEqual(undoMerge(eps, 'C', 'later'), ['C']);
    assert.deepEqual(states(eps), { A: 'approved', B: 'approved', C: 'undone', D: 'approved', E: 'undone' });
    const nested = build();
    assert.deepEqual(undoMerge(nested, 'C', 'later'), ['E', 'C']);
    assert.deepEqual(states(nested), { A: 'approved', B: 'approved', C: 'undone', D: 'approved', E: 'undone' });
    assert.ok(nested.find(e => e.id === 'E').title, 'parent kept as history');
});

test('auto-merge plan: count/token thresholds with OR/AND, keeps newest, skips pending, suppressed and restricted work', () => {
    const eps = [scene('A', 0, 4), scene('B', 5, 9), scene('C', 10, 14), scene('D', 15, 19), scene('E', 20, 24)];
    const base = normalizeSettings({ autoMergeEnabled: true, mergeCountThreshold: 5, mergeTokenThreshold: 2000, mergeTriggerMode: 'or' });
    assert.equal(planAutoMerge(eps, rows, { ...base, autoMergeEnabled: false }), null);
    const plan = planAutoMerge(eps, rows, base);
    assert.deepEqual(plan.ids, ['A', 'B', 'C', 'D'], 'oldest contiguous run, newest node kept');
    assert.equal(planAutoMerge(eps.slice(0, 4), rows, base), null, 'below count, below tokens');
    assert.ok(planAutoMerge(eps.slice(0, 4), rows, base, { estimate: () => 600 }), 'token threshold alone triggers with OR');
    assert.equal(planAutoMerge(eps.slice(0, 4), rows, { ...base, mergeTriggerMode: 'and' }, { estimate: () => 600 }), null, 'AND needs both');
    assert.deepEqual(planAutoMerge(eps, rows, { ...base, mergeCountThreshold: 4 }, { pendingIds: new Set(['A']) }).ids, ['B', 'C', 'D']);
    assert.deepEqual(planAutoMerge(eps, rows, base, { suppressed: [plan.inputHash] }).ids, ['B', 'C', 'D'], 'just-undone input is not redone');
    const secret = eps.map(e => structuredClone(e)); secret[0].event.knownBy = ['Mina.png'];
    assert.deepEqual(planAutoMerge(secret, rows, { ...base, mergeCountThreshold: 4 }).ids, ['B', 'C', 'D'], 'restricted records are never auto-merged');
    assert.equal(mergeInputHash([{ ep: eps[0], c: eps[0].chronicle }]) === mergeInputHash([{ ep: eps[0], c: { ...eps[0].chronicle, revision: 2 } }]), false);
});

// ── extension flows with a fake isolated endpoint ──
function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const mergeReply = JSON.stringify({ title: 'Merged chapter', summary: 'Hana and Mina did everything in order.', knownBy: ['all'], facts: [{ text: 'They met.', knownBy: ['all'], parts: [1] }, { text: 'Unsupported.', knownBy: ['all'], parts: [] }], keywords: ['merged'] });
function runner(episodes, settings = {}) {
    globalThis.window = { confirm: () => true };
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { calls: [], rows };
    const c = core(['state', 'normalizeData', 'runChronicleMerge', 'approveMergeReview', 'draftFromCandidate', 'reviewCandidate', 'undoChronicleMerge', 'maybeAutoMerge', 'chronicleOf', 'buildMergePrompt', 'episodeEntryPlans'], host,
        `api = async (path, options = {}) => { host.calls.push({ path, body: options.body === undefined ? undefined : structuredClone(options.body) });
            if (path.includes('/messages')) return structuredClone(host.rows);
            if (path === 'chronicle/connections') return [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }];
            if (path === 'generate/isolated') return { content: ${JSON.stringify(mergeReply)}, usage: { input: 10, output: 5, measured: true } };
            throw new Error('unexpected ' + path); };
         freshOwnedData = async () => structuredClone(state.currentData);
         persistData = async (d) => { state.currentData = normalizeData(d); return state.currentData; };
         render = () => {}; toast = () => {};`);
    c.state.chatCharacters = [{ id: 'Mina.png', name: 'Mina' }];
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', metadata: {} }, chronicleRows: rows, chronicleRowsChatId: 'chat',
        chronicleConnections: [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }] });
    c.state.currentData = c.normalizeData({ items: [], episodes, chronicle: { settings } });
    return { c, host, generated: () => host.calls.filter(x => x.path === 'generate/isolated') };
}
const eps = () => [scene('A', 0, 4), scene('B', 5, 9), scene('D', 10, 19), scene('F', 20, 29)];
const st = (c, id) => evaluateChronicle(c.state.currentData.episodes, rows).get(id)?.state;

test('manual merge: one isolated request with parts only, review, approve, then undo with suppression', async () => {
    const { c, generated } = runner(eps());
    const review = await c.runChronicleMerge(['A', 'B']);
    assert.equal(generated().length, 1);
    const body = generated()[0].body;
    assert.equal(body.guard, undefined);
    assert.match(body.messages[1].content, /^PARTS \(oldest first\):\n\nPART 1\nTitle: scene A/);
    assert.doesNotMatch(JSON.stringify(body.messages), /#\d+~#|st-message|MEMORY_CABINET|memoryCabinet|기억 ?보관함|"A"|ep_|chr_/);
    assert.equal(review.kind, 'merge');
    assert.equal(st(c, 'A'), 'approved', 'pending candidate does not archive originals');
    await assert.rejects(c.runChronicleMerge(['A', 'B']), /검토 대기/, 'no duplicate paid work');
    assert.equal(generated().length, 1);
    const draft = c.draftFromCandidate(c.reviewCandidate(review));
    assert.deepEqual(draft.facts.map(f => f.text), ['They met.'], 'unsupported facts dropped by default');
    await c.approveMergeReview(review, draft);
    const ch = c.state.currentData.episodes.find(e => e.chronicle?.mode === 'chapter');
    assert.equal(ch.chronicle.level, 1);
    assert.deepEqual([st(c, 'A'), st(c, 'B'), st(c, ch.id)], ['archived', 'archived', 'approved']);
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId).sort(), ['D', 'F', ch.id].sort());
    await c.undoChronicleMerge(ch.id);
    assert.deepEqual([st(c, 'A'), st(c, 'B'), st(c, ch.id)], ['approved', 'approved', 'undone']);
    assert.equal(c.chronicleOf().suppressedMerges.length, 1);
    assert.equal(generated().length, 1, 'undo makes no model call');
});

test('auto-merge with review ON only creates a candidate; with review OFF it applies and cascades up to the call cap', async () => {
    const on = runner(eps(), { autoMergeEnabled: true, mergeCountThreshold: 3, mergeReviewBeforeApply: true, maxCallsPerRun: 1 });
    assert.equal(await on.c.maybeAutoMerge(), 1);
    assert.equal(on.c.chronicleOf().reviews.length, 1);
    assert.equal(st(on.c, 'A'), 'approved');
    assert.equal(await on.c.maybeAutoMerge(), 0, 'pending candidate blocks a second paid call on the same nodes');
    const off = runner(eps(), { autoMergeEnabled: true, mergeCountThreshold: 2, mergeReviewBeforeApply: false, maxCallsPerRun: 2 });
    assert.equal(await off.c.maybeAutoMerge(), 2);
    assert.equal(off.generated().length, 2, 'cascade stops at the cap');
    const chapters = off.c.state.currentData.episodes.filter(e => e.chronicle?.mode === 'chapter');
    assert.deepEqual(chapters.map(e => e.chronicle.level).sort(), [1, 2], 'second call merged the new chapter one level up');
    assert.deepEqual(injectedCoverageOverlap(off.c.state.currentData.episodes, rows), []);
    // Undo, then auto-merge again: the just-undone input is not merged again.
    const top = chapters.find(e => e.chronicle.level === 2);
    await off.c.undoChronicleMerge(top.id);
    const before = off.generated().length;
    await off.c.maybeAutoMerge();
    const again = off.c.state.currentData.episodes.filter(e => e.chronicle?.mode === 'chapter' && e.chronicle.status === 'approved');
    assert.ok(!again.some(e => e.id !== top.id && e.chronicle.childRefs.map(r => r.id).join() === top.chronicle.childRefs.map(r => r.id).join()), 'no immediate re-merge of the undone input');
    assert.ok(off.generated().length - before <= 2);
});

test('restricted records are never auto-merged and a restricted chapter cannot widen its scope', async () => {
    const restricted = eps().map(e => ({ ...e, event: { ...e.event, knownBy: ['Mina.png'] } }));
    const r = runner(restricted, { autoMergeEnabled: true, mergeCountThreshold: 2, mergeReviewBeforeApply: false, maxCallsPerRun: 3 });
    assert.equal(await r.c.maybeAutoMerge(), 0);
    assert.equal(r.generated().length, 0);
    const review = await r.c.runChronicleMerge(['A', 'B']);
    const draft = r.c.draftFromCandidate(r.c.reviewCandidate(review));
    await assert.rejects(r.c.approveMergeReview(review, draft), /교집합/);
    draft.event.knownBy = ['Mina.png']; draft.facts.forEach(f => { f.knownBy = ['Mina.png']; });
    await r.c.approveMergeReview(review, draft);
    assert.ok(r.c.state.currentData.episodes.some(e => e.chronicle?.mode === 'chapter'));
});
