import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';

const { stMessageRow } = chronicleLib;
const savedGlobals = { window: globalThis.window, document: globalThis.document };
test.after(() => { Object.assign(globalThis, savedGlobals); });

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}

// ST chat: every 10th message is /hide-hidden (is_system), #7 is hidden from one character.
function stChat(length, text = (i) => `message ${i}`) {
    return Array.from({ length }, (_, i) => ({
        is_user: i % 2 === 0, is_system: i > 0 && i % 10 === 0, name: i % 2 === 0 ? 'Hana' : 'Mina', mes: text(i),
        send_date: '2026-10-18T00:00:00Z', ...(i === 7 ? { extra: { hiddenFromAICharacterIds: ['Mina.png'] } } : {}),
    }));
}

const NAMES = ['state', 'messageNumber', 'parseSourceRange', 'sourceRangeStatus', 'sourceLimitForRanges', 'sourceRangeIds',
    'recentSourceIds', 'effectiveSourceIds', 'selectedSourceRows', 'sourceCapReport', 'assertModelSourceFits', 'loadSourceMessages',
    'selectRecentSource', 'ensureSourceRangesLoaded', 'loadOlderSourceMessages', 'toggleSourceRow', 'parsedSourceRanges', 'sourceLayer',
    'makeLocalDraft', 'generateCandidates', 'generateReviewCandidates', 'SOURCE_MAX_MESSAGES', 'SOURCE_PAGE_MESSAGES',
    'SOURCE_LOCAL_CHARS', 'SOURCE_MODEL_CHARS'];

function harness(chat) {
    globalThis.window = { confirm: () => true };
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const host = { chat, calls: [] };
    const c = core(NAMES, host, `api = async (path, options = {}) => {
            host.calls.push(path);
            const url = new URL(path, 'https://x.invalid/');
            if (url.pathname.endsWith('/messages')) {
                const rows = host.chat.map(chronicleLib.stMessageRow);
                const limit = Number(url.searchParams.get('limit'));
                return limit > 0 ? rows.slice(-limit) : rows;
            }
            throw new Error('unexpected ' + path); };
        render = () => {}; toast = () => {}; saveUiState = async () => {};`);
    Object.assign(c.state, { selectedChatId: 'chat', sourceMode: 'messages', sourceTarget: 'anchor' });
    return { c, host };
}

test('range parsing accepts single numbers, #prefix, reversed and dash forms; rejects junk', () => {
    const { c } = harness([]);
    const pick = (r) => (r.ok ? [r.start, r.end] : r.empty ? 'empty' : 'invalid');
    assert.deepEqual(pick(c.parseSourceRange('10', '40')), [10, 40]);
    assert.deepEqual(pick(c.parseSourceRange('#40', '#10')), [10, 40]);
    assert.deepEqual(pick(c.parseSourceRange('7', '')), [7, 7]);
    assert.deepEqual(pick(c.parseSourceRange('', '9')), [9, 9]);
    assert.deepEqual(pick(c.parseSourceRange('10-40', '')), [10, 40]);
    assert.deepEqual(pick(c.parseSourceRange(' 3 ~ 5 ')), [3, 5]);
    assert.equal(pick(c.parseSourceRange('', '')), 'empty');
    for (const bad of [['-1', '3'], ['1.5', ''], ['abc', '2'], ['2', 'x']]) assert.equal(pick(c.parseSourceRange(...bad)), 'invalid');
});

test('rows carry the real ST message number; hidden messages are excluded but do not shift numbers', async () => {
    const { c } = harness(stChat(30));
    await c.loadSourceMessages(c.SOURCE_PAGE_MESSAGES);
    const numbers = c.state.sourceRows.map(c.messageNumber);
    assert.equal(numbers[0], 29, 'newest first');
    for (const hidden of [7, 10, 20]) assert.ok(!numbers.includes(hidden), `#${hidden} is hidden`);
    assert.ok(numbers.includes(11) && numbers.includes(6) && numbers.includes(0));
    assert.equal(c.state.sourceRows.find((row) => c.messageNumber(row) === 11).content, 'message 11');
    assert.deepEqual(c.state.sourceWindow, { limit: 120, total: 30, from: 0, complete: true });
    assert.equal(c.state.hiddenSkipped.source, 1, 'only the per-character hidden #7 is counted; /hide messages are system rows');
    const html = c.sourceLayer();
    assert.match(html, /<b>#29 · Mina<\/b>/);
    assert.match(html, /특정 인물에게 숨긴 메시지 1개는 읽지 않았어요/);
});

test('range union with manual ticks; out-of-chat and partially outside ranges warn', async () => {
    const { c } = harness(stChat(30));
    await c.loadSourceMessages(120);
    c.state.sourceRanges = [{ start: '5', end: '12' }, { start: '25', end: '40' }, { start: '50', end: '60' }];
    c.state.sourceSelected.add('st-message:1');
    const ids = [...c.effectiveSourceIds()].map((id) => Number(id.split(':')[1])).sort((a, b) => a - b);
    // 7 and 10 are hidden; 25..29 exist, 30..40 do not.
    assert.deepEqual(ids, [1, 5, 6, 8, 9, 11, 12, 25, 26, 27, 28, 29]);
    assert.equal(c.selectedSourceRows().length, ids.length);
    const win = c.state.sourceWindow;
    const [a, b, d] = c.parsedSourceRanges().map((r) => c.sourceRangeStatus(r, win));
    assert.equal(a.kind, 'ok');
    assert.equal(b.kind, 'partial');
    assert.match(b.message, /일부가 채팅 기록 밖입니다/);
    assert.equal(d.kind, 'outside');
    assert.match(d.message, /이 범위는 채팅 기록 밖입니다/);
    const html = c.sourceLayer();
    assert.match(html, /이 범위는 채팅 기록 밖입니다/);
    assert.match(html, /12개 선택 · 약 \d+ tokens/);
    // Range-covered rows are shown checked and cannot be unticked one by one.
    assert.match(html, /data-source-id="st-message:6" checked disabled/);
    // Summaries mode ignores message ranges.
    c.state.sourceMode = 'summaries';
    assert.equal(c.effectiveSourceIds().size, 1);
});

test('recent N picks the newest readable messages and loads older pages within the bound', async () => {
    const { c, host } = harness(stChat(400));
    await c.loadSourceMessages(c.SOURCE_PAGE_MESSAGES);
    assert.equal(c.state.sourceWindow.from, 280);
    const recent = c.recentSourceIds(c.state.sourceRows, 5).map((id) => Number(id.split(':')[1]));
    assert.deepEqual(recent, [399, 398, 397, 396, 395]);
    // 390 is hidden, so the 12 newest readable are 399..388 minus 390, plus 387.
    const got = await c.selectRecentSource(12);
    assert.equal(got, 12);
    assert.ok(!c.state.sourceSelected.has('st-message:390'));
    assert.ok(c.state.sourceSelected.has('st-message:387'));
    // Asking for more than is loaded fetches older messages with a larger limit.
    host.calls.length = 0;
    assert.equal(await c.selectRecentSource(200), 200);
    assert.ok(host.calls.some((p) => /limit=(\d+)/.test(p) && Number(p.match(/limit=(\d+)/)[1]) > 120));
});

test('ranges older than the loaded window page in on demand, capped at the upper bound', async () => {
    const { c, host } = harness(stChat(3000));
    const max = c.SOURCE_MAX_MESSAGES;
    assert.equal(max, 2000);
    await c.loadSourceMessages(120);
    assert.deepEqual(c.state.sourceWindow, { limit: 120, total: 3000, from: 2880, complete: false });
    c.state.sourceRanges = [{ start: '2500', end: '2510' }];
    assert.equal(c.sourceLimitForRanges(c.parsedSourceRanges(), c.state.sourceWindow), 500);
    assert.equal(c.sourceRangeStatus(c.parsedSourceRanges()[0], c.state.sourceWindow).kind, 'not-loaded');
    assert.equal(await c.ensureSourceRangesLoaded(), true);
    assert.equal(c.state.sourceWindow.from, 2500);
    assert.ok(c.effectiveSourceIds().has('st-message:2505'));
    // A range reaching before the bound loads only up to the bound and says so.
    c.state.sourceRanges = [{ start: '500', end: '1200' }];
    await c.ensureSourceRangesLoaded();
    assert.equal(c.state.sourceWindow.limit, max);
    assert.equal(c.state.sourceWindow.from, 1000);
    const status = c.sourceRangeStatus(c.parsedSourceRanges()[0], c.state.sourceWindow);
    assert.equal(status.kind, 'partial');
    assert.match(status.message, /#1000보다 앞은 불러올 수 없어/);
    // Entirely before the bound: nothing selected, no further fetch.
    c.state.sourceRanges = [{ start: '0', end: '50' }];
    host.calls.length = 0;
    assert.equal(await c.ensureSourceRangesLoaded(), false);
    assert.equal(host.calls.length, 0);
    assert.equal(c.sourceRangeStatus(c.parsedSourceRanges()[0], c.state.sourceWindow).kind, 'too-old');
    assert.equal(c.effectiveSourceIds().size, 0);
    // Load-more never asks past the bound.
    await c.loadOlderSourceMessages();
    assert.equal(host.calls.length, 0);
    assert.ok(host.calls.every((p) => Number(p.match(/limit=(\d+)/)?.[1] || 0) <= max));
});

test('load older steps one page at a time and stops at the start of the chat', async () => {
    const { c, host } = harness(stChat(250));
    await c.loadSourceMessages(120);
    await c.loadOlderSourceMessages();
    assert.equal(c.state.sourceWindow.limit, 240);
    await c.loadOlderSourceMessages();
    assert.equal(c.state.sourceWindow.complete, true);
    assert.equal(c.state.sourceWindow.from, 0);
    const before = host.calls.length;
    await c.loadOlderSourceMessages();
    assert.equal(host.calls.length, before);
});

test('shift-click toggles every row between the last click and this one', async () => {
    const { c } = harness(stChat(20));
    await c.loadSourceMessages(120);
    c.toggleSourceRow('st-message:18', true);
    c.toggleSourceRow('st-message:12', true, true);
    const picked = [...c.state.sourceSelected].map((id) => Number(id.split(':')[1])).sort((a, b) => a - b);
    assert.deepEqual(picked, [12, 13, 14, 15, 16, 17, 18]);
    c.toggleSourceRow('st-message:15', false, true);
    assert.deepEqual([...c.state.sourceSelected].map((id) => Number(id.split(':')[1])).sort((a, b) => a - b), [16, 17, 18]);
});

test('caps are announced before sending and never silently truncated into the model', async () => {
    const big = (i) => 'x'.repeat(1300) + ` #${i}`;
    const { c, host } = harness(stChat(130, big));
    await c.loadSourceMessages(120);
    c.state.sourceRanges = [{ start: '30', end: '129' }];
    const rows = c.selectedSourceRows();
    assert.ok(rows.length > 85);
    const report = c.sourceCapReport(rows.map((r) => r.content).join('\n\n'));
    assert.equal(report.modelOver, true);
    assert.equal(report.localOver, true);
    const html = c.sourceLayer();
    assert.match(html, /모델 입력 한도 100,000자를 넘어 모델로 보내지 않아요/);
    assert.match(html, /앞 16,000자만 담아요/);
    assert.match(html, /data-action="source-model" disabled/);
    c.state.modelConnectionId = 'conn';
    host.calls.length = 0;
    await assert.rejects(c.generateCandidates(), /모델 입력 한도 100,000자를 넘어요.*모델을 호출하지 않았어요/);
    assert.equal(host.calls.length, 0, 'no model call');
    // Local draft over its cap asks first; declining creates nothing.
    let asked = '';
    globalThis.window.confirm = (msg) => { asked = msg; return false; };
    assert.equal(c.makeLocalDraft(), false);
    assert.match(asked, /앞 16,000자만 담기고/);
    assert.equal(c.state.draft, null);
    globalThis.window.confirm = () => true;
    c.makeLocalDraft();
    assert.equal(c.state.draft.content.length, c.SOURCE_LOCAL_CHARS);
    // Summary review path checks the same model cap before calling.
    c.state.sourceMode = 'summaries';
    await assert.rejects(c.generateReviewCandidates([{ id: 's', title: 'big', content: 'y'.repeat(c.SOURCE_MODEL_CHARS + 1) }]), /모델 입력 한도/);
    assert.equal(host.calls.length, 0);
});

test('within the caps the selection goes to the model whole', async () => {
    const { c } = harness(stChat(40));
    await c.loadSourceMessages(120);
    c.state.sourceRanges = [{ start: '0', end: '39' }];
    const text = c.selectedSourceRows().map((r) => r.content).join('');
    assert.equal(c.sourceCapReport(text).notes.length, 0);
    assert.equal(c.assertModelSourceFits('abc'), 'abc');
    assert.doesNotMatch(c.sourceLayer(), /data-source-cap/);
});
