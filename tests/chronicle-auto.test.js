import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';

const { stMessageRow, buildRange, planAutoScene, normalizeSettings } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

const turn = (i, extra = {}) => ({ is_user: i % 2 === 0, name: i % 2 ? 'Mina' : 'Hana', mes: `line ${i + 1}`, send_date: `2026-10-17T01:${String(i).padStart(2, '0')}:00Z`, ...extra });
const chatOf = n => Array.from({ length: n }, (_, i) => turn(i));
const rowsOf = chat => chat.map(stMessageRow);
const settings = extra => normalizeSettings({ autoEnabled: true, autoEveryResponses: 3, autoBuffer: 1, ...extra });
const scene = (id, rows, s, e, extra = {}) => ({ id, title: id, keywords: [`kw-${id}`], event: { summary: id }, facts: [], chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, s, e), ...extra } });

test('auto plan: K completed responses, recent buffer kept, ends on the assistant line', () => {
    const rows = rowsOf(chatOf(10)); // responses at 1,3,5,7,9
    assert.deepEqual(planAutoScene([], rows, settings({ autoEnabled: false })), { ok: false, reason: 'off' });
    assert.deepEqual(planAutoScene([], rowsOf(chatOf(7)), settings()), { ok: false, reason: 'waiting', have: 3, need: 4, start: 0 });
    assert.deepEqual(planAutoScene([], rows, settings()), { ok: true, start: 0, end: 5, responses: 3 });
    const withA = [scene('A', rows, 0, 5)];
    assert.deepEqual(planAutoScene(withA, rows, settings()), { ok: false, reason: 'waiting', have: 2, need: 4, start: 6 });
});

test('system/empty lines are not turns; swipes do not add turns', () => {
    const chat = chatOf(8);
    chat.splice(2, 0, { is_system: true, name: 'System', mes: 'note', send_date: 'x' }, { is_user: false, name: 'Mina', mes: '   ', send_date: 'y' });
    chat[1].swipe_id = 2; chat[1].swipes = ['a', 'b', 'c'];
    const plan = planAutoScene([], rowsOf(chat), settings());
    assert.equal(plan.ok, true);
    assert.equal(plan.end, 7, 'third real response is chat[7] after the two non-turn lines');
});

test('checkpoint never skips a gap and stops on records needing attention', () => {
    const rows = rowsOf(chatOf(20));
    assert.deepEqual(planAutoScene([scene('B', rows, 8, 11)], rows, settings()), { ok: false, reason: 'gap', gapStart: 0, gapEnd: 7 });
    const stale = scene('A', rows, 0, 5, { status: 'stale', invalidReason: 'x' });
    assert.equal(planAutoScene([stale], rows, settings()).reason, 'not-approved');
    const edited = rows.map((r, i) => (i === 2 ? { ...r, content: 'changed' } : r));
    assert.equal(planAutoScene([scene('A', rows, 0, 5)], edited, settings()).reason, 'unlocated');
});

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const reply = (extra = {}) => JSON.stringify({ title: 'Auto scene', summary: 'They talked.', knownBy: ['all'], lines: [1, 2], facts: [{ text: 'They talked.', knownBy: ['all'], lines: [2] }], keywords: ['talk'], ...extra });
function runner({ chat = chatOf(10), data = {}, answer = async () => ({ content: reply() }) } = {}) {
    globalThis.window = { confirm: () => { throw new Error('auto runs must not ask for confirmation'); } };
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { calls: [], rows: rowsOf(chat), answer };
    const c = core(['state', 'normalizeData', 'maybeAutoScene', 'recoverChronicleJobs', 'chronicleOf', 'autoSceneStatus', 'autoSceneLabel'], host,
        `api = async (path, options = {}) => { host.calls.push({ path, body: options.body === undefined ? undefined : structuredClone(options.body) });
            if (path.includes('/messages')) return structuredClone(host.rows);
            if (path === 'chronicle/connections') return [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }];
            if (path === 'generate/isolated') return host.answer();
            throw new Error('unexpected ' + path); };
         freshOwnedData = async () => structuredClone(state.currentData);
         persistData = async (d) => { state.currentData = normalizeData(d); return state.currentData; };
         ownershipAllowsData = () => true; render = () => {}; toast = () => {};`);
    c.state.chatCharacters = [{ id: 'Mina.png', name: 'Mina' }];
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', metadata: {} }, chronicleRows: host.rows, chronicleRowsChatId: 'chat',
        chronicleConnections: [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }] });
    c.state.currentData = c.normalizeData({ items: [], ...data });
    return { c, host, calls: () => host.calls.filter(x => x.path === 'generate/isolated') };
}
const autoOn = extra => ({ chronicle: { settings: { autoEnabled: true, autoEveryResponses: 3, autoBuffer: 1, ...extra } } });

test('auto scene with review ON: one call without a confirm dialog, candidate only, no duplicate on the next event', async () => {
    const { c, calls } = runner({ data: autoOn() });
    const review = await c.maybeAutoScene();
    assert.equal(calls().length, 1);
    assert.deepEqual(calls()[0].body.guard.startIndex, 0);
    assert.equal(calls()[0].body.guard.endIndex, 5);
    assert.equal(review.status, 'ready');
    assert.equal((c.state.currentData.episodes || []).length, 0);
    assert.deepEqual(c.chronicleOf().jobs, [], 'job ledger cleared once the result is stored');
    assert.equal(await c.maybeAutoScene(), null);
    assert.equal(calls().length, 1, 'pending candidate blocks another paid call');
    assert.match(c.autoSceneLabel(c.autoSceneStatus()), /검토 대기/);
});

test('auto scene with review OFF saves a public candidate, then waits for the next K responses', async () => {
    const { c, calls } = runner({ data: autoOn({ reviewBeforeApply: false }) });
    await c.maybeAutoScene();
    const eps = c.state.currentData.episodes;
    assert.equal(eps.length, 1);
    assert.equal(eps[0].chronicle.status, 'approved');
    assert.equal(eps[0].chronicle.range.count, 6);
    assert.equal(await c.maybeAutoScene(), null);
    assert.equal(calls().length, 1);
    assert.match(c.autoSceneLabel(c.autoSceneStatus()), /완료 응답 2개 남음/);
});

test('review OFF still keeps hidden-line and scope-uncertain candidates for review', async () => {
    const chat = chatOf(10); chat[3].extra = { hiddenFromAICharacterIds: ['Mina.png'] };
    const { c } = runner({ chat, data: autoOn({ reviewBeforeApply: false }) });
    const review = await c.maybeAutoScene();
    assert.equal(review.status, 'ready');
    assert.equal((c.state.currentData.episodes || []).length, 0);
});

test('a request lost to a reload becomes an uncertain failed candidate and is never retried automatically', async () => {
    const rows = rowsOf(chatOf(10));
    const lost = { id: 'chr_lost', startedAt: 'then', auto: true, review: { id: 'chr_lost', kind: 'scene', range: buildRange(rows, 0, 5) } };
    const { c, calls } = runner({ data: { chronicle: { settings: autoOn().chronicle.settings, jobs: [lost] } } });
    assert.equal(await c.maybeAutoScene(), null, 'pending job blocks');
    assert.equal(await c.recoverChronicleJobs(), 1);
    const rv = c.chronicleOf().reviews[0];
    assert.equal(rv.status, 'failed');
    assert.match(rv.reason, /^결과 미확정/);
    assert.deepEqual(c.chronicleOf().jobs, []);
    assert.equal(await c.maybeAutoScene(), null);
    assert.equal(calls().length, 0);
});

test('timeout leaves an uncertain candidate; the next event does not pay again', async () => {
    const { c, calls } = runner({ data: autoOn(), answer: async () => { throw new Error('모델 응답 대기 시간이 초과됐습니다.'); } });
    await assert.rejects(c.maybeAutoScene(), /초과/);
    assert.equal(calls().length, 1);
    assert.match(c.chronicleOf().reviews[0].reason, /^결과 미확정/);
    assert.deepEqual(c.chronicleOf().jobs, []);
    assert.equal(await c.maybeAutoScene(), null);
    assert.equal(calls().length, 1);
});

test('failure classification: network loss is uncertain, server failure is failed, pre-dispatch clears, chat switch keeps the ledger', async () => {
    const cases = [
        [() => { throw new TypeError('Failed to fetch'); }, r => assert.match(r.reviews[0].reason, /^결과 미확정/)],
        [() => { throw new Error('요약 요청 실패 (503). 자동 재시도하지 않습니다.'); }, r => { assert.equal(r.reviews[0].status, 'failed'); assert.doesNotMatch(r.reviews[0].reason, /미확정/); }],
        [() => { throw new Error('선택한 구간의 원문이 바뀌었습니다. 모델을 호출하지 않았습니다.'); }, r => { assert.deepEqual(r.reviews, []); assert.deepEqual(r.jobs, []); }],
        [() => { throw new Error('모델 요청 중 채팅을 전환해 결과를 적용하지 않았습니다.'); }, r => { assert.deepEqual(r.reviews, []); assert.equal(r.jobs.length, 1, 'shown as 결과 미확정 when that chat opens again'); }],
    ];
    for (const [answer, verify] of cases) {
        const { c } = runner({ data: autoOn(), answer: async () => answer() });
        await c.maybeAutoScene().catch(() => {});
        verify(c.chronicleOf());
    }
});
