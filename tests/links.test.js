import test from 'node:test';
import assert from 'node:assert/strict';
import { retargetWorldInfoLinks } from '../links.js';

test('retarget persists global, auxiliary, persona and inactive chat links without altering messages', async () => {
    const state = { globalSelect: ['old', 'other'], charLore: [{ extraBooks: ['old'] }] };
    const selected = ['old', 'other'];
    const powerUser = { persona_description_lorebook: 'old', persona_descriptions: { a: { lorebook: 'old' } } };
    let settings;
    let chat = [{ chat_metadata: { world_info: 'old', integrity: 'test' } }, { mes: '한글 원문', extra: { untouched: 1 } }];
    const originalMessage = structuredClone(chat[1]);
    await retargetWorldInfoLinks('old', 'new', {
        getContext: () => ({ chatId: 'active', characters: [] }), state, selected, powerUser,
        saveSettings: async () => { settings = { world_info_settings: { world_info: structuredClone(state) }, power_user: structuredClone(powerUser) }; },
        post: async (path, body) => {
            if (path === '/api/settings/get') return { settings: JSON.stringify(settings) };
            if (path === '/api/chats/recent') return [{ avatar: 'A.png', file_name: 'inactive.jsonl', chat_metadata: { world_info: 'old' } }];
            if (path === '/api/chats/get') return structuredClone(chat);
            if (path === '/api/chats/save') { chat = structuredClone(body.chat); return { ok: true }; }
            throw Error(path);
        },
    });
    assert.deepEqual(selected, ['new', 'other']);
    assert.deepEqual(state.charLore[0].extraBooks, ['new']);
    assert.equal(powerUser.persona_descriptions.a.lorebook, 'new');
    assert.equal(chat[0].chat_metadata.world_info, 'new');
    assert.deepEqual(chat[1], originalMessage);
});
