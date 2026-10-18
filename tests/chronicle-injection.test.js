import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';
import { compileWorldInfo } from '../world-info.js';

const { stMessageRow, buildRange, planChronicleInjection, normalizeSettings, applyMerge } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

const chat = Array.from({ length: 40 }, (_, i) => ({ is_user: i % 2 === 0, name: i % 2 ? 'Mina' : 'Hana', mes: `line ${i + 1}`, send_date: `2026-10-17T02:${String(i).padStart(2, '0')}:00Z` }));
const rows = chat.map(stMessageRow);
const scene = (id, s, e, extra = {}) => ({ id, title: `scene ${id}`, keywords: [`kw-${id}`], event: { summary: `summary ${id}` }, facts: [],
    chronicle: { mode: 'range', status: 'approved', revision: 1, range: buildRange(rows, s, e), ...extra } });
const five = () => [scene('A', 0, 3), scene('B', 4, 7), scene('C', 8, 11), scene('D', 12, 15), scene('E', 16, 19)];
const modes = r => Object.fromEntries([...r.plan].map(([id, e]) => [id, `${e.mode}:${e.reason}`]));
const settings = extra => normalizeSettings({ recentScenes: 3, recentChapters: 1, budgetTokens: 2400, oldDetailTokens: 700, ...extra });

test('newest N scenes are constant, older ones keyword-only', () => {
    const r = planChronicleInjection(five(), rows, settings(), () => 300);
    assert.deepEqual(modes(r), { A: 'keyword:older', B: 'keyword:older', C: 'constant:recent', D: 'constant:recent', E: 'constant:recent' });
    assert.equal(r.constantTokens, 900);
    assert.equal(r.cap, 1700);
    assert.equal(r.keywordTokens, 600);
});

test('the constant budget is a cap: recent records that do not fit fall back to keyword', () => {
    const r = planChronicleInjection(five(), rows, settings({ budgetTokens: 1400, oldDetailTokens: 700 }), () => 300);
    assert.deepEqual(modes(r), { A: 'keyword:older', B: 'keyword:older', C: 'keyword:budget', D: 'constant:recent', E: 'constant:recent' });
});

test('dependency closure: a constant delta pulls in the record it was written against, or is held (never keyword-only)', () => {
    const eps = five();
    eps[4].chronicle.contextRefs = [{ id: 'A', revision: 1 }];
    assert.deepEqual(modes(planChronicleInjection(eps, rows, settings(), () => 300)).A, 'constant:dependency');
    const tight = planChronicleInjection(eps, rows, settings({ budgetTokens: 1250, oldDetailTokens: 700 }), () => 300);
    assert.equal(modes(tight).E, 'held:dependency-budget');
    assert.equal(modes(tight).A, 'keyword:older');
    // An archived reference is served by its live merged parent.
    const merged = five();
    merged[4].chronicle.contextRefs = [{ id: 'A', revision: 1 }];
    const parent = { id: 'P', title: 'chapter', keywords: ['kw-P'], event: { summary: 'recap' }, facts: [], chronicle: { mode: 'chapter', level: 1, status: 'approved', revision: 1, childRefs: [{ id: 'A', revision: 1 }, { id: 'B', revision: 1 }] } };
    applyMerge(merged, parent, ['A', 'B'], 'now');
    const r = planChronicleInjection(merged, rows, settings({ recentChapters: 0 }), () => 300);
    assert.equal(modes(r).P, 'constant:dependency');
    assert.equal(r.plan.has('A'), false, 'archived original never planned');
});

test('the newest chapter is constant (J=1); archived, stale and deleted records are not planned', () => {
    const eps = five();
    const parent = { id: 'P', title: 'chapter', keywords: ['kw-P'], event: { summary: 'recap' }, facts: [], chronicle: { mode: 'chapter', level: 1, status: 'approved', revision: 1, childRefs: [{ id: 'A', revision: 1 }, { id: 'B', revision: 1 }] } };
    applyMerge(eps, parent, ['A', 'B'], 'now');
    eps.push(scene('S', 20, 23, { status: 'stale', invalidReason: 'x' }), scene('X', 24, 27, { status: 'deleted' }));
    const r = planChronicleInjection(eps, rows, settings({ recentScenes: 2 }), () => 200);
    assert.deepEqual(modes(r), { P: 'constant:recent', C: 'keyword:older', D: 'constant:recent', E: 'constant:recent' });
});

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
test('WI plans: recent records become constant native entries with their full approved summary', () => {
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const c = core(['state', 'normalizeData', 'episodeEntryPlans', 'episodeEntryPayload']);
    c.state.chatCharacters = [];
    Object.assign(c.state, { selectedChatId: 'chat', currentChat: { id: 'chat', metadata: {} }, chronicleRows: rows, chronicleRowsChatId: 'chat' });
    const eps = five();
    eps[4].event.summary = 'z'.repeat(1500);
    eps[4].keywords = [];
    const data = c.normalizeData({ items: [], episodes: eps, chronicle: { settings: { recentScenes: 1 } } });
    const plans = c.episodeEntryPlans({ id: 'chat', metadata: {} }, data);
    const e = plans.find(p => p.episodeId === 'E');
    assert.equal(e.constant, true, 'constant even without keywords');
    assert.ok(e.content.includes('z'.repeat(1500)), 'no 260-char truncation for chronicle records');
    assert.equal(plans.find(p => p.episodeId === 'A').constant, false);
    const payload = c.episodeEntryPayload({ id: 'chat' }, e, true);
    const compiled = compileWorldInfo({ chatId: 'chat', entries: { 0: { ...payload, id: 0 } } }, {}, { characters: [], mode: 'swap' });
    assert.equal(compiled.entries[0].constant, true);
    assert.equal(compiled.entries[0].disable, false);
    assert.doesNotMatch(e.content, /MEMORY_CABINET|#\d+~#|st-message/);
});
