import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';
import { parseImport, exportData } from '../migration.js';
import { createHost } from '../host.js';

const { stMessageRow, messageFingerprint, strongHash, buildRange, sliceHash, normalizeChronicleState, assertReviewRoom, MAX_REVIEWS } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
// Group chat: Mina and Bo. Line 2 is hidden from Bo.
const chat = [
    { is_user: true, name: 'Hana', mes: 'Mina, come here.', send_date: '2026-10-17T00:00:00Z' },
    { is_user: false, name: 'Mina', mes: 'Mina whispers: the key is under the floor.', send_date: '2026-10-17T00:01:00Z', extra: { hiddenFromAICharacterIds: ['Bo.png'] } },
    { is_user: false, name: 'Bo', mes: 'Bo walks in and asks about dinner.', send_date: '2026-10-17T00:02:00Z' },
];
const rows = chat.map(stMessageRow);
const characters = [{ id: 'Mina.png', name: 'Mina' }, { id: 'Bo.png', name: 'Bo' }];
const publicReply = (extra = {}) => JSON.stringify({ title: 'Whisper', summary: 'Mina told Hana the key is under the floor; Bo asked about dinner.', knownBy: ['all'], lines: [1, 2, 3],
    facts: [{ text: 'The key is under the floor.', knownBy: ['all'], lines: [2] }, { text: 'Bo asked about dinner.', knownBy: ['all'], lines: [3] }], keywords: ['key'], ...extra });

function runner({ reply = async () => ({ content: publicReply() }), reviews = [], dom = null } = {}) {
    globalThis.window = { confirm: () => true };
    globalThis.document = dom || { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { calls: [], rows, reply };
    const c = core(['state', 'normalizeData', 'runChronicleScene', 'chronicleOf', 'promptLinesFor', 'buildScenePrompt', 'parseSceneResponse', 'saveChronicleReview', 'captureChronicleCandidate', 'reviewCandidate', 'readableMessages'], host,
        `api = async (path, options = {}) => { host.calls.push({ path, body: options.body === undefined ? undefined : structuredClone(options.body) });
            if (path.includes('/messages')) return structuredClone(host.rows);
            if (path === 'generate/isolated') return host.reply();
            throw new Error('unexpected ' + path); };
         freshOwnedData = async () => structuredClone(state.currentData);
         persistData = async (d) => { state.currentData = normalizeData(d); return state.currentData; };
         render = () => {}; toast = () => {};`);
    c.state.chatCharacters = characters;
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', characterIds: ['Mina.png', 'Bo.png'], metadata: { groupChatMode: 'individual' } },
        chronicleRows: rows, chronicleRowsChatId: 'chat', chronicleConnections: [{ id: 'current', label: 'cur', supported: true, source: 'custom', model: 'fake' }] });
    c.state.currentData = c.normalizeData({ items: [], chronicle: { reviews } });
    return { c, generated: () => host.calls.filter(x => x.path === 'generate/isolated') };
}

// ── C1 ──
test('host rows keep per-character hidden IDs; visible lines keep their old fingerprint', () => {
    assert.deepEqual(rows[1].extra, { hiddenFromAICharacterIds: ['Bo.png'] });
    assert.equal(rows[0].extra, undefined);
    const old = r => strongHash([r.role, r.activeSwipeIndex, r.createdAt, r.name, r.content].join('␟'));
    assert.equal(messageFingerprint(rows[0]), old(rows[0]), 'stored ranges over visible lines stay valid');
    assert.notEqual(messageFingerprint(rows[1]), old(rows[1]));
    const unhidden = stMessageRow({ ...chat[1], extra: {} }, 1);
    assert.notEqual(messageFingerprint(unhidden), messageFingerprint(rows[1]), 'changing who may see a line is a source change');
    assert.notEqual(sliceHash([rows[0], unhidden, rows[2]], 0, 2), sliceHash(rows, 0, 2));
});

test('host messages API exposes the restriction, so older readers (대화에서/요소/위키) now skip hidden lines', async () => {
    const ctx = { chatId: 'c', characterId: 0, characters: [{ avatar: 'Mina.png' }], chatMetadata: { integrity: 'x' }, chat, getRequestHeaders: () => ({}) };
    const host = createHost({ getContext: () => ctx });
    const id = host.getCurrentChatId();
    const listed = await host.api(`chats/${encodeURIComponent(id)}/messages`);
    assert.deepEqual(listed[1].extra, { hiddenFromAICharacterIds: ['Bo.png'] });
    const { c } = runner();
    assert.deepEqual(c.readableMessages(listed, 'source').map(r => r.content), [chat[0].mes, chat[2].mes]);
});

test('a model answer of knownBy all cannot launder a hidden line as public (group fixture)', () => {
    const { c } = runner();
    const lines = c.promptLinesFor(rows, 0, 2);
    assert.deepEqual(lines[1].hiddenFrom, ['Bo.png']);
    assert.match(c.buildScenePrompt(lines, { text: '', refs: [] })[1].content, /\[2\] Mina \(not seen by Bo\): Mina whispers/);
    const cand = c.parseSceneResponse(publicReply(), lines);
    assert.equal(cand.scopeNeedsReview, true);
    assert.deepEqual(cand.event.knownByIds, ['Mina.png'], 'event drawn from the whole range excludes Bo');
    assert.deepEqual(cand.event.hiddenFrom, ['Bo.png']);
    assert.deepEqual(cand.facts[0].knownByIds, ['Mina.png'], 'fact citing the hidden line excludes Bo');
    assert.deepEqual(cand.facts[1].knownByIds, [], 'fact citing only visible lines stays as the model said');
    assert.deepEqual(cand.facts[1].hiddenFrom, []);
});

function fakeDom({ values = {}, checked = {}, scopes = {} }) {
    const boxes = Object.entries(scopes).flatMap(([key, ids]) => { const [kind, index] = key.split('|'); return characters.map(ch => ({ kind, index, checked: ids.includes(ch.id), dataset: { scopeChar: ch.id } })); });
    const match = sel => { const m = sel.match(/data-scope-kind="([^"]+)"\]\[data-scope-index="([^"]+)"/); return m ? boxes.filter(b => b.kind === m[1] && b.index === m[2] && (!sel.includes(':checked') || b.checked)) : []; };
    return { getElementById: id => (id in values ? { value: values[id] } : id in checked ? { checked: checked[id] } : null), querySelectorAll: sel => match(sel), querySelector: sel => match(sel)[0] || null };
}

test('widening a hidden-line scope to include Bo or everyone needs explicit confirmation at approval', async () => {
    const values = { 'mmc-chr-title': 'Whisper', 'mmc-chr-summary': 'Mina told Hana a secret.', 'mmc-chr-fact-text-0': 'The key is under the floor.', 'mmc-chr-fact-text-1': 'Bo asked about dinner.' };
    const base = { 'mmc-chr-fact-keep-0': true, 'mmc-chr-fact-keep-1': true, 'mmc-chr-public-ok': true };
    const make = (checked, scopes) => { const r = runner({ dom: fakeDom({ values, checked: { ...base, ...checked }, scopes }) }); return r; };
    const { c } = make({}, {});
    const lines = c.promptLinesFor(rows, 0, 2);
    const rv = { candidate: c.parseSceneResponse(publicReply(), lines) };
    const scopesWide = { 'chrdraft-event|0': ['Mina.png'], 'chrdraft-fact|0': ['Mina.png', 'Bo.png'], 'chrdraft-fact|1': [] };
    const wide = make({}, scopesWide);
    await assert.rejects(async () => wide.c.captureChronicleCandidate(rv), /숨김 대상|숨긴 줄/);
    const publicEvent = make({}, { 'chrdraft-event|0': [], 'chrdraft-fact|0': ['Mina.png'], 'chrdraft-fact|1': [] });
    await assert.rejects(async () => publicEvent.c.captureChronicleCandidate(rv), /숨긴 줄/, 'making the event public is a widening too');
    const confirmed = make({ 'mmc-chr-widen-ok': true }, scopesWide);
    assert.deepEqual(confirmed.c.captureChronicleCandidate(rv).facts[0].knownBy, ['Mina.png', 'Bo.png']);
    const narrow = make({}, { 'chrdraft-event|0': ['Mina.png'], 'chrdraft-fact|0': ['Mina.png'], 'chrdraft-fact|1': [] });
    assert.deepEqual(narrow.c.captureChronicleCandidate(rv).event.knownBy, ['Mina.png']);
});

test('restriction survives storage: a reloaded review keeps hiddenFrom', async () => {
    const { c } = runner();
    c.state.chronicleDraft = { start: 0, end: 2, connectionId: 'current', maxTokens: 900 };
    await c.runChronicleScene();
    const stored = c.chronicleOf().reviews[0];
    assert.ok(stored, 'review stored');
    const again = c.reviewCandidate(stored);
    assert.deepEqual(again.event.hiddenFrom, ['Bo.png']);
    assert.deepEqual(again.facts[0].hiddenFrom, ['Bo.png']);
    assert.deepEqual(again.facts[0].knownByIds, ['Mina.png']);
});

// ── C2 ──
const fullReviews = () => Array.from({ length: MAX_REVIEWS }, (_, i) => ({ id: `paid-${i}`, kind: 'scene', status: 'ready', range: buildRange(rows, 0, 0), candidate: { title: `c${i}` } }));
test('12 pending candidates: the 13th run is refused before any model call and nothing is evicted', async () => {
    const { c, generated } = runner({ reviews: fullReviews() });
    c.state.chronicleDraft = { start: 0, end: 2, connectionId: 'current', maxTokens: 900 };
    await assert.rejects(c.runChronicleScene(), /12개/);
    assert.equal(generated().length, 0);
    assert.deepEqual(c.chronicleOf().reviews.map(r => r.id), fullReviews().map(r => r.id));
    await assert.rejects(c.saveChronicleReview({ id: 'paid-12', kind: 'scene', status: 'ready', range: buildRange(rows, 0, 0) }), /그대로/);
    assert.equal(c.chronicleOf().reviews.length, 12);
    assert.equal(c.chronicleOf().reviews[0].id, 'paid-0');
    const eleven = runner({ reviews: fullReviews().slice(1) });
    eleven.c.state.chronicleDraft = { start: 0, end: 2, connectionId: 'current', maxTokens: 900 };
    await eleven.c.runChronicleScene();
    assert.equal(eleven.generated().length, 1);
    assert.equal(eleven.c.chronicleOf().reviews.length, 12);
});

test('normalization never drops candidates; size is checked before the call', () => {
    const thirteen = [...fullReviews(), { id: 'paid-12', kind: 'scene', status: 'ready', range: buildRange(rows, 0, 0) }];
    assert.equal(normalizeChronicleState({ reviews: thirteen }).reviews.length, 13);
    const big = { chronicle: { reviews: [] }, episodes: Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, title: 't', event: { summary: 'x'.repeat(70000) }, chronicle: { mode: 'range', range: buildRange(rows, 0, 0) } })) };
    assert.throws(() => assertReviewRoom(big, 1200), /공간이 부족/);
    assert.doesNotThrow(() => assertReviewRoom({ chronicle: { reviews: [] }, episodes: [] }, 1200));
});

// ── C3 ──
test('summary length is validated before normalization: 2000 accepted, 2001 becomes a failed candidate with the raw response', async () => {
    const { c } = runner();
    const lines = c.promptLinesFor(rows, 0, 2);
    assert.equal(c.parseSceneResponse(publicReply({ summary: 'a'.repeat(2000) }), lines).event.summary.length, 2000);
    assert.throws(() => c.parseSceneResponse(publicReply({ summary: 'a'.repeat(2001) }), lines), /2,001자/);
    assert.throws(() => c.parseSceneResponse(publicReply({ facts: [{ text: 'f'.repeat(301), lines: [1] }] }), lines), /300자/);
    const long = publicReply({ summary: 'b'.repeat(2001) });
    const r = runner({ reply: async () => ({ content: long }) });
    r.c.state.chronicleDraft = { start: 0, end: 2, connectionId: 'current', maxTokens: 900 };
    await r.c.runChronicleScene();
    const rv = r.c.chronicleOf().reviews[0];
    assert.equal(rv.status, 'failed');
    assert.equal(rv.candidate, null, 'no truncated candidate');
    assert.equal(rv.rawText, long, 'raw response kept for cleanup');
    assert.equal(r.generated().length, 1, 'no automatic retry');
});

test('imports refuse (not truncate) over-limit chronicle records; existing data is untouched by a failed import', () => {
    const ep = n => ({ id: 'e', title: 'scene', event: { summary: 'x'.repeat(n) }, chronicle: { mode: 'range', range: buildRange(rows, 0, 1) } });
    assert.equal(parseImport(exportData({ items: [], episodes: [ep(2000)] })).episodes[0].event.summary.length, 2000);
    assert.throws(() => parseImport(exportData({ items: [], episodes: [ep(2001)] })), /형식\/상한/);
    assert.equal(parseImport(exportData({ items: [], episodes: [{ title: 'legacy', event: { summary: 'y'.repeat(2001) } }] })).episodes.length, 1, 'legacy import behaviour unchanged');
});
