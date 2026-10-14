export const DATA_KEY = 'memoryCabinetV1';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const BACKUP_MARKER = '§MEMORY_CABINET_BACKUP_V1§';
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function parseImport(text) {
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('10 MiB 이하의 JSON 파일을 선택해 주세요.');
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('올바른 JSON 파일이 아닙니다. ZIP 파일은 기억 데이터가 아닙니다.'); }
    if (Array.isArray(value)) {
        // A single exported chat header is unambiguous; never choose one of many chats.
        const headers = value.filter(row => row?.chat_metadata?.[DATA_KEY] || row?.metadata?.[DATA_KEY]);
        if (headers.length !== 1) throw new Error('기억 데이터가 들어 있는 채팅 하나를 내보내 주세요.');
        value = headers[0];
    }
    let data = value?.[DATA_KEY] || value?.metadata?.[DATA_KEY] || value?.chat_metadata?.[DATA_KEY]
        || value?.chat?.metadata?.[DATA_KEY];
    if (!data && (value?.format === 'memory-vault' || value?.marker === BACKUP_MARKER)) data = value.data;
    if (!data && value?.entries) {
        const backups = Object.values(value.entries).filter(entry => (entry.enabled === false || entry.disable === true)
            && String(entry.content || '').startsWith(BACKUP_MARKER));
        if (backups.length !== 1) throw new Error('구조화 백업이 하나 들어 있는 보관함 로어북을 선택해 주세요.');
        try {
            const payload = JSON.parse(backups[0].content.slice(BACKUP_MARKER.length).trim());
            if (payload.marker !== BACKUP_MARKER) throw new Error('marker');
            data = payload.data;
        } catch { throw new Error('로어북의 구조화 백업이 올바르지 않습니다.'); }
    }
    data ||= value;
    if (!record(data) || !Array.isArray(data.items)
        || (data.elementMemory !== undefined && (!record(data.elementMemory) || !Array.isArray(data.elementMemory.entities)))
        || (data.wiki !== undefined && (!record(data.wiki) || !Array.isArray(data.wiki.docs)))) {
        throw new Error('memoryCabinetV1 기억 데이터가 없습니다. 확장 설치 ZIP과 실제 RP 기억 데이터는 별개입니다.');
    }
    if ((data.version !== undefined && data.version !== 1) || data.items.some(item => !record(item))
        || data.elementMemory?.entities?.some(item => !record(item))
        || data.wiki?.docs?.some(doc => !record(doc) || !Array.isArray(doc.sections) || doc.sections.some(section => !record(section)))) {
        throw new Error('지원하지 않는 버전이거나 기억 항목 형식이 올바르지 않습니다.');
    }
    if (data.elementMemory?.entities?.length > 400) throw new Error('요소 기억 400개 상한을 넘습니다. 분할 후 가져와 주세요.');
    if (data.wiki?.docs?.length > 400 || data.wiki?.docs?.some(doc => doc.sections?.length > 16)) {
        throw new Error('지원 상한(문서 400개, 문서당 섹션 16개)을 넘습니다. 분할 후 가져와 주세요.');
    }
    // Strip prototype-sensitive keys recursively before data reaches normalizers.
    return JSON.parse(JSON.stringify(data), (key, val) => ['__proto__', 'prototype', 'constructor'].includes(key) ? undefined : val);
}

export function exportData(data) {
    if (!record(data)) throw new Error('내보낼 기억이 없습니다.');
    return JSON.stringify({ format: 'memory-vault', version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}

export function downloadJson(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
