import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';
import { compileWorldInfo } from '../world-info.js';

// Regression cases for request scope, failed-request retries, merge-candidate
// rendering, dependency closure and graph integrity (fake provider only).
const { stMessageRow, buildRange, evaluateChronicle, blockedChronicleIds, validateMerge, applyMerge, planChronicleInjection, normalizeSettings } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const chat = Array.from({ length: 24 }, (_, i) => ({ is_user: i % 2 === 0, name: i % 2 ? 'Mina' : 'Hana', mes: `line ${i + 1}`, send_date: `2026-10-18T00:${String(i).padStart(2, '0')}:00Z` }));
const rows = chat.map(stMessageRow);
const scene = (id, s, e, extra = {}) => ({ id, title: `scene ${id}`, keywords: [`kw-${id}`], event: { summary: `summary ${id}` }, facts: [],
    chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, s, e), ...extra } });
const chapter = (id, kids, extra = {}) => ({ id, title: `chapter ${id}`, keywords: [`kw-${id}`], event: { summary: `recap ${id}` }, facts: [],
    chronicle: { mode: 'chapter', level: 1, status: 'approved', revision: 1, childRefs: kids.map(k => ({ id: k.id, revision: k.chronicle.revision })), ...extra } });
const states = eps => Object.fromEntries([...evaluateChronicle(eps, rows)].map(([id, r]) => [id, r.state]));
const reasons = eps => Object.fromEntries([...evaluateChronicle(eps, rows)].map(([id, r]) => [id, r.reason]));
const group = [{ id: 'Mina.png', name: 'Mina' }, { id: 'Bo.png', name: 'Bo' }];
const reply = obj => JSON.stringify({ title: 'T', summary: 'S', knownBy: ['all'], lines: [1], facts: [{ text: 'F', knownBy: ['all'], lines: [1] }], keywords: ['k'], ...obj });

function harness({ episodes = [], settings = {}, reviews = [], characters = group, rowsIn = rows, answer = async () => ({ content: reply({}) }), confirm = () => true } = {}) {
    globalThis.window = { confirm };
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { calls: [], rows: rowsIn, answer };
    const c = core(['state', 'normalizeData', 'chronicleRangeLayer', 'chronicleRangeInfo', 'approveMergeReview', 'runChronicleMerge', 'runChronicleScene', 'parseSceneResponse',
        'promptLinesFor', 'buildScenePrompt', 'maybeAutoScene', 'maybeAutoMerge', 'chronicleOf', 'autoSceneStatus', 'autoSceneLabel', 'episodeEntryPlans', 'episodeEntryPayload',
        'reconfirmChronicleNode', 'retryChronicleReview', 'draftFromCandidate', 'reviewCandidate', 'confirmChronicleStandalone'], host,
    `api = async (path, options = {}) => { host.calls.push({ path, body: options.body === undefined ? undefined : structuredClone(options.body) });
        if (path.includes('/messages')) return structuredClone(host.rows);
        if (path === 'chronicle/connections') return [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }];
        if (path === 'generate/isolated') return host.answer(options.body);
        throw new Error('unexpected ' + path); };
     freshOwnedData = async () => structuredClone(state.currentData);
     persistData = async (d) => { state.currentData = normalizeData(d); return state.currentData; };
     ownershipAllowsData = () => true; render = () => {}; toast = () => {};`);
    c.state.chatCharacters = characters;
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', characterIds: characters.map(ch => ch.id), metadata: { groupChatMode: 'individual' } },
        chronicleRows: rowsIn, chronicleRowsChatId: 'chat', chronicleDraft: { start: 0, end: 3, connectionId: 'current', maxTokens: 900 },
        chronicleConnections: [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }] });
    c.state.currentData = c.normalizeData({ items: [], episodes, chronicle: { settings, reviews } });
    return { c, host, generated: () => host.calls.filter(x => x.path === 'generate/isolated') };
}

// ── C1: request scope ──
test('C1 counterexample: a scene whose event and fact have disjoint audiences cannot be merged or approved wider', async () => {
    const split = id => { const ep = scene(id, id === 'A' ? 0 : 2, id === 'A' ? 1 : 3); ep.event.knownBy = ['Mina.png']; ep.facts = [{ text: 'secret only Bo knows', knownBy: ['Bo.png'] }]; return ep; };
    const eps = [split('A'), split('B')];
    const check = validateMerge(eps, rows, ['A', 'B']);
    assert.equal(check.ok, false, 'same list-set signature is not proof of one readable audience');
    assert.match(check.error, /범위/);
    const { c, generated } = harness({ episodes: eps });
    await assert.rejects(c.runChronicleMerge(['A', 'B']), /범위/);
    assert.equal(generated().length, 0, 'refused before any model call');
    // A forged/old candidate cannot be approved either (approval re-validates).
    const forged = { id: 'rv', kind: 'merge', status: 'ready', childRefs: [{ id: 'A', revision: 1 }, { id: 'B', revision: 1 }], inputHash: 'x', contextRefs: [] };
    await assert.rejects(c.approveMergeReview(forged, { title: 'Leaked', event: { summary: 'Mina-only event AND Bo-only secret', knownBy: ['Mina.png', 'Bo.png'] }, facts: [], keywords: ['k'], background: {}, characters: [] }));
    assert.equal(c.state.currentData.episodes.some(e => e.chronicle?.mode === 'chapter'), false);
});

test('C1: same-signature multi-restricted parts merge only inside the per-item intersection', async () => {
    const r = (id, s, e) => { const ep = scene(id, s, e); ep.event.knownBy = ['Mina.png', 'Bo.png']; ep.facts = [{ text: `only Mina ${id}`, knownBy: ['Mina.png'] }]; return ep; };
    const eps = [r('A', 0, 1), r('B', 2, 3)];
    const check = validateMerge(eps, rows, ['A', 'B']);
    assert.equal(check.ok, true, check.error);
    assert.deepEqual(check.audience, ['Mina.png']);
    const { c, generated } = harness({ episodes: eps });
    const review = await c.runChronicleMerge(['A', 'B']);
    assert.equal(generated().length, 1);
    const draft = c.draftFromCandidate(c.reviewCandidate(review));
    draft.event.knownBy = ['Mina.png', 'Bo.png']; draft.facts.forEach(f => { f.knownBy = ['Mina.png']; });
    await assert.rejects(c.approveMergeReview(review, draft), /교집합/, 'event widened to Bo is refused');
    draft.event.knownBy = [];
    await assert.rejects(c.approveMergeReview(review, draft), /교집합/, 'public is a widening too');
    draft.event.knownBy = ['Mina.png'];
    await c.approveMergeReview(review, draft);
    const ch = c.state.currentData.episodes.find(e => e.chronicle?.mode === 'chapter');
    assert.deepEqual(ch.event.knownBy, ['Mina.png']);
});

test('C1: a public part does not widen a restricted part (public/restricted mix narrows to the restricted audience)', () => {
    const mixed = (id, s, e) => { const ep = scene(id, s, e); ep.facts = [{ text: `public ${id}` }, { text: `secret ${id}`, knownBy: ['Mina.png'] }]; return ep; };
    const check = validateMerge([mixed('A', 0, 1), mixed('B', 2, 3)], rows, ['A', 'B']);
    assert.equal(check.ok, true, check.error);
    assert.equal(check.restricted, true);
    assert.deepEqual(check.audience, ['Mina.png']);
    const pub = scene('B', 2, 3);
    assert.match(validateMerge([mixed('A', 0, 1), pub], rows, ['A', 'B']).error, /범위/, 'public with restricted nodes is not merged');
});

test('C1: the regenerate path applies the same audience rule', async () => {
    const split = (id, s, e) => { const ep = scene(id, s, e); ep.event.knownBy = ['Mina.png']; ep.facts = [{ text: 'Bo secret', knownBy: ['Bo.png'] }]; return ep; };
    const A = split('A', 0, 1), B = split('B', 2, 3);
    const eps = [A, B];
    applyMerge(eps, chapter('P', [A, B]), ['A', 'B'], 'now');
    const { c, generated } = harness({ episodes: eps });
    await assert.rejects(c.runChronicleMerge([], { replacesEpisodeId: 'P' }), /범위/);
    assert.equal(generated().length, 0);
});

test('C1: lines hidden from some characters are left out of the request (public projection), not sent with a label', async () => {
    const hiddenChat = chat.slice(0, 4).map((m, i) => (i === 1 ? { ...m, mes: 'SECRET key under floor', extra: { hiddenFromAICharacterIds: ['Bo.png'] } } : m));
    const hiddenRows = hiddenChat.map(stMessageRow);
    const { c, generated } = harness({ rowsIn: hiddenRows });
    const lines = c.promptLinesFor(hiddenRows, 0, 3);
    assert.equal(lines.some(l => l.content.includes('SECRET')), false);
    const info = c.chronicleRangeInfo();
    assert.equal(info.excludedHidden, 1);
    assert.doesNotMatch(JSON.stringify(info.messages), /SECRET|not seen by/);
    // Probe: the model cites a visible line for a secret; the secret never reached it.
    const cand = c.parseSceneResponse(reply({ facts: [{ text: 'SECRET key under floor', knownBy: ['all'], lines: [2] }] }), lines);
    assert.ok(cand);
    await c.runChronicleScene();
    assert.equal(generated().length, 1);
    assert.doesNotMatch(JSON.stringify(generated()[0].body.messages), /SECRET|not seen by/);
    assert.equal(generated()[0].body.guard.startIndex, 0, 'the record still covers the whole selected range');
    assert.equal(generated()[0].body.guard.endIndex, 3);
    assert.throws(() => c.buildScenePrompt([{ n: 1, index: 1, speaker: 'Mina', content: 'x', hiddenFrom: ['Bo.png'] }], { text: '', refs: [] }), /숨긴/, 'defensive: a hidden line can never be formatted into a request');
});

test('C1: a range made only of hidden lines is refused before the call', async () => {
    const allHidden = chat.slice(0, 2).map(m => ({ ...m, extra: { hiddenFromAICharacterIds: ['Bo.png'] } })).map(stMessageRow);
    const { c, generated } = harness({ rowsIn: allHidden });
    c.state.chronicleDraft = { start: 0, end: 1, connectionId: 'current', maxTokens: 900 };
    await assert.rejects(c.runChronicleScene(), /줄이 없/);
    assert.equal(generated().length, 0);
});

// ── C2: no automatic re-request after a failure ──
test('C2 counterexample: a server failure is not re-requested by the next automatic event or after reload', async () => {
    let n = 0;
    const settings = { autoEnabled: true, autoEveryResponses: 2, autoBuffer: 0 };
    const { c, generated } = harness({ characters: [{ id: 'Mina.png', name: 'Mina' }], episodes: [scene('seed', 0, 1)], settings,
        answer: async () => { n += 1; throw new Error('요약 요청 실패 (500). 자동 재시도하지 않습니다.'); } });
    await c.maybeAutoScene().catch(() => {});
    assert.equal(generated().length, 1);
    assert.equal(c.chronicleOf().reviews[0].status, 'failed');
    await c.maybeAutoScene().catch(() => {});
    assert.equal(generated().length, 1, 'next event: no second paid call for the same range');
    c.state.currentData = c.normalizeData(structuredClone(c.state.currentData));
    await c.maybeAutoScene().catch(() => {});
    assert.equal(generated().length, 1, 'reload does not reopen the retry');
    assert.match(c.autoSceneLabel(c.autoSceneStatus()), /실패/);
    assert.equal(n, 1);
});

test('C2: parse failures and over-long answers also stop automation', async () => {
    for (const content of ['not json', reply({ summary: 'x'.repeat(2001) })]) {
        const { c, generated } = harness({ characters: [{ id: 'Mina.png', name: 'Mina' }], episodes: [scene('seed', 0, 1)], settings: { autoEnabled: true, autoEveryResponses: 2, autoBuffer: 0 }, answer: async () => ({ content }) });
        await c.maybeAutoScene();
        await c.maybeAutoScene();
        assert.equal(generated().length, 1);
        assert.equal(c.chronicleOf().reviews[0].status, 'failed');
    }
});

test('C2: a failed merge is not re-requested by auto-merge; only the explicit retry calls again', async () => {
    const eps = [scene('A', 0, 3), scene('B', 4, 7), scene('C', 8, 11), scene('D', 12, 15)];
    let fail = true;
    const { c, generated } = harness({ characters: [{ id: 'Mina.png', name: 'Mina' }], episodes: eps, settings: { autoMergeEnabled: true, mergeCountThreshold: 3, maxCallsPerRun: 3 },
        answer: async () => { if (fail) throw new Error('요약 요청 실패 (500). 자동 재시도하지 않습니다.'); return { content: JSON.stringify({ title: 'M', summary: 'S', knownBy: ['all'], facts: [], keywords: ['m'] }) }; } });
    await c.maybeAutoMerge();
    assert.equal(generated().length, 1, 'one failed call, cascade stopped');
    const failed = c.chronicleOf().reviews[0];
    assert.equal(failed.status, 'failed');
    await c.maybeAutoMerge();
    await c.maybeAutoMerge();
    const sameInput = generated().filter(g => g.body.messages[1].content.includes('scene A'));
    assert.equal(sameInput.length, 1, 'the failed input is never auto-requested again');
    fail = false;
    await c.retryChronicleReview(failed.id);
    assert.equal(generated().filter(g => g.body.messages[1].content.includes('scene A')).length, 2, 'user retry is the only re-call');
});

// ── C3: range view with a pending merge candidate ──
test('C3 counterexample: the range view renders while a merge candidate waits for review', () => {
    const eps = [scene('A', 0, 1), scene('B', 2, 3)];
    const check = validateMerge(eps, rows, ['A', 'B']);
    const rv = { id: 'rv', kind: 'merge', status: 'ready', childRefs: [{ id: 'A', revision: 1 }, { id: 'B', revision: 1 }], inputHash: check.inputHash, contextRefs: [], candidate: { title: 'M' } };
    const { c } = harness({ episodes: eps, reviews: [rv] });
    c.state.chronicleDraft = { start: 4, end: 7, connectionId: 'current', maxTokens: 900 };
    const html = c.chronicleRangeLayer();
    assert.match(html, /구간 기록 만들기/);
    assert.match(html, /data-action="chronicle-run"(?![^>]*disabled)/, 'a different range can still be requested');
});

// ── C4: dependency closure ──
const plan = (eps, extra = {}, tokens = 100) => {
    const r = planChronicleInjection(eps, rows, normalizeSettings({ recentScenes: 1, recentChapters: 0, budgetTokens: 2400, oldDetailTokens: 700, ...extra }), () => tokens);
    return Object.fromEntries([...r.plan].map(([id, e]) => [id, `${e.mode}:${e.reason}`]));
};
const chain = () => [scene('A', 0, 1), scene('B', 2, 3, { contextRefs: [{ id: 'A', revision: 1 }] }), scene('C', 4, 5, { contextRefs: [{ id: 'B', revision: 1 }] })];

test('C4 counterexample: a three-step chain is closed transitively', () => {
    assert.deepEqual(plan(chain()), { A: 'constant:dependency', B: 'constant:dependency', C: 'constant:recent' });
});

test('C4: when the closure does not fit, the dependent is held, never keyword-only', () => {
    const tight = plan(chain(), { budgetTokens: 950, oldDetailTokens: 700 });
    assert.deepEqual(tight, { A: 'keyword:older', B: 'held:dependency-not-included', C: 'held:dependency-budget' });
});

test('C4: an older record with dependencies is never keyword-only on its own', () => {
    const eps = [...chain(), scene('D', 6, 7)];
    assert.deepEqual(plan(eps), { A: 'keyword:older', B: 'held:dependency-not-included', C: 'held:dependency-not-included', D: 'constant:recent' });
});

test('C4: a merged representative brings its own dependencies (recursive through chapters)', () => {
    const A = scene('A', 0, 1), B = scene('B', 2, 3, { contextRefs: [{ id: 'A', revision: 1 }] }), C = scene('C', 4, 5, { contextRefs: [{ id: 'B', revision: 1 }] });
    const D = scene('D', 6, 7, { contextRefs: [{ id: 'C', revision: 1 }] });
    const eps = [A, B, C, D];
    applyMerge(eps, chapter('P', [A, B]), ['A', 'B'], 'now');
    // Q = C + D; C was written against B (inside P), so Q depends on P.
    applyMerge(eps, chapter('Q', [C, D]), ['C', 'D'], 'now');
    const E = scene('E', 8, 9, { contextRefs: [{ id: 'D', revision: 1 }] });
    eps.push(E);
    assert.deepEqual(plan(eps), { P: 'constant:dependency', Q: 'constant:dependency', E: 'constant:recent' });
});

test('C4: a user-confirmed standalone record breaks the chain and may be keyword-only', () => {
    const eps = chain();
    eps[1].chronicle.standaloneRevision = 1;
    assert.deepEqual(plan(eps, { budgetTokens: 850, oldDetailTokens: 700 }), { A: 'keyword:older', B: 'keyword:older', C: 'held:dependency-budget' });
    assert.deepEqual(plan(eps, { budgetTokens: 1000, oldDetailTokens: 700 }), { A: 'keyword:older', B: 'constant:dependency', C: 'constant:recent' });
    eps[1].chronicle.revision = 2; // an edit after the confirmation voids it
    eps[2].chronicle.contextRefs = [{ id: 'B', revision: 2 }];
    assert.equal(plan(eps).B, 'constant:dependency');
});

test('C4: WI order puts every dependency ahead of its dependent, so a native budget cut drops the dependent first', () => {
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const { c } = harness({ characters: [], episodes: chain(), settings: { recentScenes: 1, recentChapters: 0 } });
    const plans = c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData);
    const entries = Object.fromEntries(plans.map((p, i) => [p.episodeId, { ...c.episodeEntryPayload({ id: 'chat' }, p, true), id: i }]));
    const compiled = compileWorldInfo({ chatId: 'chat', entries: Object.fromEntries(Object.values(entries).map(e => [e.id, e])) }, {}, { characters: [], mode: 'swap' });
    const stOrder = id => compiled.entries[entries[id].id].order;
    assert.ok(stOrder('A') > stOrder('B') && stOrder('B') > stOrder('C'), 'ST sorts by order descending and stops at the first budget overflow');
    const held = harness({ characters: [], episodes: [...chain(), scene('D', 6, 7)], settings: { recentScenes: 1, recentChapters: 0 } });
    assert.deepEqual(held.c.episodeEntryPlans({ id: 'chat', metadata: {} }, held.c.state.currentData).map(p => p.episodeId).sort(), ['A', 'D'], 'held records have no entry');
});

// ── C5: graph integrity ──
test('C5 counterexample: a chapter whose children lack the archive backlink is held with its children', () => {
    const X = scene('X', 0, 1), Y = scene('Y', 2, 3);
    const eps = [X, Y, chapter('P', [X, Y])];
    assert.deepEqual(states(eps), { X: 'held', Y: 'held', P: 'held' });
    assert.equal(reasons(eps).P, 'graph-invalid');
    assert.deepEqual([...blockedChronicleIds(eps, rows)].sort(), ['P', 'X', 'Y']);
});

test('C5 counterexample: different records over overlapping messages are both held', () => {
    const eps = [scene('X', 0, 4), scene('Y', 3, 6)];
    assert.deepEqual(states(eps), { X: 'held', Y: 'held' });
    assert.equal(reasons(eps).X, 'coverage-overlap');
    assert.deepEqual([...blockedChronicleIds(eps, rows)].sort(), ['X', 'Y']);
});

test('C5: two live parents, an orphan backlink, a gap between children and a cycle are all held', () => {
    const X = scene('X', 0, 1), Y = scene('Y', 2, 3), Z = scene('Z', 4, 5);
    const twoParents = [X, Y, Z];
    applyMerge(twoParents, chapter('P', [X, Y]), ['X', 'Y'], 'now');
    twoParents.push(chapter('Q', [Y, Z]));
    Z.chronicle.archivedBy = 'Q';
    assert.equal(states(twoParents).P, 'held');
    assert.equal(states(twoParents).Q, 'held');
    const orphan = [scene('X', 0, 1), scene('Y', 2, 3), scene('W', 4, 5, { archivedBy: 'P' })];
    applyMerge(orphan, chapter('P', [orphan[0], orphan[1]]), ['X', 'Y'], 'now');
    assert.equal(states(orphan).P, 'held', 'a node archived under P that P does not list');
    assert.equal(evaluateChronicle(orphan, rows).get('W').own, 'held', 'kept out of injection, never re-activated');
    assert.equal(blockedChronicleIds(orphan, rows).has('W'), true);
    const gap = [scene('X', 0, 1), scene('Y', 4, 5)];
    applyMerge(gap, chapter('P', [gap[0], gap[1]]), ['X', 'Y'], 'now');
    assert.equal(states(gap).P, 'held');
    assert.equal(reasons(gap).P, 'coverage-invalid');
    const a = scene('X', 0, 1), b = scene('Y', 2, 3);
    const cyc = [a, b];
    const P = chapter('P', [a, b]); const Q = chapter('Q', [P, scene('Z', 4, 5)]);
    applyMerge(cyc, P, ['X', 'Y'], 'now');
    P.chronicle.childRefs.push({ id: 'Q', revision: 1 }); Q.chronicle.archivedBy = 'P'; P.chronicle.archivedBy = 'Q';
    cyc.push(Q);
    assert.ok(['held', 'archived'].includes(states(cyc).P) && states(cyc).Q !== 'approved');
    assert.equal(blockedChronicleIds(cyc, rows).has('Q'), true);
});

test('C5: a normal merged tree stays approved; reconfirm cannot revive a structurally invalid chapter', async () => {
    const X = scene('X', 0, 1), Y = scene('Y', 2, 3);
    const ok = [X, Y];
    applyMerge(ok, chapter('P', [X, Y]), ['X', 'Y'], 'now');
    assert.deepEqual(states(ok), { X: 'archived', Y: 'archived', P: 'approved' });
    const broken = [scene('X', 0, 1), scene('Y', 2, 3)];
    broken.push(chapter('P', [broken[0], broken[1]], { status: 'held', invalidReason: 'imported' }));
    const { c } = harness({ episodes: broken });
    await assert.rejects(c.reconfirmChronicleNode('P'), /연결|구조/);
    assert.equal(states(c.state.currentData.episodes).P, 'held');
});

test('C4: the standalone confirmation is a user action on this revision only', async () => {
    let asked = 0;
    const { c } = harness({ characters: [], episodes: chain(), settings: { recentScenes: 1, recentChapters: 0, budgetTokens: 720, oldDetailTokens: 700 }, confirm: () => { asked += 1; return true; } });
    const before = c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId);
    assert.deepEqual(before, ['A'], 'B and C rely on earlier records and do not fit: held');
    await c.confirmChronicleStandalone('B');
    assert.equal(asked, 1);
    const b = c.state.currentData.episodes.find(e => e.id === 'B');
    assert.equal(b.chronicle.standaloneRevision, 1);
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId).sort(), ['A', 'B'], 'B may now go in by keyword; C still needs B in the same request');
});
