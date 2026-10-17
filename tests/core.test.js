import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as chronicleLib from '../chronicle.js';

function core(names, host = {}, setup = '') {
    let source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
    source = source.replace(/^import .*;\n/gm, '').replace('export function mountMemoryVault', 'function mountMemoryVault');
    const at = source.lastIndexOf('  if (document.readyState');
    source = source.slice(0, at) + `${setup}; return { ${names.join(',')} };\n}\nreturn mountMemoryVault(host);`;
    return new Function('host', 'chronicleLib', source)(host, chronicleLib);
}
const threadFixture = { id: 't', title: 'thread', currentState: 'SECRET', history: [{ state: 'PUBLIC', at: '2026-01-01' }, { state: 'SECRET', at: '2026-02-01', knownBy: ['a'] }] };
test('injection bodies omit chat labels and internal markers while preserving meaningful names', () => {
    const c = core(['state', 'normalizeData', 'promiseContext', 'anchorContext', 'keywordContext', 'restrictedContext', 'elementContext', 'wikiAlwaysContext', 'wikiDocContext', 'threadContext']);
    c.state.chatCharacters = [{ id: 'a', name: 'Alice' }];
    const chat = { id: 'c', name: 'Seraphina - 2026-10-07@09h05m03s007ms', metadata: {} };
    const data = c.normalizeData({ items: [], threads: [{ title: '동행', currentState: '다음 길을 찾는다', history: [{ state: '다음 길을 찾는다', status: 'open' }] }] });
    const entity = { name: '노란 컵', currentFacts: [{ text: '손잡이가 깨졌다' }], historyFacts: [] };
    const doc = { title: '도서관', sections: [], aliases: [], summary: '북쪽 건물', category: 'place' };
    const bodies = [
        c.promiseContext(chat, data), c.anchorContext(chat, data),
        c.keywordContext(chat, { category: 'fact', title: '컵', content: '노란색' }),
        c.restrictedContext(chat, { type: 'promise', title: '비밀', content: '약속', knownBy: ['a'] }),
        c.elementContext(chat, entity), c.wikiAlwaysContext(chat, { docs: [], alwaysBudgetChars: 1000 }),
        c.wikiDocContext(chat, doc), c.threadContext(chat, data),
    ];
    for (const body of bodies) {
        assert.doesNotMatch(body, /MEMORY_CABINET_|Seraphina|2026-10-07|09h05m03s007ms/);
    }
    assert.match(bodies[3], /Alice만 알고 있다/);
    assert.match(bodies[4], /노란 컵/);
    assert.match(bodies[6], /도서관/);
    assert.match(bodies[7], /다음 길을 찾는다/);
});
test('scene and private thread payloads omit internal markers without dropping story time or scopes', () => {
    const c = core(['state', 'normalizeData', 'episodeEntryPlans', 'restrictedThreadPlans']);
    c.state.chatCharacters = [{ id: 'a', name: 'Alice' }];
    const chat = { id: 'c', name: 'FILENAME', metadata: { groupChatMode: 'individual' } };
    const data = c.normalizeData({
        episodes: [{ id: 'ep', title: '도서관', keywords: ['도서관'], background: { place: '도서관' }, event: { summary: '만났다' }, facts: [{ text: '쪽지를 건넸다', knownBy: ['a'] }] }],
        threads: [threadFixture],
    });
    const plans = [...c.episodeEntryPlans(chat, data), ...c.restrictedThreadPlans(data)];
    assert.ok(plans.length >= 3);
    for (const plan of plans) assert.doesNotMatch(plan.content, /MEMORY_CABINET_|FILENAME/);
    assert.ok(plans.some(p => /Alice만/.test(p.content)));
});
test('editing private history without scope change must not publish its state', async () => {
    const savedDocument = globalThis.document;
    globalThis.document = {
        getElementById: id => ({ value: ({ 'mmc-th-title': 'thread', 'mmc-th-state': 'SECRET edited' })[id] || '' }),
        querySelectorAll: () => [],
    };
    try {
        const c = core(['state', 'normalizeThread', 'saveThreadDraft', 'deriveThreadState'], {}, 'freshOwnedData = async () => state.currentData; persistData = async d => { state.currentData = d; }; render = () => {}');
        c.state.currentData = { threads: [c.normalizeThread(threadFixture)] };
        c.state.threadDraft = c.state.currentData.threads[0];
        await c.saveThreadDraft();
        assert.equal(c.deriveThreadState(c.state.currentData.threads[0]).currentState, 'PUBLIC');
    } finally { globalThis.document = savedDocument; }
});
test('managed overwrite requires confirmation and never escalates a running sync', async () => {
    const savedWindow = globalThis.window;
    const calls = [];

    // The helper is exercised separately from persistence, covered by host tests.
    const d = core(['state', 'overwriteManagedWorldInfo'], { calls }, 'syncLorebook = async options => host.calls.push(options);');
    d.state.currentChat = { id: 'c' }; d.state.currentData = {};
    try {
        globalThis.window = { confirm: () => false };
        await d.overwriteManagedWorldInfo();
        assert.equal(calls.length, 0);
        globalThis.window.confirm = () => true;
        await d.overwriteManagedWorldInfo();
        assert.equal(calls[0].overwriteManaged, true);
        d.state.syncPromise = Promise.resolve();
        await assert.rejects(d.overwriteManagedWorldInfo(), /동기화/);
        assert.equal(calls.length, 1);
    } finally { globalThis.window = savedWindow; }
});

test('auto apply downgrades a restricted snapshot even when the model proposes public copies', async () => {
    for (const knownBy of [undefined, ['all'], ['Alice']]) {
        const savedDocument = globalThis.document;
        globalThis.document = { getElementById: () => null };
        let applied = 0;
        const c = core(['state', 'normalizeData', 'maybeAutoProcessSummaries', 'restorePendingReview', 'scopeBlocksApply'], {
            api: async () => ({ content: JSON.stringify([{ action: 'add', type: 'anchor', title: 'copy', content: 'SECRET', knownBy }]) }),
            onApply: () => { applied++; },
        }, 'ownershipAllowsData = () => true; advancedMemoryEnabled = () => false; chooseDefaultConnection = () => "fake"; saveUiState = async () => {}; setBusy = () => {}; render = () => {}; toast = () => {}; persistData = async d => { state.currentData = d; }; applyReviewCandidates = async () => host.onApply();');
        try {
            c.state.chatCharacters = [{ id: 'a', name: 'Alice' }];
            c.state.currentData = c.normalizeData({ items: [{ id: 'secret', type: 'anchor', title: 'private', content: 'SECRET', knownBy: ['a'] }] });
            assert.deepEqual(c.state.currentData.items[0].knownBy, ['a']);
            c.state.currentChat = { id: 'c', metadata: {} }; c.state.selectedChatId = 'c';
            c.state.summaryUpdateMode = 'auto_apply'; c.state.connections = [{ id: 'fake' }];
            c.state.pendingSummaryRows = [{ id: 's', content: 'public summary' }];
            await c.maybeAutoProcessSummaries();
            assert.equal(applied, 0);
            assert.equal(c.state.currentData.items.length, 1);
            assert.equal(c.state.currentData.pendingReview.candidates.length, 1);
            c.restorePendingReview();
            assert.equal(c.state.reviewCandidates[0].scopeNeedsReview, true);
            if (knownBy?.[0] !== 'Alice') assert.equal(c.scopeBlocksApply(c.state.reviewCandidates[0]), true);
        } finally { globalThis.document = savedDocument; }
    }
});

test('review context restriction includes nested episode and thread scopes but not public memory', () => {
    const c = core(['state', 'normalizeData', 'reviewContextHasRestricted']);
    c.state.chatCharacters = [{ id: 'a', name: 'Alice' }];
    for (const data of [
        { threads: [threadFixture] },
        { episodes: [{ title: 'scene', event: { summary: 'secret', knownBy: ['a'] } }] },
    ]) {
        c.state.currentData = c.normalizeData({ items: [], ...data });
        assert.equal(c.reviewContextHasRestricted(), true);
    }
    c.state.currentData = c.normalizeData({ items: [{ type: 'anchor', title: 'public', content: 'public' }] });
    assert.equal(c.reviewContextHasRestricted(), false);
});

test('empty public history must not fall back to latest private thread state', () => {
    const c = core(['normalizeThread', 'deriveThreadState']);
    const thread = c.normalizeThread({ title: 'thread', currentState: 'SECRET', history: [{ state: '', status: 'hold', at: '2026-01-01' }, { state: 'SECRET', knownBy: ['a'], at: '2026-02-01' }] });
    assert.equal(c.deriveThreadState(thread).currentState, '');
});
test('episode-only and thread-only review responses recover', async () => {
    for (const row of [{ kind: 'episode', title: 'scene', event: { summary: 'event' } }, { kind: 'thread', action: 'add', title: 'thread', state: 'open' }]) {
        const c = core(['state', 'applyRecoveredRows'], {}, 'persistPendingReview = async () => {}; toast = () => {}');
        c.state.currentData = { items: [] }; c.state.rawRecovery = { kind: 'review', rows: [] };
        await c.applyRecoveredRows(JSON.stringify([row]));
        assert.equal(c.state.reviewEpisodes.length + c.state.reviewThreads.length, 1);
    }
});
test('status changes preserve latest history scope', async () => {
    const c = core(['state', 'normalizeThread', 'setThreadStatus', 'deriveThreadState'], {}, 'freshOwnedData = async () => state.currentData; persistData = async d => { state.currentData = d; }; render = () => {}');
    c.state.currentData = { threads: [c.normalizeThread(threadFixture)] };
    await c.setThreadStatus('t', 'hold');
    assert.equal(c.deriveThreadState(c.state.currentData.threads[0]).currentState, 'PUBLIC');
});
test('review snapshot and unrestricted model echo retain effective history scope', () => {
    const c = core(['state', 'normalizeThread', 'threadSnapshotForPrompt', 'normalizeThreadCandidate', 'applyThreadCandidates', 'deriveThreadState']);
    c.state.chatCharacters = [{ id: 'a', name: 'Alice' }];
    c.state.currentData = { threads: [c.normalizeThread(threadFixture)] };
    assert.match(c.threadSnapshotForPrompt(), /knownBy/);
    const cand = c.normalizeThreadCandidate({ action: 'update', targetId: 't', state: 'SECRET', knownBy: ['all'] });
    c.applyThreadCandidates(c.state.currentData, [cand], new Set(['0']));
    assert.equal(c.deriveThreadState(c.state.currentData.threads[0]).currentState, 'PUBLIC');
});
test('scope-held branch records need branch approval before identity approval and roundtrip without mutating parent', () => {
    const c = core(['holdPostBranchRecords', 'branchHoldCount', 'normalizeData', 'restoreHeldRecord', 'prepareScopeImport']);
    const parent = { items: [], scopeReviewHold: [{ kind: 'items', record: { title: 'secret', knownBy: ['a'] } }] };
    const child = c.holdPostBranchRecords(parent, null, 'parent');
    assert.equal(child.scopeReviewHold.length, 0);
    assert.equal(c.branchHoldCount(child.branchHold), 1);
    const held = c.normalizeData(c.prepareScopeImport(JSON.parse(JSON.stringify(child)))).branchHold.scopeReviewHold[0];
    assert.equal(c.restoreHeldRecord(child, 'scopeReviewHold', held), true);
    assert.equal(child.items.length, 0);
    assert.equal(child.scopeReviewHold.length, 1);
    assert.equal(parent.scopeReviewHold.length, 1);
});
test('chat identities load before ownership normalization', async () => {
    const c = core(['state', 'loadCurrentChat'], { api: async () => ({ id: 'c', characterIds: ['a'], metadata: {} }) }, 'applyOwnershipForCurrentChat = async () => { if (!state.chatCharacters.some(c => c.id === "a")) throw Error("identities missing"); state.currentData = { elementMemory: {} }; }; restorePendingReview = () => {}; refreshAgentNotice = async () => {}');
    c.state.selectedChatId = 'c';
    await c.loadCurrentChat();
});
test('undo preserves a renamed automatic thread and manual history', async () => {
    const c = core(['state', 'normalizeThread', 'undoAutoReview'], {}, 'freshOwnedData = async () => state.currentData; persistData = async d => { state.currentData = d; }; toast = () => {}; render = () => {}');
    c.state.currentData = { items: [], threads: [c.normalizeThread({ title: 'manual rename', sourceCandidateId: 'cand', updatedAt: 'later', history: [{ candidateId: 'cand', state: 'auto' }, { via: 'manual', state: 'manual' }] })], lastAutoReviewUndo: { threadCandidates: ['cand'] } };
    const t = c.state.currentData.threads[0];
    c.state.currentData.lastAutoReviewUndo.threadVersions = { [t.id]: JSON.stringify({ ...t, title: 'original', updatedAt: 'earlier', history: t.history.slice(0, 1) }) };
    await c.undoAutoReview();
    assert.equal(c.state.currentData.threads.length, 1);
    assert.equal(c.state.currentData.threads[0].history.length, 2);
});
test('unsupported imported scope is preserved outside all active layers', () => {
    const { normalizeData } = core(['normalizeData']);
    const entity = { name: 'secret', currentFacts: [{ text: 'secret', knownBy: ['unknown'] }] };
    const data = normalizeData({ items: [], elementMemory: { entities: [entity] }, wiki: { docs: [{ title: 'secret', sections: [], knownBy: ['unknown'] }] } });
    assert.equal(data.elementMemory.entities.length, 0);
    assert.equal(data.wiki.docs.length, 0);
    assert.deepEqual(data.scopeReviewHold[0].record, entity);
});
test('import review holds matching identities across supported nested layers', () => {
    const { prepareScopeImport, normalizeData } = core(['prepareScopeImport', 'normalizeData']);
    const data = normalizeData(prepareScopeImport({ items: [{ title: 's', knownBy: ['Alice.png'] }], episodes: [{ title: 'e', facts: [{ text: 's', knownBy: ['Alice.png'] }] }], threads: [{ title: 't', history: [{ state: 's', knownBy: ['Alice.png'] }] }] }));
    assert.equal(data.items.length + data.episodes.length + data.threads.length, 0);
    assert.equal(data.scopeReviewHold.length, 3);
});

test('episodes preserve event/fact scope and source fingerprints', () => {
    const { normalizeEpisode } = core(['normalizeEpisode']);
    const ep = normalizeEpisode({ title: '장면', event: { summary: '비밀', knownBy: ['unknown'] }, facts: [{ text: '사실', knownBy: ['unknown'] }], sourceFingerprints: { s: 'fp' } });
    assert.deepEqual(ep.event.knownBy, ['unknown']);
    assert.deepEqual(ep.facts[0].knownBy, ['unknown']);
    assert.equal(ep.sourceFingerprints.s, 'fp');
});
test('thread state follows chronological visible history', () => {
    const { normalizeThread, deriveThreadState } = core(['normalizeThread', 'deriveThreadState']);
    const thread = normalizeThread({ title: '진행', history: [{ at: '2026-02-01', status: 'resolved', state: '종료', knownBy: ['a'] }, { at: '2026-01-01', status: 'open', state: '시작' }] });
    assert.equal(deriveThreadState(thread).currentState, '시작');
    assert.equal(deriveThreadState(thread, ['a']).currentState, '종료');
});
test('sync merges only pointers into newer content', () => {
    const { normalizeData, mergeSyncPointers } = core(['normalizeData', 'mergeSyncPointers']);
    const latest = normalizeData({ items: [], episodes: [{ title: '최신' }], alwaysBudgetTokens: 999 });
    const stale = normalizeData({ items: [], episodes: [{ title: '이전' }], lorebookId: 'book' });
    const merged = mergeSyncPointers(latest, stale);
    assert.equal(merged.episodes[0].title, '최신');
    assert.equal(merged.alwaysBudgetTokens, latest.alwaysBudgetTokens);
    assert.equal(merged.lorebookId, 'book');
});
test('dedupe respects scope and UI map merge preserves other chats', () => {
    const { dedupeByTitle, mergeUiMaps } = core(['dedupeByTitle', 'mergeUiMaps']);
    const result = dedupeByTitle([{ type: 'anchor', title: '컵' }, { type: 'anchor', title: '컵' }, { type: 'anchor', title: '컵', knownBy: ['a'] }]);
    assert.equal(result.kept.length, 2);
    const merged = mergeUiMaps({ sourceWatchByChat: { a: 1 } }, { sourceWatchByChat: { b: 2 } });
    assert.deepEqual(merged.sourceWatchByChat, { a: 1, b: 2 });
});
test('safe selection refuses scope review and thread reopen', () => {
    const { preselectThreads } = core(['preselectThreads']);
    assert.equal(preselectThreads([{ scopeNeedsReview: true }, { needsConfirm: true }]).size, 0);
});
test('unknown branch cutoff holds every inherited layer and clears pending work', () => {
    const { holdPostBranchRecords } = core(['holdPostBranchRecords']);
    const data = holdPostBranchRecords({ items: [{ id: 'a', type: 'anchor', title: '기억', content: '내용' }], episodes: [{ title: '장면' }], threads: [{ title: '흐름' }], pendingReview: { x: 1 } }, null, 'parent');
    assert.equal(data.items.length, 0);
    assert.equal(data.episodes.length, 0);
    assert.equal(data.threads.length, 0);
    assert.equal(data.branchHold.items.length, 1);
    assert.equal(data.pendingReview, null);
});
test('disjoint thread scopes never become public', () => {
    const { normalizeThread, deriveThreadState } = core(['normalizeThread', 'deriveThreadState']);
    const t = normalizeThread({ title: '비밀', knownBy: ['a'], history: [{ state: 'secret', knownBy: ['b'] }] });
    assert.equal(deriveThreadState(t), null);
    assert.equal(deriveThreadState(t, ['a']), null);
});
test('public extraction excludes hidden/system and conditional source text', () => {
    const { readableMessages } = core(['readableMessages']);
    const rows = readableMessages([{ role: 'system', content: 'hidden' }, { role: 'user', content: '{{#if char == "a"}}secret{{/if}}' }, { role: 'assistant', content: 'public' }], 'test');
    assert.deepEqual(rows.map(r => r.content), ['public']);
});
test('unresolved model knownBy stays restricted and requires review', () => {
    const { candidateScope, scopeBlocksApply } = core(['candidateScope', 'scopeBlocksApply']);
    const candidate = candidateScope({ knownBy: ['unmapped-id'] });
    assert.deepEqual(candidate.knownByIds, ['unmapped-id']);
    assert.equal(scopeBlocksApply(candidate), true);
});
test('episode and thread candidate scopes retain unresolved identities', () => {
    const { normalizeEpisodeCandidate, normalizeThreadCandidate, episodeScopeBlocks, threadCandidateBlocks } = core(['normalizeEpisodeCandidate', 'normalizeThreadCandidate', 'episodeScopeBlocks', 'threadCandidateBlocks']);
    const ep = normalizeEpisodeCandidate({ title: '장면', event: { summary: 'secret', knownBy: ['unknown'] } });
    assert.deepEqual(ep.event.knownByIds, ['unknown']);
    assert.equal(episodeScopeBlocks(ep), true);
    const th = normalizeThreadCandidate({ title: '흐름', action: 'add', state: 'secret', knownBy: ['unknown'] });
    assert.deepEqual(th.knownByIds, ['unknown']);
    assert.equal(threadCandidateBlocks(th), true);
});
test('new managed pointers reset without losing restricted memories', () => {
    const { resetManagedPointersForOwner } = core(['resetManagedPointersForOwner']);
    const { data } = resetManagedPointersForOwner({ items: [], episodes: [{ title: '장면', event: { knownBy: ['unknown'] } }], threadEntryId: '9', episodeEntryIds: { a: '8' }, threadRestrictedEntryIds: { a: '7' }, restrictedEntryIds: { a: '6' } }, 'child');
    assert.equal(data.threadEntryId, ''); assert.deepEqual(data.episodeEntryIds, {});
    assert.deepEqual(data.threadRestrictedEntryIds, {}); assert.deepEqual(data.restrictedEntryIds, {});
    assert.deepEqual(data.scopeReviewHold[0].record.event.knownBy, ['unknown']);
});
test('markup renders six layers and source watch preserves active memories', async () => {
    const { state, normalizeData, shellMarkup, refreshStaleRecords, textHash } = core(['state', 'normalizeData', 'shellMarkup', 'refreshStaleRecords', 'textHash']);
    state.currentChat = { id: 'c', metadata: { summaryEntries: [{ id: 's', content: 'changed' }] } };
    state.selectedChatId = 'c'; state.ownership = { status: 'owned' };
    state.currentData = normalizeData({ ownerChatId: 'c', items: [{ id: 'p', type: 'promise', title: '약속', content: '계속', status: 'active', sourceFingerprints: { 'summary:s': textHash('old') } }] });
    assert.match(shellMarkup(), /장면/); assert.match(shellMarkup(), /흐름/);
    await refreshStaleRecords();
    assert.equal(state.staleRecords.length, 1);
    assert.equal(state.currentData.items[0].status, 'active');
});
test('scope editor retains imported unknown IDs even in single-character chats', () => {
    const { scopeControl, state } = core(['scopeControl', 'state']);
    state.chatCharacters = [{ id: 'Alice.png', name: 'Alice' }];
    const html = scopeControl('draft', 0, ['unknown']);
    assert.match(html, /data-scope-char="unknown" checked/);
    assert.match(html, /data-scope-char="Alice.png"/);
});
test('sync completion reads latest host metadata before merging pointers', async () => {
    let written;
    const host = { api: async (_path, options = {}) => {
        if (options.method === 'PATCH') { written = options.body.memoryCabinetV1; return; }
        return { id: 'c', metadata: { memoryCabinetV1: { items: [], episodes: [{ title: 'external latest' }] } } };
    } };
    const { state, normalizeData, writeSyncResult } = core(['state', 'normalizeData', 'writeSyncResult'], host);
    state.currentChat = { id: 'c', metadata: {} }; state.currentData = normalizeData({ items: [], episodes: [{ title: 'stale' }] });
    await writeSyncResult(state.currentChat, normalizeData({ items: [], lorebookId: 'book' }));
    assert.equal(written.episodes[0].title, 'external latest');
    assert.equal(written.lorebookId, 'book');
});
