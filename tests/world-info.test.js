import test from 'node:test';
import assert from 'node:assert/strict';
import { compileWorldInfo, conditionKeys, removeManagedEntries } from '../world-info.js';

const match = (key, text) => new RegExp(key.slice(1, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)).test(text);
const base = { id: '7', name: 'cup', enabled: true, content: 'yellow cup', dynamicState: { memoryCabinetElementId: 'cup' } };
test('restricted entries fail closed without resolved avatars and append withholds secrets', () => {
    const book = { entries: { 7: { ...base, constant: true, characterFilterMode: 'include', characterFilterIds: ['Alice.png'] } } };
    assert.equal(compileWorldInfo(book).entries[7].disable, true);
    const scope = { characters: [{ avatar: 'Alice.png' }], mode: 'swap' };
    const allowed = compileWorldInfo(book, {}, scope).entries[7];
    assert.equal(allowed.disable, false);
    assert.deepEqual(allowed.characterFilter.names, ['Alice']);
    assert.equal(compileWorldInfo(book, {}, { ...scope, mode: 'append' }).entries[7].disable, true);
    assert.equal(compileWorldInfo(book, {}, { ...scope, mode: 'append_disabled' }).entries[7].disable, true);
    book.entries[7].characterFilterIds = ['unknown'];
    assert.equal(compileWorldInfo(book, {}, scope).entries[7].disable, true);
});

test('literal terms cannot become regexes or inject OR alternatives', () => {
    for (const term of ['/foo/i', 'a.*b', 'a|b', '[x]', '(cup)', '$1', 'x/y', 'a\\b', 'two\nlines']) {
        const [key] = conditionKeys({ keys: [term] });
        assert.ok(match(key, `prefix ${term} suffix`), term);
        assert.equal(match(key, 'unrelated text'), false, term);
    }
});

test('AND groups require every term across multiple lines, in any order', () => {
    const [key] = conditionKeys({ keys: ['Ji-hee'], secondaryKeys: ['cup', 'yellow'], selective: true });
    assert.equal(match(key, 'YELLOW cup\nJi-hee'), true);
    assert.equal(match(key, 'Ji-hee holds a cup'), false);
    assert.equal(match(key, 'yellow cup'), false);
});

test('compile collapses proxy triggers without recursion, and keeps backups disabled', () => {
    const world = compileWorldInfo({ id: 'test', chatId: 'owner', entries: {
        7: { ...base, tag: 'memory-cabinet-element-facts', keys: ['internal-marker'], delayUntilRecursion: true },
        8: { ...base, id: '8', tag: 'memory-cabinet-element-trigger', keys: ['Ji-hee'], secondaryKeys: ['cup'], selective: true },
        9: { ...base, id: '9', tag: 'memory-cabinet-structured-backup', constant: true, content: 'private backup' },
    } });
    assert.deepEqual(Object.keys(world.entries), ['7', '9']);
    assert.equal(world.entries[7].delayUntilRecursion, 0);
    assert.equal(match(world.entries[7].key[0], 'Ji-hee\ncup'), true);
    assert.equal(match(world.entries[7].key[0], 'cup'), false);
    assert.equal(world.entries[9].disable, true);
    assert.equal(world.entries[7].extensions.memoryVault.ownerChatId, 'owner');
});

test('disabled proxies cannot activate body entries', () => {
    const world = compileWorldInfo({ entries: {
        7: { ...base, tag: 'memory-cabinet-wiki-doc', dynamicState: { memoryCabinetWikiId: 'wiki' } },
        8: { ...base, id: '8', tag: 'memory-cabinet-wiki-trigger', dynamicState: { memoryCabinetWikiId: 'wiki' }, keys: ['test'], enabled: false },
    } });
    assert.equal(world.entries[7].disable, true);
});

test('duplicate and foreign managed lore is removed; user lore remains', () => {
    const user = { content: 'user book' };
    const owned = { extensions: { memoryVault: { ownerChatId: 'foreign' } } };
    const lists = { chatLore: [owned, user], globalLore: [owned], personaLore: [owned] };
    removeManagedEntries(lists);
    assert.deepEqual(lists, { chatLore: [user], globalLore: [], personaLore: [] });
});
