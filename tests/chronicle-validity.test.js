import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';
import { compileWorldInfo } from '../world-info.js';

const { buildRange, stMessageRow, evaluateChronicle, blockedChronicleIds } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const chat = Array.from({ length: 12 }, (_, i) => ({ is_user: i % 2 === 0, name: i % 2 ? 'Mina' : 'Hana', mes: `line ${i + 1}`, send_date: `2026-10-17T00:${String(i).padStart(2, '0')}:00Z` }));
const rowsOf = list => list.map(stMessageRow);
const scene = (id, start, end, extra = {}, list = chat) => ({ id, title: `scene ${id}`, keywords: [`kw-${id}`], event: { summary: `summary ${id}` }, facts: [], createdAt: '2026-01-01T00:00:00Z',
    chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rowsOf(list), start, end), ...extra } });

test('source edits stale the scene; deltas that referenced it go stale transitively', () => {
    const eps = [scene('a', 0, 3), scene('b', 4, 7, { contextRefs: [{ id: 'a', revision: 1 }] }), scene('c', 8, 11, { contextRefs: [{ id: 'b', revision: 1 }] })];
    const edited = chat.map((m, i) => (i === 2 ? { ...m, mes: 'changed' } : m));
    const ev = evaluateChronicle(eps, rowsOf(edited));
    assert.deepEqual([...ev].map(([id, r]) => [id, r.state, r.reason]), [['a', 'stale', 'source-changed'], ['b', 'stale', 'dependency-changed'], ['c', 'stale', 'dependency-changed']]);
    assert.deepEqual([...blockedChronicleIds(eps, rowsOf(chat))], []);
    const swiped = chat.map((m, i) => (i === 5 ? { ...m, swipe_id: 1 } : m));
    assert.equal(evaluateChronicle(eps, rowsOf(swiped)).get('b').reason, 'source-changed');
    const deletedMiddle = chat.filter((_, i) => i !== 6);
    assert.equal(evaluateChronicle(eps, rowsOf(deletedMiddle)).get('b').state, 'stale');
    const deletedBefore = chat.slice(1);
    assert.equal(evaluateChronicle([scene('b', 4, 7)], rowsOf(deletedBefore)).get('b').state, 'approved', 'a deletion before the range only moves it');
});

test('editing (revision bump) or deleting a referenced scene stales its dependents; restore heals', () => {
    const a = scene('a', 0, 3);
    const b = scene('b', 4, 7, { contextRefs: [{ id: 'a', revision: 1 }] });
    assert.equal(evaluateChronicle([{ ...a, chronicle: { ...a.chronicle, revision: 2 } }, b], rowsOf(chat)).get('b').state, 'stale');
    const deleted = { ...a, chronicle: { ...a.chronicle, status: 'deleted', statusBeforeDelete: 'approved' } };
    const ev = evaluateChronicle([deleted, b], rowsOf(chat));
    assert.equal(ev.get('a').state, 'deleted');
    assert.equal(ev.get('b').state, 'stale');
    assert.equal(evaluateChronicle([a, b], rowsOf(chat)).get('b').state, 'approved');
});

function harness(data, list = chat, extraNames = []) {
    globalThis.window = { confirm: () => true };
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { rows: rowsOf(list), saves: [] };
    const c = core(['state', 'normalizeData', 'refreshChronicleValidity', 'reconfirmChronicleNode', 'deleteChronicleNode', 'restoreChronicleNode', 'purgeChronicleNode', 'saveEpisodeDraft', 'episodeEntryPlans', 'priorContextFor', 'episodeEntryPayload', ...extraNames], host,
        `api = async (path) => { if (path.includes('/messages')) return structuredClone(host.rows); throw new Error('unexpected ' + path); };
         freshOwnedData = async () => structuredClone(state.currentData);
         persistData = async (d) => { host.saves.push(structuredClone(d)); state.currentData = normalizeData(d); return state.currentData; };
         ownershipAllowsData = () => true; render = () => {}; toast = () => {};`);
    c.state.chatCharacters = [{ id: 'Mina.png', name: 'Mina' }];
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', metadata: {} },
        currentData: c.normalizeData({ items: [], ...data }), chronicleRows: host.rows, chronicleRowsChatId: 'chat' });
    return { c, host };
}
const statusOf = (c, id) => c.state.currentData.episodes.find(e => e.id === id).chronicle;

test('refresh persists stale/held status and the WI plan drops it immediately', async () => {
    const edited = chat.map((m, i) => (i === 1 ? { ...m, mes: 'edited' } : m));
    const { c, host } = harness({ episodes: [scene('a', 0, 3), scene('b', 4, 7, { contextRefs: [{ id: 'a', revision: 1 }] })] }, edited);
    const plansBefore = c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId);
    assert.deepEqual(plansBefore, [], 'live evaluation already withholds both');
    c.state.chronicleRows = rowsOf(chat);
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId).sort(), ['a', 'b'], 'control: unedited source injects');
    c.state.chronicleRows = host.rows;
    assert.equal(await c.refreshChronicleValidity(), true);
    assert.equal(host.saves.length, 1);
    assert.deepEqual([statusOf(c, 'a').status, statusOf(c, 'a').invalidReason], ['stale', 'source-changed']);
    assert.deepEqual([statusOf(c, 'b').status, statusOf(c, 'b').invalidReason], ['stale', 'dependency-changed']);
    assert.equal(await c.refreshChronicleValidity(), false, 'no repeated writes');
    c.state.chronicleRowsChatId = '';
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData), [], 'persisted status alone also withholds');
});

test('원문 대조 restores an imported scene only when the source still matches', async () => {
    const imported = scene('a', 0, 3, { status: 'held', invalidReason: 'imported' });
    const { c } = harness({ episodes: [imported] });
    await c.reconfirmChronicleNode('a');
    assert.deepEqual([statusOf(c, 'a').status, statusOf(c, 'a').invalidReason], ['approved', '']);
    const other = chat.map((m, i) => (i < 4 ? { ...m, mes: `other ${i}` } : m));
    const h2 = harness({ episodes: [imported] }, other);
    await assert.rejects(h2.c.reconfirmChronicleNode('a'), /원문이 바뀌어/);
    assert.equal(statusOf(h2.c, 'a').status, 'held');
    globalThis.window = { confirm: () => false };
    const h3 = harness({ episodes: [imported] });
    globalThis.window = { confirm: () => false };
    await h3.c.reconfirmChronicleNode('a');
    assert.equal(statusOf(h3.c, 'a').status, 'held', 'declining keeps it held');
});

test('dependency-stale delta can be re-confirmed as standalone, updating its reference revision', async () => {
    const a = scene('a', 0, 3, { revision: 2 });
    const b = scene('b', 4, 7, { status: 'stale', invalidReason: 'dependency-changed', contextRefs: [{ id: 'a', revision: 1 }] });
    const { c } = harness({ episodes: [a, b] });
    await c.reconfirmChronicleNode('b');
    assert.equal(statusOf(c, 'b').status, 'approved');
    assert.deepEqual(statusOf(c, 'b').contextRefs.map(r => [r.id, r.revision]), [['a', 2]]);
});

test('delete is a tombstone with restore; purge only after delete; dependents follow', async () => {
    const { c } = harness({ episodes: [scene('a', 0, 3), scene('b', 4, 7, { contextRefs: [{ id: 'a', revision: 1 }] })] });
    await c.deleteChronicleNode('a');
    assert.equal(statusOf(c, 'a').status, 'deleted');
    assert.equal(statusOf(c, 'a').statusBeforeDelete, 'approved');
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId), []);
    await c.restoreChronicleNode('a');
    assert.equal(statusOf(c, 'a').status, 'approved');
    assert.deepEqual(c.episodeEntryPlans({ id: 'chat', metadata: {} }, c.state.currentData).map(p => p.episodeId).sort(), ['a', 'b']);
    await c.purgeChronicleNode('a');
    assert.ok(c.state.currentData.episodes.some(e => e.id === 'a'), 'purge needs a tombstone first');
    await c.deleteChronicleNode('a');
    await c.purgeChronicleNode('a');
    assert.ok(!c.state.currentData.episodes.some(e => e.id === 'a'));
});

test('keyword-only edits keep the revision; content edits bump it and stale dependents', async () => {
    const a = scene('a', 0, 3);
    const { c } = harness({ episodes: [a, scene('b', 4, 7, { contextRefs: [{ id: 'a', revision: 1 }] })] });
    const fields = { 'mmc-ep-title': 'scene a', 'mmc-ep-summary': 'summary a', 'mmc-ep-keywords': 'a, library' };
    globalThis.document = { getElementById: id => (id in fields ? { value: fields[id] } : null), querySelectorAll: () => [], querySelector: () => null };
    c.state.episodeDraft = structuredClone(c.state.currentData.episodes[0]);
    await c.saveEpisodeDraft();
    assert.equal(statusOf(c, 'a').revision, 1);
    assert.deepEqual(c.state.currentData.episodes[0].keywords, ['a', 'library']);
    fields['mmc-ep-summary'] = 'summary a, corrected';
    c.state.episodeDraft = structuredClone(c.state.currentData.episodes[0]);
    await c.saveEpisodeDraft();
    assert.equal(statusOf(c, 'a').revision, 2);
    assert.equal(evaluateChronicle(c.state.currentData.episodes, rowsOf(chat)).get('b').state, 'stale');
});

test('privacy rechecks: restricted scenes never become prior context; merged-group (APPEND) and unresolved IDs never inject', () => {
    const restricted = scene('secret', 0, 3, {});
    restricted.facts = [{ text: 'Mina hid the key', knownBy: ['Mina.png'] }];
    const open = scene('open', 4, 7);
    const { c } = harness({ episodes: [restricted, open] });
    const prior = c.priorContextFor(c.state.currentData, 8);
    assert.deepEqual(prior.refs.map(r => r.id), ['open']);
    assert.doesNotMatch(prior.text, /hid the key/);
    // APPEND group: restricted plan is disabled.
    c.state.currentChat = { id: 'chat', characterIds: ['Mina.png', 'Bo.png'], metadata: { groupChatMode: 'merged' } };
    c.state.chatCharacters = [{ id: 'Mina.png', name: 'Mina' }, { id: 'Bo.png', name: 'Bo' }];
    const plans = c.episodeEntryPlans(c.state.currentChat, c.state.currentData);
    const secretPlan = plans.find(p => p.episodeId === 'secret' && p.scopeKey !== 'main');
    assert.ok(secretPlan);
    assert.equal(secretPlan.enabled, false);
    // Unresolved ID in scope: the compiled native entry is disabled.
    const payload = c.episodeEntryPayload({ id: 'chat' }, { ...secretPlan, scope: ['Ghost.png'], enabled: true }, true);
    const compiled = compileWorldInfo({ chatId: 'chat', entries: { 0: { ...payload, id: 0 } } }, {}, { characters: [{ avatar: 'Mina.png' }], mode: 'swap' });
    assert.equal(compiled.entries[0].disable, true);
});
