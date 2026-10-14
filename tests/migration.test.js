import test from 'node:test';
import assert from 'node:assert/strict';
test('resolved branch hold null round trips', () => {
    assert.equal(parseImport('{"items":[],"branchHold":null}').branchHold, null);
});
test('new layer import validates scopes and bounded histories', () => {
    assert.throws(() => parseImport(JSON.stringify({ items: [], threads: [{}] })), /형식/);
    assert.throws(() => parseImport(JSON.stringify({ items: [], episodes: [{ title: 'x', facts: 'invalid' }] })), /형식/);
    assert.throws(() => parseImport(JSON.stringify({ items: [{ knownBy: {} }] })), /형식/);
    const data = parseImport(JSON.stringify({ items: [{ knownBy: ['unknown'] }], episodes: [], threads: [] }));
    assert.deepEqual(data.items[0].knownBy, ['unknown']);
});
import { parseImport, exportData, MAX_IMPORT_BYTES } from '../migration.js';

const data = { version: 1, items: [{ id: 'promise', content: 'Keep canonical English', contentKo: '한국어 표시본' }], elementMemory: { entities: [] }, wiki: { docs: [] } };
test('raw, Marinara chat metadata, ST header, and portable export retain canonical and Korean data', () => {
    const values = [data, { memoryCabinetV1: data }, { metadata: { memoryCabinetV1: data } },
        { chat: { metadata: { memoryCabinetV1: data } } }, [{ chat_metadata: { memoryCabinetV1: data } }]];
    for (const value of values) assert.deepEqual(parseImport(JSON.stringify(value)), data);
    assert.deepEqual(parseImport(exportData(data)), data);
});
test('structured disabled backup supports Marinara and ST World Info formats', () => {
    const marker = '§MEMORY_CABINET_BACKUP_V1§';
    const content = `${marker}\n${JSON.stringify({ marker, data })}`;
    for (const entries of [[{ enabled: false, content }], { 0: { disable: true, content } }]) {
        assert.deepEqual(parseImport(JSON.stringify({ entries })), data);
    }
});
test('unrelated, malformed, ambiguous, and over-limit imports fail before writing', () => {
    for (const value of [{}, { items: {} }, { items: [null] }, { items: [], version: 99 }, { items: [], wiki: {} }, { entries: {} },
        [{ metadata: { memoryCabinetV1: data } }, { metadata: { memoryCabinetV1: data } }]]) {
        assert.throws(() => parseImport(JSON.stringify(value)));
    }
    assert.throws(() => parseImport('PK zip data'));
    assert.throws(() => parseImport(' '.repeat(MAX_IMPORT_BYTES + 1)));
});
test('prototype-sensitive imported fields are removed recursively', () => {
    const parsed = parseImport('{"items":[],"__proto__":{"polluted":true},"wiki":{"docs":[],"constructor":{}}}');
    assert.equal(Object.hasOwn(parsed, '__proto__'), false);
    assert.equal(Object.hasOwn(parsed.wiki, 'constructor'), false);
    assert.equal({}.polluted, undefined);
});
