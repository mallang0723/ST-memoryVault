// Retarget native links before a verified legacy WI copy can replace its source.
export async function retargetWorldInfoLinks(oldName, newName, { getContext, state, selected, powerUser, saveSettings, post }) {
    const replace = values => values?.map(value => value === oldName ? newName : value);
    const ctx = getContext();
    // Primary character links need the host's card editor, not a silent rewrite.
    // Fail closed rather than deleting a still-linked source.
    if (ctx.characters?.some(c => c.data?.extensions?.world === oldName)) {
        throw new Error('이 책이 캐릭터 기본 로어북에 연결돼 있습니다. 새 책으로 연결한 뒤 다시 동기화해 주세요. 옛 책은 보존했습니다.');
    }
    const desired = structuredClone({ state, selected, powerUser });
    desired.selected = replace(desired.selected);
    desired.state.globalSelect = replace(desired.state.globalSelect);
    for (const row of desired.state.charLore || []) row.extraBooks = replace(row.extraBooks);
    if (desired.powerUser.persona_description_lorebook === oldName) desired.powerUser.persona_description_lorebook = newName;
    for (const descriptor of Object.values(desired.powerUser.persona_descriptions || {})) {
        if (descriptor.lorebook === oldName) descriptor.lorebook = newName;
    }
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    {
        Object.assign(state, desired.state);
        selected.splice(0, selected.length, ...desired.selected);
        // Do not replace unrelated live persona preferences.
        powerUser.persona_description_lorebook = desired.powerUser.persona_description_lorebook;
        for (const [key, descriptor] of Object.entries(desired.powerUser.persona_descriptions || {})) {
            if (powerUser.persona_descriptions?.[key]?.lorebook === oldName) powerUser.persona_descriptions[key].lorebook = descriptor.lorebook;
        }
        await saveSettings();
        const response = await post('/api/settings/get', {});
        const saved = JSON.parse(response.settings);
        if (!equal(saved.world_info_settings?.world_info?.globalSelect || [], desired.selected)
            || !equal(saved.world_info_settings?.world_info?.charLore, desired.state.charLore)
            || saved.power_user?.persona_description_lorebook !== desired.powerUser.persona_description_lorebook
            || !equal(saved.power_user?.persona_descriptions, desired.powerUser.persona_descriptions)) {
            throw new Error('글로벌/페르소나 연결 저장을 확인하지 못했습니다. 옛 책을 보존했습니다.');
        }
    }
    // Recent with no max returns all accessible chats. Read only headers first;
    // fetch/rewrite full rows only for a native link that actually needs moving.
    const chats = await post('/api/chats/recent', { metadata: true });
    for (const row of chats) {
        if (row.chat_metadata?.world_info !== oldName) continue;
        const name = row.file_name.replace(/\.jsonl$/i, '');
        const current = getContext();
        if (String(name) === String(current.chatId) && (row.group ? String(row.group) === String(current.groupId) : row.avatar === current.characters?.[current.characterId]?.avatar)) continue;
        if (!row.avatar && !row.group) throw new Error('열리지 않은 채팅의 연결을 안전하게 이전할 수 없어 옛 책을 보존했습니다.');
        const path = row.group ? '/api/chats/group' : '/api/chats';
        const body = row.group ? { id: name } : { file_name: name, avatar_url: row.avatar };
        const data = await post(`${path}/get`, body);
        if (data?.[0]?.chat_metadata?.world_info !== oldName) continue;
        const updated = structuredClone(data);
        updated[0].chat_metadata.world_info = newName;
        // Refuse a concurrent change rather than clobbering a newer conversation.
        if (!equal(await post(`${path}/get`, body), data)) throw new Error('연결 이전 중 채팅이 변경되었습니다. 옛 책을 보존했습니다.');
        await post(`${path}/save`, { ...body, chat: updated });
        if (!equal(await post(`${path}/get`, body), updated)) throw new Error('채팅 연결 이전을 확인하지 못했습니다. 옛 책을 보존했습니다.');
    }
}
