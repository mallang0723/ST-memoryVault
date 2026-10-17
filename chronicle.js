// Scene chronicle: message anchors, range identity and validation.
// Pure functions shared by host.js and extension.js. No DOM, no network.

function mix53(text, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
/** 106-bit non-cryptographic content hash: change detection, not security. */
export function strongHash(value) {
    const text = String(value ?? '');
    return mix53(text, 0x9e3779b1) + mix53(text, 0x85ebca77);
}

/** Message row as exposed by host `chats/:id/messages`. */
export function messageFingerprint(row) {
    return strongHash([String(row?.role || ''), Number(row?.activeSwipeIndex) || 0, String(row?.createdAt || ''), String(row?.name || ''), String(row?.content || '')].join('␟'));
}
export function stMessageRow(message, index) {
    return {
        id: `st-message:${index}`, role: message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant',
        content: String(message?.mes || ''), createdAt: String(message?.send_date || ''), name: message?.name,
        activeSwipeIndex: Number(message?.swipe_id) || 0,
    };
}
export function rangeHashOf(fingerprints) { return strongHash(fingerprints.join('|')); }
/** Hash of the inclusive [start,end] slice of host message rows. */
export function sliceHash(rows, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= rows.length) return '';
    return rangeHashOf(rows.slice(start, end + 1).map(messageFingerprint));
}
