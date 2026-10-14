import { parseImport, exportData, downloadJson, MAX_IMPORT_BYTES } from './migration.js';

// UI and memory rules migrated from the user-supplied Memory Vault v2.0.0.
// All engine access is isolated in host.js; no Marinara runtime is required.
export function mountMemoryVault(host) {
  "use strict";

  const VERSION = "2.0.0-st.1";
  const DATA_KEY = "memoryCabinetV1";
  const LEGACY_PROMISE_KEY = "promiseKeeperV1";
    const EXT_STORAGE_KEY = "memoryCabinetUiV1";
  const LOREBOOK_TAG = "memory-cabinet-rp";
  const PROMISE_ENTRY_TAG = "memory-cabinet-promises";
  const ANCHOR_ENTRY_TAG = "memory-cabinet-anchors-always";
  const KEYWORD_ENTRY_TAG = "memory-cabinet-anchor-keyword";
  const ELEMENT_HEADER_ENTRY_TAG = "memory-cabinet-element-header";
  const ELEMENT_FACT_ENTRY_TAG = "memory-cabinet-element-facts";
  const ELEMENT_TRIGGER_ENTRY_TAG = "memory-cabinet-element-trigger";
  const BACKUP_ENTRY_TAG = "memory-cabinet-structured-backup";
  const BOOK_MARKER = "§MEMORY_CABINET_RP_V1§";
  const PROMISE_MARKER = "§MEMORY_CABINET_PROMISES_V1§";
  const ANCHOR_MARKER = "§MEMORY_CABINET_ANCHORS_V1§";
  const KEYWORD_MARKER = "§MEMORY_CABINET_KEYWORD_V1§";
  const ELEMENT_MARKER = "§MEMORY_CABINET_ELEMENT_V1§";
  const ELEMENT_TRIGGER_MARKER = "§MEMORY_CABINET_ELEMENT_TRIGGER_V1§";
  const BACKUP_MARKER = "§MEMORY_CABINET_BACKUP_V1§";
  const WIKI_HEADER_ENTRY_TAG = "memory-cabinet-wiki-header";
  const WIKI_ALWAYS_ENTRY_TAG = "memory-cabinet-wiki-always";
  const WIKI_DOC_ENTRY_TAG = "memory-cabinet-wiki-doc";
  const WIKI_TRIGGER_ENTRY_TAG = "memory-cabinet-wiki-trigger";
  const WIKI_MARKER = "\u00a7MEMORY_CABINET_WIKI_V1\u00a7";
  const WIKI_ALWAYS_MARKER = "\u00a7MEMORY_CABINET_WIKI_ALWAYS_V1\u00a7";
  const WIKI_TRIGGER_MARKER = "\u00a7MEMORY_CABINET_WIKI_TRIGGER_V1\u00a7";
  const WIKI_DOC_LIMIT = 400;
  // 섹션 본문의 권장 상한과, 기존 데이터를 조용히 버리지 않기 위한 안전 상한.
  const WIKI_SECTION_BODY_MAX = 8000;
  const WIKI_SECTION_BODY_HARD_MAX = 60000;
  const WIKI_SUMMARY_MAX = 400;
  const WIKI_SECTION_MAX_LEVEL = 3;
  const WIKI_IMAGE_LIMIT = 8;
  // v2: 테마는 하나다. 테마 하나가 보관함 전체와 위키 문서 색을 같이 정한다.
  // 예전 위키 전용 테마(wikiTheme: green)는 전역 "아카이브 그린"으로 옮겨진다.
  const UI_THEMES = [
    { id: "ribbon", label: "리본 라일락", help: "차분한 기본 보라" },
    { id: "rose", label: "스토리 로즈", help: "로즈 먹색의 감성" },
    { id: "green", label: "아카이브 그린", help: "예전 위키 그린을 보관함 전체로" },
    { id: "sillytavern", label: "SillyTavern 테마 따르기", help: "호스트 색에서 계산 · 밝음/어두움 자동" },
  ];
  const UI_THEME_IDS = UI_THEMES.map((row) => row.id);
  const TAB_IDS = ["overview", "promise", "anchor", "element", "wiki"];
  const WIKI_SECTION_LIMIT = 16;
  const WIKI_CANDIDATE_LIMIT = 8;
  const WIKI_CATEGORY_LABEL = {
    character: "등장인물",
    relationship: "관계",
    place: "장소",
    object: "물건",
    event: "사건·사고",
    organization: "조직·세력",
    lore: "세계관·규칙",
    misc: "기타",
  };
  const WIKI_SOURCE_KIND_LABEL = { element: "요소 기억", anchor: "기억 앵커", promise: "약속", summary: "요약", message: "대화 원문", manual: "직접 입력" };

  const DEFAULT_WIKI_DRAFT_PROMPT = `You are an archivist writing a reference wiki for an ongoing roleplay.
You do not invent facts. You only organize and narrate what the supplied records already state.

Write for a human reader who wants to look something up later, not for the model.
Each document covers exactly one subject: one person, one relationship, one place, one object, one incident, one organization, or one world rule.
Prefer a short "한눈에 보는 개요" of one or two sentences, then sections with concrete detail.
Use Korean unless the records are clearly in another language.
Attach a citation marker such as [1] or [2] to sentences that come from a specific supplied record, using the numbers shown in the source list.
Leave a sentence uncited only when it is a neutral connecting sentence.
Do not create a document when the records contain nothing durable about that subject.`;

  const DEFAULT_WIKI_UPDATE_PROMPT = `You are revising an existing wiki document using newly recorded memories.
Keep the document's existing voice, structure, and section headings.
Change only what the new records actually contradict or add. Do not rewrite untouched paragraphs.
Never propose a change to a section marked USER-LOCKED. If a new record conflicts with a locked section, report it in "conflicts" instead.
Do not invent facts that the supplied records do not state.
Return the full new body for each section you want to change, not a partial diff.`;

  const DEFAULT_WIKI_INJECTION_PROMPT = `The following wiki documents are the established reference for this story's world, people, and places.
Treat them as already-known background, not as new information to announce.
Stay consistent with them when they are relevant, and do not recite or quote the documents themselves.
When a wiki document and an older recalled scene disagree, the wiki document is the later, authoritative state.`;
  const ROOT_ID = "mmc-root-v1";
  const LAUNCHER_ID = "mmc-launcher-v1";
  const TOAST_ID = "mmc-toast-v1";
  const API_TIMEOUT_MS = 20000;
  const MODEL_TIMEOUT_MS = 180000;
  const ELEMENT_CHUNK_CHARS = 42000;
  const ELEMENT_CANDIDATE_LIMIT = 40;
  const SUMMARY_UPDATE_MODE_LABEL = { notify_only: "알림만", notify_model: "알림 + 모델 정리 버튼", auto_review: "자동 분석 후 승인 대기", auto_apply: "완전 자동 적용 (실험적)" };

  const DEFAULT_ELEMENT_EXTRACTION_PROMPT = `You maintain a compact continuity ledger for an ongoing roleplay. This is not an event summary.
Record only per-entity facts that must stay consistent later.

Test every fact: if this entity reappears 50 turns from now and the writer does not know this fact, would the world contradict itself?

Record durable object attributes, condition, current location, ownership, agreed use, notable usage history, lasting place features, and lasting preferences or possessions.
Do not record one-off actions, scene decoration, ordinary use, plot-event summaries, emotional beats, or facts already obvious from the character/persona description.
Write short labelled fragments, not narrative sentences.
Good: \"노란색\" / \"상태: 고장\" / \"위치: 작업실\" / \"U 선호: 소다\"
Bad: \"이준이가 컴퓨터를 고쳐서 다시 책상 위에 올려두었다\"

currentFacts = what is true now. historyFacts = what was true before, or a durable past fact about the entity.
When a current fact is replaced, put the new value in currentFacts and set replacesFactId to the existing fact it supersedes.
Returning zero entities is correct when nothing durable appeared.`;

  const DEFAULT_ELEMENT_INJECTION_PROMPT = `The following element memories contain persistent world-state facts relevant to the current context.
Treat them as already-established continuity, not as new information to announce.
Preserve current states, possessions, locations, preferences, and object details naturally when relevant.
Do not force them into the scene, recite the list, or mention consulting memory.
When current and historical facts differ, current facts take precedence.`;
  // 확장이 고정하는 언어 규약. 사용자 지침을 고쳐도 이 규칙은 유지된다.
  const LANGUAGE_CONTRACT = [
    "Language rule (fixed by the extension, do not override):",
    "- Write every canonical field in the SAME language as the supplied source. Never translate the source into Korean.",
    "- When the source language is not Korean, additionally return the matching *Ko field with a short Korean rendering for display only.",
    "- When the source is already Korean, omit every *Ko field.",
    "- The *Ko fields are for the reader's screen. They are never sent back into the roleplay.",
  ].join("\n");
  const KEYWORD_LANGUAGE_CONTRACT = [
    "Keyword-anchor rule (fixed by the extension, do not override):",
    "- When an AI-created or AI-updated anchor uses activation=keyword and the source language is not Korean, keywords MUST contain useful source-language terms AND their corresponding Korean terms in the same keywords array.",
    "- Example: hospital, surgery, 병원, 수술.",
    "- Do not add forced translations for a Korean-language source, and do not alter user-authored manual keywords.",
  ].join("\n");
  const ADVANCED_MEMORY_PRIORITY_RULE = "When these current facts conflict with an older scene or summary recalled by Advanced Memory, treat these current facts as the latest authoritative state.";

  const DEFAULT_REVIEW_PROMPT = [
    "Compare newly created roleplay summaries with the current promise and memory-anchor records.",
    "Classify only durable information that will matter in later roleplay continuity.",
    "PROMISE means an explicit agreed future action, plan, appointment, duty, or commitment. Do not convert wishes, emotions, or guesses into promises.",
    "MEMORY ANCHOR means a relationship change, lasting current state, unresolved ongoing event, stable preference, canon fact, or explicit caution whose loss would materially break continuity.",
    "Prefer updating an existing record when the new summary supersedes it. Do not keep contradictory old and new states active at the same time.",
    "Mark a promise complete only when the source clearly says it was fulfilled. Archive an anchor only when the source clearly makes the old state obsolete.",
    "For anchors, assign lifespan=permanent for durable facts, current_state for temporary ongoing states, and until_event for unresolved threads that should retire when resolved.",
    "Write titles and contents in the same language as the source. Do not translate an English roleplay into Korean.",
  ].join("\n");

  const PRIORITY_WEIGHT = { high: 0, normal: 1, low: 2 };
  const PRIORITY_LABEL = { high: "중요", normal: "보통", low: "낮음" };
  const PROMISE_STATUS_LABEL = { active: "진행 중", hold: "보류", done: "완료", cancelled: "취소" };
  const ANCHOR_CATEGORY_LABEL = {
    relationship: "관계",
    state: "현재 상태",
    event: "진행 사건",
    preference: "성향·취향",
    setting: "설정·사실",
    caution: "주의",
  };
  const ANCHOR_LIFESPAN_LABEL = { permanent: "영구", current_state: "현재 상태", until_event: "사건 종료까지" };
  const REVIEW_ACTION_LABEL = { add: "추가", update: "갱신", keep: "유지", complete: "완료", archive: "보관" };
  const REVIEW_TYPE_LABEL = { promise: "약속", anchor: "앵커" };

  const iconSvg = (body, strokeWidth = 1.8) => `<svg class="mmc-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

  const SVG = {
    // A bookmarked index card: deliberately different from OOC Studio's archive-box icon.
    memory: iconSvg('<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M9 3.5v7l3-1.9 3 1.9v-7"/><path d="M8 14.5h8M8 17.5h5"/>'),
    close: iconSvg('<path d="M6 6l12 12M18 6 6 18"/>', 2),
    help: iconSvg('<circle cx="12" cy="12" r="9"/><path d="M9.8 9.4a2.5 2.5 0 0 1 4.8.9c0 1.9-2.6 2.2-2.6 4"/><path d="M12 17.3h.01"/>', 1.9),
    // Simple sliders are more robust than the previous complex gear path under host SVG styles.
    gear: iconSvg('<path d="M4 7h6M14 7h6M4 17h10M18 17h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>'),
    plus: iconSvg('<path d="M12 5v14M5 12h14"/>', 2),
    spark: iconSvg('<path d="M12 3l1.2 4L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-2L12 3Z"/><path d="M5 15.5l.7 2.2L8 19l-2.3 1.3L5 22.5l-.7-2.2L2 19l2.3-1.3L5 15.5Z"/>'),
    message: iconSvg('<path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h8M8 13h5"/>'),
    summary: iconSvg('<path d="M6 3.5h8l4 4V20.5H6Z"/><path d="M14 3.5v4h4M9 11h6M9 14.5h6M9 18h4"/>'),
    pin: iconSvg('<path d="M14.5 4.5l5 5-2.5 1-4 4-.8 4.7-2.4-2.4-2.4-2.4 4.7-.8 4-4 1-2.5-5-5"/><path d="M4.5 19.5l5-5"/>'),
    edit: iconSvg('<path d="M5 19l3.8-.8L18.5 8.5 15.5 5.5 5.8 15.2 5 19Z"/><path d="M13.8 7.2l3 3"/>'),
    trash: iconSvg('<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13M10 10.5v6M14 10.5v6"/>'),
    sync: iconSvg('<path d="M19 8V4.5l-2 2A7 7 0 0 0 5.5 9"/><path d="M5 16v3.5l2-2A7 7 0 0 0 18.5 15"/>'),
    overview: iconSvg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    promise: iconSvg('<path d="M4 6.5l1.5 1.5L8.5 5"/><path d="M4 12.5l1.5 1.5 3-3"/><path d="M4.5 18.5h3"/><path d="M11.5 6.5h8.5M11.5 12.5h8.5M11.5 18.5h8.5"/>'),
    anchor: iconSvg('<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5V20"/><path d="M8.5 11h7"/><path d="M5 13.5a7 7 0 0 0 14 0"/>'),
    element: iconSvg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M10 7.5h4"/><path d="M8.5 14h7M8.5 17h4.5"/>'),
    wiki: iconSvg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.4 3.6 5.2 3.6 8.5s-1.1 6.1-3.6 8.5c-2.5-2.4-3.6-5.2-3.6-8.5s1.1-6.1 3.6-8.5Z"/>'),
    book: iconSvg('<path d="M5 4.5h11.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2V4.5Z"/><path d="M5 18a2 2 0 0 1 2-2h11.5"/>'),
    inbox: iconSvg('<path d="M4 13.5l2.2-7.2a1.5 1.5 0 0 1 1.4-1.1h8.8a1.5 1.5 0 0 1 1.4 1.1l2.2 7.2V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z"/><path d="M4 13.5h4.5l1.2 2h4.6l1.2-2H20"/>'),
    info: iconSvg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/>', 2),
    lock: iconSvg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    back: iconSvg('<path d="M14.5 6l-6 6 6 6"/>', 2),
    chevron: iconSvg('<path d="M9.5 6l6 6-6 6"/>', 2),
    more: iconSvg('<circle cx="6" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="18" cy="12" r=".8"/>', 2.4),
    eye: iconSvg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
    warn: iconSvg('<path d="M12 4l9 16H3L12 4Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>', 1.9),
    search: iconSvg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', 1.9),
  };

  let state = {
    chats: [],
    connections: [],
    selectedChatId: "",
    activeTab: "overview",
    filter: "active",
    promiseSelectedId: "",
    promisePane: "list",
    settingsTab: "screen",
    elementSearch: "",
    elementTestText: "",
    elementDraft: null,
    elementCandidates: [],
    elementCandidateSelected: new Set(),
    elementExtractInfo: null,
    elementCandidateOverflow: 0,
    elementExtractMode: "recent",
    wikiSelectedId: "",
    wikiSearch: "",
    wikiCategoryFilter: "all",
    wikiDraft: null,
    wikiCandidates: [],
    wikiCandidateSelected: new Set(),
    wikiDraftTopic: "",
    wikiSourceRows: [],
    wikiSourceSelected: new Set(),
    wikiProposalDocId: "",
    wikiProposalSelected: new Set(),
    wikiHistory: [],
    koDisplay: "auto",
    agentNotice: { checked: false, memoryNag: "unknown", longTermMemory: "unknown" },
    agentNoticeDismissed: {},
    elementExtractTurns: 20,
    elementRangeStart: 1,
    elementRangeEnd: 20,
    expanded: { promise: false, anchor: false },
    currentChat: null,
    currentData: null,
    ownership: { status: "unknown", reason: "", ownerChatId: "", evidence: "", backup: null, discoveryChecked: false },
    quarantinedData: null,
    ownershipDetachLorebookIds: [],
    draft: null,
    layer: null,
    helpTab: "usage",
    sourceMode: "messages",
    sourceRows: [],
    sourceSelected: new Set(),
    sourceTarget: "anchor",
    modelConnectionId: "",
    uiFontSize: "normal",
    uiThemeMode: "ribbon",
    reviewPrompt: DEFAULT_REVIEW_PROMPT,
    reviewExtraInstruction: "",
    summaryKnownByChat: {},
    summaryAutoAttemptByChat: {},
    summaryUpdateMode: "notify_model",
    autoReviewBusy: false,
    pendingSummaryRows: [],
    summaryCheckBusy: false,
    passiveFetchCleanup: null,
    candidates: [],
    candidateSelected: new Set(),
    reviewCandidates: [],
    reviewSelected: new Set(),
    reviewSourceRows: [],
    evidenceView: null,
    healthCandidates: [],
    healthSelected: new Set(),
    rawRecovery: null,
    busy: false,
    busyText: "",
    busyStartedAt: 0,
    busyTimer: null,
    syncing: false,
  };

  const cleanupFns = [];
  const on = (target, type, handler, options) => {
    target?.addEventListener?.(type, handler, options);
    cleanupFns.push(() => target?.removeEventListener?.(type, handler, options));
  };

  function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function parseRecord(value) {
    if (isRecord(value)) return value;
    if (typeof value === "string" && value.trim()) {
      try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed : {}; } catch {}
    }
    return {};
  }
  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }
  function uid(prefix = "mmc") {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }
  function nowIso() { return new Date().toISOString(); }
  function truncate(value, max = 180) {
    const text = String(value || "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  function normalizeApiPath(path) { return String(path || "").replace(/^\/?api\//, "").replace(/^\/+/, ""); }
  function extractArray(payload, keys = ["items", "results", "chats", "connections", "messages", "entries", "lorebooks"]) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data)) return payload.data;
    for (const key of keys) if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    return [];
  }
  function chatMode(chat) {
    return String(chat?.mode || chat?.chatMode || chat?.type || parseRecord(chat?.metadata).mode || "").toLowerCase();
  }
  function isRpChat(chat) {
    const mode = chatMode(chat);
    return ["roleplay", "role_play", "rp", "visual_novel", "visual-novel", "vn"].includes(mode);
  }
  function chatLabel(chat) { return String(chat?.name || chat?.title || chat?.displayName || "이름 없는 RP"); }
  function chatSelectLabel(chat) {
    const name = chatLabel(chat);
    const branchName = String(parseRecord(chat?.metadata).branchName || "").trim();
    return branchName ? `${name} · ${branchName}` : name;
  }
  function chatRecentTime(chat) {
    const metadata = parseRecord(chat?.metadata);
    const value = chat?.lastMessageAt || metadata.lastMessageAt || chat?.updatedAt || metadata.updatedAt || "";
    if (typeof value === "number" && Number.isFinite(value)) return value < 100000000000 ? value * 1000 : value;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : 0;
  }
  function roleLabel(role) { return role === "assistant" ? "NPC" : role === "user" ? "U" : String(role || "기록"); }
  function sourceDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  }
  function estimateTokens(text) {
    const s = String(text || "");
    let units = 0;
    for (let i = 0; i < s.length; i++) {
      const code = s.codePointAt(i);
      if (code > 0xffff) i += 1;
      const dense = (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) ||
        (code >= 0xac00 && code <= 0xd7af) || (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x3400 && code <= 0x9fff) || code > 0xffff;
      units += dense ? 4 : 1;
    }
    return Math.ceil(units / 4);
  }

  function textHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }

  function summaryRowsFromMetadata(metadata) {
    const meta = parseRecord(metadata);
    let rows = safeArray(meta.summaryEntries).filter((row) => row && row.enabled !== false && String(row.content || "").trim());
    if (!rows.length && String(meta.summary || "").trim()) {
      rows = [{ id: "legacy-summary", title: "현재 통합 요약", content: String(meta.summary), origin: "legacy", enabled: true, updatedAt: meta.updatedAt || "" }];
    }
    return rows.slice().sort((a, b) => String(a.createdAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.updatedAt || "")));
  }

  function summarySignature(row) {
    return `${String(row?.id || "summary")}|${String(row?.updatedAt || row?.createdAt || "")}|${textHash(row?.content || "")}`;
  }

  function summaryBatchKey(rows = state.pendingSummaryRows) {
    return safeArray(rows).map(summarySignature).sort().join("||");
  }

  function hasUnsavedCandidateLayer() {
    if (state.layer === "candidates") return state.candidates.length > 0;
    if (state.layer === "review-candidates") return state.reviewSourceRows.length > 0;
    if (state.layer === "health-candidates") return state.healthCandidates.length > 0;
    if (state.layer === "element-candidates") return state.elementCandidates.length > 0;
    if (state.layer === "wiki-candidates") return state.wikiCandidates.length > 0;
    if (state.layer === "wiki-editor") return !!state.wikiDraft;
    if (state.layer === "raw-repair") return !!state.rawRecovery?.text;
    return false;
  }

  function candidateCloseMessage() {
    if (state.layer === "review-candidates") return "약속·앵커 갱신 후보는 이 RP에 보관됩니다. 나중에 다시 확인할 수 있습니다.";
    if (state.layer === "health-candidates") return "아직 적용하지 않은 기억 건강검진 제안이 있습니다.\n정말 닫을까요? 닫으면 이번 모델 결과는 사라집니다.";
    if (state.layer === "element-candidates") return "아직 저장하지 않은 요소 기억 후보가 있습니다.\n정말 닫을까요? 닫으면 이번 모델 결과는 사라집니다.";
    if (state.layer === "wiki-candidates") return "아직 저장하지 않은 위키 초안이 있습니다.\n정말 닫을까요? 닫으면 이번 모델 결과는 사라집니다.";
    if (state.layer === "wiki-editor") return "편집 중인 위키 문서가 있습니다.\n정말 닫을까요? 저장하지 않은 수정은 사라집니다.";
    if (state.layer === "raw-repair") return "아직 복구하지 않은 모델 원문 응답이 있습니다.\n정말 닫을까요? 닫으면 이번 응답 원문은 사라집니다.";
    return "아직 저장하지 않은 모델 후보가 있습니다.\n정말 닫을까요? 닫으면 이번 모델 결과는 사라집니다.";
  }

  function clearLayerDrafts(layer = state.layer) {
    if (layer === "candidates") { state.candidates = []; state.candidateSelected.clear(); }
    if (layer === "review-candidates") return;
    if (layer === "health-candidates") { state.healthCandidates = []; state.healthSelected.clear(); }
    if (layer === "element-candidates") { state.elementCandidates = []; state.elementCandidateSelected.clear(); state.elementExtractInfo = null; state.elementCandidateOverflow = 0; }
    if (layer === "element-editor") state.elementDraft = null;
    if (layer === "wiki-candidates") { state.wikiCandidates = []; state.wikiCandidateSelected.clear(); }
    if (layer === "wiki-editor") state.wikiDraft = null;
    if (layer === "wiki-draft") { state.wikiSourceRows = []; state.wikiSourceSelected.clear(); }
    if (layer === "wiki-proposal") { state.wikiProposalDocId = ""; state.wikiProposalSelected.clear(); }
    if (layer === "evidence") state.evidenceView = null;
    if (layer === "raw-repair") state.rawRecovery = null;
    if (layer === "editor") state.draft = null;
  }

  function requestCloseLayer({ force = false } = {}) {
    if (!state.layer) return true;
    if (!force && state.layer !== "review-candidates" && hasUnsavedCandidateLayer() && !window.confirm(candidateCloseMessage())) return false;
    const closing = state.layer;
    clearLayerDrafts(closing);
    state.layer = null;
    state.draft = null;
    render();
    return true;
  }

  function updateCandidateSelectionDom(kind, input) {
    const row = input?.closest?.(".mmc-candidate");
    const list = row?.closest?.(".mmc-candidate-list");
    if (!row || !list) return;
    row.classList.toggle("is-selected", !!input.checked);
    if (input.checked) {
      list.prepend(row);
    } else {
      const selectedRows = Array.from(list.querySelectorAll(".mmc-candidate.is-selected"));
      const lastSelected = selectedRows[selectedRows.length - 1];
      if (lastSelected) lastSelected.after(row); else list.append(row);
    }
    const set = kind === "review" ? state.reviewSelected : kind === "health" ? state.healthSelected : state.candidateSelected;
    const buttonSelector = kind === "review" ? '[data-action="apply-review"]' : kind === "health" ? '[data-action="apply-health"]' : '[data-action="save-candidates"]';
    const button = document.querySelector(buttonSelector);
    if (button) {
      button.disabled = set.size <= 0;
      button.textContent = kind === "candidate" ? `선택 ${set.size}개 추가` : `선택 ${set.size}개 적용`;
    }
    const count = document.querySelector(`[data-selected-count="${kind}"]`);
    if (count) count.textContent = `선택됨 ${set.size}개`;
  }

  async function api(path, options = {}) {
    return host.api(path, { ...options, chatId: path === "chats" || path === "connections" ? undefined : state.selectedChatId });
  }

  function defaultData() {
    return {
      version: 1,
      ownerChatId: "",
      enabled: true,
      items: [],
      maxPromises: 8,
      maxAnchors: 10,
      anchorBudgetChars: 2400,
      lorebookId: "",
      promiseEntryId: "",
      anchorEntryId: "",
      backupEntryId: "",
      keywordEntryIds: {},
      elementMemory: {
        schemaVersion: 1,
        originChatId: "",
        entities: [],
        connectionId: "",
        extractionPrompt: "",
        injectionPrompt: "",
        injectionEnabled: false,
        extractTurns: 20,
        headerEntryId: "",
        entityEntryIds: {},
      },
      wiki: {
        schemaVersion: 1,
        originChatId: "",
        docs: [],
        connectionId: "",
        draftPrompt: "",
        updatePrompt: "",
        injectionPrompt: "",
        injectionEnabled: false,
        alwaysBudgetChars: 1200,
        proposals: [],
        headerEntryId: "",
        alwaysEntryId: "",
        docEntryIds: {},
      },
      pendingReview: null,
      lastAutoReviewUndo: null,
      lastSyncAt: "",
      lastSyncError: "",
      legacyImportedAt: "",
      updatedAt: "",
    };
  }

  function normalizePromise(item = {}) {
    return {
      id: String(item.id || uid("promise")),
      type: "promise",
      title: String(item.title || "새 약속"),
      content: String(item.content || item.note || item.quote || ""),
      titleKo: normalizeKoText(item.titleKo, item.title, 200),
      contentKo: normalizeKoText(item.contentKo, item.content, 4000),
      status: ["active", "hold", "done", "cancelled"].includes(item.status) ? item.status : "active",
      priority: ["high", "normal", "low"].includes(item.priority) ? item.priority : "normal",
      scheduleText: String(item.scheduleText || ""),
      sourceType: String(item.sourceType || "manual"),
      sourceIds: safeArray(item.sourceIds || (item.sourceMessageId ? [item.sourceMessageId] : [])).map(String),
      sourceQuote: String(item.sourceQuote || item.quote || ""),
      createdAt: String(item.createdAt || nowIso()),
      updatedAt: String(item.updatedAt || item.createdAt || nowIso()),
    };
  }

  function normalizeAnchor(item = {}) {
    const activation = item.activation === "keyword" ? "keyword" : "always";
    return {
      id: String(item.id || uid("anchor")),
      type: "anchor",
      title: String(item.title || "새 기억 앵커"),
      content: String(item.content || item.note || item.quote || ""),
      titleKo: normalizeKoText(item.titleKo, item.title, 200),
      contentKo: normalizeKoText(item.contentKo, item.content, 4000),
      category: Object.prototype.hasOwnProperty.call(ANCHOR_CATEGORY_LABEL, item.category) ? item.category : "setting",
      priority: ["high", "normal", "low"].includes(item.priority) ? item.priority : "normal",
      active: item.active !== false,
      archived: item.archived === true,
      activation,
      keywords: safeArray(item.keywords).map((x) => String(x).trim()).filter(Boolean).slice(0, 24),
      lifespan: Object.prototype.hasOwnProperty.call(ANCHOR_LIFESPAN_LABEL, item.lifespan) ? item.lifespan : "permanent",
      sourceType: String(item.sourceType || "manual"),
      sourceIds: safeArray(item.sourceIds).map(String),
      sourceQuote: String(item.sourceQuote || ""),
      createdAt: String(item.createdAt || nowIso()),
      updatedAt: String(item.updatedAt || item.createdAt || nowIso()),
    };
  }

  function normalizeItem(item = {}) { return item?.type === "anchor" ? normalizeAnchor(item) : normalizePromise(item); }

  // 한글이 들어 있으면 한국어, 라틴 문자만 있으면 영어로 본다. 애매하면 어느 쪽도 아니다.
  function hasHangul(value) { return /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/.test(String(value || "")); }
  function hasLatin(value) { return /[A-Za-z]/.test(String(value || "")); }
  function seedKeywordsByScript(value) {
    const text = String(value || "").trim();
    if (!text) return { ko: [], en: [] };
    if (hasHangul(text)) return { ko: [text], en: [] };
    if (hasLatin(text)) return { ko: [], en: [text] };
    return { ko: [], en: [] };
  }
  // 표시 언어. 원문(canonical)은 절대 바꾸지 않고, 번역이 있을 때만 화면에서 골라 보여준다.
  // RP에 주입하는 쪽은 언제나 원문을 쓰므로 이 함수는 화면 표시에만 쓴다.
  function koDisplayOn() { return state.koDisplay !== "original"; }
  function displayText(original, korean) {
    return koDisplayOn() && String(korean || "").trim() ? String(korean) : String(original || "");
  }
  function hasKoText(...values) { return values.some((value) => String(value || "").trim()); }
  // 표시용 한국어 번역. 원문과 같거나 비어 있으면 저장하지 않는다.
  function normalizeKoText(value, original, maxChars) {
    const text = String(value || "").trim().slice(0, maxChars);
    if (!text) return "";
    if (text === String(original || "").trim()) return "";
    return text;
  }
  function normalizeTextList(value, max = 8, maxChars = 120) {
    const out = [];
    const seen = new Set();
    for (const raw of safeArray(value)) {
      const text = String(raw || "").trim().replace(/\s+/g, " ").slice(0, maxChars);
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key); out.push(text);
      if (out.length >= max) break;
    }
    return out;
  }
  function normalizeTriggerGroups(value) {
    const out = []; const seen = new Set();
    for (const raw of safeArray(value)) {
      const terms = normalizeTextList(Array.isArray(raw) ? raw : String(raw || "").split(/[,＋+]/), 4, 80);
      if (terms.length < 2) continue;
      const key = terms.map((x) => x.toLocaleLowerCase()).sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key); out.push(terms);
      if (out.length >= 8) break;
    }
    return out;
  }
  function normalizeElementFact(value = {}) {
    const text = String(value.text || value.content || "").trim().slice(0, 300);
    if (!text) return null;
    const sourceRaw = isRecord(value.source) ? value.source : null;
    const source = sourceRaw ? {
      messageIds: normalizeTextList(sourceRaw.messageIds, 24, 120),
      fingerprints: normalizeTextList(sourceRaw.fingerprints, 24, 120),
      activeSwipeIndex: Number.isInteger(sourceRaw.activeSwipeIndex) ? sourceRaw.activeSwipeIndex : 0,
      contentHash: String(sourceRaw.contentHash || ""),
    } : null;
    return { id: String(value.id || uid("elf")), text, textKo: normalizeKoText(value.textKo, text, 300), source, createdAt: String(value.createdAt || nowIso()) };
  }
  function elementFactKey(value) { return String(value?.text || value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function uniqueElementFacts(value) {
    const seen = new Set();
    const out = [];
    for (const raw of safeArray(value)) {
      const fact = normalizeElementFact(raw);
      const key = elementFactKey(fact);
      if (!fact || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
    }
    return out;
  }
  function balanceElementFacts(currentValue, historyValue) {
    const allCurrent = uniqueElementFacts(currentValue);
    const currentFacts = allCurrent.slice(-8);
    const overflow = allCurrent.slice(0, Math.max(0, allCurrent.length - 8));
    const currentKeys = new Set(currentFacts.map(elementFactKey));
    const historyFacts = uniqueElementFacts([...safeArray(historyValue), ...overflow]).filter((fact) => !currentKeys.has(elementFactKey(fact)));
    return { currentFacts, historyFacts };
  }
  function normalizeElement(value = {}) {
    const facts = balanceElementFacts(value.currentFacts, value.historyFacts);
    return {
      id: String(value.id || uid("element")),
      name: String(value.name || "새 요소").trim().slice(0, 80),
      nameKo: normalizeKoText(value.nameKo, String(value.name || "").trim().slice(0, 80), 80),
      aliases: normalizeTextList(value.aliases, 8, 80),
      standaloneTriggers: normalizeTextList(value.standaloneTriggers, 8, 80),
      triggerGroups: normalizeTriggerGroups(value.triggerGroups),
      currentFacts: facts.currentFacts,
      historyFacts: facts.historyFacts,
      createdAt: String(value.createdAt || nowIso()),
      updatedAt: String(value.updatedAt || value.createdAt || nowIso()),
    };
  }
  function normalizeElementMemory(value = {}) {
    const raw = parseRecord(value);
    return {
      schemaVersion: 1,
      originChatId: String(raw.originChatId || ""),
      entities: safeArray(raw.entities).map(normalizeElement).slice(0, 400),
      connectionId: String(raw.connectionId || ""),
      extractionPrompt: String(raw.extractionPrompt || "").slice(0, 8000),
      injectionPrompt: String(raw.injectionPrompt || "").slice(0, 8000),
      injectionEnabled: raw.injectionEnabled === true,
      extractTurns: Math.max(1, Math.min(100, Number(raw.extractTurns) || 20)),
      headerEntryId: String(raw.headerEntryId || ""),
      entityEntryIds: parseRecord(raw.entityEntryIds),
    };
  }

  function normalizeWikiSection(value = {}) {
    const raw = parseRecord(value);
    const heading = String(raw.heading || raw.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
    // 권장 상한(WIKI_SECTION_BODY_MAX)은 저장 단계에서 경고로 막는다. 여기서는 이미 저장된
    // 사용자 본문을 조용히 잘라 없애지 않도록 훨씬 큰 안전 상한만 적용한다.
    const body = String(raw.body ?? raw.content ?? "").replace(/\r\n?/g, "\n").slice(0, WIKI_SECTION_BODY_HARD_MAX);
    if (!heading && !body.trim()) return null;
    const level = Math.max(1, Math.min(WIKI_SECTION_MAX_LEVEL, Number(raw.level) || 1));
    return {
      id: String(raw.id || uid("wsec")),
      heading: heading || "본문",
      headingKo: normalizeKoText(raw.headingKo, heading, 120),
      body,
      bodyKo: normalizeKoText(raw.bodyKo, body, WIKI_SECTION_BODY_HARD_MAX),
      level,
      managed: raw.managed === "user" ? "user" : "ai",
      updatedAt: String(raw.updatedAt || nowIso()),
    };
  }
  // 이미지 바이너리는 저장하지 않는다. http(s) 또는 같은 호스트 경로만 허용한다.
  function normalizeWikiImage(value = {}) {
    const raw = parseRecord(value);
    const url = String(raw.url || "").trim().slice(0, 1000);
    if (!url) return null;
    const safe = /^https?:\/\//i.test(url) || /^\/[^/\\]/.test(url);
    if (!safe) return null;
    return {
      id: String(raw.id || uid("wimg")),
      url,
      alt: String(raw.alt || "").trim().replace(/\s+/g, " ").slice(0, 200),
      caption: String(raw.caption || "").trim().replace(/\s+/g, " ").slice(0, 300),
      lead: raw.lead === true,
    };
  }
  function normalizeWikiSource(value = {}) {
    const raw = parseRecord(value);
    const kind = Object.prototype.hasOwnProperty.call(WIKI_SOURCE_KIND_LABEL, raw.kind) ? raw.kind : "manual";
    const label = String(raw.label || "").trim().replace(/\s+/g, " ").slice(0, 160);
    const quote = String(raw.quote || raw.text || "").trim().slice(0, 1200);
    if (!label && !quote) return null;
    return {
      id: String(raw.id || uid("wsrc")),
      kind,
      refId: String(raw.refId || "").slice(0, 160),
      label: label || WIKI_SOURCE_KIND_LABEL[kind],
      quote,
      createdAt: String(raw.createdAt || nowIso()),
    };
  }
  function normalizeWikiDoc(value = {}) {
    const raw = parseRecord(value);
    const sections = safeArray(raw.sections).map(normalizeWikiSection).filter(Boolean).slice(0, WIKI_SECTION_LIMIT);
    return {
      id: String(raw.id || uid("wdoc")),
      title: String(raw.title || "새 문서").trim().replace(/\s+/g, " ").slice(0, 120) || "새 문서",
      category: Object.prototype.hasOwnProperty.call(WIKI_CATEGORY_LABEL, raw.category) ? raw.category : "misc",
      subcategory: String(raw.subcategory || "").trim().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").slice(0, 80),
      titleKo: normalizeKoText(raw.titleKo, String(raw.title || "").trim().replace(/\s+/g, " ").slice(0, 120), 120),
      summary: String(raw.summary || "").trim().replace(/\s+/g, " ").slice(0, WIKI_SUMMARY_MAX),
      summaryKo: normalizeKoText(raw.summaryKo, String(raw.summary || "").trim().replace(/\s+/g, " ").slice(0, WIKI_SUMMARY_MAX), WIKI_SUMMARY_MAX),
      summaryManaged: raw.summaryManaged === "user" ? "user" : "ai",
      images: safeArray(raw.images).map(normalizeWikiImage).filter(Boolean).slice(0, WIKI_IMAGE_LIMIT),
      sections,
      aliases: normalizeTextList(raw.aliases, 12, 80),
      keywordsKo: normalizeTextList(raw.keywordsKo, 16, 80),
      keywordsEn: normalizeTextList(raw.keywordsEn, 16, 80),
      keywordGroups: normalizeTriggerGroups(raw.keywordGroups),
      relatedDocIds: normalizeTextList(raw.relatedDocIds, 24, 80),
      sources: safeArray(raw.sources).map(normalizeWikiSource).filter(Boolean).slice(0, 24),
      aiLocked: raw.aiLocked === true,
      excludeFromContext: raw.excludeFromContext === true,
      alwaysRemember: raw.alwaysRemember === true,
      createdAt: String(raw.createdAt || nowIso()),
      updatedAt: String(raw.updatedAt || raw.createdAt || nowIso()),
      aiUpdatedAt: String(raw.aiUpdatedAt || ""),
    };
  }
  function normalizeWikiProposalChange(value = {}) {
    const raw = parseRecord(value);
    const heading = String(raw.heading || "").trim().slice(0, 120);
    const after = String(raw.after ?? "").replace(/\r\n?/g, "\n").slice(0, WIKI_SECTION_BODY_HARD_MAX);
    if (!heading && !after.trim()) return null;
    return {
      id: String(raw.id || uid("wchg")),
      sectionId: String(raw.sectionId || ""),
      heading: heading || "본문",
      before: String(raw.before ?? "").replace(/\r\n?/g, "\n").slice(0, WIKI_SECTION_BODY_HARD_MAX),
      after,
      afterKo: normalizeKoText(raw.afterKo, after, WIKI_SECTION_BODY_HARD_MAX),
      reason: String(raw.reason || "").trim().slice(0, 300),
      kind: raw.kind === "summary" ? "summary" : raw.sectionId ? "update" : "add",
    };
  }
  function normalizeWikiProposal(value) {
    const raw = parseRecord(value);
    const docId = String(raw.docId || "");
    const changes = safeArray(raw.changes).map(normalizeWikiProposalChange).filter(Boolean).slice(0, WIKI_SECTION_LIMIT + 1);
    const conflicts = normalizeTextList(raw.conflicts, 12, 300);
    if (!docId || (!changes.length && !conflicts.length)) return null;
    return {
      id: String(raw.id || uid("wprop")),
      docId,
      docTitle: String(raw.docTitle || "").slice(0, 120),
      baseUpdatedAt: String(raw.baseUpdatedAt || ""),
      createdAt: String(raw.createdAt || nowIso()),
      sourceCount: Math.max(0, Number(raw.sourceCount) || 0),
      sources: safeArray(raw.sources).map(normalizeWikiSource).filter(Boolean).slice(0, 24),
      changes,
      conflicts,
    };
  }
  function normalizeWiki(value = {}) {
    const raw = parseRecord(value);
    const docs = safeArray(raw.docs).map(normalizeWikiDoc).slice(0, WIKI_DOC_LIMIT);
    const knownIds = new Set(docs.map((doc) => doc.id));
    for (const doc of docs) doc.relatedDocIds = doc.relatedDocIds.filter((id) => id !== doc.id && knownIds.has(id));
    return {
      schemaVersion: 1,
      originChatId: String(raw.originChatId || ""),
      docs,
      connectionId: String(raw.connectionId || ""),
      draftPrompt: String(raw.draftPrompt || "").slice(0, 8000),
      updatePrompt: String(raw.updatePrompt || "").slice(0, 8000),
      injectionPrompt: String(raw.injectionPrompt || "").slice(0, 8000),
      injectionEnabled: raw.injectionEnabled === true,
      alwaysBudgetChars: Math.max(300, Math.min(6000, Number(raw.alwaysBudgetChars) || 1200)),
      proposals: safeArray(raw.proposals).map(normalizeWikiProposal).filter(Boolean).filter((row) => knownIds.has(row.docId)).slice(0, 40),
      headerEntryId: String(raw.headerEntryId || ""),
      alwaysEntryId: String(raw.alwaysEntryId || ""),
      docEntryIds: parseRecord(raw.docEntryIds),
    };
  }

  function normalizePendingReview(value) {
    const raw = parseRecord(value);
    const candidates = safeArray(raw.candidates).filter(isRecord).map((row) => ({ ...row }));
    const sourceRows = safeArray(raw.sourceRows).filter(isRecord).map((row) => ({
      id: String(row.id || ""), title: String(row.title || ""), content: String(row.content || ""),
      origin: String(row.origin || ""), enabled: row.enabled !== false,
      createdAt: String(row.createdAt || ""), updatedAt: String(row.updatedAt || ""), messageCount: Number(row.messageCount) || 0,
    }));
    if (!candidates.length && !sourceRows.length) return null;
    return {
      candidates,
      selectedIndices: safeArray(raw.selectedIndices).map(String),
      selectedCandidateIds: safeArray(raw.selectedCandidateIds).map(String),
      sourceRows,
      batchKey: String(raw.batchKey || summaryBatchKey(sourceRows)),
      createdAt: String(raw.createdAt || nowIso()),
    };
  }

  function normalizeAutoReviewUndo(value) {
    const raw = parseRecord(value);
    const updated = safeArray(raw.updated).filter(isRecord).filter((row) => row.before?.id).map((row) => ({ id: String(row.id), before: normalizeItem(row.before), appliedUpdatedAt: String(row.appliedUpdatedAt || "") }));
    const created = safeArray(raw.created).filter(isRecord).map((row) => ({ id: String(row.id || ""), appliedUpdatedAt: String(row.appliedUpdatedAt || "") })).filter((row) => row.id);
    if (!updated.length && !created.length) return null;
    return { createdAt: String(raw.createdAt || nowIso()), sourceBatchKey: String(raw.sourceBatchKey || ""), updated, created };
  }

  function normalizeData(raw) {
    const base = defaultData();
    const value = parseRecord(raw);
    return {
      ...base,
      ...value,
      version: 1,
      ownerChatId: String(value.ownerChatId || ""),
      enabled: value.enabled !== false,
      maxPromises: Math.max(1, Math.min(20, Number(value.maxPromises) || 8)),
      maxAnchors: Math.max(1, Math.min(24, Number(value.maxAnchors) || 10)),
      anchorBudgetChars: Math.max(600, Math.min(12000, Number(value.anchorBudgetChars) || 2400)),
      items: safeArray(value.items).map(normalizeItem),
      lorebookId: String(value.lorebookId || ""),
      promiseEntryId: String(value.promiseEntryId || ""),
      anchorEntryId: String(value.anchorEntryId || ""),
      backupEntryId: String(value.backupEntryId || ""),
      keywordEntryIds: parseRecord(value.keywordEntryIds),
      elementMemory: normalizeElementMemory(value.elementMemory),
      wiki: normalizeWiki(value.wiki),
      pendingReview: normalizePendingReview(value.pendingReview),
      lastAutoReviewUndo: normalizeAutoReviewUndo(value.lastAutoReviewUndo),
      lastSyncAt: String(value.lastSyncAt || ""),
      lastSyncError: String(value.lastSyncError || ""),
      legacyImportedAt: String(value.legacyImportedAt || ""),
    };
  }

  function advancedMemoryEnabled(chat = state.currentChat) {
    return parseRecord(parseRecord(chat?.metadata).advancedMemory).enabled === true;
  }

  function branchParentChatId(chat = state.currentChat) {
    const metadata = parseRecord(chat?.metadata);
    return String(metadata.branchParentChatId || chat?.branchParentChatId || "");
  }

  function hasMeaningfulMemoryData(raw) {
    const value = parseRecord(raw);
    const memory = parseRecord(value.elementMemory);
    const wiki = parseRecord(value.wiki);
    return safeArray(value.items).length > 0
      || safeArray(memory.entities).length > 0
      || safeArray(wiki.docs).length > 0
      || Object.keys(parseRecord(wiki.docEntryIds)).length > 0
      || !!String(wiki.headerEntryId || wiki.alwaysEntryId || wiki.originChatId || "")
      || !!normalizePendingReview(value.pendingReview)
      || !!normalizeAutoReviewUndo(value.lastAutoReviewUndo)
      || !!String(value.lorebookId || value.promiseEntryId || value.anchorEntryId || value.backupEntryId || "")
      || Object.keys(parseRecord(value.keywordEntryIds)).length > 0
      || Object.keys(parseRecord(memory.entityEntryIds)).length > 0;
  }

  function ownershipAllowsData(ownership = state.ownership) {
    return ["new", "owned", "legacy-owned", "branch-owned", "restored", "confirmed"].includes(String(ownership?.status || ""));
  }

  function managedBookOwner(book) {
    const description = String(book?.description || "");
    const match = description.match(/§MEMORY_CABINET_RP_V1§\s+chat:([^\s]+)/);
    if (match) return { ownerChatId: String(match[1]), evidence: "managed-book-marker" };
    if (safeArray(book?.tags).includes(LOREBOOK_TAG) && book?.chatId) return { ownerChatId: String(book.chatId), evidence: "managed-book-chatId" };
    return { ownerChatId: "", evidence: "" };
  }

  function parseBackupEntry(entry, expectedChatId) {
    const content = String(entry?.content || "");
    if (entry?.enabled !== false) return null;
    if (entry?.tag !== BACKUP_ENTRY_TAG && !content.includes(BACKUP_MARKER)) return null;
    const start = content.indexOf("{");
    if (start < 0) return null;
    try {
      const payload = JSON.parse(content.slice(start));
      if (payload?.marker !== BACKUP_MARKER || String(payload?.ownerChatId || "") !== String(expectedChatId || "")) return null;
      const data = normalizeData(payload.data);
      if (data.ownerChatId !== String(expectedChatId || "")) return null;
      return { entryId: String(entry.id || ""), savedAt: String(payload.savedAt || ""), data };
    } catch { return null; }
  }

  function classifyOwnership({ chatId, parentChatId = "", rawData, bookOwnerChatId = "", bookEvidence = "", backup = null, discoveryChecked = true }) {
    const value = parseRecord(rawData);
    const explicitOwner = String(value.ownerChatId || "");
    const originOwner = String(parseRecord(value.elementMemory).originChatId || "");
    const inheritedOwner = explicitOwner || originOwner || String(bookOwnerChatId || "");
    if (explicitOwner) {
      if (explicitOwner === chatId) return { status: "owned", ownerChatId: explicitOwner, evidence: "ownerChatId", reason: "" };
      if (parentChatId && parentChatId === explicitOwner) return backup
        ? { status: "recovery", ownerChatId: chatId, evidence: "matching-backup-before-branch-inherit", reason: "이 분기의 기존 백업이 있어 부모 데이터 재상속을 보류함" }
        : { status: "branch", ownerChatId: explicitOwner, evidence: "branchParentChatId+ownerChatId", reason: "부모 RP에서 정상 상속된 분기 데이터" };
      return { status: "quarantine", ownerChatId: explicitOwner, evidence: "ownerChatId", reason: "다른 RP 소유의 기억 데이터가 감지됨" };
    }
    if (originOwner) {
      if (originOwner === chatId) return { status: "legacy-owned", ownerChatId: chatId, evidence: "elementMemory.originChatId", reason: "" };
      if (parentChatId && parentChatId === originOwner) return backup
        ? { status: "recovery", ownerChatId: chatId, evidence: "matching-backup-before-legacy-branch-inherit", reason: "이 분기의 기존 백업이 있어 부모 legacy 데이터 재상속을 보류함" }
        : { status: "branch", ownerChatId: originOwner, evidence: "branchParentChatId+elementMemory.originChatId", reason: "부모 RP의 v1.8.0 요소 기억을 상속한 분기" };
      return { status: "quarantine", ownerChatId: originOwner, evidence: "elementMemory.originChatId", reason: "요소 기억이 다른 RP를 원본으로 가리킴" };
    }
    if (bookOwnerChatId) {
      if (bookOwnerChatId === chatId) return { status: "legacy-owned", ownerChatId: chatId, evidence: bookEvidence || "managed-lorebook", reason: "" };
      if (parentChatId && parentChatId === bookOwnerChatId) return backup
        ? { status: "recovery", ownerChatId: chatId, evidence: "matching-backup-before-book-branch-inherit", reason: "이 분기의 기존 백업이 있어 부모 로어북 데이터 재상속을 보류함" }
        : { status: "branch", ownerChatId: bookOwnerChatId, evidence: `branchParentChatId+${bookEvidence || "managed-lorebook"}`, reason: "부모 RP의 관리 로어북과 함께 상속된 분기" };
      return { status: "quarantine", ownerChatId: bookOwnerChatId, evidence: bookEvidence || "managed-lorebook", reason: "관리 로어북이 다른 RP를 가리킴" };
    }
    if (hasMeaningfulMemoryData(value)) return { status: "quarantine", ownerChatId: inheritedOwner, evidence: "none", reason: "소유권 증거가 없는 기존 기억 데이터" };
    if (backup) return { status: "recovery", ownerChatId: chatId, evidence: "matching-backup", reason: "metadata가 비어 있지만 이 RP의 전용 백업을 찾음" };
    if (!discoveryChecked) return { status: "quarantine", ownerChatId: "", evidence: "backup-check-failed", reason: "로어북 백업 확인에 실패해 새 데이터로 확정할 수 없음" };
    return { status: "new", ownerChatId: chatId, evidence: "empty", reason: "" };
  }

  function resetManagedPointersForOwner(data, chatId) {
    const next = normalizeData(data);
    const previousBookIds = [next.lorebookId].map(String).filter(Boolean);
    next.ownerChatId = String(chatId);
    next.lorebookId = "";
    next.promiseEntryId = "";
    next.anchorEntryId = "";
    next.backupEntryId = "";
    next.keywordEntryIds = {};
    next.elementMemory.originChatId = String(chatId);
    next.elementMemory.connectionId = "";
    next.elementMemory.headerEntryId = "";
    next.elementMemory.entityEntryIds = {};
    next.wiki.originChatId = String(chatId);
    next.wiki.connectionId = "";
    next.wiki.headerEntryId = "";
    next.wiki.alwaysEntryId = "";
    next.wiki.docEntryIds = {};
    next.lastSyncAt = "";
    next.lastSyncError = "";
    return { data: next, previousBookIds };
  }

  async function loadUiState() {
    const saved = parseRecord((await host.storage.get())[EXT_STORAGE_KEY]);
    state.selectedChatId = String(saved.selectedChatId || state.selectedChatId || "");
    state.activeTab = TAB_IDS.includes(saved.activeTab) ? saved.activeTab : "overview";
    state.wikiCategoryFilter = saved.wikiCategoryFilter === "all" || Object.prototype.hasOwnProperty.call(WIKI_CATEGORY_LABEL, saved.wikiCategoryFilter) ? saved.wikiCategoryFilter : "all";
    state.koDisplay = saved.koDisplay === "original" ? "original" : "auto";
    state.agentNoticeDismissed = parseRecord(saved.agentNoticeDismissed);
    state.filter = ["active", "all", "hold", "done", "archived"].includes(saved.filter) ? saved.filter : "active";
    state.expanded = { promise: saved.expandedPromise === true, anchor: saved.expandedAnchor === true };
    state.modelConnectionId = String(saved.modelConnectionId || "");
    state.uiFontSize = ["normal", "large", "xlarge"].includes(saved.uiFontSize) ? saved.uiFontSize : "normal";
    let savedTheme = saved.uiThemeMode === "paper" ? "ribbon" : saved.uiThemeMode === "marinara" ? "sillytavern" : saved.uiThemeMode;
    // v2 이전: 위키 탭에서만 쓰던 "나무위키풍 그린"은 보관함 전체 테마 "아카이브 그린"으로 옮긴다(한 번만).
    if (saved.themeUnifiedV2 !== true && saved.wikiTheme === "green") savedTheme = "green";
    state.uiThemeMode = UI_THEME_IDS.includes(savedTheme) ? savedTheme : "ribbon";
    state.reviewPrompt = String(saved.reviewPrompt || "").trim() || DEFAULT_REVIEW_PROMPT;
    state.reviewExtraInstruction = String(saved.reviewExtraInstruction || "");
    state.summaryKnownByChat = parseRecord(saved.summaryKnownByChat);
    state.summaryAutoAttemptByChat = parseRecord(saved.summaryAutoAttemptByChat);
    state.summaryUpdateMode = Object.prototype.hasOwnProperty.call(SUMMARY_UPDATE_MODE_LABEL, saved.summaryUpdateMode) ? saved.summaryUpdateMode : "notify_model";
    state.elementExtractMode = saved.elementExtractMode === "range" ? "range" : "recent";
    state.elementExtractTurns = Math.max(1, Math.min(100, Number(saved.elementExtractTurns) || 20));
    state.elementRangeStart = Math.max(1, Number(saved.elementRangeStart) || 1);
    state.elementRangeEnd = Math.max(state.elementRangeStart, Number(saved.elementRangeEnd) || 20);
  }

  async function saveUiState(patch = {}) {
    const current = {
      selectedChatId: state.selectedChatId,
      activeTab: state.activeTab,
      filter: state.filter,
      expandedPromise: state.expanded.promise,
      expandedAnchor: state.expanded.anchor,
      modelConnectionId: state.modelConnectionId,
      uiFontSize: state.uiFontSize,
      uiThemeMode: state.uiThemeMode,
      reviewPrompt: state.reviewPrompt,
      reviewExtraInstruction: state.reviewExtraInstruction,
      summaryKnownByChat: state.summaryKnownByChat,
      summaryAutoAttemptByChat: state.summaryAutoAttemptByChat,
      summaryUpdateMode: state.summaryUpdateMode,
      elementExtractMode: state.elementExtractMode,
      elementExtractTurns: state.elementExtractTurns,
      elementRangeStart: state.elementRangeStart,
      elementRangeEnd: state.elementRangeEnd,
      wikiCategoryFilter: state.wikiCategoryFilter,
      themeUnifiedV2: true,
      koDisplay: state.koDisplay,
      agentNoticeDismissed: state.agentNoticeDismissed,
      ...patch,
    };
    await host.storage.patch({ [EXT_STORAGE_KEY]: current });
  }

  async function loadChats() {
    const payload = await api("chats");
    const all = extractArray(payload, ["chats", "items", "results"])
      .filter((chat) => chat && (chat.id || chat.chatId))
      .map((chat) => ({ ...chat, id: String(chat.id || chat.chatId), metadata: parseRecord(chat.metadata) }));
    const rp = all.filter(isRpChat);
    state.chats = (rp.length ? rp : all).map((chat, index) => ({ chat, index }))
      .sort((a, b) => chatRecentTime(b.chat) - chatRecentTime(a.chat) || a.index - b.index)
      .map((row) => row.chat);
    if (!state.chats.some((chat) => chat.id === state.selectedChatId)) state.selectedChatId = state.chats[0]?.id || "";
  }

  function connectionRows(payload) {
    return extractArray(payload, ["connections", "items", "results"])
      .filter((row) => row && !["image_generation", "video_generation", "embedding"].includes(String(row.provider || "")))
      .filter((row) => String(row.model || "").trim() || String(row.provider || "") === "grok_subscription")
      .map((row) => ({
        id: String(row.id || ""),
        label: String(row.name || row.label || row.model || row.provider || "연결"),
        model: String(row.model || ""),
        provider: String(row.provider || ""),
      }))
      .filter((row) => row.id);
  }

  function chooseDefaultConnection(chat) {
    if (state.modelConnectionId && state.connections.some((c) => c.id === state.modelConnectionId)) return state.modelConnectionId;
    const chatConnection = String(chat?.connectionId || "");
    if (chatConnection && state.connections.some((c) => c.id === chatConnection)) return chatConnection;
    return state.connections[0]?.id || "";
  }

  async function loadConnections() {
    try { state.connections = connectionRows(await api("connections")); } catch { state.connections = []; }
    state.modelConnectionId = chooseDefaultConnection(state.currentChat);
  }

  async function applyOwnershipForCurrentChat(rawData) {
    const chat = state.currentChat;
    const chatId = String(chat?.id || "");
    const resources = await inspectOwnershipResources(chat, rawData);
    const decision = classifyOwnership({
      chatId,
      parentChatId: branchParentChatId(chat),
      rawData,
      bookOwnerChatId: resources.bookOwnerChatId,
      bookEvidence: resources.bookEvidence,
      backup: resources.backup,
      discoveryChecked: resources.discoveryChecked,
    });
    state.ownership = { ...decision, backup: resources.backup, discoveryChecked: resources.discoveryChecked };
    state.quarantinedData = null;
    state.ownershipDetachLorebookIds = [];

    if (["quarantine", "recovery"].includes(decision.status)) {
      state.quarantinedData = hasMeaningfulMemoryData(rawData) ? parseRecord(rawData) : null;
      state.currentData = defaultData();
      state.pendingSummaryRows = [];
      restorePendingReview();
      const wrongBookId = decision.status === "quarantine" ? String(parseRecord(rawData).lorebookId || "") : "";
      const detachIds = [...resources.foreignActiveIds, wrongBookId].filter(Boolean);
      try { await detachLorebooks(chatId, detachIds); } catch (error) { console.warn("[기억 보관함] foreign lorebook detach failed", error); }
      return;
    }

    if (decision.status === "branch") {
      const prepared = resetManagedPointersForOwner(rawData, chatId);
      state.currentData = prepared.data;
      state.ownershipDetachLorebookIds = [...new Set([...prepared.previousBookIds, ...resources.foreignActiveIds])];
      state.ownership = { ...decision, status: "branch-owned", ownerChatId: chatId, backup: null, discoveryChecked: resources.discoveryChecked };
      await patchChatMetadata(chatId, { [DATA_KEY]: state.currentData });
      restorePendingReview();
      try { await syncLorebook({ silent: true }); } catch (error) { console.warn("[기억 보관함] branch lorebook sync failed", error); }
      return;
    }

    const data = normalizeData(rawData);
    if (["new", "legacy-owned"].includes(decision.status)) data.ownerChatId = chatId;
    if (!data.elementMemory.originChatId) data.elementMemory.originChatId = chatId;
    if (!data.wiki.originChatId) data.wiki.originChatId = chatId;
    state.currentData = data;
    if (resources.foreignActiveIds.length) {
      try { await detachLorebooks(chatId, resources.foreignActiveIds); } catch (error) { console.warn("[기억 보관함] foreign lorebook detach failed", error); }
    }
    if (decision.status === "legacy-owned") await patchChatMetadata(chatId, { [DATA_KEY]: data });
    restorePendingReview();
  }

  async function loadCurrentChat() {
    if (!state.selectedChatId) {
      state.currentChat = null;
      state.currentData = null;
      state.ownership = { status: "unknown", reason: "", ownerChatId: "", evidence: "", backup: null, discoveryChecked: false };
      state.quarantinedData = null;
      return;
    }
    let full = null;
    try { full = await api(`chats/${encodeURIComponent(state.selectedChatId)}`); } catch {}
    const fallback = state.chats.find((chat) => chat.id === state.selectedChatId) || null;
    state.currentChat = full && isRecord(full) ? { ...fallback, ...full, id: state.selectedChatId, metadata: parseRecord(full.metadata) } : fallback;
    await applyOwnershipForCurrentChat(parseRecord(state.currentChat?.metadata)[DATA_KEY]);
    if (!state.modelConnectionId) state.modelConnectionId = chooseDefaultConnection(state.currentChat);
    state.elementExtractTurns = state.currentData.elementMemory.extractTurns || state.elementExtractTurns || 20;
    restorePendingReview();
    try { await refreshAgentNotice(); } catch (error) { console.warn("[기억 보관함] agent notice check failed", error); }
  }

  async function restoreFromMatchingBackup() {
    const backup = state.ownership?.backup;
    const chatId = String(state.currentChat?.id || "");
    if (!backup || !chatId || String(backup.data?.ownerChatId || "") !== chatId) throw new Error("이 RP와 일치하는 복구 백업을 찾지 못했습니다.");
    const data = normalizeData(backup.data);
    data.ownerChatId = chatId;
    state.currentData = data;
    state.quarantinedData = null;
    state.ownership = { status: "restored", reason: "", ownerChatId: chatId, evidence: "matching-backup", backup, discoveryChecked: true };
    await patchChatMetadata(chatId, { [DATA_KEY]: data });
    restorePendingReview();
    await syncLorebook({ silent: true });
    await checkNewSummaries({ refreshChat: false, baselineIfUnknown: true, renderAfter: false });
    toast("이 RP의 전용 로어북 백업에서 기억을 복구했습니다.");
    render();
  }

  async function confirmQuarantinedDataForCurrentChat() {
    const chatId = String(state.currentChat?.id || "");
    if (!chatId || !state.quarantinedData || !hasMeaningfulMemoryData(state.quarantinedData)) throw new Error("확정할 격리 데이터가 없습니다.");
    const prepared = resetManagedPointersForOwner(state.quarantinedData, chatId);
    state.currentData = prepared.data;
    state.quarantinedData = null;
    state.ownershipDetachLorebookIds = [...new Set([...state.ownershipDetachLorebookIds, ...prepared.previousBookIds])];
    state.ownership = { status: "confirmed", reason: "", ownerChatId: chatId, evidence: "user-confirmed-copy", backup: state.ownership?.backup || null, discoveryChecked: true };
    await patchChatMetadata(chatId, { [DATA_KEY]: prepared.data });
    restorePendingReview();
    await syncLorebook({ silent: true });
    await checkNewSummaries({ refreshChat: false, baselineIfUnknown: true, renderAfter: false });
    toast("격리 데이터를 이 RP 소유의 독립 복사본으로 확정했습니다.");
    render();
  }

  function restorePendingReview() {
    state.reviewCandidates = [];
    state.reviewSelected.clear();
    state.reviewSourceRows = [];
    const pending = state.currentData?.pendingReview;
    if (!pending) return;
    state.reviewCandidates = safeArray(pending.candidates).map(normalizeReviewCandidate).filter(Boolean);
    state.reviewSourceRows = safeArray(pending.sourceRows).map((row) => ({ ...row }));
    const selected = new Set(safeArray(pending.selectedIndices).map(String));
    const selectedIds = new Set(safeArray(pending.selectedCandidateIds).map(String));
    state.reviewSelected = new Set(state.reviewCandidates.map((candidate, index) => selectedIds.size ? (selectedIds.has(candidate.candidateId) ? String(index) : null) : (selected.has(String(index)) ? String(index) : null)).filter(Boolean));
  }

  async function persistPendingReview() {
    if (!state.currentData) return;
    const data = normalizeData(state.currentData);
    data.pendingReview = normalizePendingReview({
      candidates: state.reviewCandidates,
      selectedIndices: [...state.reviewSelected],
      selectedCandidateIds: state.reviewCandidates.filter((_, index) => state.reviewSelected.has(String(index))).map((candidate) => candidate.candidateId),
      sourceRows: state.reviewSourceRows,
      batchKey: summaryBatchKey(state.reviewSourceRows),
      createdAt: data.pendingReview?.createdAt || nowIso(),
    });
    await persistData(data, { sync: false, silent: true });
  }

  async function clearPendingReview() {
    if (state.currentData?.pendingReview) {
      const data = normalizeData(state.currentData);
      data.pendingReview = null;
      await persistData(data, { sync: false, silent: true });
    }
    state.reviewCandidates = [];
    state.reviewSelected.clear();
    state.reviewSourceRows = [];
  }

  async function refreshAll({ renderAfter = true } = {}) {
    await loadChats();
    await loadCurrentChat();
    if (!state.connections.length) await loadConnections();
    if (renderAfter) render();
  }

  function updateLauncherBadge() {
    const launcher = document.getElementById(LAUNCHER_ID);
    const badge = launcher?.querySelector?.(".mmc-launcher-badge");
    const count = state.pendingSummaryRows.length;
    if (!launcher || !badge) return;
    launcher.classList.toggle("has-summary-alert", count > 0);
    badge.hidden = count <= 0;
    badge.textContent = count > 9 ? "9+" : String(count);
    launcher.title = count > 0 ? `새 요약 ${count}개 · 기억 갱신 필요` : "기억 보관함";
  }

  async function checkNewSummaries({ refreshChat = true, baselineIfUnknown = true, renderAfter = false } = {}) {
    const chatId = String(state.selectedChatId || "");
    if (!chatId || state.summaryCheckBusy || !ownershipAllowsData()) return [];
    state.summaryCheckBusy = true;
    try {
      if (refreshChat) {
        const fresh = await api(`chats/${encodeURIComponent(chatId)}`);
        if (fresh && isRecord(fresh)) {
          const fallback = state.chats.find((chat) => chat.id === chatId) || {};
          state.currentChat = { ...fallback, ...state.currentChat, ...fresh, id: chatId, metadata: parseRecord(fresh.metadata) };
          await applyOwnershipForCurrentChat(parseRecord(state.currentChat.metadata)[DATA_KEY]);
          if (!ownershipAllowsData()) return [];
        }
      }
      const rows = summaryRowsFromMetadata(state.currentChat?.metadata);
      const hasBaseline = Array.isArray(state.summaryKnownByChat[chatId]);
      if (!hasBaseline && baselineIfUnknown) {
        state.summaryKnownByChat[chatId] = rows.map(summarySignature).slice(-260);
        state.pendingSummaryRows = [];
        await saveUiState();
      } else {
        const known = new Set(safeArray(state.summaryKnownByChat[chatId]).map(String));
        state.pendingSummaryRows = rows.filter((row) => !known.has(summarySignature(row)));
      }
      updateLauncherBadge();
      if (renderAfter && !document.getElementById(ROOT_ID)?.hidden) render();
      if (state.pendingSummaryRows.length && !advancedMemoryEnabled()) void maybeAutoProcessSummaries();
      return state.pendingSummaryRows;
    } catch (error) {
      console.warn("[기억 보관함] summary check failed", error);
      return state.pendingSummaryRows;
    } finally {
      state.summaryCheckBusy = false;
    }
  }

  async function markSummaryRowsReviewed(rows) {
    const chatId = String(state.selectedChatId || "");
    if (!chatId) return;
    const current = safeArray(state.summaryKnownByChat[chatId]).map(String);
    const seen = new Set(current);
    const reviewed = new Set();
    for (const row of safeArray(rows)) { const sig = summarySignature(row); seen.add(sig); reviewed.add(sig); }
    state.summaryKnownByChat[chatId] = Array.from(seen).slice(-260);
    state.pendingSummaryRows = state.pendingSummaryRows.filter((row) => !reviewed.has(summarySignature(row)));
    updateLauncherBadge();
    await saveUiState();
    await checkNewSummaries({ refreshChat: false, baselineIfUnknown: false, renderAfter: false });
  }

  async function maybeAutoProcessSummaries() {
    if (!ownershipAllowsData() || advancedMemoryEnabled()) return;
    if (!state.pendingSummaryRows.length) return;
    if (!["auto_review", "auto_apply"].includes(state.summaryUpdateMode)) return;
    if (state.autoReviewBusy || state.busy || state.layer || state.reviewSourceRows.length) return;
    const chatId = String(state.selectedChatId || "");
    if (!chatId) return;
    const batchKey = summaryBatchKey(state.pendingSummaryRows);
    if (!batchKey || String(state.summaryAutoAttemptByChat[chatId] || "") === batchKey) return;
    if (!state.connections.length) await loadConnections();
    state.modelConnectionId = chooseDefaultConnection(state.currentChat);
    if (!state.modelConnectionId) {
      console.warn("[기억 보관함] 자동 요약 정리: 사용할 모델 연결이 없습니다.");
      return;
    }
    state.summaryAutoAttemptByChat[chatId] = batchKey;
    await saveUiState();
    state.autoReviewBusy = true;
    const rows = state.pendingSummaryRows.slice();
    state.sourceMode = "summaries";
    state.sourceTarget = "review";
    state.sourceRows = rows.slice();
    state.sourceSelected = new Set(rows.map((row) => String(row.id || "")));
    try {
      const generated = await generateReviewCandidates(rows, { showLayer: false });
      if (!generated) return;
      if (state.summaryUpdateMode === "auto_apply") {
        const actionable = state.reviewCandidates.some((item, i) => item.action !== "keep" && state.reviewSelected.has(String(i)));
        if (actionable) {
          await applyReviewCandidates({ auto: true });
        } else {
          await clearPendingReview();
          await markSummaryRowsReviewed(rows);
          toast("자동 정리 결과 새로 반영할 기억이 없어 이번 요약을 검토 완료 처리했습니다.");
          render();
        }
      } else {
        toast(`새 요약 자동 분석 완료 · 후보 ${state.reviewCandidates.length}개`);
        render();
      }
    } catch (error) {
      console.warn("[기억 보관함] 자동 요약 정리 실패", error);
      if (!state.currentData?.pendingReview) {
        delete state.summaryAutoAttemptByChat[chatId];
        await saveUiState();
      }
      toast(`자동 요약 정리 실패: ${error.message || "모델 호출을 확인해 주세요."}`, true);
      render();
    } finally {
      state.autoReviewBusy = false;
    }
  }

  function refreshSummaryAlertDom() {
    updateLauncherBadge();
    const root = document.getElementById(ROOT_ID);
    if (!root || root.hidden) return;
    if (state.activeTab === "overview" && !state.layer && !state.busy) { render(); return; }
    const slot = root.querySelector("[data-mmc-summary-alert-slot]");
    if (slot) slot.innerHTML = statusBanners();
  }

  async function acceptObservedChatSnapshot(chatId, payload) {
    if (!chatId || chatId !== String(state.selectedChatId || "") || !payload || !isRecord(payload)) return;
    const metadata = parseRecord(payload.metadata);
    const existingMeta = parseRecord(state.currentChat?.metadata);
    const fallback = state.chats.find((chat) => chat.id === chatId) || {};
    // Passive observation must never replace the extension's in-memory records with a possibly stale host response.
    // Only the host's newest summary fields are merged here; memoryCabinetV1 remains owned by persistData/loadCurrentChat.
    state.currentChat = {
      ...fallback,
      ...state.currentChat,
      id: chatId,
      metadata: {
        ...existingMeta,
        summary: metadata.summary,
        summaryEntries: metadata.summaryEntries,
        lastAutomaticSummaryMessageId: metadata.lastAutomaticSummaryMessageId,
      },
    };

    const rows = summaryRowsFromMetadata(metadata);
    const hasBaseline = Array.isArray(state.summaryKnownByChat[chatId]);
    if (!hasBaseline) {
      state.summaryKnownByChat[chatId] = rows.map(summarySignature).slice(-260);
      state.pendingSummaryRows = [];
      await saveUiState();
    } else {
      const known = new Set(safeArray(state.summaryKnownByChat[chatId]).map(String));
      state.pendingSummaryRows = rows.filter((row) => !known.has(summarySignature(row)));
    }
    refreshSummaryAlertDom();
    if (state.pendingSummaryRows.length && ownershipAllowsData() && !advancedMemoryEnabled()) void maybeAutoProcessSummaries();
  }

  function installPassiveSummaryObserver() {
    let pendingTimer;
    let disposed = false;
    const applyChange = async (snapshot) => {
      if (disposed) return;
      if (state.busy || state.syncing || state.actionPending || state.autoReviewBusy) {
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => void applyChange(snapshot), 200);
        return;
      }
      // Always use the latest host selection, including rapid A -> B -> A changes.
      const currentId = host.getCurrentChatId();
      if (currentId !== state.selectedChatId) {
        const wasOpen = !document.getElementById(ROOT_ID)?.hidden;
        closeModal({ force: true });
        state.wikiSelectedId = "";
        state.wikiHistory = [];
        state.selectedChatId = currentId;
        if (wasOpen) await openModal();
        else await primeSummaryObserver();
      } else if (snapshot?.id === currentId) {
        await acceptObservedChatSnapshot(currentId, snapshot);
      }
    };
    const unsubscribe = host.onChange(applyChange);
    cleanupFns.push(() => { disposed = true; clearTimeout(pendingTimer); unsubscribe(); });
  }

  async function primeSummaryObserver() {
    if (state.busy || state.syncing || state.actionPending) return;
    try {
      await loadUiState();
      await loadChats();
      await loadCurrentChat();
      await checkNewSummaries({ refreshChat: false, baselineIfUnknown: true, renderAfter: false });
    } catch (error) {
      console.warn("[기억 보관함] summary observer init failed", error);
    }
  }

  async function patchChatMetadata(chatId, patch) {
    await api(`chats/${encodeURIComponent(chatId)}/metadata`, { method: "PATCH", body: patch });
    const row = state.chats.find((chat) => chat.id === chatId);
    if (row) row.metadata = { ...parseRecord(row.metadata), ...patch };
    if (state.currentChat?.id === chatId) state.currentChat.metadata = { ...parseRecord(state.currentChat.metadata), ...patch };
  }

  async function verifyOwnershipBeforePersist() {
    const chatId = String(state.currentChat?.id || "");
    const fresh = await api(`chats/${encodeURIComponent(chatId)}`);
    const raw = parseRecord(fresh?.metadata)[DATA_KEY];
    const owner = String(parseRecord(raw).ownerChatId || "");
    if (owner === chatId) return;
    if (state.ownership?.status === "new" && !hasMeaningfulMemoryData(raw)) return;
    const fallback = state.chats.find((chat) => chat.id === chatId) || {};
    state.currentChat = { ...fallback, ...state.currentChat, ...fresh, id: chatId, metadata: parseRecord(fresh?.metadata) };
    await applyOwnershipForCurrentChat(raw);
    render();
    throw new Error("저장 직전 RP 소유권이 달라져 작업을 중단하고 데이터를 격리했습니다.");
  }

  async function persistData(data, { sync = true, silent = false } = {}) {
    if (!state.currentChat?.id) throw new Error("RP방을 먼저 선택해 주세요.");
    if (!ownershipAllowsData()) throw new Error("소유권 확인 전에는 기억을 저장하거나 동기화할 수 없습니다.");
    await verifyOwnershipBeforePersist();
    const next = normalizeData(data);
    next.ownerChatId = String(state.currentChat.id);
    if (!next.elementMemory.originChatId) next.elementMemory.originChatId = String(state.currentChat.id);
    if (!next.wiki.originChatId) next.wiki.originChatId = String(state.currentChat.id);
    next.updatedAt = nowIso();
    await patchChatMetadata(state.currentChat.id, { [DATA_KEY]: next });
    state.currentData = next;
    if (sync) await syncLorebook({ silent: true });
    if (!silent) toast("저장했습니다.");
    return state.currentData;
  }

  async function freshOwnedData() {
    const fresh = await api(`chats/${encodeURIComponent(state.selectedChatId)}`);
    const raw = parseRecord(fresh?.metadata)[DATA_KEY];
    const rawOwner = String(parseRecord(raw).ownerChatId || "");
    if (!rawOwner && state.ownership?.status === "new" && !hasMeaningfulMemoryData(raw)) {
      const data = normalizeData(raw);
      data.ownerChatId = String(state.selectedChatId || "");
      return data;
    }
    if (rawOwner !== String(state.selectedChatId || "")) {
      const fallback = state.chats.find((chat) => chat.id === state.selectedChatId) || {};
      state.currentChat = { ...fallback, ...state.currentChat, ...fresh, id: state.selectedChatId, metadata: parseRecord(fresh?.metadata) };
      await applyOwnershipForCurrentChat(raw);
      render();
      throw new Error("저장 직전 RP 소유권이 달라져 작업을 중단하고 데이터를 격리했습니다.");
    }
    return normalizeData(raw);
  }

  function prioritySort(a, b) {
    const p = (PRIORITY_WEIGHT[a.priority] ?? 1) - (PRIORITY_WEIGHT[b.priority] ?? 1);
    if (p) return p;
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  }

  function activePromises(data = state.currentData) {
    return safeArray(data?.items).filter((item) => item.type === "promise" && item.status === "active").sort(prioritySort);
  }
  function activeAlwaysAnchors(data = state.currentData) {
    return safeArray(data?.items).filter((item) => item.type === "anchor" && item.active && !item.archived && item.activation === "always").sort(prioritySort);
  }
  function activeKeywordAnchors(data = state.currentData) {
    return safeArray(data?.items).filter((item) => item.type === "anchor" && item.active && !item.archived && item.activation === "keyword" && item.keywords.length).sort(prioritySort);
  }

  function anchorLine(item) {
    return `- [${ANCHOR_CATEGORY_LABEL[item.category] || "기억"}] ${truncate(item.title, 90)}: ${truncate(item.content, 360)}`;
  }

  function anchorInjectionPlan(data = state.currentData) {
    const normalized = normalizeData(data || {});
    const all = activeAlwaysAnchors(normalized);
    const considered = all.slice(0, normalized.maxAnchors);
    const budget = normalized.anchorBudgetChars;
    const selected = [];
    const excluded = all.slice(normalized.maxAnchors);
    let used = 0;
    for (const item of considered) {
      const cost = anchorLine(item).length + 1;
      if (!selected.length || used + cost <= budget) {
        selected.push(item);
        used += cost;
      } else excluded.push(item);
    }
    return { candidates: all, considered, selected, excluded, used, budget };
  }

  function managedBookMarker(chatId) { return `${BOOK_MARKER} chat:${chatId}`; }
  async function readChatMetadata(chatId) {
    try { const chat = await api(`chats/${encodeURIComponent(chatId)}`); return parseRecord(chat?.metadata); }
    catch { return parseRecord(state.chats.find((x) => x.id === chatId)?.metadata); }
  }
  async function inspectOwnershipResources(chat, rawData) {
    const metadata = parseRecord(chat?.metadata);
    const raw = parseRecord(rawData);
    const activeIds = safeArray(metadata.activeLorebookIds).map(String).filter(Boolean);
    const wantedIds = new Set([...activeIds, String(raw.lorebookId || "")].filter(Boolean));
    const booksById = new Map();
    let discoveryChecked = false;
    try {
      const payload = await api(`lorebooks?chatId=${encodeURIComponent(chat.id)}`);
      for (const book of extractArray(payload, ["lorebooks", "items", "results"])) if (book?.id) booksById.set(String(book.id), book);
      discoveryChecked = true;
    } catch {}
    for (const id of wantedIds) {
      if (booksById.has(id)) continue;
      try { const book = await api(`lorebooks/${encodeURIComponent(id)}`); if (book?.id) booksById.set(String(book.id), book); } catch {}
    }
    const directBook = booksById.get(String(raw.lorebookId || "")) || null;
    const directOwner = managedBookOwner(directBook);
    const foreignActiveIds = [];
    const matchingBooks = [];
    for (const [id, book] of booksById) {
      const owner = managedBookOwner(book);
      if (owner.ownerChatId === String(chat.id)) matchingBooks.push(book);
      else if (activeIds.includes(id) && owner.ownerChatId && owner.ownerChatId !== String(chat.id)) foreignActiveIds.push(id);
    }
    let backup = null;
    for (const book of matchingBooks) {
      try {
        const entries = extractArray(await api(`lorebooks/${encodeURIComponent(book.id)}/entries`), ["entries", "items", "results"]);
        for (const entry of entries) {
          const parsed = parseBackupEntry(entry, chat.id);
          if (parsed && (!backup || String(parsed.savedAt).localeCompare(String(backup.savedAt)) > 0)) backup = { ...parsed, bookId: String(book.id) };
        }
      } catch {}
    }
    return {
      discoveryChecked,
      bookOwnerChatId: directOwner.ownerChatId,
      bookEvidence: directOwner.evidence,
      backup,
      foreignActiveIds,
    };
  }

  async function detachLorebooks(chatId, removeIds = []) {
    const remove = new Set(safeArray(removeIds).map(String).filter(Boolean));
    if (!remove.size) return;
    const meta = await readChatMetadata(chatId);
    const current = safeArray(meta.activeLorebookIds).map(String);
    const next = current.filter((id) => !remove.has(id));
    if (JSON.stringify(current) !== JSON.stringify(next)) await patchChatMetadata(chatId, { activeLorebookIds: next });
  }
  async function attachLorebook(chatId, lorebookId, removeIds = []) {
    const meta = await readChatMetadata(chatId);
    const remove = new Set(safeArray(removeIds).map(String).filter(Boolean));
    const current = safeArray(meta.activeLorebookIds).map(String);
    const next = [...new Set([...current.filter((id) => !remove.has(id)), String(lorebookId)])];
    if (JSON.stringify(current) !== JSON.stringify(next)) await patchChatMetadata(chatId, { activeLorebookIds: next });
  }

  async function findManagedBook(chat, data) {
    if (data.lorebookId) {
      try {
        const book = await api(`lorebooks/${encodeURIComponent(data.lorebookId)}`);
        const marker = managedBookMarker(chat.id);
        const belongsHere = String(book?.description || "").includes(marker) || String(book?.chatId || "") === String(chat.id);
        if (book?.id && belongsHere) return book;
      } catch {}
    }
    const payload = await api(`lorebooks?chatId=${encodeURIComponent(chat.id)}`);
    const books = extractArray(payload, ["lorebooks", "items", "results"]);
    const marker = managedBookMarker(chat.id);
    return books.find((book) => String(book?.description || "").includes(marker))
      || books.find((book) => safeArray(book?.tags).includes(LOREBOOK_TAG) && String(book?.chatId || "") === String(chat.id))
      || null;
  }

  async function ensureManagedBook(chat, data) {
    let book = await findManagedBook(chat, data);
    const payload = {
      name: `기억 보관함 · ${chatLabel(chat)}`,
      description: `기억 보관함 확장이 이 RP 전용으로 관리하는 주입 로어북입니다. 확장 안의 기록이 원본이며, 이 로어북은 동기화 결과입니다.\n${managedBookMarker(chat.id)}`,
      category: "uncategorized",
      scanDepth: 4,
      tokenBudget: Math.max(2400, Math.ceil((Number(data.anchorBudgetChars) || 2400) / 3) + 1800 + wikiBookBudgetBonus(data)),
      recursiveScanning: true,
      excludeFromVectorization: true,
      chatId: chat.id,
      isGlobal: false,
      enabled: true,
      scope: { mode: "specific", chatIds: [chat.id] },
      tags: [...new Set([...safeArray(book?.tags), LOREBOOK_TAG, "extension-managed"])],
      generatedBy: "user",
    };
    if (!book) book = await api("lorebooks", { method: "POST", body: payload });
    else {
      await api(`lorebooks/${encodeURIComponent(book.id)}`, { method: "PATCH", body: payload });
      book = { ...book, ...payload };
    }
    if (!book?.id) throw new Error("전용 로어북을 만들지 못했습니다.");
    return { ...book, id: String(book.id) };
  }

  // 위키 주입을 켰을 때만 전용 로어북 예산을 늘린다. 위키를 쓰지 않으면 기존 값과 동일하다.
  function wikiBookBudgetBonus(data) {
    const wiki = normalizeWiki(data?.wiki);
    if (!wiki.injectionEnabled) return 0;
    const always = Math.ceil(wiki.alwaysBudgetChars / 3);
    const docs = Math.min(6, wiki.docs.filter((doc) => wikiDocInjectable(doc, wiki)).length) * 600;
    return always + docs;
  }
  function promiseContext(chat, data) {
    const items = activePromises(data).slice(0, data.maxPromises);
    const lines = [
      PROMISE_MARKER,
      `[약속 · ${chatLabel(chat)}]`,
      "아래는 사용자가 직접 보관한 현재 유효한 약속·계획이다.",
    ];
    for (const item of items) {
      const schedule = item.scheduleText ? ` / 예정: ${truncate(item.scheduleText, 90)}` : "";
      lines.push(`- ${item.priority === "high" ? "[중요] " : ""}${truncate(item.title, 90)}: ${truncate(item.content, 320)}${schedule}`);
    }
    lines.push("관련 상황에서 자연스럽게 기억하되 목록을 먼저 낭독하지 말고, 기록에 없는 약속을 새로 만들지 마라.");
    return lines.join("\n");
  }

  function anchorContext(chat, data) {
    const items = anchorInjectionPlan(data).selected;
    const lines = [
      ANCHOR_MARKER,
      `[기억 앵커 · ${chatLabel(chat)}]`,
      "아래는 이 RP에서 당장 잊으면 안 되는 사용자가 고정한 사실이다.",
    ];
    for (const item of items) lines.push(anchorLine(item));
    lines.push("현재 서사와 충돌하지 않는 범위에서 지속적으로 유지하라. 목록 자체를 대사로 낭독하지 마라.");
    return lines.join("\n");
  }

  function keywordContext(chat, item) {
    return [
      KEYWORD_MARKER,
      `[조건부 기억 앵커 · ${chatLabel(chat)}]`,
      `[${ANCHOR_CATEGORY_LABEL[item.category] || "기억"}] ${item.title}: ${item.content}`,
      "이 기억은 관련 키워드/상황에서만 자연스럽게 참조하고, 목록이나 시스템 지시처럼 언급하지 마라.",
    ].join("\n");
  }

  function constantEntryPayload({ tag, name, content, enabled, order, dynamicState }) {
    return {
      name,
      content,
      description: `${name} · 기억 보관함 자동 관리`,
      keys: [],
      secondaryKeys: [],
      enabled,
      constant: true,
      selective: false,
      probability: null,
      scanDepth: null,
      matchWholeWords: false,
      caseSensitive: false,
      useRegex: false,
      position: 0,
      depth: 4,
      order,
      role: "system",
      preventRecursion: true,
      excludeRecursion: false,
      delayUntilRecursion: false,
      excludeFromVectorization: true,
      tag,
      dynamicState,
    };
  }

  function backupEntryPayload(chat, data) {
    const snapshot = normalizeData(data);
    snapshot.ownerChatId = String(chat.id);
    const savedAt = nowIso();
    return {
      name: "기억 보관함 · 구조화 백업",
      content: `${BACKUP_MARKER}\n${JSON.stringify({ marker: BACKUP_MARKER, ownerChatId: String(chat.id), savedAt, data: snapshot })}`,
      description: `기억 보관함 비활성 복구 백업 · owner:${chat.id}`,
      keys: [], secondaryKeys: [], enabled: false, constant: false, selective: false,
      probability: null, scanDepth: null, matchWholeWords: false, caseSensitive: false, useRegex: false,
      position: 0, depth: 4, order: 999, role: "system", preventRecursion: true,
      excludeRecursion: true, delayUntilRecursion: false, excludeFromVectorization: true,
      tag: BACKUP_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: "structured-backup", inactiveBackup: true },
    };
  }

  function keywordEntryPayload(chat, item) {
    return {
      name: `기억 앵커 · ${truncate(item.title, 120)}`,
      content: keywordContext(chat, item),
      description: `기억 보관함 조건부 앵커 · item:${item.id}`,
      keys: item.keywords.slice(0, 24),
      secondaryKeys: [],
      enabled: true,
      constant: false,
      selective: false,
      probability: null,
      scanDepth: null,
      matchWholeWords: false,
      caseSensitive: false,
      useRegex: false,
      position: 0,
      depth: 4,
      order: item.priority === "high" ? 35 : item.priority === "low" ? 55 : 45,
      role: "system",
      preventRecursion: true,
      excludeRecursion: false,
      delayUntilRecursion: false,
      excludeFromVectorization: true,
      tag: KEYWORD_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), memoryCabinetItemId: String(item.id), managedBy: LOREBOOK_TAG },
    };
  }

  async function upsertEntry(bookId, entries, entryId, matcher, payload) {
    let entry = null;
    if (entryId) entry = entries.find((row) => String(row.id) === String(entryId)) || null;
    if (!entry) entry = entries.find(matcher) || null;
    if (entry?.id) {
      const updated = await api(`lorebooks/${encodeURIComponent(bookId)}/entries/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: payload });
      return String(updated?.id || entry.id);
    }
    const created = await api(`lorebooks/${encodeURIComponent(bookId)}/entries`, { method: "POST", body: payload });
    if (!created?.id) throw new Error("로어북 항목을 만들지 못했습니다.");
    return String(created.id);
  }

  async function syncLorebook({ silent = false } = {}) {
    if (!state.currentChat || !state.currentData || state.syncing) return;
    if (!ownershipAllowsData()) throw new Error("격리된 기억은 로어북에 동기화할 수 없습니다.");
    await verifyOwnershipBeforePersist();
    state.syncing = true;
    const chat = state.currentChat;
    const data = normalizeData(state.currentData);
    data.ownerChatId = String(chat.id);
    try {
      await host.beginSync(chat.id);
      const previousBookId = String(data.lorebookId || "");
      const book = await ensureManagedBook(chat, data);
      const detachIds = [...new Set([...(previousBookId && previousBookId !== String(book.id) ? [previousBookId] : []), ...state.ownershipDetachLorebookIds])];
      await attachLorebook(chat.id, book.id, detachIds);
      const rows = extractArray(await api(`lorebooks/${encodeURIComponent(book.id)}/entries`), ["entries", "items", "results"]);

      const promises = activePromises(data).slice(0, data.maxPromises);
      data.promiseEntryId = await upsertEntry(
        book.id,
        rows,
        data.promiseEntryId,
        (entry) => entry?.tag === PROMISE_ENTRY_TAG || String(entry?.content || "").includes(PROMISE_MARKER),
        constantEntryPayload({
          tag: PROMISE_ENTRY_TAG,
          name: "약속 · 진행 중",
          content: promiseContext(chat, data),
          enabled: data.enabled && promises.length > 0,
          order: 30,
          dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: "promises" },
        }),
      );

      const anchors = anchorInjectionPlan(data).selected;
      data.anchorEntryId = await upsertEntry(
        book.id,
        rows,
        data.anchorEntryId,
        (entry) => entry?.tag === ANCHOR_ENTRY_TAG || String(entry?.content || "").includes(ANCHOR_MARKER),
        constantEntryPayload({
          tag: ANCHOR_ENTRY_TAG,
          name: "기억 앵커 · 항상 기억",
          content: anchorContext(chat, data),
          enabled: data.enabled && anchors.length > 0,
          order: 32,
          dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: "anchors" },
        }),
      );

      const keywordItems = activeKeywordAnchors(data);
      const existingKeywordEntries = rows.filter((entry) => entry?.tag === KEYWORD_ENTRY_TAG || String(parseRecord(entry?.dynamicState).memoryCabinetItemId || "").trim());
      const nextMap = {};
      for (const item of keywordItems) {
        const knownId = String(data.keywordEntryIds?.[item.id] || "");
        const id = await upsertEntry(
          book.id,
          rows,
          knownId,
          (entry) => String(parseRecord(entry?.dynamicState).memoryCabinetItemId || "") === item.id,
          keywordEntryPayload(chat, item),
        );
        nextMap[item.id] = id;
      }
      const activeIds = new Set(Object.values(nextMap).map(String));
      for (const entry of existingKeywordEntries) {
        if (!entry?.id || activeIds.has(String(entry.id))) continue;
        try { await api(`lorebooks/${encodeURIComponent(book.id)}/entries/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { enabled: false } }); } catch {}
      }

      const memory = data.elementMemory;
      memory.headerEntryId = await upsertEntry(
        book.id,
        rows,
        memory.headerEntryId,
        (entry) => entry?.tag === ELEMENT_HEADER_ENTRY_TAG,
        elementHeaderPayload(memory, chat),
      );

      const existingElementEntries = rows.filter((entry) => [ELEMENT_FACT_ENTRY_TAG, ELEMENT_TRIGGER_ENTRY_TAG].includes(String(entry?.tag || "")));
      const nextElementMap = {};
      const activeElementEntryIds = new Set();
      for (const entity of memory.entities) {
        const previous = parseRecord(memory.entityEntryIds?.[entity.id]);
        const factId = await upsertEntry(
          book.id, rows, String(previous.factId || ""),
          (entry) => String(parseRecord(entry?.dynamicState).memoryCabinetElementId || "") === entity.id && entry?.tag === ELEMENT_FACT_ENTRY_TAG,
          elementFactEntryPayload(chat, entity, memory),
        );
        activeElementEntryIds.add(String(factId));
        const proxyIds = [];
        const conditions = elementTriggerConditions(entity);
        for (let i = 0; i < conditions.length; i++) {
          const known = safeArray(previous.proxyIds)[i];
          const proxyId = await upsertEntry(
            book.id, rows, String(known || ""),
            (entry) => {
              const ds = parseRecord(entry?.dynamicState);
              return entry?.tag === ELEMENT_TRIGGER_ENTRY_TAG && String(ds.memoryCabinetElementId || "") === entity.id && Number(ds.memoryCabinetConditionIndex) === i;
            },
            elementProxyEntryPayload(chat, entity, conditions[i], i, memory),
          );
          proxyIds.push(proxyId); activeElementEntryIds.add(String(proxyId));
        }
        nextElementMap[entity.id] = { factId, proxyIds };
      }
      for (const entry of existingElementEntries) {
        if (!entry?.id || activeElementEntryIds.has(String(entry.id))) continue;
        try { await api(`lorebooks/${encodeURIComponent(book.id)}/entries/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { enabled: false } }); } catch {}
      }
      memory.entityEntryIds = nextElementMap;
      memory.originChatId = chat.id;
      data.elementMemory = memory;

      const wiki = data.wiki;
      wiki.headerEntryId = await upsertEntry(
        book.id, rows, wiki.headerEntryId,
        (entry) => entry?.tag === WIKI_HEADER_ENTRY_TAG,
        wikiHeaderPayload(wiki, chat),
      );
      wiki.alwaysEntryId = await upsertEntry(
        book.id, rows, wiki.alwaysEntryId,
        (entry) => entry?.tag === WIKI_ALWAYS_ENTRY_TAG,
        wikiAlwaysPayload(wiki, chat),
      );
      const existingWikiEntries = rows.filter((entry) => [WIKI_DOC_ENTRY_TAG, WIKI_TRIGGER_ENTRY_TAG].includes(String(entry?.tag || "")));
      const nextWikiMap = {};
      const activeWikiEntryIds = new Set();
      for (const doc of wiki.docs) {
        const previous = parseRecord(wiki.docEntryIds?.[doc.id]);
        const bodyId = await upsertEntry(
          book.id, rows, String(previous.bodyId || ""),
          (entry) => entry?.tag === WIKI_DOC_ENTRY_TAG && String(parseRecord(entry?.dynamicState).memoryCabinetWikiId || "") === doc.id,
          wikiDocEntryPayload(chat, doc, wiki),
        );
        activeWikiEntryIds.add(String(bodyId));
        const proxyIds = [];
        const conditions = wikiTriggerConditions(doc);
        for (let i = 0; i < conditions.length; i++) {
          const known = safeArray(previous.proxyIds)[i];
          const proxyId = await upsertEntry(
            book.id, rows, String(known || ""),
            (entry) => {
              const ds = parseRecord(entry?.dynamicState);
              return entry?.tag === WIKI_TRIGGER_ENTRY_TAG && String(ds.memoryCabinetWikiId || "") === doc.id && Number(ds.memoryCabinetConditionIndex) === i;
            },
            wikiProxyEntryPayload(chat, doc, conditions[i], i, wiki),
          );
          proxyIds.push(proxyId); activeWikiEntryIds.add(String(proxyId));
        }
        nextWikiMap[doc.id] = { bodyId, proxyIds };
      }
      for (const entry of existingWikiEntries) {
        if (!entry?.id || activeWikiEntryIds.has(String(entry.id))) continue;
        try { await api(`lorebooks/${encodeURIComponent(book.id)}/entries/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: { enabled: false } }); } catch {}
      }
      wiki.docEntryIds = nextWikiMap;
      wiki.originChatId = chat.id;
      data.wiki = wiki;

      data.lorebookId = book.id;
      data.keywordEntryIds = nextMap;
      data.lastSyncAt = nowIso();
      data.lastSyncError = "";
      data.updatedAt = nowIso();
      data.backupEntryId = await upsertEntry(
        book.id,
        rows,
        data.backupEntryId,
        (entry) => entry?.tag === BACKUP_ENTRY_TAG || String(entry?.content || "").includes(BACKUP_MARKER),
        backupEntryPayload(chat, data),
      );
      await host.commitSync(chat.id);
      await patchChatMetadata(chat.id, { [DATA_KEY]: data });
      state.currentData = data;
      state.ownershipDetachLorebookIds = [];
      if (!silent) toast("전용 로어북을 동기화했습니다.");
    } catch (error) {
      data.lastSyncError = String(error?.message || error);
      try { await patchChatMetadata(chat.id, { [DATA_KEY]: data }); } catch {}
      state.currentData = data;
      if (!silent) toast(`동기화 실패: ${data.lastSyncError}`, true);
      throw error;
    } finally {
      host.endSync();
      state.syncing = false;
      render();
    }
  }

  // ──────────────────────────────────────────────
  // 요소 기억: 원문 기반 entity-centric continuity memory
  // ──────────────────────────────────────────────

  function elementMemory(data = state.currentData) { return normalizeElementMemory(data?.elementMemory); }
  function elementKey(value) { return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function elementFindMatches(entities, value) {
    const key = elementKey(value);
    if (!key) return [];
    return safeArray(entities).filter((entity) => [entity.name, ...safeArray(entity.aliases)].some((name) => elementKey(name) === key));
  }
  function elementMessageFingerprint(row) {
    return textHash(`${String(row?.role || "")}|${Number(row?.activeSwipeIndex) || 0}|${String(row?.createdAt || "")}|${String(row?.content || "")}`);
  }
  function collectCompletedTurns(messages) {
    const turns = [];
    let current = null;
    const push = () => {
      if (current && current.hasUser && current.hasAssistant) turns.push({ ...current, turn: turns.length + 1 });
      current = null;
    };
    safeArray(messages).forEach((row, index) => {
      const role = String(row?.role || "");
      if (!['user', 'assistant'].includes(role) || !String(row?.content || "").trim()) return;
      if (role === 'user') {
        push();
        current = { startMessageIndex: index, endMessageIndex: index, messages: [row], hasUser: true, hasAssistant: false };
      } else if (current?.hasUser) {
        current.messages.push(row); current.endMessageIndex = index; current.hasAssistant = true;
      }
    });
    push();
    return turns;
  }
  function selectElementTurns(messages, request = {}) {
    const turns = collectCompletedTurns(messages);
    const totalTurns = turns.length;
    if (!totalTurns) throw new Error("완결된 RP 턴이 없습니다.");
    const mode = request.mode === 'range' ? 'range' : 'recent';
    let startTurn; let endTurn;
    if (mode === 'recent') {
      const count = Math.max(1, Math.min(100, Number(request.turns) || 20));
      startTurn = Math.max(1, totalTurns - count + 1); endTurn = totalTurns;
    } else {
      startTurn = Number(request.startTurn); endTurn = Number(request.endTurn);
      if (!Number.isInteger(startTurn) || !Number.isInteger(endTurn)) throw new Error("턴 범위는 정수로 입력해 주세요.");
      if (startTurn < 1 || endTurn < 1 || startTurn > endTurn) throw new Error("턴 범위를 확인해 주세요.");
      if (endTurn > totalTurns) throw new Error(`현재 완결된 RP는 ${totalTurns}턴까지입니다.`);
      if (endTurn - startTurn + 1 > 100) throw new Error("한 번에 최대 100턴까지 읽을 수 있습니다.");
    }
    const selectedTurns = turns.slice(startTurn - 1, endTurn);
    const selectedMessages = selectedTurns.flatMap((turn) => turn.messages);
    return { totalTurns, startTurn, endTurn, turns: selectedTurns, messages: selectedMessages };
  }
  function elementSourceText(messages) {
    return safeArray(messages).map((row, index) => `[M${index} ${String(row.role || 'record')}] ${String(row.content || '')}`).join("\n\n");
  }
  function chunkElementMessages(messages, maxChars = ELEMENT_CHUNK_CHARS) {
    const chunks = [];
    let current = [];
    let currentChars = 0;
    for (const message of safeArray(messages)) {
      const messageChars = String(message?.content || '').length + 32;
      if (current.length && currentChars + messageChars > maxChars) {
        chunks.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(message);
      currentChars += messageChars;
    }
    if (current.length) chunks.push(current);
    return chunks;
  }
  function elementSourceFromEvidence(messages, evidence) {
    const picked = [...new Set(safeArray(evidence).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < messages.length))].sort((a, b) => a - b);
    if (!picked.length) return null;
    const rows = picked.map((i) => messages[i]).filter(Boolean);
    const messageIds = rows.map((row) => String(row.id || row.messageId || '')).filter(Boolean);
    const fingerprints = rows.map(elementMessageFingerprint);
    const activeSwipeIndex = Number(rows[0]?.activeSwipeIndex) || 0;
    return { messageIds, fingerprints, activeSwipeIndex, contentHash: textHash(fingerprints.join('|')) };
  }
  function chooseElementExistingCandidates(entities, sourceText) {
    const haystack = String(sourceText || '').toLocaleLowerCase();
    return safeArray(entities).map((entity) => {
      let score = 0;
      [entity.name, ...safeArray(entity.aliases)].forEach((value) => {
        const key = String(value || '').trim().toLocaleLowerCase();
        if (key && haystack.includes(key)) score += 3;
      });
      return { entity, score };
    }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || String(b.entity.updatedAt).localeCompare(String(a.entity.updatedAt))).slice(0, 24).map((row) => row.entity);
  }
  function elementExtractionPrompt(memory, messages) {
    const sourceText = elementSourceText(messages);
    const existing = chooseElementExistingCandidates(memory.entities, sourceText);
    const existingText = existing.length ? existing.map((entity) => {
      const lines = [`id=${entity.id} name=${entity.name} aliases=${safeArray(entity.aliases).join(' | ')}`];
      if (entity.standaloneTriggers.length) lines.push(`  standaloneTriggers: ${entity.standaloneTriggers.join(' | ')}`);
      entity.triggerGroups.forEach((group) => lines.push(`  triggerGroup: ${group.join(' + ')}`));
      entity.currentFacts.forEach((fact) => lines.push(`  current [${fact.id}] ${fact.text}`));
      entity.historyFacts.forEach((fact) => lines.push(`  history [${fact.id}] ${fact.text}`));
      return lines.join('\n');
    }).join('\n\n') : '(none)';
    const criteria = String(memory.extractionPrompt || '').trim() || DEFAULT_ELEMENT_EXTRACTION_PROMPT;
    const contract = [
      'Response contract — return ONE JSON object and nothing else:',
      '{"entities":[{"action":"create"|"update","existingId":null,"name":"...","nameKo":null,"aliases":["..."],"standaloneTriggers":["..."],"triggerGroups":[["...","..."]],"currentFacts":[{"text":"...","textKo":null,"replacesFactId":null}],"historyFacts":[{"text":"...","textKo":null}],"evidence":[0,1]}]}',
      '- At most 12 entities.',
      '- evidence lists M indexes from the supplied source and must not be empty.',
      '- existingId and replacesFactId must be copied exactly from Existing elements, or null. Never invent one.',
      '- Use action=update whenever the entity already appears in Existing elements.',
      '- aliases identify the same entity; they are NOT retrieval conditions.',
      '- standaloneTriggers are specific phrases that may recall this entity by themselves. Do not use bare generic nouns.',
      '- triggerGroups are AND conditions; all words inside one group must appear. Put generic words here with a specific companion.',
      '- Leave retrieval conditions empty rather than inventing uncertain triggers.',
      '- Put retrieval phrases for BOTH the source language and Korean into standaloneTriggers and triggerGroups when the roleplay is not in Korean.',
      '- Return {"entities":[]} when nothing qualifies.',
      LANGUAGE_CONTRACT,
    ].join('\n');
    return `${criteria}\n\n[Existing elements]\n${existingText}\n[/Existing elements]\n\n${contract}`;
  }
  function parseElementProposalJson(text, memory, messages) {
    const fragments = collectBalancedJsonFragments(text);
    let parsed = null;
    for (const fragment of fragments) {
      for (const candidate of [fragment, repairJsonishText(fragment)]) {
        try { parsed = JSON.parse(candidate); break; } catch {}
      }
      if (parsed) break;
    }
    if (!parsed) return { ok: false, rows: [] };
    const rows = Array.isArray(parsed) ? parsed : safeArray(parsed.entities);
    const sourceText = messages.map((row) => String(row.content || '')).join('\n').toLocaleLowerCase();
    const claimed = new Set();
    const normalized = [];
    for (const raw of rows) {
      if (!isRecord(raw)) continue;
      const name = String(raw.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) continue;
      const aliases = normalizeTextList(raw.aliases, 8, 80);
      if (![name, ...aliases].some((value) => sourceText.includes(String(value).toLocaleLowerCase()))) continue;
      const source = elementSourceFromEvidence(messages, raw.evidence);
      if (!source) continue;
      let target = null;
      const requestedId = String(raw.existingId || '');
      if (requestedId) target = memory.entities.find((entity) => entity.id === requestedId) || null;
      if (!target) {
        const matches = elementFindMatches(memory.entities, name).filter((entity) => !claimed.has(entity.id));
        if (matches.length === 1) target = matches[0];
      }
      if (target) claimed.add(target.id);
      const currentFacts = safeArray(raw.currentFacts).map((fact) => {
        if (!isRecord(fact)) return null;
        const textValue = String(fact.text || '').trim().slice(0, 300);
        if (!textValue) return null;
        const replace = String(fact.replacesFactId || '');
        return { text: textValue, textKo: String(fact.textKo || "").trim().slice(0, 300), replacesFactId: target?.currentFacts.some((row) => row.id === replace) ? replace : null };
      }).filter(Boolean);
      const historyFacts = safeArray(raw.historyFacts).map((fact) => ({
        text: String(isRecord(fact) ? fact.text : fact || '').trim().slice(0, 300),
        textKo: isRecord(fact) ? String(fact.textKo || '').trim().slice(0, 300) : '',
      })).filter((fact) => fact.text);
      if (!currentFacts.length && !historyFacts.length) continue;
      normalized.push({
        proposalId: uid('elp'),
        kind: target ? 'update' : 'create',
        entityId: target?.id || null,
        baseUpdatedAt: target?.updatedAt || null,
        name,
        nameKo: String(raw.nameKo || '').trim().slice(0, 80),
        aliases,
        standaloneTriggers: normalizeTextList(raw.standaloneTriggers, 8, 80),
        triggerGroups: normalizeTriggerGroups(raw.triggerGroups),
        currentFacts,
        historyFacts,
        source,
      });
    }
    return { ok: true, rows: normalized };
  }
  function mergeElementProposalSource(left, right) {
    if (!left) return right || null;
    if (!right) return left;
    const messageIds = normalizeTextList([...safeArray(left.messageIds), ...safeArray(right.messageIds)], 96, 120);
    const fingerprints = normalizeTextList([...safeArray(left.fingerprints), ...safeArray(right.fingerprints)], 96, 120);
    return {
      messageIds,
      fingerprints,
      activeSwipeIndex: Number.isInteger(right.activeSwipeIndex) ? right.activeSwipeIndex : Number(left.activeSwipeIndex) || 0,
      contentHash: textHash(fingerprints.join('|')),
    };
  }
  function mergeElementProposals(rows) {
    const merged = [];
    for (const row of safeArray(rows)) {
      const identities = new Set([row.name, ...safeArray(row.aliases)].map((value) => String(value || '').trim().toLocaleLowerCase()).filter(Boolean));
      if (!identities.size) continue;
      const existingIndex = merged.findIndex((candidate) => {
        if (row.entityId && candidate.entityId === row.entityId) return true;
        if (row.entityId || candidate.entityId) return false;
        return [candidate.name, ...safeArray(candidate.aliases)].some((value) => identities.has(String(value || '').trim().toLocaleLowerCase()));
      });
      if (existingIndex < 0) {
        merged.push({ ...row, currentFacts: safeArray(row.currentFacts).slice(), historyFacts: safeArray(row.historyFacts).slice() });
        continue;
      }
      const target = merged[existingIndex];
      const currentByText = new Map(safeArray(target.currentFacts).map((fact) => [elementFactKey(fact), fact]));
      for (const fact of safeArray(row.currentFacts)) {
        const factKey = elementFactKey(fact);
        if (!factKey) continue;
        const prior = currentByText.get(factKey);
        if (!prior) { target.currentFacts.push(fact); currentByText.set(factKey, fact); }
        else if (!prior.replacesFactId && fact.replacesFactId) prior.replacesFactId = fact.replacesFactId;
      }
      const knownFacts = new Set([...target.currentFacts, ...target.historyFacts].map(elementFactKey));
      for (const fact of safeArray(row.historyFacts)) {
        const factKey = elementFactKey(fact);
        if (!factKey || knownFacts.has(factKey)) continue;
        knownFacts.add(factKey);
        target.historyFacts.push(fact);
      }
      target.aliases = normalizeTextList([...target.aliases, ...row.aliases], 8, 80);
      target.standaloneTriggers = normalizeTextList([...target.standaloneTriggers, ...row.standaloneTriggers], 8, 80);
      target.triggerGroups = normalizeTriggerGroups([...target.triggerGroups, ...row.triggerGroups]);
      target.source = mergeElementProposalSource(target.source, row.source);
    }
    return merged.map((row) => {
      const seen = new Set();
      const currentFacts = safeArray(row.currentFacts).filter((fact) => { const key = elementFactKey(fact); if (!key || seen.has(key)) return false; seen.add(key); return true; });
      const historyFacts = safeArray(row.historyFacts).filter((fact) => { const key = elementFactKey(fact); if (!key || seen.has(key)) return false; seen.add(key); return true; });
      return { ...row, currentFacts, historyFacts };
    });
  }
  async function fetchElementMessages() {
    const payload = await api(`chats/${encodeURIComponent(state.selectedChatId)}/messages`);
    return extractArray(payload, ['messages', 'items', 'results']).filter((row) => ['user', 'assistant'].includes(String(row.role || '')) && String(row.content || '').trim());
  }
  async function previewElementRange() {
    const messages = await fetchElementMessages();
    const req = state.elementExtractMode === 'range'
      ? { mode: 'range', startTurn: state.elementRangeStart, endTurn: state.elementRangeEnd }
      : { mode: 'recent', turns: state.elementExtractTurns };
    return selectElementTurns(messages, req);
  }
  async function generateElementCandidates() {
    const data = normalizeData(state.currentData);
    const memory = data.elementMemory;
    const connectionId = String(memory.connectionId || state.modelConnectionId || chooseDefaultConnection(state.currentChat) || '');
    if (!connectionId) throw new Error('요소 기억 추출에 사용할 모델 연결을 선택해 주세요.');
    const messages = await fetchElementMessages();
    const req = state.elementExtractMode === 'range'
      ? { mode: 'range', startTurn: state.elementRangeStart, endTurn: state.elementRangeEnd }
      : { mode: 'recent', turns: state.elementExtractTurns };
    const selection = selectElementTurns(messages, req);
    const chunks = chunkElementMessages(selection.messages);
    setBusy(true, `요소 기억 후보를 찾는 중… 1/${chunks.length} 청크`);
    try {
      const collected = [];
      const failures = [];
      let successfulChunks = 0;
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        state.busyText = `요소 기억 후보를 찾는 중… ${chunkIndex + 1}/${chunks.length} 청크`;
        const busyLabel = document.querySelector('.mmc-busy b');
        if (busyLabel) busyLabel.textContent = state.busyText;
        let output = '';
        try {
          const payload = await api('generate/raw', {
            method: 'POST', timeoutMs: MODEL_TIMEOUT_MS,
            body: {
              connectionId,
              runId: uid('element-extract'),
              streaming: false,
              messages: [
                { role: 'system', content: `${elementExtractionPrompt(memory, chunk)}\n\nThis is source chunk ${chunkIndex + 1} of ${chunks.length}. Analyze this chunk independently.` },
                { role: 'user', content: `[SOURCE MESSAGES]\n${elementSourceText(chunk)}\n[/SOURCE MESSAGES]` },
              ],
              parameters: { maxTokens: 1800, reasoningEffort: null },
            },
          });
          output = extractGeneratedText(payload);
          const parsed = parseElementProposalJson(output, memory, chunk);
          if (!parsed.ok) throw new Error('응답 JSON을 읽지 못함');
          successfulChunks += 1;
          collected.push(...parsed.rows);
        } catch (error) {
          failures.push({ index: chunkIndex, message: String(error?.message || '분석 실패'), output: String(output || ''), rows: chunk.slice() });
        }
      }
      if (!successfulChunks) {
        const first = failures.find((row) => row.output) || failures[0];
        if (first.output) {
          state.rawRecovery = { kind: 'element', text: first.output, rows: first.rows, extractInfo: { ...selection, chunkCount: chunks.length, failedChunks: failures.length } };
          state.layer = 'raw-repair';
          toast(`전체 ${chunks.length}개 청크 분석에 실패했습니다. 첫 응답 원문을 보존했습니다.`, true);
          return;
        }
        throw new Error(`전체 ${chunks.length}개 청크 분석에 실패했습니다: ${first.message}`);
      }
      const merged = mergeElementProposals(collected);
      state.elementCandidateOverflow = Math.max(0, merged.length - ELEMENT_CANDIDATE_LIMIT);
      state.elementCandidates = merged.slice(0, ELEMENT_CANDIDATE_LIMIT);
      state.elementCandidateSelected = new Set(state.elementCandidates.map((_, i) => String(i)));
      state.elementExtractInfo = { ...selection, chunkCount: chunks.length, successfulChunks, failedChunks: failures.length };
      state.layer = 'element-candidates';
      if (failures.length) toast(`${chunks.length}개 중 ${failures.length}개 청크는 실패했습니다. 성공한 후보 ${state.elementCandidates.length}개는 유지했습니다.`, true);
      else if (state.elementCandidateOverflow) toast(`후보 상한을 넘어 ${state.elementCandidateOverflow}개가 미리보기에 포함되지 않았습니다.`, true);
      else if (!state.elementCandidates.length) toast('이번 범위에서는 저장할 만한 요소 기억을 찾지 못했습니다.');
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }
  function elementCandidateFromDom(candidate, index) {
    const get = (suffix) => document.getElementById(`mmc-ec-${suffix}-${index}`);
    const lines = (value, max) => String(value || '').split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, max);
    const name = String(get('name')?.value || candidate.name || '').trim().slice(0, 80);
    const aliases = normalizeTextList(lines(get('aliases')?.value, 8), 8, 80);
    const standaloneTriggers = normalizeTextList(lines(get('triggers')?.value, 8), 8, 80);
    const triggerGroups = normalizeTriggerGroups(lines(get('groups')?.value, 8).map((line) => line.split(/[,＋+]/)));
    const currentLines = lines(get('current')?.value, Number.MAX_SAFE_INTEGER);
    const historyLines = lines(get('history')?.value, Number.MAX_SAFE_INTEGER);
    // 손으로 고치지 않은 줄은 한국어 표시본을 그대로 가져간다. 고친 줄은 번역이 더 이상 맞지 않으므로 버린다.
    const koByText = new Map([...safeArray(candidate.currentFacts), ...safeArray(candidate.historyFacts)]
      .filter((fact) => fact && fact.textKo).map((fact) => [String(fact.text || ''), String(fact.textKo)]));
    return {
      ...candidate, name, aliases, standaloneTriggers, triggerGroups,
      currentFacts: currentLines.map((textValue, i) => ({ text: textValue.slice(0, 300), textKo: koByText.get(textValue) || '', replacesFactId: candidate.currentFacts?.[i]?.replacesFactId || null })),
      historyFacts: historyLines.map((textValue) => ({ text: textValue.slice(0, 300), textKo: koByText.get(textValue) || '' })),
    };
  }
  function mergeFactLines(existingFacts, textLines, now) {
    const byText = new Map(existingFacts.map((fact) => [fact.text, fact]));
    return textLines.map((textValue) => byText.get(textValue) || { id: uid('elf'), text: textValue.slice(0, 300), textKo: '', source: null, createdAt: now });
  }
  async function applyElementCandidates() {
    const selectedIndices = [...state.elementCandidateSelected].map(Number).filter((i) => Number.isInteger(i));
    if (!selectedIndices.length) throw new Error('저장할 요소 후보를 선택해 주세요.');
    const data = await freshOwnedData();
    const memory = data.elementMemory;
    let created = 0; let updated = 0; const conflicts = [];
    const succeeded = new Set();
    const now = nowIso();
    for (const index of selectedIndices) {
      const original = state.elementCandidates[index];
      if (!original) continue;
      const proposal = elementCandidateFromDom(original, index);
      if (!proposal.name || (!proposal.currentFacts.length && !proposal.historyFacts.length)) continue;
      if (proposal.kind === 'update') {
        const targetIndex = memory.entities.findIndex((entity) => entity.id === proposal.entityId);
        if (targetIndex < 0) { conflicts.push(`${proposal.name}: 기존 요소 없음`); continue; }
        const target = memory.entities[targetIndex];
        if (proposal.baseUpdatedAt && target.updatedAt !== proposal.baseUpdatedAt) { conflicts.push(`${target.name}: 검토 중 수정됨`); continue; }
        const supersededIds = new Set(proposal.currentFacts.map((fact) => fact.replacesFactId).filter(Boolean));
        const keptCurrent = target.currentFacts.filter((fact) => !supersededIds.has(fact.id));
        const demoted = target.currentFacts.filter((fact) => supersededIds.has(fact.id));
        const keptKeys = new Set(keptCurrent.map(elementFactKey));
        const addCurrent = proposal.currentFacts.filter((fact) => !keptKeys.has(elementFactKey(fact.text))).map((fact) => ({ id: uid('elf'), text: fact.text, textKo: fact.textKo || '', source: proposal.source, createdAt: now }));
        const historyKeys = new Set([...target.historyFacts, ...demoted].map(elementFactKey));
        const addHistory = proposal.historyFacts.filter((fact) => !historyKeys.has(elementFactKey(fact.text))).map((fact) => ({ id: uid('elf'), text: fact.text, textKo: fact.textKo || '', source: proposal.source, createdAt: now }));
        target.name = proposal.name;
        if (proposal.nameKo) target.nameKo = proposal.nameKo;
        target.aliases = normalizeTextList([...target.aliases, ...proposal.aliases], 8, 80);
        target.standaloneTriggers = normalizeTextList([...target.standaloneTriggers, ...proposal.standaloneTriggers], 8, 80);
        target.triggerGroups = normalizeTriggerGroups([...target.triggerGroups, ...proposal.triggerGroups]);
        const balanced = balanceElementFacts([...keptCurrent, ...addCurrent], [...target.historyFacts, ...demoted, ...addHistory]);
        target.currentFacts = balanced.currentFacts;
        target.historyFacts = balanced.historyFacts;
        target.updatedAt = now;
        updated += 1; succeeded.add(index); continue;
      }
      if (memory.entities.length >= 400) { conflicts.push(`${proposal.name}: 요소 상한`); continue; }
      if (elementFindMatches(memory.entities, proposal.name).length) { conflicts.push(`${proposal.name}: 같은 이름/별칭이 이미 있음`); continue; }
      memory.entities.push(normalizeElement({
        id: uid('element'), name: proposal.name, nameKo: proposal.nameKo, aliases: proposal.aliases,
        standaloneTriggers: proposal.standaloneTriggers, triggerGroups: proposal.triggerGroups,
        currentFacts: proposal.currentFacts.map((fact) => ({ id: uid('elf'), text: fact.text, textKo: fact.textKo || '', source: proposal.source, createdAt: now })),
        historyFacts: proposal.historyFacts.map((fact) => ({ id: uid('elf'), text: fact.text, textKo: fact.textKo || '', source: proposal.source, createdAt: now })),
        createdAt: now, updatedAt: now,
      }));
      created += 1; succeeded.add(index);
    }
    memory.originChatId = state.selectedChatId;
    data.elementMemory = memory;
    await persistData(data);
    if (conflicts.length) {
      state.elementCandidates = state.elementCandidates.filter((_, i) => !succeeded.has(i));
      state.elementCandidateSelected = new Set(state.elementCandidates.map((_, i) => String(i)));
      state.layer = state.elementCandidates.length ? 'element-candidates' : null;
      toast(`${created + updated}개 저장 · ${conflicts.length}개는 최신 수정/중복 때문에 남겨뒀습니다.`, true);
    } else {
      state.elementCandidates = []; state.elementCandidateSelected.clear(); state.elementExtractInfo = null; state.elementCandidateOverflow = 0; state.layer = null;
      toast(`요소 기억 ${created + updated}개를 저장했습니다.`);
    }
    render();
  }
  function elementFactLines(entity) {
    const current = entity.currentFacts.map((fact) => `- ${fact.text}`).join('\n');
    const history = entity.historyFacts.slice(-4).map((fact) => `- ${fact.text}`).join('\n');
    return [current ? `현재:\n${current}` : '', history ? `이력:\n${history}` : ''].filter(Boolean).join('\n');
  }
  function elementContext(chat, entity) {
    return [ELEMENT_MARKER, `[요소 기억 · ${chatLabel(chat)} · ${entity.name}]`, elementFactLines(entity)].filter(Boolean).join('\n');
  }
  function elementTriggerMarker(entityId) { return `${ELEMENT_TRIGGER_MARKER}:${entityId}`; }
  function elementTriggerConditions(entity) {
    const conditions = [];
    if (entity.standaloneTriggers.length) conditions.push({ kind: 'standalone', keys: entity.standaloneTriggers.slice() });
    const groups = normalizeTriggerGroups(entity.triggerGroups);
    for (const group of groups) {
      const covered = entity.standaloneTriggers.some((trigger) => group.every((term) => trigger.toLocaleLowerCase().includes(term.toLocaleLowerCase())));
      if (!covered) conditions.push({ kind: 'group', keys: group.slice() });
    }
    return conditions;
  }
  function elementHeaderContext(memory) {
    const base = String(memory.injectionPrompt || '').trim() || DEFAULT_ELEMENT_INJECTION_PROMPT;
    return `${base}\n${ADVANCED_MEMORY_PRIORITY_RULE}`;
  }
  function elementHeaderPayload(memory, chat) {
    const any = memory.injectionEnabled && memory.entities.some((entity) => elementTriggerConditions(entity).length && (entity.currentFacts.length || entity.historyFacts.length));
    return constantEntryPayload({
      tag: ELEMENT_HEADER_ENTRY_TAG,
      name: '요소 기억 · 해석 지침',
      content: elementHeaderContext(memory),
      enabled: any,
      order: 33,
      dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: 'element-header' },
    });
  }
  function elementFactEntryPayload(chat, entity, memory) {
    return {
      name: `요소 기억 · ${truncate(entity.name, 120)}`,
      content: elementContext(chat, entity),
      description: `기억 보관함 요소 기억 · element:${entity.id}`,
      keys: [elementTriggerMarker(entity.id)], secondaryKeys: [],
      enabled: memory.injectionEnabled && elementTriggerConditions(entity).length > 0,
      constant: false, selective: false, selectiveLogic: 'and', probability: null, scanDepth: null,
      matchWholeWords: false, caseSensitive: true, useRegex: false,
      position: 0, depth: 4, order: 44, role: 'system',
      preventRecursion: true, excludeRecursion: false, delayUntilRecursion: true, excludeFromVectorization: true,
      tag: ELEMENT_FACT_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), memoryCabinetElementId: String(entity.id), managedBy: LOREBOOK_TAG, kind: 'element-facts' },
    };
  }
  function elementProxyEntryPayload(chat, entity, condition, index, memory) {
    const group = condition.kind === 'group';
    return {
      name: `요소 조건 · ${truncate(entity.name, 100)} · ${index + 1}`,
      content: `<!-- ${elementTriggerMarker(entity.id)} -->`,
      description: `기억 보관함 요소 검색 조건 · element:${entity.id}`,
      keys: group ? [condition.keys[0]] : condition.keys.slice(),
      secondaryKeys: group ? condition.keys.slice(1) : [],
      enabled: memory.injectionEnabled,
      constant: false, selective: group, selectiveLogic: group ? 'and_all' : 'and', probability: null, scanDepth: null,
      matchWholeWords: false, caseSensitive: false, useRegex: false,
      position: 0, depth: 4, order: 43, role: 'system',
      preventRecursion: false, excludeRecursion: true, delayUntilRecursion: false, excludeFromVectorization: true,
      tag: ELEMENT_TRIGGER_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), memoryCabinetElementId: String(entity.id), memoryCabinetConditionIndex: index, managedBy: LOREBOOK_TAG, kind: 'element-trigger' },
    };
  }
  function matchElementTriggers(entity, text) {
    const haystack = String(text || '').toLocaleLowerCase();
    const reasons = [];
    entity.standaloneTriggers.forEach((trigger) => { if (haystack.includes(trigger.toLocaleLowerCase())) reasons.push(`단독: ${trigger}`); });
    entity.triggerGroups.forEach((group) => { if (group.every((term) => haystack.includes(term.toLocaleLowerCase()))) reasons.push(`조합: ${group.join(' + ')}`); });
    return reasons;
  }
  function elementSearchResults(text = state.elementTestText) {
    return elementMemory().entities.map((entity) => ({ entity, reasons: matchElementTriggers(entity, text) })).filter((row) => row.reasons.length);
  }


  function elementConnectionOptions(memory = elementMemory()) {
    const selected = String(memory.connectionId || state.modelConnectionId || '');
    const rows = state.connections.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row.label)}${row.model ? ` · ${esc(row.model)}` : ''}</option>`).join('');
    return `<option value="">기본 후보 모델 사용</option>${rows}`;
  }
  function elementRow(entity) {
    const facts = entity.currentFacts.slice(0, 3).map((fact) => displayText(fact.text, fact.textKo));
    const moreFacts = Math.max(0, entity.currentFacts.length - facts.length);
    const conditionCount = elementTriggerConditions(entity).length;
    const hasEvidence = [...entity.currentFacts, ...entity.historyFacts].some((fact) => fact.source && (safeArray(fact.source.messageIds).length || safeArray(fact.source.fingerprints).length || fact.source.contentHash));
    return `<article class="mmc-element-row" data-element-id="${esc(entity.id)}">
      <button class="mmc-element-main" data-action="edit-element" data-id="${esc(entity.id)}">
        <span class="mmc-cat-head"><b>${esc(displayText(entity.name, entity.nameKo))}</b>${entity.aliases.length ? `<small>${esc(entity.aliases.slice(0, 3).join(" · "))}</small>` : ""}</span>
        ${facts.length ? `<ul class="mmc-facts">${facts.map((text) => `<li>${esc(truncate(text, 90))}</li>`).join("")}${moreFacts ? `<li class="is-more">외 ${moreFacts}개</li>` : ""}</ul>` : '<span class="mmc-element-summary">현재 사실 없음</span>'}
      </button>
      <div class="mmc-element-meta"><span>현재 ${entity.currentFacts.length} · 이력 ${entity.historyFacts.length}</span><span class="mmc-chip ${conditionCount ? "is-ok" : "is-warn"}">${conditionCount ? `검색 조건 ${conditionCount}` : "조건 없음"}</span>${hasEvidence ? `<button class="mmc-evidence-link" data-action="view-evidence" data-kind="element" data-id="${esc(entity.id)}">근거</button>` : ""}</div>
    </article>`;
  }

  function elementExtractionPanel(memory) {
    const range = state.elementExtractMode === "range";
    return `<section class="mmc-card mmc-element-toolbox">
      <div class="mmc-dock-copy"><span class="mmc-dock-icon">${SVG.spark}</span><div><b>원문에서 요소 기억 찾기</b><small>요약이 아니라 완결된 RP 원문을 직접 읽고 후보만 만들어요. 저장은 검토한 뒤에만 돼요.</small></div></div>
      <div class="mmc-dock-controls">
        <div class="mmc-element-mode mmc-seg"><label class="${!range ? "is-active" : ""}"><input type="radio" name="mmc-element-mode" value="recent" ${!range ? "checked" : ""}>최근 턴</label><label class="${range ? "is-active" : ""}"><input type="radio" name="mmc-element-mode" value="range" ${range ? "checked" : ""}>직접 지정</label></div>
        <div class="mmc-element-range">${range
          ? `<label>시작 <input id="mmc-element-range-start" type="number" min="1" value="${state.elementRangeStart}"></label><span>~</span><label>끝 <input id="mmc-element-range-end" type="number" min="1" value="${state.elementRangeEnd}"></label>`
          : `<label>최근 <input id="mmc-element-turns" type="number" min="1" max="100" value="${state.elementExtractTurns}"> 턴</label>`}</div>
        <button class="mmc-btn mmc-primary" data-action="extract-elements">${SVG.spark}<span>요소 기억 추출</span></button>
      </div>
      <small class="mmc-element-status"><i class="mmc-sync-dot ${memory.injectionEnabled ? "is-ok" : ""}"></i>주입 ${memory.injectionEnabled ? "켜짐" : "꺼짐"} · 저장된 요소 ${memory.entities.length}개 · 모델 결과는 자동 저장되지 않아요 · <button class="mmc-link" data-action="element-settings">요소 설정</button></small>
    </section>`;
  }

  function elementTestResultsMarkup() {
    const results = elementSearchResults();
    return state.elementTestText.trim()
      ? (results.length ? results.map((row) => `<span class="mmc-hit"><b>${esc(row.entity.name)}</b><small>${esc(row.reasons.join(" · "))}</small></span>`).join("") : "<em>일치하는 요소가 없어요.</em>")
      : "<em>문장을 넣으면 호출될 요소와 이유를 보여 줘요.</em>";
  }
  function elementSearchPanel(memory) {
    return `<section class="mmc-card mmc-element-search-test">
      <header class="mmc-card-head"><b>호출 테스트</b></header>
      <small class="mmc-muted">실제 로어북 조건과 같은 OR / AND 규칙으로 어떤 요소가 불려 올지 미리 확인해요.</small>
      <textarea id="mmc-element-test" rows="3" placeholder="예: 지희가 사물함에서 상자를 꺼냈다">${esc(state.elementTestText)}</textarea>
      <div class="mmc-element-test-results">${elementTestResultsMarkup()}</div>
      <div class="mmc-rule-note"><b>규칙</b><small><strong>별칭</strong>은 같은 대상의 다른 이름이고 자동 검색어가 아니에요. <strong>단독 호출어</strong>는 하나만 나와도, <strong>조합 호출조건</strong>은 같은 줄의 단어가 모두 나와야 불러요.</small></div>
    </section>`;
  }

  function elementFilteredEntities(memory = elementMemory()) {
    const query = String(state.elementSearch || "").trim().toLocaleLowerCase();
    return memory.entities.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).filter((entity) => !query || [entity.name, entity.nameKo, ...entity.aliases, ...entity.currentFacts.map((f) => `${f.text} ${f.textKo}`), ...entity.historyFacts.map((f) => `${f.text} ${f.textKo}`)].join("\n").toLocaleLowerCase().includes(query));
  }
  function elementListMarkup(memory = elementMemory()) {
    const entities = elementFilteredEntities(memory);
    return entities.length ? entities.map(elementRow).join("") : `<div class="mmc-empty">${memory.entities.length ? "검색 결과가 없어요." : "아직 요소 기억이 없어요. 원문에서 추출하거나 직접 추가해 보세요."}</div>`;
  }
  function elementMainView() {
    const memory = elementMemory();
    return `<div class="mmc-element-page">
      ${elementExtractionPanel(memory)}
      <div class="mmc-el-wrap">
        <section class="mmc-el-main">
          <div class="mmc-element-list-head"><label class="mmc-searchbox">${SVG.search}<input id="mmc-element-search" value="${esc(state.elementSearch)}" placeholder="이름·별칭·사실 검색" aria-label="요소 검색"></label><button class="mmc-btn mmc-primary" data-action="new-element">${SVG.plus}<span>새 요소</span></button></div>
          <div class="mmc-element-list">${elementListMarkup(memory)}</div>
        </section>
        <aside class="mmc-el-aside">${elementSearchPanel(memory)}</aside>
      </div>
    </div>`;
  }

  function elementEditorLayer() {
    const d = state.elementDraft ? normalizeElement(state.elementDraft) : normalizeElement({ id: '', name: '' });
    const current = d.currentFacts.map((fact) => fact.text).join('\n');
    const history = d.historyFacts.map((fact) => fact.text).join('\n');
    const groups = d.triggerGroups.map((group) => group.join(', ')).join('\n');
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-element-editor" data-layer-stop>
      <header><div><span class="mmc-kicker">ELEMENT MEMORY</span><h3>${d.id ? '요소 기억 편집' : '새 요소 기억'}</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <label class="mmc-field"><span>이름</span><input id="mmc-element-name" value="${esc(d.name)}" maxlength="80" placeholder="예: 노란 텀블러"></label>
        <label class="mmc-field"><span>별칭 <small>같은 대상의 다른 이름 · 한 줄에 하나</small></span><textarea id="mmc-element-aliases" rows="3">${esc(d.aliases.join('\n'))}</textarea></label>
        <div class="mmc-element-editor-grid">
          <label class="mmc-field"><span>현재 사실 <small>지금 참인 상태 · 한 줄에 하나</small></span><textarea id="mmc-element-current" rows="6" placeholder="상태: 정상\n위치: 책상">${esc(current)}</textarea></label>
          <label class="mmc-field"><span>이력 <small>지속적으로 기억할 과거 · 한 줄에 하나</small></span><textarea id="mmc-element-history" rows="6">${esc(history)}</textarea></label>
        </div>
        <section class="mmc-trigger-box"><div><b>검색 조건</b><small>별칭은 대상의 이름일 뿐 검색어가 아닙니다. 일반명사는 조합 조건에 넣는 편이 안전합니다.</small></div>
          <label class="mmc-field"><span>단독 호출어 <small>하나만 나와도 호출 · 한 줄에 하나</small></span><textarea id="mmc-element-triggers" rows="3" placeholder="지희의 종이 상자">${esc(d.standaloneTriggers.join('\n'))}</textarea></label>
          <label class="mmc-field"><span>조합 호출조건 <small>한 줄 안의 단어가 모두 나와야 호출 · 쉼표로 구분</small></span><textarea id="mmc-element-groups" rows="4" placeholder="지희, 상자\n지희, 사물함">${esc(groups)}</textarea></label>
        </section>
        ${hasKoText(d.nameKo, ...d.currentFacts.map((fact) => fact.textKo), ...d.historyFacts.map((fact) => fact.textKo)) ? `<details class="mmc-source-quote"><summary>한국어 표시본 보기 · 위 칸의 원문은 그대로 유지됩니다</summary><p>${esc([d.nameKo, ...d.currentFacts.map((fact) => fact.textKo), ...d.historyFacts.map((fact) => fact.textKo)].filter(Boolean).join("\n"))}</p></details>` : ""}
      </div>
      <footer>${d.id ? `<button class="mmc-btn mmc-danger" data-action="delete-element" data-id="${esc(d.id)}">삭제</button>` : '<span></span>'}<div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-element">저장</button></div></footer>
    </section></div>`;
  }
  function elementCandidateRow(item, index) {
    const target = item.kind === 'update' ? elementMemory().entities.find((entity) => entity.id === item.entityId) : null;
    return `<article class="mmc-element-candidate">
      <div class="mmc-element-candidate-head"><label><input type="checkbox" data-element-candidate-index="${index}" ${state.elementCandidateSelected.has(String(index)) ? 'checked' : ''}><span class="mmc-type-chip">${item.kind === 'update' ? '갱신' : '신규'}</span></label><b>${esc(item.name)}</b><small>현재 ${item.currentFacts.length} · 이력 ${item.historyFacts.length}</small></div>
      ${target ? `<div class="mmc-candidate-note">기존 <b>${esc(target.name)}</b> · 최근 수정 ${esc(sourceDate(target.updatedAt) || target.updatedAt)}</div>` : ''}
      <label class="mmc-field"><span>이름</span><input id="mmc-ec-name-${index}" value="${esc(item.name)}" maxlength="80"></label>
      <div class="mmc-element-editor-grid">
        <label class="mmc-field"><span>현재 사실</span><textarea id="mmc-ec-current-${index}" rows="5">${esc(item.currentFacts.map((fact) => fact.text).join('\n'))}</textarea></label>
        <label class="mmc-field"><span>이력</span><textarea id="mmc-ec-history-${index}" rows="5">${esc(item.historyFacts.map((fact) => fact.text).join('\n'))}</textarea></label>
      </div>
      <label class="mmc-field"><span>별칭</span><textarea id="mmc-ec-aliases-${index}" rows="2">${esc(item.aliases.join('\n'))}</textarea></label>
      <div class="mmc-element-editor-grid">
        <label class="mmc-field"><span>단독 호출어</span><textarea id="mmc-ec-triggers-${index}" rows="2">${esc(item.standaloneTriggers.join('\n'))}</textarea></label>
        <label class="mmc-field"><span>조합 호출조건</span><textarea id="mmc-ec-groups-${index}" rows="2">${esc(item.triggerGroups.map((group) => group.join(', ')).join('\n'))}</textarea></label>
      </div>
    </article>`;
  }
  function elementCandidateLayer() {
    const info = state.elementExtractInfo;
    const label = info ? `${info.startTurn}~${info.endTurn}턴 · ${info.chunkCount || 1}청크 · 후보 ${state.elementCandidates.length}개` : `후보 ${state.elementCandidates.length}개`;
    const warnings = [
      info?.failedChunks ? `${info.chunkCount}개 청크 중 ${info.failedChunks}개 분석 실패 · 성공한 결과는 유지됨` : "",
      state.elementCandidateOverflow ? `후보 상한 ${ELEMENT_CANDIDATE_LIMIT}개 초과 · ${state.elementCandidateOverflow}개는 이번 미리보기에 포함되지 않음` : "",
    ].filter(Boolean);
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-element-candidates-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">ELEMENT REVIEW</span><h3>요소 기억 추출 결과</h3><small>${esc(label)}</small></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">${warnings.map((text) => `<div class="mmc-candidate-note mmc-warning-note">${esc(text)}</div>`).join("")}<div class="mmc-candidate-toolbar"><b>${state.elementCandidateSelected.size}/${state.elementCandidates.length} 선택</b><div><button class="mmc-btn" data-action="element-select-all">전체 선택</button><button class="mmc-btn" data-action="element-select-none">전체 해제</button></div></div>${state.elementCandidates.length ? state.elementCandidates.map(elementCandidateRow).join('') : '<div class="mmc-empty">저장할 만한 요소 후보가 없습니다.</div>'}</div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-element-candidates" ${state.elementCandidateSelected.size ? '' : 'disabled'}>선택 ${state.elementCandidateSelected.size}개 저장</button></div></footer>
    </section></div>`;
  }
  function elementSettingsLayer() {
    const memory = elementMemory();
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-settings-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">ELEMENT SETTINGS</span><h3>요소 기억 설정</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <label class="mmc-setting mmc-setting-model"><span><b>요소 추출 모델</b><small>비워 두면 기억 보관함의 기본 후보 모델을 사용합니다.</small></span><select id="mmc-element-model">${elementConnectionOptions(memory)}</select></label>
        <label class="mmc-check-line"><input id="mmc-element-injection-enabled" type="checkbox" ${memory.injectionEnabled ? 'checked' : ''}><span>검색 조건이 맞는 요소 기억을 전용 로어북으로 주입하기</span></label>
        <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>요소 추출 지침</b><small>무엇을 요소 기억으로 남길지 정합니다. JSON 형식 규칙은 확장이 별도로 붙입니다.</small></span><button class="mmc-btn" data-action="reset-element-extraction-prompt">기본값 복원</button></div><textarea id="mmc-element-extraction-prompt" rows="10">${esc(memory.extractionPrompt || DEFAULT_ELEMENT_EXTRACTION_PROMPT)}</textarea></section>
        <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>요소 주입 지침</b><small>검색된 요소 기억을 모델이 어떻게 취급할지 정합니다. 실제 위치는 전용 로어북의 system 기억으로 고정합니다.</small></span><button class="mmc-btn" data-action="reset-element-injection-prompt">기본값 복원</button></div><textarea id="mmc-element-injection-prompt" rows="8">${esc(memory.injectionPrompt || DEFAULT_ELEMENT_INJECTION_PROMPT)}</textarea></section>
        <div class="mmc-setting-warning"><b>검색 조건 안내</b><small><strong>별칭</strong>은 같은 대상의 다른 이름이고 자동 검색어가 아닙니다. <strong>단독 호출어</strong>는 하나만 등장해도 기억을 부르며, <strong>조합 호출조건</strong>은 같은 줄의 모든 단어가 등장해야 부릅니다.</small></div>
      </div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-element-settings">설정 저장</button></div></footer>
    </section></div>`;
  }



  // ──────────────────────────────────────────────
  // 이야기 위키: 기존 기억 위에 올리는 사람이 읽고 고치는 편집 레이어
  // 새 기억 저장소가 아니라, 약속·앵커·요소 기억·요약·원문을 조직해 서술하는 문서 계층이다.
  // ──────────────────────────────────────────────

  function wikiState(data = state.currentData) { return normalizeWiki(data?.wiki); }
  function wikiKey(value) { return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
  function wikiCategoryLabel(doc) { return WIKI_CATEGORY_LABEL[doc?.category] || WIKI_CATEGORY_LABEL.misc; }
  function wikiCategoryPath(doc) {
    const base = wikiCategoryLabel(doc);
    return doc?.subcategory ? `${base} / ${doc.subcategory}` : base;
  }
  function wikiRetrievalTerms(doc) {
    return normalizeTextList([...safeArray(doc?.keywordsKo), ...safeArray(doc?.keywordsEn)], 24, 80);
  }
  function wikiTriggerConditions(doc) {
    const conditions = [];
    const solo = wikiRetrievalTerms(doc);
    if (solo.length) conditions.push({ kind: "standalone", keys: solo });
    for (const group of normalizeTriggerGroups(doc?.keywordGroups)) {
      const covered = solo.some((term) => group.every((word) => term.toLocaleLowerCase().includes(word.toLocaleLowerCase())));
      if (!covered) conditions.push({ kind: "group", keys: group.slice() });
    }
    return conditions;
  }
  function wikiDocInjectable(doc, wiki) {
    return !!(wiki.injectionEnabled && !doc.excludeFromContext && wikiTriggerConditions(doc).length > 0 && (doc.summary.trim() || doc.sections.length));
  }
  function wikiAlwaysDocs(wiki) {
    return wiki.docs.filter((doc) => doc.alwaysRemember && !doc.excludeFromContext && doc.summary.trim());
  }
  function wikiDocFullText(doc) {
    return [doc.title, doc.summary, ...safeArray(doc.sections).map((section) => `${section.heading}\n${section.body}`)].join("\n");
  }
  function wikiSearchHaystack(doc) {
    return [doc.title, doc.titleKo, wikiCategoryPath(doc), ...safeArray(doc.aliases), ...wikiRetrievalTerms(doc), doc.summary, doc.summaryKo,
      ...safeArray(doc.sections).map((section) => `${section.heading}\n${section.headingKo}\n${section.body}\n${section.bodyKo}`)].join("\n").toLocaleLowerCase();
  }
  function wikiFindByTitle(docs, title) {
    const key = wikiKey(title);
    if (!key) return null;
    return safeArray(docs).find((doc) => wikiKey(doc.title) === key)
      || safeArray(docs).find((doc) => safeArray(doc.aliases).some((alias) => wikiKey(alias) === key))
      || null;
  }
  function wikiUnescape(value) {
    return String(value ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  }
  function wikiBracketTokens(text) {
    const out = [];
    for (const match of String(text || "").matchAll(/\[([^\[\]\n]{1,80})\]/g)) out.push(String(match[1]).trim());
    return out;
  }
  function wikiOutgoingTitles(doc) {
    const seen = new Set();
    const out = [];
    for (const token of wikiBracketTokens(wikiDocFullText(doc))) {
      if (!token || /^\d{1,3}$/.test(token)) continue;
      const key = wikiKey(token);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(token);
      if (out.length >= 40) break;
    }
    return out;
  }
  function wikiOutgoingRows(doc, docs) {
    const rows = [];
    const pushed = new Set();
    for (const title of wikiOutgoingTitles(doc)) {
      const target = wikiFindByTitle(docs, title);
      if (target && target.id === doc.id) continue;
      const key = target ? `id:${target.id}` : `t:${wikiKey(title)}`;
      if (pushed.has(key)) continue;
      pushed.add(key);
      rows.push({ title: target ? target.title : title, doc: target });
    }
    for (const id of safeArray(doc.relatedDocIds)) {
      const target = docs.find((row) => row.id === id);
      if (!target || target.id === doc.id || pushed.has(`id:${target.id}`)) continue;
      pushed.add(`id:${target.id}`);
      rows.push({ title: target.title, doc: target });
    }
    return rows;
  }
  function wikiIncomingRows(doc, docs) {
    return docs.filter((row) => {
      if (row.id === doc.id) return false;
      if (safeArray(row.relatedDocIds).includes(doc.id)) return true;
      return wikiOutgoingTitles(row).some((title) => wikiFindByTitle(docs, title)?.id === doc.id);
    });
  }

  function wikiInlineMarkup(text, doc, docs) {
    let out = esc(text);
    out = out.replace(/`([^`\n]{1,200})`/g, (whole, code) => `<code>${code}</code>`);
    out = out.replace(/\*\*([^*\n]{1,200})\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]{1,200})\*(?!\*)/g, "$1<em>$2</em>");
    out = out.replace(/\[([^\[\]\n]{1,80})\]/g, (whole, rawToken) => {
      const token = String(rawToken).trim();
      if (/^\d{1,3}$/.test(token)) {
        const index = Number(token);
        const source = safeArray(doc?.sources)[index - 1];
        return `<button type="button" class="mmc-wiki-cite${source ? "" : " is-missing"}" data-action="wiki-source" data-id="${esc(doc?.id || "")}" data-index="${index}" title="${esc(source ? `${WIKI_SOURCE_KIND_LABEL[source.kind]} · ${source.label}` : "연결된 근거가 없습니다")}">${index}</button>`;
      }
      const target = wikiFindByTitle(docs, wikiUnescape(token));
      return `<button type="button" class="mmc-wiki-link${target ? "" : " is-missing"}" data-action="wiki-open" data-id="${esc(target?.id || "")}" title="${esc(target ? target.title : "아직 없는 문서")}">${token}</button>`;
    });
    return out;
  }
  function wikiRenderMarkdown(body, doc, docs) {
    const lines = String(body || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = "";
    let inCode = false;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = ""; } };
    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        if (inCode) { out.push("</pre>"); inCode = false; }
        else { closeList(); out.push("<pre>"); inCode = true; }
        continue;
      }
      if (inCode) { out.push(`${esc(line)}\n`); continue; }
      if (!line.trim()) { closeList(); continue; }
      const heading = line.match(/^\s*(#{1,4})\s+(.*)$/);
      if (heading) { closeList(); const level = Math.min(6, 3 + heading[1].length); out.push(`<h${level}>${wikiInlineMarkup(heading[2], doc, docs)}</h${level}>`); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push("<hr>"); continue; }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) { closeList(); out.push(`<blockquote>${wikiInlineMarkup(quote[1], doc, docs)}</blockquote>`); continue; }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${wikiInlineMarkup(bullet[1], doc, docs)}</li>`); continue; }
      const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ordered) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${wikiInlineMarkup(ordered[1], doc, docs)}</li>`); continue; }
      closeList();
      out.push(`<p>${wikiInlineMarkup(line, doc, docs)}</p>`);
    }
    if (inCode) out.push("</pre>");
    closeList();
    return out.join("");
  }

  function wikiTriggerMarkerFor(docId) { return `${WIKI_TRIGGER_MARKER}:${docId}`; }
  function wikiAlwaysContext(chat, wiki) {
    const docs = wikiAlwaysDocs(wiki);
    const lines = [WIKI_ALWAYS_MARKER, `[이야기 위키 · 항상 기억 개요 · ${chatLabel(chat)}]`, "아래는 이 이야기에서 언제나 전제로 두는 위키 문서의 한 줄 개요다. 본문 전체가 아니라 개요만 제공한다."];
    let used = 0;
    for (const doc of docs) {
      const line = `- [${wikiCategoryLabel(doc)}] ${truncate(doc.title, 60)}: ${truncate(doc.summary, 220)}`;
      if (lines.length > 3 && used + line.length + 1 > wiki.alwaysBudgetChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    lines.push("자세한 내용이 필요하면 관련 키워드가 등장할 때 해당 문서가 따로 제공된다. 목록 자체를 낭독하지 마라.");
    return lines.join("\n");
  }
  // 주입에는 언제나 원문(canonical)만 쓴다. 한국어 표시본과 이미지는 넣지 않는다.
  function wikiDocContext(chat, doc) {
    const body = safeArray(doc.sections)
      .map((section) => `${"#".repeat(Math.max(2, Math.min(4, (Number(section.level) || 1) + 1)))} ${section.heading}\n${section.body}`)
      .join("\n\n");
    return [
      WIKI_MARKER,
      `[이야기 위키 · ${chatLabel(chat)} · ${doc.title}]`,
      `분류: ${wikiCategoryPath(doc)}`,
      doc.aliases.length ? `별칭: ${doc.aliases.join(" / ")}` : "",
      doc.summary ? `개요: ${doc.summary}` : "",
      body,
    ].filter(Boolean).join("\n").slice(0, 9000);
  }
  function wikiHeaderContext(wiki) {
    const base = String(wiki.injectionPrompt || "").trim() || DEFAULT_WIKI_INJECTION_PROMPT;
    return `${base}\n${ADVANCED_MEMORY_PRIORITY_RULE}`;
  }
  function wikiHeaderPayload(wiki, chat) {
    const any = wiki.docs.some((doc) => wikiDocInjectable(doc, wiki)) || (wiki.injectionEnabled && wikiAlwaysDocs(wiki).length > 0);
    return constantEntryPayload({
      tag: WIKI_HEADER_ENTRY_TAG,
      name: "이야기 위키 · 해석 지침",
      content: wikiHeaderContext(wiki),
      enabled: any,
      order: 34,
      dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: "wiki-header" },
    });
  }
  function wikiAlwaysPayload(wiki, chat) {
    return constantEntryPayload({
      tag: WIKI_ALWAYS_ENTRY_TAG,
      name: "이야기 위키 · 항상 기억 개요",
      content: wikiAlwaysContext(chat, wiki),
      enabled: wiki.injectionEnabled && wikiAlwaysDocs(wiki).length > 0,
      order: 31,
      dynamicState: { memoryCabinetChatId: String(chat.id), managedBy: LOREBOOK_TAG, kind: "wiki-always" },
    });
  }
  function wikiDocEntryPayload(chat, doc, wiki) {
    return {
      name: `이야기 위키 · ${truncate(doc.title, 110)}`,
      content: wikiDocContext(chat, doc),
      description: `기억 보관함 위키 문서 · wiki:${doc.id}`,
      keys: [wikiTriggerMarkerFor(doc.id)], secondaryKeys: [],
      enabled: wikiDocInjectable(doc, wiki),
      constant: false, selective: false, selectiveLogic: "and", probability: null, scanDepth: null,
      matchWholeWords: false, caseSensitive: true, useRegex: false,
      position: 0, depth: 4, order: 46, role: "system",
      preventRecursion: true, excludeRecursion: false, delayUntilRecursion: true, excludeFromVectorization: true,
      tag: WIKI_DOC_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), memoryCabinetWikiId: String(doc.id), managedBy: LOREBOOK_TAG, kind: "wiki-doc" },
    };
  }
  function wikiProxyEntryPayload(chat, doc, condition, index, wiki) {
    const group = condition.kind === "group";
    return {
      name: `위키 조건 · ${truncate(doc.title, 90)} · ${index + 1}`,
      content: `<!-- ${wikiTriggerMarkerFor(doc.id)} -->`,
      description: `기억 보관함 위키 검색 조건 · wiki:${doc.id}`,
      keys: group ? [condition.keys[0]] : condition.keys.slice(),
      secondaryKeys: group ? condition.keys.slice(1) : [],
      enabled: wiki.injectionEnabled && !doc.excludeFromContext,
      constant: false, selective: group, selectiveLogic: group ? "and_all" : "and", probability: null, scanDepth: null,
      matchWholeWords: false, caseSensitive: false, useRegex: false,
      position: 0, depth: 4, order: 45, role: "system",
      preventRecursion: false, excludeRecursion: true, delayUntilRecursion: false, excludeFromVectorization: true,
      tag: WIKI_TRIGGER_ENTRY_TAG,
      dynamicState: { memoryCabinetChatId: String(chat.id), memoryCabinetWikiId: String(doc.id), memoryCabinetConditionIndex: index, managedBy: LOREBOOK_TAG, kind: "wiki-trigger" },
    };
  }
  function matchWikiTriggers(doc, text) {
    const haystack = String(text || "").toLocaleLowerCase();
    const reasons = [];
    wikiRetrievalTerms(doc).forEach((term) => { if (haystack.includes(term.toLocaleLowerCase())) reasons.push(`단독: ${term}`); });
    normalizeTriggerGroups(doc.keywordGroups).forEach((group) => { if (group.every((word) => haystack.includes(word.toLocaleLowerCase()))) reasons.push(`조합: ${group.join(" + ")}`); });
    return reasons;
  }

  // 새 기억 감지: 모델을 부르지 않고 로컬에서만 관련성을 센다.
  function wikiRelatedMemoryRows(doc, data = state.currentData) {
    const normalized = normalizeData(data || {});
    const terms = [...new Set([doc.title, ...safeArray(doc.aliases), ...wikiRetrievalTerms(doc)].map(wikiKey).filter((value) => value.length >= 2))];
    if (!terms.length) return [];
    const since = String(doc.aiUpdatedAt || "");
    const rows = [];
    const touch = (kind, id, label, text, updatedAt) => {
      const stamp = String(updatedAt || "");
      if (since && stamp && stamp <= since) return;
      if (since && !stamp) return;
      const haystack = `${label}\n${text}`.toLocaleLowerCase();
      if (!terms.some((term) => haystack.includes(term))) return;
      rows.push({ kind, id: String(id), label: String(label || ""), text: truncate(String(text || ""), 600), updatedAt: stamp });
    };
    for (const entity of normalizeElementMemory(normalized.elementMemory).entities) touch("element", entity.id, entity.name, elementFactLines(entity), entity.updatedAt);
    for (const item of safeArray(normalized.items)) {
      if (item.type === "anchor" && item.archived) continue;
      if (item.type === "promise" && item.status === "cancelled") continue;
      touch(item.type === "anchor" ? "anchor" : "promise", item.id, item.title, item.content, item.updatedAt);
    }
    for (const row of summaryRowsFromMetadata(state.currentChat?.metadata)) touch("summary", row.id, row.title || "요약", row.content, row.updatedAt || row.createdAt);
    return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 12);
  }
  function wikiProposalFor(docId, wiki = wikiState()) {
    return wiki.proposals.find((row) => row.docId === String(docId)) || null;
  }

  function wikiConnectionId(wiki = wikiState()) {
    return String(wiki.connectionId || state.modelConnectionId || chooseDefaultConnection(state.currentChat) || "");
  }
  async function collectWikiSourceRows() {
    const data = normalizeData(state.currentData);
    const rows = [];
    for (const entity of normalizeElementMemory(data.elementMemory).entities) {
      rows.push({ id: `element:${entity.id}`, kind: "element", refId: entity.id, label: entity.name, text: elementFactLines(entity), updatedAt: entity.updatedAt });
    }
    for (const item of safeArray(data.items)) {
      if (item.type === "anchor" && item.archived) continue;
      rows.push({ id: `${item.type}:${item.id}`, kind: item.type === "anchor" ? "anchor" : "promise", refId: item.id, label: item.title, text: item.content, updatedAt: item.updatedAt });
    }
    for (const row of summaryRowsFromMetadata(state.currentChat?.metadata)) {
      rows.push({ id: `summary:${row.id}`, kind: "summary", refId: String(row.id || ""), label: String(row.title || "요약"), text: String(row.content || ""), updatedAt: String(row.updatedAt || row.createdAt || "") });
    }
    try {
      const payload = await api(`chats/${encodeURIComponent(state.selectedChatId)}/messages?limit=120`);
      const messages = extractArray(payload, ["messages", "items", "results"]).filter((row) => ["user", "assistant"].includes(String(row.role || "")) && String(row.content || "").trim());
      for (const row of messages.slice(-30).reverse()) {
        rows.push({ id: `message:${String(row.id || uid("wmsg"))}`, kind: "message", refId: String(row.id || ""), label: `${roleLabel(row.role)} · ${truncate(String(row.content || ""), 40)}`, text: String(row.content || ""), updatedAt: String(row.createdAt || "") });
      }
    } catch (error) {
      console.warn("[기억 보관함] wiki source messages failed", error);
    }
    return rows.filter((row) => String(row.text || "").trim());
  }
  function wikiSelectedSourceRows() {
    return state.wikiSourceRows.filter((row) => state.wikiSourceSelected.has(String(row.id)));
  }
  function wikiSourceBlock(rows) {
    return rows.map((row, index) => `[${index + 1}] (${WIKI_SOURCE_KIND_LABEL[row.kind] || row.kind}) ${row.label}\n${truncate(row.text, 1400)}`).join("\n\n");
  }
  function wikiDraftSystemPrompt(wiki, rows) {
    const criteria = String(wiki.draftPrompt || "").trim() || DEFAULT_WIKI_DRAFT_PROMPT;
    const topic = String(state.wikiDraftTopic || "").trim();
    const contract = [
      "Response contract — return ONE JSON object and nothing else:",
      '{"documents":[{"title":"...","titleKo":null,"category":"character","subcategory":"","summary":"...","summaryKo":null,"aliases":["..."],"keywordsKo":["..."],"keywordsEn":["..."],"keywordGroups":[["...","..."]],"sections":[{"heading":"...","headingKo":null,"level":1,"body":"markdown with [1] citations","bodyKo":null}],"cited":[1,2]}]}',
      `- category must be one of: ${Object.keys(WIKI_CATEGORY_LABEL).join(", ")}.`,
      `- At most ${WIKI_CANDIDATE_LIMIT} documents, at most ${WIKI_SECTION_LIMIT} sections each.`,
      "- summary is one or two sentences, at most 200 characters, and must read on its own.",
      "- body is Markdown. Use [n] to cite the numbered source list. Use [문서 제목] to link another wiki document.",
      "- cited lists every source number used anywhere in that document.",
      "- keywordsKo and keywordsEn are retrieval phrases, not the same thing as aliases. Avoid bare generic nouns; put generic words in keywordGroups with a specific companion.",
      `- level is 1, 2, or 3. Use 2 and 3 only for real sub-sections of the section above, at most ${WIKI_SECTION_MAX_LEVEL} levels.`,
      "- keywordsKo holds Korean retrieval phrases and keywordsEn holds Latin-script ones. Never put an English phrase in keywordsKo.",
      '- Return {"documents":[]} when the sources contain nothing worth a document.',
      LANGUAGE_CONTRACT,
    ].join("\n");
    return [criteria, topic ? `\n[요청한 주제]\n${topic}` : "", `\n[SOURCE LIST]\n${wikiSourceBlock(rows)}\n[/SOURCE LIST]`, `\n${contract}`].filter(Boolean).join("\n");
  }
  function wikiRemapCitations(text, mapping) {
    return String(text || "").replace(/\[(\d{1,3})\]/g, (whole, digits) => {
      const local = mapping.get(Number(digits));
      return local ? `[${local}]` : "";
    });
  }
  function parseWikiDraftJson(output, rows) {
    const fragments = collectBalancedJsonFragments(output);
    let parsed = null;
    for (const fragment of fragments) {
      for (const candidate of [fragment, repairJsonishText(fragment)]) {
        try { parsed = JSON.parse(candidate); break; } catch {}
      }
      if (parsed) break;
    }
    if (!parsed) return { ok: false, rows: [] };
    const list = Array.isArray(parsed) ? parsed : safeArray(parsed.documents || parsed.docs || parsed.items);
    const out = [];
    for (const raw of list) {
      if (!isRecord(raw)) continue;
      const title = String(raw.title || "").trim().replace(/\s+/g, " ").slice(0, 120);
      if (!title) continue;
      const sections = safeArray(raw.sections).map((section) => normalizeWikiSection(section)).filter(Boolean).slice(0, WIKI_SECTION_LIMIT);
      const summary = String(raw.summary || "").trim().replace(/\s+/g, " ").slice(0, 400);
      if (!summary && !sections.length) continue;
      const usedGlobal = new Set();
      const collect = (text) => { for (const match of String(text || "").matchAll(/\[(\d{1,3})\]/g)) usedGlobal.add(Number(match[1])); };
      collect(summary);
      sections.forEach((section) => collect(section.body));
      safeArray(raw.cited).map(Number).filter((value) => Number.isInteger(value)).forEach((value) => usedGlobal.add(value));
      const ordered = [...usedGlobal].filter((value) => value >= 1 && value <= rows.length).sort((a, b) => a - b);
      const mapping = new Map(ordered.map((globalIndex, i) => [globalIndex, i + 1]));
      const sources = ordered.map((globalIndex) => {
        const row = rows[globalIndex - 1];
        return normalizeWikiSource({ kind: row.kind, refId: row.refId, label: row.label, quote: truncate(row.text, 1200) });
      }).filter(Boolean);
      out.push(normalizeWikiDoc({
        id: uid("wdoc"),
        title,
        category: raw.category,
        subcategory: raw.subcategory,
        titleKo: String(raw.titleKo || "").trim().slice(0, 120),
        summary: wikiRemapCitations(summary, mapping).replace(/\s+/g, " ").trim(),
        summaryKo: wikiRemapCitations(String(raw.summaryKo || "").trim(), mapping).replace(/\s+/g, " ").trim(),
        summaryManaged: "ai",
        sections: sections.map((section) => ({ ...section, body: wikiRemapCitations(section.body, mapping), bodyKo: wikiRemapCitations(section.bodyKo, mapping), managed: "ai" })),
        aliases: raw.aliases,
        // 제목은 쓰인 문자에 따라 한국어/영어 키워드로 나눠 넣는다. 영어 제목을 KO로 분류하지 않는다.
        keywordsKo: normalizeTextList([...normalizeTextList(raw.keywordsKo, 16, 80), ...seedKeywordsByScript(title).ko], 16, 80),
        keywordsEn: normalizeTextList([...normalizeTextList(raw.keywordsEn, 16, 80), ...seedKeywordsByScript(title).en], 16, 80),
        keywordGroups: raw.keywordGroups,
        sources,
        aiUpdatedAt: nowIso(),
      }));
      if (out.length >= WIKI_CANDIDATE_LIMIT) break;
    }
    return { ok: true, rows: out };
  }
  async function generateWikiDrafts() {
    const wiki = wikiState();
    const rows = wikiSelectedSourceRows();
    if (!rows.length) throw new Error("초안의 근거로 쓸 기억을 하나 이상 선택해 주세요.");
    const connectionId = wikiConnectionId(wiki);
    if (!connectionId) throw new Error("위키 초안에 사용할 모델 연결을 선택해 주세요.");
    setBusy(true, "모델이 위키 초안을 작성하는 중…");
    try {
      const payload = await api("generate/raw", {
        method: "POST", timeoutMs: MODEL_TIMEOUT_MS,
        body: {
          connectionId, runId: uid("wiki-draft"), streaming: false,
          messages: [
            { role: "system", content: wikiDraftSystemPrompt(wiki, rows) },
            { role: "user", content: `[EXISTING WIKI TITLES]\n${wiki.docs.map((doc) => doc.title).join(" / ") || "(none)"}\n[/EXISTING WIKI TITLES]\n\n위 SOURCE LIST만 근거로 위키 문서 초안을 작성하세요.` },
          ],
          parameters: { maxTokens: 4000, reasoningEffort: null },
        },
      });
      const output = extractGeneratedText(payload);
      const parsed = parseWikiDraftJson(output, rows);
      if (!parsed.ok) { openRawRecovery("wiki", output, rows); return; }
      state.wikiCandidates = parsed.rows;
      state.wikiCandidateSelected = new Set(parsed.rows.map((row, index) => String(index)));
      state.layer = "wiki-candidates";
      if (!parsed.rows.length) toast("이번 근거에서는 문서로 만들 만한 내용을 찾지 못했습니다.");
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }
  function wikiCandidateFromDom(candidate, index) {
    const get = (suffix) => document.getElementById(`mmc-wc-${suffix}-${index}`);
    const lines = (value, max) => String(value || "").split(/\n/).map((row) => row.trim()).filter(Boolean).slice(0, max);
    return normalizeWikiDoc({
      ...candidate,
      title: String(get("title")?.value || candidate.title || "").trim().slice(0, 120),
      category: String(get("category")?.value || candidate.category || "misc"),
      subcategory: String(get("subcategory")?.value || candidate.subcategory || ""),
      summary: String(get("summary")?.value || candidate.summary || "").trim().slice(0, 400),
      aliases: normalizeTextList(lines(get("aliases")?.value, 12), 12, 80),
      keywordsKo: normalizeTextList(lines(get("ko")?.value, 16), 16, 80),
      keywordsEn: normalizeTextList(lines(get("en")?.value, 16), 16, 80),
    });
  }
  async function applyWikiCandidates() {
    const selected = [...state.wikiCandidateSelected].map(Number).filter((index) => Number.isInteger(index));
    if (!selected.length) throw new Error("저장할 문서를 선택해 주세요.");
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const conflicts = [];
    const saved = new Set();
    let created = 0;
    for (const index of selected.slice().sort((a, b) => a - b)) {
      const original = state.wikiCandidates[index];
      if (!original) continue;
      const doc = wikiCandidateFromDom(original, index);
      if (!doc.title) { conflicts.push("제목 없는 문서"); continue; }
      if (wiki.docs.length >= WIKI_DOC_LIMIT) { conflicts.push(`${doc.title}: 문서 상한 ${WIKI_DOC_LIMIT}개`); continue; }
      if (wikiFindByTitle(wiki.docs, doc.title)) { conflicts.push(`${doc.title}: 같은 제목/별칭 문서가 이미 있음`); continue; }
      wiki.docs.push(doc);
      created += 1;
      saved.add(index);
    }
    wiki.originChatId = String(state.selectedChatId || "");
    data.wiki = wiki;
    await persistData(data);
    if (conflicts.length) {
      state.wikiCandidates = state.wikiCandidates.filter((row, index) => !saved.has(index));
      state.wikiCandidateSelected = new Set(state.wikiCandidates.map((row, index) => String(index)));
      state.layer = state.wikiCandidates.length ? "wiki-candidates" : null;
      toast(`${created}개 저장 · ${conflicts.length}개는 중복/상한 때문에 남겨뒀습니다.`, true);
    } else {
      state.wikiCandidates = [];
      state.wikiCandidateSelected.clear();
      state.layer = null;
      toast(`위키 문서 ${created}개를 저장했습니다.`);
    }
    render();
  }

  function wikiUpdateSystemPrompt(wiki) {
    const criteria = String(wiki.updatePrompt || "").trim() || DEFAULT_WIKI_UPDATE_PROMPT;
    const contract = [
      "Response contract — return ONE JSON object and nothing else:",
      '{"summary":null,"summaryKo":null,"changes":[{"sectionId":"...","heading":"...","body":"full new markdown","bodyKo":null,"reason":"why"}],"conflicts":["..."]}',
      "- sectionId must be copied exactly from the document, or null to propose a brand new section.",
      "- Never return a sectionId whose section is marked USER-LOCKED. Put that case in conflicts instead.",
      "- summary is the replacement one-line overview, or null to leave it unchanged.",
      "- body is the complete new text of that section, in Markdown, keeping any [n] citation markers that still apply.",
      `- At most ${WIKI_SECTION_LIMIT} changes.`,
      '- Return {"changes":[],"conflicts":[]} when nothing should change.',
      LANGUAGE_CONTRACT,
    ].join("\n");
    return `${criteria}\n\n${contract}`;
  }
  function wikiDocForPrompt(doc) {
    const lines = [`title: ${doc.title}`, `category: ${wikiCategoryPath(doc)}`, `summary: ${doc.summary || "(none)"}`];
    if (doc.aliases.length) lines.push(`aliases: ${doc.aliases.join(" | ")}`);
    for (const section of doc.sections) {
      lines.push(`\n--- section id=${section.id} heading="${section.heading}" ${section.managed === "user" ? "USER-LOCKED" : "AI-MANAGED"} ---\n${section.body}`);
    }
    return lines.join("\n");
  }
  function parseWikiProposalJson(output, doc) {
    const fragments = collectBalancedJsonFragments(output);
    let parsed = null;
    for (const fragment of fragments) {
      for (const candidate of [fragment, repairJsonishText(fragment)]) {
        try { parsed = JSON.parse(candidate); break; } catch {}
      }
      if (parsed) break;
    }
    if (!parsed || !isRecord(parsed)) return { ok: false, changes: [], conflicts: [] };
    const lockedIds = new Set(doc.sections.filter((section) => section.managed === "user").map((section) => section.id));
    const byId = new Map(doc.sections.map((section) => [section.id, section]));
    const changes = [];
    const conflicts = normalizeTextList(parsed.conflicts, 12, 300);
    const rawSummary = parsed.summary;
    if (typeof rawSummary === "string" && rawSummary.trim() && rawSummary.trim() !== doc.summary) {
      if (doc.summaryManaged === "user") {
        conflicts.push("개요가 사용자 편집으로 잠겨 있어 개요 변경 제안을 적용하지 않았습니다.");
      } else {
        changes.push(normalizeWikiProposalChange({
          kind: "summary", sectionId: "", heading: "한눈에 보는 개요",
          before: doc.summary, after: rawSummary.trim().replace(/\s+/g, " ").slice(0, WIKI_SUMMARY_MAX),
          afterKo: String(parsed.summaryKo || "").trim().replace(/\s+/g, " ").slice(0, WIKI_SUMMARY_MAX), reason: "",
        }));
      }
    }
    for (const raw of safeArray(parsed.changes || parsed.sections)) {
      if (!isRecord(raw)) continue;
      const body = String(raw.body ?? raw.after ?? "").replace(/\r\n?/g, "\n");
      if (!body.trim()) continue;
      const sectionId = String(raw.sectionId || "");
      if (sectionId && lockedIds.has(sectionId)) {
        const section = byId.get(sectionId);
        conflicts.push(`잠긴 섹션 "${section?.heading || sectionId}"에 대한 변경 제안이 들어와 적용하지 않았습니다.`);
        continue;
      }
      const target = sectionId ? byId.get(sectionId) : null;
      if (sectionId && !target) continue;
      if (target && target.body.trim() === body.trim()) continue;
      changes.push(normalizeWikiProposalChange({
        sectionId: target ? target.id : "",
        heading: String(raw.heading || target?.heading || "새 섹션"),
        before: target ? target.body : "",
        after: body,
        afterKo: String(raw.bodyKo || "").trim(),
        reason: String(raw.reason || ""),
        kind: target ? "update" : "add",
      }));
      if (changes.length >= WIKI_SECTION_LIMIT + 1) break;
    }
    return { ok: true, changes: changes.filter(Boolean), conflicts: normalizeTextList(conflicts, 12, 300) };
  }
  async function storeWikiProposal(doc, parsed, related) {
    if (!parsed.changes.length && !parsed.conflicts.length) {
      toast("모델이 바꿀 내용이 없다고 판단했습니다. 문서는 그대로 둡니다.");
      return;
    }
    const proposal = normalizeWikiProposal({
      docId: doc.id,
      docTitle: doc.title,
      baseUpdatedAt: doc.updatedAt,
      sourceCount: safeArray(related).length,
      sources: safeArray(related).map((row) => normalizeWikiSource({ kind: row.kind, refId: row.id, label: row.label, quote: truncate(row.text, 1200) })).filter(Boolean),
      changes: parsed.changes,
      conflicts: parsed.conflicts,
    });
    if (!proposal) { toast("적용할 만한 변경 제안이 없습니다."); return; }
    const data = await freshOwnedData();
    const nextWiki = normalizeWiki(data.wiki);
    nextWiki.proposals = [proposal, ...nextWiki.proposals.filter((row) => row.docId !== doc.id)].slice(0, 40);
    data.wiki = nextWiki;
    await persistData(data, { sync: false, silent: true });
    state.rawRecovery = null;
    state.wikiProposalDocId = doc.id;
    state.wikiProposalSelected = new Set(proposal.changes.map((row, index) => String(index)));
    state.layer = "wiki-proposal";
    toast(`새 기억 ${safeArray(related).length}건을 근거로 변경 제안 ${proposal.changes.length}건을 만들었습니다. 아직 문서는 바뀌지 않았습니다.`);
  }
  async function generateWikiProposal(docId) {
    const wiki = wikiState();
    const doc = wiki.docs.find((row) => row.id === String(docId));
    if (!doc) throw new Error("변경 제안을 만들 문서를 찾지 못했습니다.");
    if (doc.aiLocked) throw new Error("AI 수정 잠금이 켜져 있는 문서입니다. 잠금을 풀고 다시 시도해 주세요.");
    const related = wikiRelatedMemoryRows(doc);
    if (!related.length) throw new Error("이 문서와 관련된 새 기억이 없습니다.");
    const connectionId = wikiConnectionId(wiki);
    if (!connectionId) throw new Error("위키 갱신에 사용할 모델 연결을 선택해 주세요.");
    setBusy(true, "모델이 변경사항을 정리하는 중…");
    try {
      const sourceBlock = related.map((row, index) => `[${index + 1}] (${WIKI_SOURCE_KIND_LABEL[row.kind] || row.kind}) ${row.label}\n${truncate(row.text, 900)}`).join("\n\n");
      const payload = await api("generate/raw", {
        method: "POST", timeoutMs: MODEL_TIMEOUT_MS,
        body: {
          connectionId, runId: uid("wiki-update"), streaming: false,
          messages: [
            { role: "system", content: wikiUpdateSystemPrompt(wiki) },
            { role: "user", content: `[CURRENT DOCUMENT]\n${wikiDocForPrompt(doc)}\n[/CURRENT DOCUMENT]\n\n[NEW RECORDS]\n${sourceBlock}\n[/NEW RECORDS]` },
          ],
          parameters: { maxTokens: 3000, reasoningEffort: null },
        },
      });
      const output = extractGeneratedText(payload);
      const parsed = parseWikiProposalJson(output, doc);
      if (!parsed.ok) {
        state.rawRecovery = { kind: "wiki-update", text: output, rows: related, docId: doc.id };
        state.layer = "raw-repair";
        toast("모델 응답의 JSON 형식이 흔들렸습니다. 원문을 보존했으니 수정 없이 다시 읽거나 직접 고칠 수 있습니다.", true);
        return;
      }
      await storeWikiProposal(doc, parsed, related);
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }
  async function applyWikiProposal() {
    const proposal = wikiProposalFor(state.wikiProposalDocId);
    if (!proposal) throw new Error("적용할 변경 제안이 없습니다.");
    const picked = proposal.changes.filter((row, index) => state.wikiProposalSelected.has(String(index)));
    if (!picked.length) throw new Error("반영할 변경사항을 선택해 주세요.");
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const doc = wiki.docs.find((row) => row.id === proposal.docId);
    if (!doc) throw new Error("문서를 찾지 못했습니다. 이미 삭제된 것 같습니다.");
    if (doc.aiLocked) throw new Error("AI 수정 잠금이 켜져 있어 반영할 수 없습니다.");
    const now = nowIso();
    const skipped = [];
    let applied = 0;
    for (const change of picked) {
      if (change.kind === "summary") {
        if (doc.summaryManaged === "user") { skipped.push("개요: 사용자 편집 잠금"); continue; }
        if (doc.summary.trim() !== String(change.before || "").trim()) { skipped.push("개요: 그 사이에 직접 수정됨"); continue; }
        doc.summary = String(change.after || "").replace(/\s+/g, " ").trim().slice(0, WIKI_SUMMARY_MAX);
        doc.summaryKo = String(change.afterKo || "").replace(/\s+/g, " ").trim().slice(0, WIKI_SUMMARY_MAX);
        applied += 1;
        continue;
      }
      if (change.sectionId) {
        const section = doc.sections.find((row) => row.id === change.sectionId);
        if (!section) { skipped.push(`${change.heading}: 섹션이 사라짐`); continue; }
        if (section.managed === "user") { skipped.push(`${section.heading}: 사용자 편집 잠금`); continue; }
        if (section.body.trim() !== String(change.before || "").trim()) { skipped.push(`${section.heading}: 그 사이에 직접 수정됨`); continue; }
        section.body = String(change.after || "").slice(0, WIKI_SECTION_BODY_HARD_MAX);
        section.bodyKo = String(change.afterKo || "").slice(0, WIKI_SECTION_BODY_HARD_MAX);
        section.updatedAt = now;
        applied += 1;
        continue;
      }
      if (doc.sections.length >= WIKI_SECTION_LIMIT) { skipped.push(`${change.heading}: 섹션 상한`); continue; }
      const created = normalizeWikiSection({ heading: change.heading, body: change.after, bodyKo: change.afterKo, managed: "ai", level: 1, updatedAt: now });
      if (!created) { skipped.push(`${change.heading}: 빈 섹션`); continue; }
      doc.sections.push(created);
      applied += 1;
    }
    if (!applied) {
      await persistData(data, { sync: false, silent: true });
      throw new Error(`반영할 수 있는 변경사항이 없습니다. ${skipped.join(" / ")}`);
    }
    const existingSourceKeys = new Set(doc.sources.map((row) => `${row.kind}:${row.refId}`));
    for (const source of proposal.sources) {
      if (doc.sources.length >= 24) break;
      const key = `${source.kind}:${source.refId}`;
      if (existingSourceKeys.has(key)) continue;
      existingSourceKeys.add(key);
      doc.sources.push(source);
    }
    doc.updatedAt = now;
    doc.aiUpdatedAt = now;
    wiki.proposals = wiki.proposals.filter((row) => row.id !== proposal.id);
    data.wiki = wiki;
    await persistData(data);
    state.layer = null;
    state.wikiProposalDocId = "";
    state.wikiProposalSelected = new Set();
    toast(skipped.length ? `${applied}건 반영 · ${skipped.length}건은 건너뛰었습니다: ${skipped.join(" / ")}` : `변경사항 ${applied}건을 반영했습니다.`, skipped.length > 0);
    render();
  }
  async function dismissWikiProposal(docId) {
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const before = wiki.proposals.length;
    wiki.proposals = wiki.proposals.filter((row) => row.docId !== String(docId));
    if (wiki.proposals.length === before) return;
    const doc = wiki.docs.find((row) => row.id === String(docId));
    if (doc) doc.aiUpdatedAt = nowIso();
    data.wiki = wiki;
    await persistData(data, { sync: false, silent: true });
    state.layer = null;
    state.wikiProposalDocId = "";
    state.wikiProposalSelected = new Set();
    toast("변경 제안을 무시했습니다. 문서는 그대로입니다.");
    render();
  }

  function wikiCategoryCounts(wiki) {
    const counts = {};
    for (const doc of wiki.docs) counts[doc.category] = (counts[doc.category] || 0) + 1;
    return counts;
  }
  function wikiFilteredDocs(wiki) {
    const query = String(state.wikiSearch || "").trim().toLocaleLowerCase();
    return wiki.docs.slice()
      .filter((doc) => state.wikiCategoryFilter === "all" || doc.category === state.wikiCategoryFilter)
      .filter((doc) => !query || wikiSearchHaystack(doc).includes(query))
      .sort((a, b) => String(a.category).localeCompare(String(b.category))
        || String(a.subcategory).localeCompare(String(b.subcategory), "ko")
        || String(a.title).localeCompare(String(b.title), "ko"));
  }
  function wikiCurrentDoc(wiki = wikiState()) {
    return wiki.docs.find((doc) => doc.id === String(state.wikiSelectedId || "")) || null;
  }
  function wikiDocBadges(doc) {
    return [
      doc.alwaysRemember ? '<i class="mmc-wiki-badge is-always" title="항상 기억">항상</i>' : "",
      doc.aiLocked ? '<i class="mmc-wiki-badge is-lock" title="AI 수정 잠금">🔒</i>' : "",
      doc.excludeFromContext ? '<i class="mmc-wiki-badge is-off" title="AI 참조 제외">제외</i>' : "",
    ].filter(Boolean).join("");
  }
  // 목록 미리보기용: 근거 번호와 링크 대괄호, Markdown 기호를 걷어낸 한 줄 텍스트.
  function wikiPlainText(value) {
    return String(value || "")
      .replace(/\[(\d{1,3})\]/g, "")
      .replace(/\[([^\[\]\n]{1,80})\]/g, "$1")
      .replace(/[*`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function wikiListRow(doc, wiki) {
    const pending = wikiProposalFor(doc.id, wiki);
    return `<button class="mmc-wiki-row ${doc.id === state.wikiSelectedId ? "is-active" : ""}" data-action="wiki-open" data-id="${esc(doc.id)}">
      <span class="mmc-wiki-row-top"><b>${esc(displayText(doc.title, doc.titleKo))}</b>${wikiDocBadges(doc)}${pending ? '<i class="mmc-wiki-badge is-pending" title="변경 제안 대기">제안</i>' : ""}</span>
      <span class="mmc-wiki-row-sum">${esc(truncate(wikiPlainText(displayText(doc.summary, doc.summaryKo) || displayText(doc.sections[0]?.body, doc.sections[0]?.bodyKo) || ""), 64)) || "개요 없음"}</span>
    </button>`;
  }

  function wikiListMarkup(wiki) {
    const docs = wikiFilteredDocs(wiki);
    if (!docs.length) return `<div class="mmc-empty">${wiki.docs.length ? "검색 결과가 없습니다." : "아직 위키 문서가 없습니다."}</div>`;
    const groups = [];
    for (const doc of docs) {
      const key = `${doc.category}\u0000${doc.subcategory}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(doc);
      else groups.push({ key, label: wikiCategoryPath(doc), rows: [doc] });
    }
    return groups.map((group) => `<div class="mmc-wiki-group"><h4>${esc(group.label)}<i>${group.rows.length}</i></h4>${group.rows.map((doc) => wikiListRow(doc, wiki)).join("")}</div>`).join("");
  }
  function wikiSidePanel(wiki) {
    const counts = wikiCategoryCounts(wiki);
    const options = [`<option value="all" ${state.wikiCategoryFilter === "all" ? "selected" : ""}>모든 문서 (${wiki.docs.length})</option>`]
      .concat(Object.entries(WIKI_CATEGORY_LABEL).map(([id, label]) => `<option value="${id}" ${state.wikiCategoryFilter === id ? "selected" : ""}>${label} (${counts[id] || 0})</option>`))
      .join("");
    return `<aside class="mmc-wiki-side">
      <div class="mmc-wiki-side-tools">
        <label class="mmc-searchbox">${SVG.search}<input id="mmc-wiki-search" class="mmc-wiki-search" value="${esc(state.wikiSearch)}" placeholder="문서 검색" aria-label="문서 검색"></label>
        <select id="mmc-wiki-category-filter" aria-label="분류">${options}</select>
      </div>
      <div class="mmc-wiki-list" data-wiki-list>${wikiListMarkup(wiki)}</div>
      <div class="mmc-wiki-side-foot">
        <button class="mmc-btn mmc-primary" data-action="wiki-new">${SVG.plus}<span>새 문서</span></button>
        <button class="mmc-btn" data-action="wiki-draft-open">${SVG.spark}<span>AI 초안</span></button>
        <div class="mmc-wiki-status"><span>주입 ${wiki.injectionEnabled ? "켜짐" : "꺼짐"} · 항상 기억 ${wikiAlwaysDocs(wiki).length} · 제안 ${wiki.proposals.length}</span><button class="mmc-link" data-action="wiki-settings">위키 설정</button></div>
      </div>
    </aside>`;
  }

  function wikiSectionDomId(section) { return `mmc-wiki-h-${section.id}`; }
  function wikiHasKo(doc) {
    return !!(String(doc?.titleKo || "").trim() || String(doc?.summaryKo || "").trim()
      || safeArray(doc?.sections).some((section) => String(section.headingKo || "").trim() || String(section.bodyKo || "").trim()));
  }
  // 1 / 1.1 / 1.1.1 형태의 절 번호를 만든다. 레벨이 건너뛰어도 무너지지 않게 한다.
  function wikiSectionNumbers(sections) {
    const counters = [0, 0, 0];
    return safeArray(sections).map((section) => {
      const level = Math.max(1, Math.min(WIKI_SECTION_MAX_LEVEL, Number(section.level) || 1));
      counters[level - 1] += 1;
      for (let i = level; i < counters.length; i += 1) counters[i] = 0;
      return counters.slice(0, level).map((value) => Math.max(1, value)).join(".");
    });
  }
  function wikiSectionMarkup(doc, section, docs, number) {
    const locked = section.managed === "user";
    const level = Math.max(1, Math.min(WIKI_SECTION_MAX_LEVEL, Number(section.level) || 1));
    const tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
    const heading = displayText(section.heading, section.headingKo);
    const body = displayText(section.body, section.bodyKo);
    const showsKo = koDisplayOn() && String(section.bodyKo || "").trim() && body !== section.body;
    return `<section class="mmc-wiki-section ${locked ? "is-locked" : ""}" data-wiki-level="${level}">
      <${tag} id="${esc(wikiSectionDomId(section))}" class="mmc-wh"><span class="mmc-wh-text"><i class="mmc-wiki-h-num">${esc(number)}.</i>${esc(heading)}</span>${locked ? `<i class="mmc-wiki-manage is-locked" title="사용자 편집 · AI가 바꾸지 않습니다">${SVG.lock}사용자 편집</i>` : ""}<button class="mmc-wh-edit" data-action="wiki-edit" data-id="${esc(doc.id)}" title="${locked ? "사용자 편집 섹션" : "AI 관리 섹션 · 변경 제안 대상"}">[편집]</button></${tag}>
      <div class="mmc-wiki-body">${wikiRenderMarkdown(body, doc, docs) || '<p class="mmc-wiki-muted">내용이 비어 있습니다.</p>'}</div>
      ${showsKo ? `<details class="mmc-wiki-original"><summary>원문 보기</summary><div class="mmc-wiki-body">${wikiRenderMarkdown(section.body, doc, docs)}</div></details>` : ""}
    </section>`;
  }

  function wikiImagesMarkup(doc) {
    const images = safeArray(doc.images).filter((image) => image.url);
    if (!images.length) return { lead: "", rest: "" };
    const figure = (image, className) => `<figure class="${className}"><img src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy" referrerpolicy="no-referrer">${image.caption ? `<figcaption>${esc(image.caption)}</figcaption>` : ""}</figure>`;
    return {
      lead: figure(images[0], "mmc-wiki-lead-image"),
      rest: images.length > 1
        ? `<section class="mmc-wiki-section" data-wiki-level="1"><h2 class="mmc-wh"><span class="mmc-wh-text">이미지</span></h2><div class="mmc-wiki-gallery">${images.slice(1).map((image) => figure(image, "mmc-wiki-figure")).join("")}</div></section>`
        : "",
    };
  }

  function wikiInfoboxMarkup(doc, docs = wikiState().docs) {
    const related = wikiOutgoingRows(doc, docs).slice(0, 6);
    const rows = [
      ["분류", `${esc(wikiCategoryLabel(doc))}${doc.subcategory ? ` › ${esc(doc.subcategory.split("/").join(" › "))}` : ""}`],
      doc.aliases.length ? ["별칭", esc(doc.aliases.join(", "))] : null,
      doc.keywordsKo.length || doc.keywordsEn.length ? ["키워드", esc([...doc.keywordsKo, ...doc.keywordsEn].join(" · "))] : null,
      doc.keywordGroups.length ? ["조합 조건", doc.keywordGroups.map((group) => esc(group.join(" + "))).join("<br>")] : null,
      related.length ? ["관련", related.map((row) => row.doc ? `<button class="mmc-wiki-link" data-action="wiki-open" data-id="${esc(row.doc.id)}">${esc(row.doc.title)}</button>` : `<button class="mmc-wiki-link is-missing" data-action="wiki-new-from-link" data-title="${esc(row.title)}">${esc(row.title)}</button>`).join(", ")] : null,
      ["최근 수정", esc(sourceDate(doc.updatedAt) || doc.updatedAt)],
      doc.aiUpdatedAt ? ["최근 AI 반영", esc(sourceDate(doc.aiUpdatedAt) || doc.aiUpdatedAt)] : null,
    ].filter(Boolean);
    const images = wikiImagesMarkup(doc);
    const toggle = (field, label, on, onText, offText, help) => `<tr class="mmc-wiki-state"><th>${label}</th><td><button class="mmc-wiki-toggle ${on ? "is-on" : ""}" data-action="wiki-toggle" data-field="${field}" data-id="${esc(doc.id)}" title="${help}" aria-pressed="${on ? "true" : "false"}"><span>${on ? onText : offText}</span><i></i></button></td></tr>`;
    return `<aside class="mmc-wiki-infobox">
      <b class="mmc-wiki-infobox-title">${esc(displayText(doc.title, doc.titleKo))}</b>
      ${images.lead}
      <table><tbody>
        ${rows.map(([term, value]) => `<tr><th>${term}</th><td>${value}</td></tr>`).join("")}
        ${toggle("alwaysRemember", "항상 기억", doc.alwaysRemember, "켜짐 · 개요만", "조건부", "개요 한 줄만 항상 주입합니다. 본문 전체는 주입하지 않습니다")}
        ${toggle("aiLocked", "AI 수정 잠금", doc.aiLocked, "잠김", "허용", "켜면 AI가 이 문서 내용을 바꾸지 못합니다")}
        ${toggle("excludeFromContext", "AI 참조 제외", doc.excludeFromContext, "제외", "참조", "켜면 RP 생성 컨텍스트에 쓰지 않습니다")}
      </tbody></table>
    </aside>`;
  }

  function wikiHomeMarkup(wiki) {
    const recent = wiki.docs.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8);
    const counts = wikiCategoryCounts(wiki);
    return `<div class="mmc-wiki-main">
      <article class="mmc-wiki-article mmc-wiki-home">
        <h1 class="mmc-wiki-title">이야기 위키 <small>대문</small></h1>
        <p class="mmc-wiki-byline">${esc(chatLabel(state.currentChat))}의 등장인물·장소·사건을 정리한 문서 모음 · 문서 ${wiki.docs.length}개</p>
        <div class="mmc-wiki-lead mmc-wiki-body"><p>이 위키는 약속·기억 앵커·요소 기억을 지우지 않고 그 위에 올리는 <strong>사람이 읽고 고치는 문서</strong>예요. AI 초안은 이미 저장된 기억만 근거로 쓰고, 새 기억이 생기면 문서를 바로 바꾸지 않고 변경 제안으로 알려 줘요.</p></div>
        ${recent.length ? `<section class="mmc-wiki-section" data-wiki-level="1"><h2 class="mmc-wh"><span class="mmc-wh-text">최근 바뀐 문서</span></h2><ul class="mmc-wiki-recent">${recent.map((doc) => `<li><button class="mmc-wiki-link" data-action="wiki-open" data-id="${esc(doc.id)}">${esc(displayText(doc.title, doc.titleKo))}</button><small>${esc(wikiCategoryPath(doc))} · ${esc(relTime(doc.updatedAt))}</small></li>`).join("")}</ul></section>` : ""}
        <section class="mmc-wiki-section" data-wiki-level="1"><h2 class="mmc-wh"><span class="mmc-wh-text">분류</span></h2><div class="mmc-wiki-cats">${Object.entries(WIKI_CATEGORY_LABEL).map(([id, label]) => `<button class="mmc-wiki-cat ${counts[id] ? "" : "is-empty"}" data-action="wiki-filter" data-category="${id}"><b>${label}</b><small>${counts[id] || 0}</small></button>`).join("")}</div></section>
        <div class="mmc-wiki-home-actions"><button class="mmc-btn mmc-primary" data-action="wiki-new">${SVG.plus}<span>새 문서</span></button><button class="mmc-btn" data-action="wiki-draft-open">${SVG.spark}<span>기억으로 AI 초안 만들기</span></button></div>
      </article>
    </div>`;
  }
  function wikiDocPanel(wiki) {
    const doc = wikiCurrentDoc(wiki);
    if (!doc) return wikiHomeMarkup(wiki);
    const docs = wiki.docs;
    const proposal = wikiProposalFor(doc.id, wiki);
    const related = proposal ? [] : wikiRelatedMemoryRows(doc);
    const outgoing = wikiOutgoingRows(doc, docs);
    const incoming = wikiIncomingRows(doc, docs);
    const banner = proposal
      ? `<div class="mmc-wiki-banner"><span class="mmc-alert-icon">${SVG.spark}</span><div><b>변경 제안 ${proposal.changes.length}건이 기다리고 있어요</b><small>새 기억 ${proposal.sourceCount}건 기준 · 아직 문서는 바뀌지 않았어요.${proposal.conflicts.length ? ` 잠금 충돌 ${proposal.conflicts.length}건 포함.` : ""}</small></div><div><button class="mmc-btn mmc-sm mmc-primary" data-action="wiki-proposal-open" data-id="${esc(doc.id)}">변경 사항 보기</button><button class="mmc-btn mmc-sm mmc-ghost" data-action="wiki-proposal-dismiss" data-id="${esc(doc.id)}">무시</button></div></div>`
      : related.length && !doc.aiLocked
        ? `<div class="mmc-wiki-banner"><span class="mmc-alert-icon">${SVG.spark}</span><div><b>새 기억 ${related.length}건이 이 문서와 관련돼요</b><small>모델을 불러 섹션 단위 변경 제안을 만들어요. 문서를 바로 바꾸지는 않아요.</small></div><div><button class="mmc-btn mmc-sm mmc-primary" data-action="wiki-propose" data-id="${esc(doc.id)}">${SVG.spark}<span>변경 제안 만들기</span></button><button class="mmc-btn mmc-sm mmc-ghost" data-action="wiki-proposal-dismiss" data-id="${esc(doc.id)}">나중에</button></div></div>`
        : "";
    const linkRow = (row) => row.doc
      ? `<button class="mmc-wiki-link" data-action="wiki-open" data-id="${esc(row.doc.id)}">${esc(row.doc.title)}</button>`
      : `<button class="mmc-wiki-link is-missing" data-action="wiki-new-from-link" data-title="${esc(row.title)}" title="아직 없는 문서 · 눌러서 만들기">${esc(row.title)}</button>`;
    const numbers = wikiSectionNumbers(doc.sections);
    const toc = doc.sections.length > 1
      ? `<nav class="mmc-wiki-toc"><b>목차</b><ol>${doc.sections.map((section, index) => `<li data-wiki-level="${Math.max(1, Math.min(WIKI_SECTION_MAX_LEVEL, Number(section.level) || 1))}"><button data-action="wiki-toc" data-target="${esc(wikiSectionDomId(section))}"><i>${esc(numbers[index])}.</i>${esc(displayText(section.heading, section.headingKo))}</button></li>`).join("")}</ol></nav>`
      : "";
    const sources = doc.sources.length
      ? `<ol class="mmc-wiki-sources">${doc.sources.map((source, index) => `<li><button class="mmc-wiki-cite" data-action="wiki-source" data-id="${esc(doc.id)}" data-index="${index + 1}">${index + 1}</button><b>${esc(WIKI_SOURCE_KIND_LABEL[source.kind] || source.kind)}</b> ${esc(source.label)}${source.quote ? `<details><summary>근거 원문 보기</summary><pre>${esc(source.quote)}</pre></details>` : ""}</li>`).join("")}</ol>`
      : '<small class="mmc-wiki-muted">연결된 근거 자료가 없어요. AI 초안으로 만든 문서에는 근거가 자동으로 붙어요.</small>';
    const crumbs = [wikiCategoryLabel(doc), ...doc.subcategory.split("/").filter(Boolean)].map((part) => `<span>${esc(part)}</span>`).join("<i>›</i>");
    const managedUser = doc.sections.filter((section) => section.managed === "user").length;
    const previous = state.wikiHistory.length ? wikiState().docs.find((row) => row.id === state.wikiHistory[state.wikiHistory.length - 1]) : null;
    return `<div class="mmc-wiki-main">
      <div class="mmc-wiki-actionbar">
        <button class="mmc-btn mmc-sm mmc-ghost mmc-wiki-back ${previous ? "has-history" : ""}" data-action="wiki-back">${SVG.back}<span>${previous ? esc(truncate(previous.title || "이전 문서", 14)) : "목록"}</span></button>
        <nav class="mmc-wiki-crumb" aria-label="분류 경로">${crumbs}</nav>
        <div class="mmc-wiki-actions">
          <button data-action="wiki-edit" data-id="${esc(doc.id)}">${SVG.edit}<span>편집</span></button>
          ${proposal ? `<button data-action="wiki-proposal-open" data-id="${esc(doc.id)}">변경 제안<em>${proposal.changes.length}</em></button>` : `<button data-action="wiki-propose" data-id="${esc(doc.id)}" ${doc.aiLocked ? "disabled" : ""} title="${doc.aiLocked ? "AI 수정 잠금 중" : "새 기억으로 변경 제안 만들기"}">${SVG.spark}<span>AI 갱신</span></button>`}
          <details class="mmc-wiki-more"><summary aria-label="더 보기">${SVG.more}</summary><div>
            ${wikiHasKo(doc) ? `<button data-action="wiki-toggle-ko">${koDisplayOn() ? "원문으로 보기" : "한국어 표시로 보기"}</button>` : ""}
            <button data-action="wiki-settings">위키 설정</button>
            <button class="is-danger" data-action="wiki-delete" data-id="${esc(doc.id)}">문서 삭제</button>
          </div></details>
        </div>
      </div>
      <article class="mmc-wiki-article">
        <header class="mmc-wiki-titlebar"><h1 class="mmc-wiki-title">${esc(displayText(doc.title, doc.titleKo))}</h1>${doc.aliases.length ? `<small>다른 이름: ${esc(doc.aliases.join(" · "))}</small>` : ""}</header>
        <p class="mmc-wiki-byline">최근 수정 <b>${esc(sourceDate(doc.updatedAt) || doc.updatedAt)}</b> · 섹션 ${doc.sections.length}개${doc.sections.length ? ` (<b>AI 관리 ${doc.sections.length - managedUser}</b>${managedUser ? ` · ${SVG.lock}사용자 편집 ${managedUser}` : ""})` : ""} · 근거 ${doc.sources.length}건${wikiHasKo(doc) ? ` · <button class="mmc-wiki-link" data-action="wiki-toggle-ko">${koDisplayOn() ? "원문으로 보기" : "한국어 표시로 보기"}</button>` : ""}</p>
        ${banner}
        ${wikiInfoboxMarkup(doc, docs)}
        <div class="mmc-wiki-lead mmc-wiki-body">${doc.summary ? wikiRenderMarkdown(displayText(doc.summary, doc.summaryKo), doc, docs) : '<p class="mmc-wiki-muted">개요가 비어 있어요. 항상 기억을 쓰려면 개요가 필요해요.</p>'}${doc.summaryManaged === "user" ? `<p class="mmc-wiki-summary-lock">${SVG.lock}개요는 사용자 편집으로 잠겨 있어 AI 갱신이 덮어쓰지 않아요.</p>` : ""}</div>
        ${toc}
        ${doc.sections.map((section, index) => wikiSectionMarkup(doc, section, docs, numbers[index])).join("") || '<div class="mmc-empty">본문 섹션이 없어요. 편집에서 섹션을 추가해 주세요.</div>'}
        ${wikiImagesMarkup(doc).rest}
        <section class="mmc-wiki-section mmc-wiki-seealso-sec" data-wiki-level="1">
          <h2 class="mmc-wh"><span class="mmc-wh-text">함께 보기</span></h2>
          <div class="mmc-wiki-seealso">
            <div><span>이 문서가 가리키는 문서</span><div class="mmc-wiki-linkrow">${outgoing.length ? outgoing.map(linkRow).join("") : '<small class="mmc-wiki-muted">없음</small>'}</div></div>
            <div><span>이 문서를 가리키는 문서</span><div class="mmc-wiki-linkrow">${incoming.length ? incoming.map((row) => linkRow({ title: row.title, doc: row })).join("") : '<small class="mmc-wiki-muted">없음</small>'}</div></div>
          </div>
        </section>
        <section class="mmc-wiki-section mmc-wiki-refs" data-wiki-level="1"><h2 class="mmc-wh"><span class="mmc-wh-text">근거</span></h2>${sources}</section>
        <footer class="mmc-wiki-doc-foot">
          <small>최근 수정 ${esc(sourceDate(doc.updatedAt) || doc.updatedAt)}${doc.aiUpdatedAt ? ` · 최근 AI 반영 ${esc(sourceDate(doc.aiUpdatedAt) || doc.aiUpdatedAt)}` : ""} · 검색 조건 ${wikiTriggerConditions(doc).length}개</small>
        </footer>
      </article>
    </div>`;
  }

  function wikiMainView() {
    const wiki = wikiState();
    if (state.wikiSelectedId && !wiki.docs.some((doc) => doc.id === state.wikiSelectedId)) state.wikiSelectedId = "";
    return `<section class="mmc-wiki-document">
      <div class="mmc-wiki-split" data-wiki-pane="${state.wikiSelectedId ? "doc" : "list"}">${wikiSidePanel(wiki)}${wikiDocPanel(wiki)}</div>
    </section>`;
  }


  function wikiCategorySelectOptions(selected) {
    return Object.entries(WIKI_CATEGORY_LABEL).map(([id, label]) => `<option value="${id}" ${selected === id ? "selected" : ""}>${label}</option>`).join("");
  }
  function wikiConnectionOptions(wiki = wikiState()) {
    const selected = String(wiki.connectionId || "");
    const rows = state.connections.map((row) => `<option value="${esc(row.id)}" ${row.id === selected ? "selected" : ""}>${esc(row.label)}${row.model ? ` · ${esc(row.model)}` : ""}</option>`).join("");
    return `<option value="">기본 후보 모델 사용</option>${rows}`;
  }
  function captureWikiDraft() {
    if (!state.wikiDraft) return;
    const lines = (id, max) => String(document.getElementById(id)?.value || "").split(/\n/).map((row) => row.trim()).filter(Boolean).slice(0, max);
    const draft = state.wikiDraft;
    draft.title = String(document.getElementById("mmc-wiki-title")?.value ?? draft.title).trim().slice(0, 120);
    draft.category = String(document.getElementById("mmc-wiki-category")?.value || draft.category || "misc");
    draft.subcategory = String(document.getElementById("mmc-wiki-subcategory")?.value ?? draft.subcategory).trim().slice(0, 80);
    draft.summary = String(document.getElementById("mmc-wiki-summary")?.value ?? draft.summary).trim();
    draft.summaryManaged = String(document.getElementById("mmc-wiki-summary-mode")?.value || draft.summaryManaged || "ai") === "user" ? "user" : "ai";
    draft.aliases = normalizeTextList(lines("mmc-wiki-aliases", 12), 12, 80);
    draft.keywordsKo = normalizeTextList(lines("mmc-wiki-ko", 16), 16, 80);
    draft.keywordsEn = normalizeTextList(lines("mmc-wiki-en", 16), 16, 80);
    draft.keywordGroups = normalizeTriggerGroups(lines("mmc-wiki-groups", 8).map((line) => line.split(/[,＋+]/)));
    draft.relatedTitles = lines("mmc-wiki-related", 24);
    draft.sections = safeArray(draft.sections).map((section, index) => ({
      ...section,
      heading: String(document.getElementById(`mmc-wiki-sec-head-${index}`)?.value ?? section.heading).trim().slice(0, 120),
      // 여기서는 자르지 않는다. 상한 초과는 저장 단계에서 경고로 알리고 원문을 유지한다.
      body: String(document.getElementById(`mmc-wiki-sec-body-${index}`)?.value ?? section.body),
      level: Math.max(1, Math.min(WIKI_SECTION_MAX_LEVEL, Number(document.getElementById(`mmc-wiki-sec-level-${index}`)?.value) || section.level || 1)),
      managed: String(document.getElementById(`mmc-wiki-sec-mode-${index}`)?.value || section.managed) === "user" ? "user" : "ai",
    }));
    draft.images = safeArray(draft.images).map((image, index) => ({
      ...image,
      url: String(document.getElementById(`mmc-wiki-img-url-${index}`)?.value ?? image.url).trim(),
      alt: String(document.getElementById(`mmc-wiki-img-alt-${index}`)?.value ?? image.alt).trim(),
      caption: String(document.getElementById(`mmc-wiki-img-cap-${index}`)?.value ?? image.caption).trim(),
      lead: index === 0,
    })).filter((image) => image.url);
  }
  function wikiLengthNoteMarkup(id, length, max) {
    const over = length > max;
    return `<small class="mmc-wiki-count ${over ? "is-over" : ""}" data-wiki-count="${esc(id)}" data-wiki-count-max="${max}">${length.toLocaleString()} / ${max.toLocaleString()}자${over ? ` · ${(length - max).toLocaleString()}자 초과` : ""}</small>`;
  }
  function wikiEditorSectionMarkup(section, index) {
    const levelOptions = Array.from({ length: WIKI_SECTION_MAX_LEVEL }, (unused, i) => i + 1)
      .map((level) => `<option value="${level}" ${Number(section.level || 1) === level ? "selected" : ""}>${"—".repeat(level - 1)}${level}단계</option>`).join("");
    return `<section class="mmc-wiki-edit-section" data-wiki-level="${Number(section.level || 1)}">
      <div class="mmc-wiki-edit-section-head">
        <input id="mmc-wiki-sec-head-${index}" value="${esc(section.heading)}" maxlength="120" placeholder="섹션 제목">
        <select id="mmc-wiki-sec-level-${index}" title="하위 섹션 깊이">${levelOptions}</select>
        <select id="mmc-wiki-sec-mode-${index}" title="AI 갱신 허용 여부"><option value="ai" ${section.managed !== "user" ? "selected" : ""}>AI 관리</option><option value="user" ${section.managed === "user" ? "selected" : ""}>🔒 사용자 편집</option></select>
        <button class="mmc-btn mmc-danger" data-action="wiki-remove-section" data-index="${index}" title="이 섹션 삭제">삭제</button>
      </div>
      <textarea id="mmc-wiki-sec-body-${index}" rows="7" data-wiki-count-for="mmc-wiki-sec-body-${index}" placeholder="Markdown 본문. [다른 문서 제목]으로 연결하고 [1]로 근거를 가리킵니다.">${esc(section.body)}</textarea>
      ${wikiLengthNoteMarkup(`mmc-wiki-sec-body-${index}`, section.body.length, WIKI_SECTION_BODY_MAX)}
      ${section.bodyKo ? `<details class="mmc-source-quote"><summary>한국어 표시본 (AI 생성) 보기</summary><p>${esc(section.bodyKo)}</p></details>` : ""}
    </section>`;
  }
  function wikiImageEditorMarkup(image, index) {
    return `<section class="mmc-wiki-edit-section">
      <div class="mmc-wiki-edit-image-head"><b>${index === 0 ? "대표 이미지" : `이미지 ${index + 1}`}</b><button class="mmc-btn mmc-danger" data-action="wiki-remove-image" data-index="${index}">삭제</button></div>
      <input id="mmc-wiki-img-url-${index}" value="${esc(image.url)}" maxlength="1000" placeholder="https://… 또는 /로 시작하는 SillyTavern 경로">
      <input id="mmc-wiki-img-alt-${index}" value="${esc(image.alt)}" maxlength="200" placeholder="alt · 화면 낭독기와 이미지 로드 실패 시 표시">
      <input id="mmc-wiki-img-cap-${index}" value="${esc(image.caption)}" maxlength="300" placeholder="캡션 · 이미지 아래 설명">
    </section>`;
  }
  function wikiEditorLayer() {
    const wiki = wikiState();
    const draft = state.wikiDraft || normalizeWikiDoc({ id: "" });
    const relatedTitles = safeArray(draft.relatedTitles).length
      ? draft.relatedTitles
      : safeArray(draft.relatedDocIds).map((id) => wiki.docs.find((doc) => doc.id === id)?.title).filter(Boolean);
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-wiki-editor" data-layer-stop>
      <header><div><span class="mmc-kicker">STORY WIKI</span><h3>${draft.id ? "위키 문서 편집" : "새 위키 문서"}</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <label class="mmc-field"><span>제목</span><input id="mmc-wiki-title" value="${esc(draft.title)}" maxlength="120" placeholder="예: 이준 / 지희의 사물함"></label>
        <div class="mmc-field-row">
          <label class="mmc-field"><span>분류</span><select id="mmc-wiki-category">${wikiCategorySelectOptions(draft.category)}</select></label>
          <label class="mmc-field"><span>하위 분류 <small>· / 로 깊이 구분</small></span><input id="mmc-wiki-subcategory" value="${esc(draft.subcategory)}" maxlength="80" placeholder="예: 주요 인물/학교"></label>
        </div>
        <div class="mmc-field-row mmc-wiki-summary-row">
          <label class="mmc-field"><span>한눈에 보는 개요 <small>항상 기억을 켜면 이 한 줄만 상시 주입됩니다</small></span><textarea id="mmc-wiki-summary" rows="3" data-wiki-count-for="mmc-wiki-summary">${esc(draft.summary)}</textarea>${wikiLengthNoteMarkup("mmc-wiki-summary", draft.summary.length, WIKI_SUMMARY_MAX)}</label>
          <label class="mmc-field"><span>개요 관리 <small>사용자 편집이면 AI 갱신에서 보호됩니다</small></span><select id="mmc-wiki-summary-mode"><option value="ai" ${draft.summaryManaged !== "user" ? "selected" : ""}>AI 관리</option><option value="user" ${draft.summaryManaged === "user" ? "selected" : ""}>🔒 사용자 편집</option></select></label>
        </div>
        ${draft.summaryKo ? `<details class="mmc-source-quote"><summary>개요 한국어 표시본 보기</summary><p>${esc(draft.summaryKo)}</p></details>` : ""}
        <section class="mmc-trigger-box">
          <div><b>검색과 한영 대응</b><small>별칭은 같은 대상의 다른 이름이고 자동 검색어가 아닙니다. 키워드만 실제 호출 조건으로 쓰입니다.</small></div>
          <label class="mmc-field"><span>별칭 <small>한 줄에 하나</small></span><textarea id="mmc-wiki-aliases" rows="2">${esc(draft.aliases.join("\n"))}</textarea></label>
          <div class="mmc-field-row">
            <label class="mmc-field"><span>한국어 키워드 <small>하나만 나와도 호출</small></span><textarea id="mmc-wiki-ko" rows="3">${esc(draft.keywordsKo.join("\n"))}</textarea></label>
            <label class="mmc-field"><span>영어 키워드 <small>영출에서도 찾히게</small></span><textarea id="mmc-wiki-en" rows="3">${esc(draft.keywordsEn.join("\n"))}</textarea></label>
          </div>
          <label class="mmc-field"><span>조합 호출조건 <small>한 줄 안의 단어가 모두 나와야 호출 · 쉼표로 구분</small></span><textarea id="mmc-wiki-groups" rows="2" placeholder="지희, 사물함">${esc(draft.keywordGroups.map((group) => group.join(", ")).join("\n"))}</textarea></label>
        </section>
        <div class="mmc-wiki-edit-sections-head"><b>본문 섹션 <small>직접 추가한 섹션은 사용자 편집으로 시작합니다</small></b><button class="mmc-btn" data-action="wiki-add-section">섹션 추가</button></div>
        ${safeArray(draft.sections).map(wikiEditorSectionMarkup).join("") || '<div class="mmc-empty">섹션이 없습니다. 섹션을 추가해 주세요.</div>'}
        <div class="mmc-wiki-edit-sections-head"><b>이미지 <small>URL만 저장합니다 · 이미지 자체는 모델에 주입하지 않습니다</small></b><button class="mmc-btn" data-action="wiki-add-image">이미지 추가</button></div>
        ${safeArray(draft.images).map(wikiImageEditorMarkup).join("") || '<div class="mmc-empty">연결된 이미지가 없습니다.</div>'}
        <label class="mmc-field"><span>관련 문서 <small>제목 한 줄에 하나 · 본문의 [문서명] 링크와 함께 표시됩니다</small></span><textarea id="mmc-wiki-related" rows="3">${esc(relatedTitles.join("\n"))}</textarea></label>
        ${draft.sources.length ? `<section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>근거 자료</b><small>본문의 [1] [2] 번호와 순서가 같습니다.</small></span></div><ol class="mmc-wiki-sources">${draft.sources.map((source, index) => `<li><b>${esc(WIKI_SOURCE_KIND_LABEL[source.kind] || source.kind)}</b> ${esc(source.label)} <button class="mmc-btn mmc-danger" data-action="wiki-remove-source" data-index="${index}">제거</button></li>`).join("")}</ol></section>` : ""}
      </div>
      <footer>${draft.id ? `<button class="mmc-btn mmc-danger" data-action="wiki-delete" data-id="${esc(draft.id)}">${SVG.trash}<span>삭제</span></button>` : "<span></span>"}<div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="wiki-save">저장</button></div></footer>
    </section></div>`;
  }
  function wikiDraftLayer() {
    const wiki = wikiState();
    const groups = Object.entries(WIKI_SOURCE_KIND_LABEL).filter(([id]) => id !== "manual");
    const rowsByKind = new Map(groups.map(([id]) => [id, []]));
    for (const row of state.wikiSourceRows) if (rowsByKind.has(row.kind)) rowsByKind.get(row.kind).push(row);
    const body = groups.map(([id, label]) => {
      const rows = rowsByKind.get(id) || [];
      if (!rows.length) return "";
      return `<section class="mmc-wiki-source-group"><div class="mmc-wiki-source-group-head"><b>${label} <small>${rows.length}</small></b><button class="mmc-btn" data-action="wiki-source-group" data-kind="${id}">이 묶음 선택/해제</button></div>${rows.map((row) => `<label class="mmc-source-row ${state.wikiSourceSelected.has(String(row.id)) ? "is-selected" : ""}"><input type="checkbox" data-wiki-source-id="${esc(row.id)}" ${state.wikiSourceSelected.has(String(row.id)) ? "checked" : ""}><span class="mmc-source-copy"><b>${esc(truncate(row.label, 60))}</b><p>${esc(truncate(row.text, 220))}</p></span></label>`).join("")}</section>`;
    }).filter(Boolean).join("");
    const selectedText = wikiSelectedSourceRows().map((row) => row.text).join("\n");
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-wiki-draft-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">WIKI DRAFT</span><h3>기존 기억으로 위키 초안 만들기</h3><small>새 기억을 만들지 않습니다. 고른 기억을 문서로 조직하고 [n] 근거를 연결합니다.</small></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <label class="mmc-field"><span>주제 <small>선택 · 비워 두면 모델이 알아서 나눕니다</small></span><input id="mmc-wiki-draft-topic" value="${esc(state.wikiDraftTopic)}" maxlength="120" placeholder="예: 이준이라는 인물 / 학교 건물"></label>
        <div class="mmc-source-toolbar"><button class="mmc-btn" data-action="wiki-source-all">전체 선택</button><button class="mmc-btn" data-action="wiki-source-none">해제</button><span>${state.wikiSourceSelected.size}개 선택 · 약 ${estimateTokens(selectedText)} tokens</span></div>
        <div class="mmc-source-list">${body || '<div class="mmc-empty">초안의 근거로 쓸 기억이 없습니다. 먼저 약속·앵커·요소 기억을 만들어 주세요.</div>'}</div>
        <section class="mmc-model-strip"><div><b>위키 초안 모델</b><small>고른 기억만 근거로 씁니다. 결과는 미리보기이며 선택 저장 전에는 보관되지 않습니다.</small></div><select id="mmc-wiki-draft-model">${wikiConnectionOptions(wiki)}</select></section>
      </div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-model-btn" data-action="wiki-draft-run" ${state.wikiSourceSelected.size ? "" : "disabled"}>${SVG.spark}<span>초안 만들기</span></button></div></footer>
    </section></div>`;
  }
  function wikiCandidateRowMarkup(item, index) {
    const checked = state.wikiCandidateSelected.has(String(index));
    return `<article class="mmc-wiki-candidate ${checked ? "is-selected" : ""}">
      <div class="mmc-wiki-candidate-head"><label><input type="checkbox" data-wiki-candidate-index="${index}" ${checked ? "checked" : ""}><span class="mmc-type-chip">신규</span></label><b>${esc(item.title)}</b><small>섹션 ${item.sections.length} · 근거 ${item.sources.length}</small></div>
      <div class="mmc-field-row">
        <label class="mmc-field"><span>제목</span><input id="mmc-wc-title-${index}" value="${esc(item.title)}" maxlength="120"></label>
        <label class="mmc-field"><span>분류</span><select id="mmc-wc-category-${index}">${wikiCategorySelectOptions(item.category)}</select></label>
      </div>
      <label class="mmc-field"><span>하위 분류</span><input id="mmc-wc-subcategory-${index}" value="${esc(item.subcategory)}" maxlength="80"></label>
      <label class="mmc-field"><span>개요</span><textarea id="mmc-wc-summary-${index}" rows="2">${esc(item.summary)}</textarea></label>
      <div class="mmc-field-row">
        <label class="mmc-field"><span>별칭</span><textarea id="mmc-wc-aliases-${index}" rows="2">${esc(item.aliases.join("\n"))}</textarea></label>
        <label class="mmc-field"><span>한국어 키워드</span><textarea id="mmc-wc-ko-${index}" rows="2">${esc(item.keywordsKo.join("\n"))}</textarea></label>
      </div>
      <label class="mmc-field"><span>영어 키워드</span><textarea id="mmc-wc-en-${index}" rows="2">${esc(item.keywordsEn.join("\n"))}</textarea></label>
      <details class="mmc-source-quote"><summary>본문 미리보기 · 저장 후 자유롭게 편집할 수 있습니다</summary><div class="mmc-wiki-body">${item.sections.map((section) => `<h5>${esc(section.heading)}</h5>${wikiRenderMarkdown(section.body, item, [])}`).join("")}</div></details>
    </article>`;
  }
  function wikiCandidateLayer() {
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-wiki-candidates-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">WIKI REVIEW</span><h3>위키 초안 결과</h3><small>후보 ${state.wikiCandidates.length}개 · 선택한 문서만 저장됩니다</small></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <div class="mmc-candidate-toolbar"><b>${state.wikiCandidateSelected.size}/${state.wikiCandidates.length} 선택</b><div><button class="mmc-btn" data-action="wiki-candidate-all">전체 선택</button><button class="mmc-btn" data-action="wiki-candidate-none">전체 해제</button></div></div>
        ${state.wikiCandidates.length ? state.wikiCandidates.map(wikiCandidateRowMarkup).join("") : '<div class="mmc-empty">저장할 만한 문서 후보가 없습니다.</div>'}
      </div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="wiki-candidate-save" ${state.wikiCandidateSelected.size ? "" : "disabled"}>선택 ${state.wikiCandidateSelected.size}개 저장</button></div></footer>
    </section></div>`;
  }
  function wikiDiffMarkup(before, after) {
    const beforeLines = String(before || "").split("\n");
    const afterLines = String(after || "").split("\n");
    const beforeSet = new Set(beforeLines.map((line) => line.trim()));
    const afterSet = new Set(afterLines.map((line) => line.trim()));
    const removed = beforeLines.filter((line) => line.trim() && !afterSet.has(line.trim()));
    const added = afterLines.filter((line) => line.trim() && !beforeSet.has(line.trim()));
    return `<div class="mmc-wiki-diff">
      ${removed.length ? `<div class="mmc-wiki-diff-side is-before"><b>이전</b>${removed.map((line) => `<p>${esc(line)}</p>`).join("")}</div>` : ""}
      ${added.length ? `<div class="mmc-wiki-diff-side is-after"><b>제안</b>${added.map((line) => `<p>${esc(line)}</p>`).join("")}</div>` : ""}
      ${!removed.length && !added.length ? '<small class="mmc-wiki-muted">줄 단위 차이가 없습니다.</small>' : ""}
    </div>`;
  }
  function wikiProposalLayer() {
    const wiki = wikiState();
    const proposal = wikiProposalFor(state.wikiProposalDocId, wiki);
    if (!proposal) return "";
    const doc = wiki.docs.find((row) => row.id === proposal.docId);
    const stale = doc && proposal.baseUpdatedAt && doc.updatedAt !== proposal.baseUpdatedAt;
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-wiki-proposal-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">WIKI UPDATE</span><h3>${esc(proposal.docTitle || doc?.title || "변경 제안")}</h3><small>새 기억 ${proposal.sourceCount}건 기준 · 변경 ${proposal.changes.length}건</small></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <div class="mmc-candidate-note">반영을 누르기 전까지 문서는 바뀌지 않습니다. 사용자 편집 잠금 섹션은 반영 대상에서 제외됩니다.</div>
        ${stale ? '<div class="mmc-candidate-note mmc-warning-note">제안을 만든 뒤 문서를 직접 수정했습니다. 그 사이 바뀐 섹션은 덮어쓰지 않고 건너뜁니다.</div>' : ""}
        ${proposal.conflicts.length ? `<div class="mmc-setting-warning"><b>잠금 충돌 ${proposal.conflicts.length}건</b><small>${proposal.conflicts.map((row) => esc(row)).join("<br>")}</small></div>` : ""}
        <div class="mmc-candidate-toolbar"><b>${state.wikiProposalSelected.size}/${proposal.changes.length} 선택</b><div><button class="mmc-btn" data-action="wiki-proposal-all">전체 선택</button><button class="mmc-btn" data-action="wiki-proposal-none">전체 해제</button></div></div>
        ${proposal.changes.map((change, index) => `<article class="mmc-wiki-change ${state.wikiProposalSelected.has(String(index)) ? "is-selected" : ""}">
          <label class="mmc-wiki-change-head"><input type="checkbox" data-wiki-proposal-index="${index}" ${state.wikiProposalSelected.has(String(index)) ? "checked" : ""}><span class="mmc-type-chip">${change.kind === "summary" ? "개요" : change.kind === "add" ? "새 섹션" : "수정"}</span><b>${esc(change.heading)}</b></label>
          ${change.reason ? `<small class="mmc-wiki-muted">${esc(change.reason)}</small>` : ""}
          ${wikiDiffMarkup(change.before, change.after)}
        </article>`).join("") || '<div class="mmc-empty">적용할 변경사항이 없습니다.</div>'}
      </div>
      <footer><button class="mmc-btn" data-action="wiki-proposal-dismiss" data-id="${esc(proposal.docId)}">무시</button><div><button class="mmc-btn" data-action="close-layer">나중에</button><button class="mmc-btn mmc-primary" data-action="wiki-proposal-apply" ${state.wikiProposalSelected.size ? "" : "disabled"}>선택 ${state.wikiProposalSelected.size}건 반영</button></div></footer>
    </section></div>`;
  }
  function wikiSettingsLayer() {
    const wiki = wikiState();
    const theme = UI_THEMES.find((row) => row.id === state.uiThemeMode) || UI_THEMES[0];
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-settings-layer mmc-sheet" data-layer-stop>
      <header><div class="mmc-sheet-title"><span class="mmc-sheet-icon">${SVG.wiki}</span><h3>이야기 위키 설정</h3></div><button class="mmc-icon-btn" data-action="close-layer" aria-label="닫기">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <section class="mmc-set-card">
          <div class="mmc-set-head"><b>모양</b><small>위키는 보관함 테마를 그대로 써요. 테마를 바꾸면 보관함 전체가 함께 바뀌어요.</small></div>
          <div class="mmc-wiki-theme-link"><span class="mmc-swatch" data-tp="${theme.id}"></span><span><b>${esc(theme.label)}</b><small>보관함 전체 · 위키 링크·인포박스·목차 색 포함</small></span><button class="mmc-btn mmc-sm" data-action="open-theme-settings">바꾸기</button></div>
        </section>
        <section class="mmc-set-card">
          <div class="mmc-set-head"><b>RP에 쓰기</b></div>
          <label class="mmc-check-line"><input id="mmc-wiki-injection-enabled" type="checkbox" ${wiki.injectionEnabled ? "checked" : ""}><span><b>위키 문서를 전용 로어북으로 RP에 사용하기</b><small>키워드가 맞는 문서만 불러와요.</small></span></label>
          <label class="mmc-setting"><span><b>항상 기억 개요 예산</b><small>항상 기억으로 표시한 문서의 개요만 이 글자 수까지 상시 주입해요. 본문은 상시 주입하지 않아요. 300~6000자.</small></span><input id="mmc-wiki-always-budget" type="number" min="300" max="6000" step="100" value="${wiki.alwaysBudgetChars}"></label>
          <label class="mmc-setting mmc-setting-model"><span><b>위키 모델</b><small>비워 두면 보관함 기본 후보 모델을 써요.</small></span><select id="mmc-wiki-model">${wikiConnectionOptions(wiki)}</select></label>
          <div class="mmc-setting-warning"><b>세 가지 상태는 따로 동작해요</b><small><strong>AI 수정 잠금</strong>은 내용 변경만 막고 참조는 허용해요. <strong>AI 참조 제외</strong>는 RP 컨텍스트에서만 빼요. <strong>항상 기억</strong>은 개요 한 줄만 상시 주입해요.</small></div>
        </section>
        <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>초안 작성 지침</b><small>무엇을 어떤 문체로 문서화할지 정해요. JSON 출력 규칙은 확장이 따로 고정해요.</small></span><button class="mmc-btn mmc-sm" data-action="reset-wiki-draft-prompt">기본값 복원</button></div><textarea id="mmc-wiki-draft-prompt" rows="9">${esc(wiki.draftPrompt || DEFAULT_WIKI_DRAFT_PROMPT)}</textarea></section>
        <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>변경 제안 지침</b><small>새 기억이 생겼을 때 어디까지 고칠지 정해요. 잠금 섹션 보호는 확장이 강제해요.</small></span><button class="mmc-btn mmc-sm" data-action="reset-wiki-update-prompt">기본값 복원</button></div><textarea id="mmc-wiki-update-prompt" rows="8">${esc(wiki.updatePrompt || DEFAULT_WIKI_UPDATE_PROMPT)}</textarea></section>
        <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>위키 주입 지침</b><small>검색된 위키 문서를 모델이 어떻게 다룰지 정해요.</small></span><button class="mmc-btn mmc-sm" data-action="reset-wiki-injection-prompt">기본값 복원</button></div><textarea id="mmc-wiki-injection-prompt" rows="7">${esc(wiki.injectionPrompt || DEFAULT_WIKI_INJECTION_PROMPT)}</textarea></section>
      </div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="wiki-save-settings">저장</button></div></footer>
    </section></div>`;
  }


  function wikiEditableDraft(doc) {
    const copy = normalizeWikiDoc(JSON.parse(JSON.stringify(doc || {})));
    copy.relatedTitles = [];
    return copy;
  }
  async function saveWikiDoc() {
    captureWikiDraft();
    const draft = state.wikiDraft;
    if (!draft) throw new Error("편집 중인 문서가 없습니다.");
    if (!String(draft.title || "").trim()) throw new Error("문서 제목을 입력해 주세요.");

    // 길이 상한은 조용히 자르지 않는다. 초과분이 있으면 저장을 멈추고 어디가 얼마나 넘었는지 알린다.
    const overflow = [];
    const summaryLength = String(draft.summary || "").length;
    if (summaryLength > WIKI_SUMMARY_MAX) overflow.push(`한눈에 보는 개요: ${summaryLength.toLocaleString()}자 (상한 ${WIKI_SUMMARY_MAX.toLocaleString()}자)`);
    safeArray(draft.sections).forEach((section, index) => {
      const length = String(section.body || "").length;
      if (length > WIKI_SECTION_BODY_MAX) overflow.push(`${index + 1}. ${section.heading || "본문"}: ${length.toLocaleString()}자 (상한 ${WIKI_SECTION_BODY_MAX.toLocaleString()}자)`);
    });
    if (overflow.length) {
      throw new Error(`길이 상한을 넘은 곳이 ${overflow.length}군데 있어 저장하지 않았습니다. 입력한 내용은 그대로 남아 있습니다.\n${overflow.join(" / ")}`);
    }

    const sections = safeArray(draft.sections).map(normalizeWikiSection).filter(Boolean);
    if (!sections.length && !String(draft.summary || "").trim()) throw new Error("개요나 본문 섹션을 하나 이상 입력해 주세요.");
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const now = nowIso();
    const relatedDocIds = normalizeTextList(
      safeArray(draft.relatedTitles).map((title) => wikiFindByTitle(wiki.docs, title)?.id).filter(Boolean).filter((id) => id !== draft.id),
      24, 80,
    );
    let autoLocked = 0;
    if (draft.id) {
      const index = wiki.docs.findIndex((row) => row.id === draft.id);
      if (index < 0) throw new Error("수정할 문서를 찾지 못했습니다. 이미 삭제된 것 같습니다.");
      const previous = wiki.docs[index];
      const duplicate = wiki.docs.find((row) => row.id !== draft.id && wikiKey(row.title) === wikiKey(draft.title));
      if (duplicate) throw new Error("같은 제목의 문서가 이미 있습니다.");

      // 사용자가 AI 관리 섹션의 제목이나 본문을 직접 고쳤으면 그 섹션을 사용자 편집으로 잠근다.
      // 다만 이번 편집에서 관리 상태를 직접 바꿨다면 그 선택을 존중한다.
      const previousById = new Map(previous.sections.map((row) => [row.id, row]));
      for (const section of sections) {
        const before = previousById.get(section.id);
        if (!before) { if (section.managed !== "user") { section.managed = "user"; autoLocked += 1; } continue; }
        const modeChangedByUser = section.managed !== before.managed;
        if (modeChangedByUser) continue;
        if (before.managed !== "ai") continue;
        if (section.heading === before.heading && section.body === before.body) continue;
        section.managed = "user";
        section.updatedAt = now;
        autoLocked += 1;
      }
      let summaryManaged = draft.summaryManaged === "user" ? "user" : "ai";
      const summaryModeChangedByUser = summaryManaged !== previous.summaryManaged;
      if (!summaryModeChangedByUser && previous.summaryManaged === "ai" && String(draft.summary || "").trim() !== previous.summary) {
        summaryManaged = "user";
        autoLocked += 1;
      }

      wiki.docs[index] = normalizeWikiDoc({
        ...previous, ...draft, sections, relatedDocIds, summaryManaged,
        id: previous.id, createdAt: previous.createdAt, sources: previous.sources, aiUpdatedAt: previous.aiUpdatedAt, updatedAt: now,
      });
      state.wikiSelectedId = previous.id;
    } else {
      if (wiki.docs.length >= WIKI_DOC_LIMIT) throw new Error(`위키 문서는 최대 ${WIKI_DOC_LIMIT}개까지 보관할 수 있습니다.`);
      if (wikiFindByTitle(wiki.docs, draft.title)) throw new Error("같은 제목이나 별칭의 문서가 이미 있습니다.");
      const created = normalizeWikiDoc({ ...draft, id: uid("wdoc"), sections, relatedDocIds, sources: [], createdAt: now, updatedAt: now, aiUpdatedAt: "" });
      wiki.docs.push(created);
      state.wikiSelectedId = created.id;
    }
    wiki.originChatId = String(state.selectedChatId || "");
    data.wiki = wiki;
    await persistData(data, { silent: autoLocked > 0 });
    if (autoLocked) toast(`직접 고친 ${autoLocked}곳을 사용자 편집으로 잠갔습니다. AI 갱신이 덮어쓰지 않습니다.`);
    state.layer = null;
    state.wikiDraft = null;
    render();
  }
  async function toggleWikiFlag(docId, field) {
    if (!["aiLocked", "excludeFromContext", "alwaysRemember"].includes(field)) return;
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const doc = wiki.docs.find((row) => row.id === String(docId));
    if (!doc) throw new Error("문서를 찾지 못했습니다.");
    if (field === "alwaysRemember" && !doc.alwaysRemember && !doc.summary.trim()) throw new Error("항상 기억을 켜려면 한눈에 보는 개요를 먼저 채워 주세요.");
    doc[field] = !doc[field];
    doc.updatedAt = nowIso();
    data.wiki = wiki;
    await persistData(data, { silent: true });
    toast(field === "aiLocked" ? (doc.aiLocked ? "AI 수정 잠금을 켰습니다." : "AI 수정 잠금을 껐습니다.")
      : field === "excludeFromContext" ? (doc.excludeFromContext ? "이 문서를 RP 참조에서 제외했습니다." : "이 문서를 다시 RP 참조에 사용합니다.")
      : (doc.alwaysRemember ? "개요를 항상 기억으로 올렸습니다. 본문은 상시 주입하지 않습니다." : "항상 기억을 껐습니다."));
    render();
  }
  async function deleteWikiDoc(docId) {
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    const before = wiki.docs.length;
    wiki.docs = wiki.docs.filter((row) => row.id !== String(docId));
    if (wiki.docs.length === before) throw new Error("삭제할 문서를 찾지 못했습니다.");
    wiki.proposals = wiki.proposals.filter((row) => row.docId !== String(docId));
    for (const doc of wiki.docs) doc.relatedDocIds = doc.relatedDocIds.filter((id) => id !== String(docId));
    data.wiki = wiki;
    await persistData(data);
    if (state.wikiSelectedId === String(docId)) state.wikiSelectedId = "";
    state.layer = null;
    state.wikiDraft = null;
    render();
  }
  async function openWikiDraftLayer() {
    setBusy(true, "기존 기억을 불러오는 중…");
    try {
      state.wikiSourceRows = await collectWikiSourceRows();
      state.wikiSourceSelected = new Set(state.wikiSourceRows.filter((row) => ["element", "anchor", "promise"].includes(row.kind)).slice(0, 40).map((row) => String(row.id)));
      state.layer = "wiki-draft";
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }
  async function saveWikiSettings() {
    const data = await freshOwnedData();
    const wiki = normalizeWiki(data.wiki);
    wiki.connectionId = String(document.getElementById("mmc-wiki-model")?.value || "");
    wiki.injectionEnabled = !!document.getElementById("mmc-wiki-injection-enabled")?.checked;
    wiki.alwaysBudgetChars = Math.max(300, Math.min(6000, Number(document.getElementById("mmc-wiki-always-budget")?.value) || wiki.alwaysBudgetChars));
    wiki.draftPrompt = String(document.getElementById("mmc-wiki-draft-prompt")?.value || "").trim().slice(0, 8000);
    wiki.updatePrompt = String(document.getElementById("mmc-wiki-update-prompt")?.value || "").trim().slice(0, 8000);
    wiki.injectionPrompt = String(document.getElementById("mmc-wiki-injection-prompt")?.value || "").trim().slice(0, 8000);
    wiki.originChatId = String(state.selectedChatId || "");
    data.wiki = wiki;
    await persistData(data);
    state.layer = null;
    render();
  }
  function refreshWikiListDom() {
    const list = document.querySelector("[data-wiki-list]");
    if (!list) return;
    list.innerHTML = wikiListMarkup(wikiState());
  }

  async function handleWikiAction(action, actionEl) {
    if (action === "wiki-open") {
      const id = String(actionEl.dataset.id || "");
      if (!id) { toast("아직 만들어지지 않은 문서입니다."); return true; }
      // 문서에서 문서로 이동할 때만 되돌아갈 자리를 남긴다.
      if (state.wikiSelectedId && state.wikiSelectedId !== id) {
        state.wikiHistory = [...state.wikiHistory.filter((row) => row !== state.wikiSelectedId), state.wikiSelectedId].slice(-20);
      }
      state.wikiSelectedId = id;
      state.activeTab = "wiki";
      if (state.layer === "evidence") state.layer = null;
      await saveUiState();
      render();
      return true;
    }
    if (action === "wiki-filter") {
      const category = String(actionEl.dataset.category || "all");
      state.wikiCategoryFilter = category === "all" || Object.prototype.hasOwnProperty.call(WIKI_CATEGORY_LABEL, category) ? category : "all";
      await saveUiState();
      refreshWikiListDom();
      const select = document.getElementById("mmc-wiki-category-filter");
      if (select) select.value = state.wikiCategoryFilter;
      return true;
    }
    if (action === "wiki-back") {
      const previous = state.wikiHistory.pop();
      state.wikiSelectedId = previous && wikiState().docs.some((doc) => doc.id === previous) ? previous : "";
      render();
      return true;
    }
    if (action === "wiki-toggle-ko") { state.koDisplay = koDisplayOn() ? "original" : "auto"; await saveUiState(); render(); return true; }
    if (action === "wiki-toc") {
      const target = document.getElementById(String(actionEl.dataset.target || ""));
      target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return true;
    }
    if (action === "wiki-new") {
      state.wikiDraft = wikiEditableDraft({ id: "", title: "", sections: [normalizeWikiSection({ heading: "기본 정보", body: "", managed: "user" }), normalizeWikiSection({ heading: "현재 상황", body: "", managed: "ai" })] });
      state.wikiDraft.id = "";
      state.layer = "wiki-editor";
      render();
      return true;
    }
    if (action === "wiki-new-from-link") {
      const title = String(actionEl.dataset.title || "").trim();
      const seeded = seedKeywordsByScript(title);
      state.wikiDraft = wikiEditableDraft({ id: "", title, keywordsKo: seeded.ko, keywordsEn: seeded.en, sections: [normalizeWikiSection({ heading: "기본 정보", body: "", managed: "user", level: 1 })] });
      state.wikiDraft.id = "";
      state.layer = "wiki-editor";
      render();
      return true;
    }
    if (action === "wiki-edit") {
      const doc = wikiState().docs.find((row) => row.id === String(actionEl.dataset.id || ""));
      if (!doc) return true;
      state.wikiDraft = wikiEditableDraft(doc);
      state.layer = "wiki-editor";
      render();
      return true;
    }
    if (action === "wiki-add-section") {
      captureWikiDraft();
      if (!state.wikiDraft) return true;
      if (safeArray(state.wikiDraft.sections).length >= WIKI_SECTION_LIMIT) throw new Error(`섹션은 최대 ${WIKI_SECTION_LIMIT}개까지 만들 수 있습니다.`);
      state.wikiDraft.sections = [...safeArray(state.wikiDraft.sections), normalizeWikiSection({ heading: "새 섹션", body: "", managed: "user", level: 1 })];
      render();
      return true;
    }
    if (action === "wiki-remove-section") {
      captureWikiDraft();
      if (!state.wikiDraft) return true;
      const index = Number(actionEl.dataset.index);
      state.wikiDraft.sections = safeArray(state.wikiDraft.sections).filter((row, i) => i !== index);
      render();
      return true;
    }
    if (action === "wiki-add-image") {
      captureWikiDraft();
      if (!state.wikiDraft) return true;
      if (safeArray(state.wikiDraft.images).length >= WIKI_IMAGE_LIMIT) throw new Error(`이미지는 최대 ${WIKI_IMAGE_LIMIT}개까지 연결할 수 있습니다.`);
      state.wikiDraft.images = [...safeArray(state.wikiDraft.images), { id: uid("wimg"), url: "", alt: "", caption: "", lead: false }];
      render();
      return true;
    }
    if (action === "wiki-remove-image") {
      captureWikiDraft();
      if (!state.wikiDraft) return true;
      const index = Number(actionEl.dataset.index);
      state.wikiDraft.images = safeArray(state.wikiDraft.images).filter((row, i) => i !== index);
      render();
      return true;
    }
    if (action === "wiki-remove-source") {
      captureWikiDraft();
      if (!state.wikiDraft) return true;
      const index = Number(actionEl.dataset.index);
      state.wikiDraft.sources = safeArray(state.wikiDraft.sources).filter((row, i) => i !== index);
      render();
      return true;
    }
    if (action === "wiki-save") { await saveWikiDoc(); return true; }
    if (action === "wiki-delete") {
      const id = String(actionEl.dataset.id || state.wikiDraft?.id || "");
      if (!id || !window.confirm("이 위키 문서를 삭제할까요? 약속·앵커·요소 기억 원본은 그대로 남습니다.")) return true;
      await deleteWikiDoc(id);
      return true;
    }
    if (action === "wiki-toggle") { await toggleWikiFlag(actionEl.dataset.id, String(actionEl.dataset.field || "")); return true; }
    if (action === "wiki-settings") { state.layer = "wiki-settings"; render(); return true; }
    if (action === "wiki-save-settings") { await saveWikiSettings(); return true; }
    if (action === "reset-wiki-draft-prompt") { const box = document.getElementById("mmc-wiki-draft-prompt"); if (box) box.value = DEFAULT_WIKI_DRAFT_PROMPT; return true; }
    if (action === "reset-wiki-update-prompt") { const box = document.getElementById("mmc-wiki-update-prompt"); if (box) box.value = DEFAULT_WIKI_UPDATE_PROMPT; return true; }
    if (action === "reset-wiki-injection-prompt") { const box = document.getElementById("mmc-wiki-injection-prompt"); if (box) box.value = DEFAULT_WIKI_INJECTION_PROMPT; return true; }
    if (action === "wiki-draft-open") { await openWikiDraftLayer(); return true; }
    if (action === "wiki-source-all") { state.wikiSourceRows.forEach((row) => state.wikiSourceSelected.add(String(row.id))); render(); return true; }
    if (action === "wiki-source-none") { state.wikiSourceSelected.clear(); render(); return true; }
    if (action === "wiki-source-group") {
      const kind = String(actionEl.dataset.kind || "");
      const rows = state.wikiSourceRows.filter((row) => row.kind === kind);
      const allOn = rows.length > 0 && rows.every((row) => state.wikiSourceSelected.has(String(row.id)));
      rows.forEach((row) => { if (allOn) state.wikiSourceSelected.delete(String(row.id)); else state.wikiSourceSelected.add(String(row.id)); });
      render();
      return true;
    }
    if (action === "wiki-draft-run") {
      state.wikiDraftTopic = String(document.getElementById("mmc-wiki-draft-topic")?.value || "").trim().slice(0, 120);
      const chosen = String(document.getElementById("mmc-wiki-draft-model")?.value || "");
      if (chosen !== wikiState().connectionId) {
        const data = normalizeData(state.currentData);
        const wiki = normalizeWiki(data.wiki);
        wiki.connectionId = chosen;
        data.wiki = wiki;
        await persistData(data, { sync: false, silent: true });
      }
      await generateWikiDrafts();
      return true;
    }
    if (action === "wiki-candidate-all") { state.wikiCandidateSelected = new Set(state.wikiCandidates.map((row, index) => String(index))); render(); return true; }
    if (action === "wiki-candidate-none") { state.wikiCandidateSelected.clear(); render(); return true; }
    if (action === "wiki-candidate-save") { await applyWikiCandidates(); return true; }
    if (action === "wiki-propose") { await generateWikiProposal(actionEl.dataset.id); return true; }
    if (action === "wiki-proposal-open") {
      const proposal = wikiProposalFor(actionEl.dataset.id);
      if (!proposal) { toast("대기 중인 변경 제안이 없습니다."); return true; }
      state.wikiProposalDocId = String(actionEl.dataset.id || "");
      state.wikiProposalSelected = new Set(proposal.changes.map((row, index) => String(index)));
      state.layer = "wiki-proposal";
      render();
      return true;
    }
    if (action === "wiki-proposal-all") {
      const proposal = wikiProposalFor(state.wikiProposalDocId);
      state.wikiProposalSelected = new Set(safeArray(proposal?.changes).map((row, index) => String(index)));
      render();
      return true;
    }
    if (action === "wiki-proposal-none") { state.wikiProposalSelected.clear(); render(); return true; }
    if (action === "wiki-proposal-apply") { await applyWikiProposal(); return true; }
    if (action === "wiki-proposal-dismiss") {
      const id = String(actionEl.dataset.id || state.wikiProposalDocId || "");
      if (!window.confirm("이 변경 제안을 무시할까요? 문서는 그대로 두고 같은 기억으로 다시 알리지 않습니다.")) return true;
      await dismissWikiProposal(id);
      return true;
    }
    if (action === "wiki-source") {
      state.evidenceView = { kind: "wiki", id: String(actionEl.dataset.id || ""), index: Number(actionEl.dataset.index) || 0 };
      state.layer = "evidence";
      render();
      return true;
    }
    return false;
  }
  async function handleWikiChange(target) {
    if (target?.id === "mmc-wiki-category-filter") {
      state.wikiCategoryFilter = String(target.value || "all");
      await saveUiState();
      refreshWikiListDom();
      return true;
    }
    if (target?.matches?.("[data-wiki-source-id]")) {
      const id = String(target.dataset.wikiSourceId || "");
      if (target.checked) state.wikiSourceSelected.add(id); else state.wikiSourceSelected.delete(id);
      render();
      return true;
    }
    if (target?.matches?.("[data-wiki-candidate-index]")) {
      const id = String(target.dataset.wikiCandidateIndex || "");
      if (target.checked) state.wikiCandidateSelected.add(id); else state.wikiCandidateSelected.delete(id);
      const row = target.closest?.(".mmc-wiki-candidate");
      if (row) row.classList.toggle("is-selected", !!target.checked);
      const button = document.querySelector('[data-action="wiki-candidate-save"]');
      if (button) { button.disabled = state.wikiCandidateSelected.size <= 0; button.textContent = `선택 ${state.wikiCandidateSelected.size}개 저장`; }
      return true;
    }
    if (target?.matches?.("[data-wiki-proposal-index]")) {
      const id = String(target.dataset.wikiProposalIndex || "");
      if (target.checked) state.wikiProposalSelected.add(id); else state.wikiProposalSelected.delete(id);
      const row = target.closest?.(".mmc-wiki-change");
      if (row) row.classList.toggle("is-selected", !!target.checked);
      const button = document.querySelector('[data-action="wiki-proposal-apply"]');
      if (button) { button.disabled = state.wikiProposalSelected.size <= 0; button.textContent = `선택 ${state.wikiProposalSelected.size}건 반영`; }
      return true;
    }
    return false;
  }
  function handleWikiInput(target) {
    const countFor = target?.dataset?.wikiCountFor;
    if (countFor) {
      const note = document.querySelector(`[data-wiki-count="${countFor}"]`);
      if (note) {
        const max = Number(note.dataset.wikiCountMax) || 0;
        const length = String(target.value || "").length;
        note.classList.toggle("is-over", max > 0 && length > max);
        note.textContent = `${length.toLocaleString()} / ${max.toLocaleString()}자${max > 0 && length > max ? ` · ${(length - max).toLocaleString()}자 초과` : ""}`;
      }
      return true;
    }
    if (target?.id !== "mmc-wiki-search") return false;
    state.wikiSearch = String(target.value || "");
    refreshWikiListDom();
    return true;
  }

  function relTime(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    const diff = Math.max(0, Date.now() - time);
    const min = Math.floor(diff / 60000);
    if (min < 1) return "방금";
    if (min < 60) return `${min}분 전`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}시간 전`;
    const day = Math.floor(hour / 24);
    if (day < 7) return `${day}일 전`;
    return sourceDate(value);
  }
  function tabCounts() {
    const rows = safeArray(state.currentData?.items);
    return {
      overview: 0,
      promise: rows.filter((item) => item.type === "promise" && item.status === "active").length,
      anchor: rows.filter((item) => item.type === "anchor").length,
      element: elementMemory().entities.length,
      wiki: wikiState().docs.length,
    };
  }
  function tabMeta() {
    return [
      { id: "overview", label: "개요", short: "개요", icon: SVG.overview },
      { id: "promise", label: "약속", short: "약속", icon: SVG.promise },
      { id: "anchor", label: "기억 앵커", short: "앵커", icon: SVG.anchor },
      { id: "element", label: "요소 기억", short: "요소", icon: SVG.element },
      { id: "wiki", label: "이야기 위키", short: "위키", icon: SVG.wiki },
    ];
  }
  function inboxRows() {
    const rows = [];
    const data = state.currentData;
    if (!data || !ownershipAllowsData()) return rows;
    if (state.reviewSourceRows.length) {
      rows.push({ tone: "accent", title: `모델 분석 완료 · 갱신 후보 ${state.reviewCandidates.length}개`, sub: "아직 보관함에는 적용되지 않았어요", actions: [["open-review-draft", "결과 확인", "", true]] });
    } else if (state.pendingSummaryRows.length) {
      const advanced = advancedMemoryEnabled();
      const modeText = advanced ? "고급 메모리 보호 모드 · 수동 확인" : (SUMMARY_UPDATE_MODE_LABEL[state.summaryUpdateMode] || "알림 + 모델 정리 버튼");
      const actions = [["review-pending", "내용 확인", "", false]];
      if (state.summaryUpdateMode !== "notify_only") actions.push(["review-model", "모델로 정리", "", true]);
      rows.push({ tone: "accent", title: `새 요약 ${state.pendingSummaryRows.length}개 · 기억 갱신이 필요해요`, sub: `${modeText} · 요약은 아직 약속·앵커에 반영되지 않았어요`, actions });
    }
    const undo = data.lastAutoReviewUndo;
    if (undo) {
      const count = safeArray(undo.updated).length + safeArray(undo.created).length;
      rows.push({ tone: "warn", title: `직전 자동 적용 ${count}개를 되돌릴 수 있어요`, sub: "자동 적용 뒤 직접 고친 기록은 건너뜁니다", actions: [["undo-auto-review", "되돌리기", "", false]] });
    }
    const wiki = wikiState();
    for (const proposal of wiki.proposals.slice(0, 3)) {
      const doc = wiki.docs.find((row) => row.id === proposal.docId);
      rows.push({ tone: "accent2", title: `위키 ‘${truncate(doc?.title || proposal.docTitle || "문서", 24)}’ 변경 제안 ${proposal.changes.length}건`, sub: `새 기억 ${proposal.sourceCount}건 기준${proposal.conflicts.length ? ` · 잠금 충돌 ${proposal.conflicts.length}건` : ""}`, actions: [["wiki-proposal-open", "보기", proposal.docId, false]] });
    }
    const plan = anchorInjectionPlan();
    if (plan.excluded.length) rows.push({ tone: "warn", title: `앵커 ${plan.excluded.length}개가 예산 때문에 대기 중`, sub: `항상 기억 ${plan.used.toLocaleString()} / ${plan.budget.toLocaleString()}자 · 지워지지는 않아요`, actions: [["tab", "앵커 보기", "anchor", false]] });
    const keywordless = safeArray(data.items).filter((item) => item.type === "anchor" && item.active && !item.archived && item.activation === "keyword" && !safeArray(item.keywords).length).length;
    if (keywordless) rows.push({ tone: "warn", title: `키워드 없는 키워드 앵커 ${keywordless}개`, sub: "키워드가 없으면 떠오르지 않아요", actions: [["tab", "앵커 보기", "anchor", false]] });
    const memory = elementMemory();
    const noCond = memory.entities.filter((entity) => !elementTriggerConditions(entity).length).length;
    if (noCond) rows.push({ tone: "muted", title: `검색 조건 없는 요소 ${noCond}개`, sub: "호출어를 넣어야 RP에서 불러올 수 있어요", actions: [["tab", "요소 보기", "element", false]] });
    return rows;
  }
  function inboxMarkup() {
    const rows = inboxRows();
    return `<section class="mmc-card mmc-inbox">
      <header class="mmc-card-head"><b>검토 대기</b>${rows.length ? `<em class="mmc-count">${rows.length}</em>` : ""}</header>
      ${rows.length ? rows.map((row) => `<div class="mmc-inbox-row is-${row.tone}"><span class="mmc-inbox-icon">${row.tone === "warn" ? SVG.warn : SVG.inbox}</span><span class="mmc-inbox-copy"><b>${esc(row.title)}</b><small>${esc(row.sub)}</small></span><span class="mmc-inbox-actions">${row.actions.map(([action, label, value, primary]) => `<button class="mmc-btn mmc-sm ${primary ? "mmc-primary" : "mmc-soft"}" data-action="${action}" ${action === "tab" ? `data-tab="${esc(value)}"` : value ? `data-id="${esc(value)}"` : ""}>${esc(label)}</button>`).join("")}</span></div>`).join("") : `<div class="mmc-inbox-empty">${SVG.inbox}<b>검토할 것이 없어요</b><small>새 요약이나 위키 변경 제안이 생기면 여기에 모여요.</small></div>`}
    </section>`;
  }
  function injectionSummary() {
    const data = state.currentData;
    const chat = state.currentChat;
    const promises = activePromises().slice(0, data.maxPromises);
    const plan = anchorInjectionPlan();
    const wiki = wikiState();
    const wikiAlways = wiki.injectionEnabled ? wikiAlwaysDocs(wiki) : [];
    const memory = elementMemory();
    const keywordAnchors = activeKeywordAnchors().length;
    const elementConds = memory.injectionEnabled ? memory.entities.filter((entity) => elementTriggerConditions(entity).length).length : 0;
    const wikiConds = wiki.docs.filter((doc) => wikiDocInjectable(doc, wiki)).length;
    const parts = [
      { id: "promise", label: "약속 · 진행 중", count: promises.length, text: promises.length ? promiseContext(chat, data) : "" },
      { id: "anchor", label: "항상 앵커", count: plan.selected.length, text: plan.selected.length ? anchorContext(chat, data) : "" },
      { id: "wiki", label: "위키 개요", count: wikiAlways.length, text: wikiAlways.length ? wikiAlwaysContext(chat, wiki) : "" },
    ].map((part) => ({ ...part, tokens: part.text ? estimateTokens(part.text) : 0 }));
    return { parts, total: parts.reduce((sum, part) => sum + part.tokens, 0), keywordAnchors, elementConds, wikiConds, conditional: keywordAnchors + elementConds + wikiConds, plan };
  }
  function injectMarkup() {
    const info = injectionSummary();
    const data = state.currentData;
    const syncError = data?.lastSyncError;
    return `<section class="mmc-card mmc-inject">
      <div class="mmc-inject-head">
        <div><span class="mmc-eyebrow">매 턴 RP에 늘 들어가는 기억</span><strong>${info.total.toLocaleString()}<small>tokens (약)</small></strong></div>
        <span class="mmc-pill ${syncError ? "is-bad" : data.lorebookId || data.lastSyncAt ? "is-ok" : ""}">${syncError ? "동기화 확인 필요" : data.lorebookId || data.lastSyncAt ? "주입 켜짐" : "아직 동기화 전"}</span>
      </div>
      <div class="mmc-meter" role="img" aria-label="주입 구성">${info.total ? info.parts.filter((part) => part.tokens).map((part) => `<i class="is-${part.id}" style="flex:${part.tokens}"></i>`).join("") : "<i class=\"is-empty\"></i>"}</div>
      <ul class="mmc-legend">${info.parts.map((part) => `<li class="is-${part.id}"><i></i>${esc(part.label)} <b>${part.count}</b></li>`).join("")}<li class="is-cond"><i></i>조건부 (키워드가 나올 때) <b>${info.conditional}</b></li></ul>
      <div class="mmc-inject-foot">
        <small>${SVG.info}<span>조건부: 앵커 키워드 ${info.keywordAnchors} · 요소 ${info.elementConds} · 위키 ${info.wikiConds} · 앵커 예산 ${info.plan.used.toLocaleString()} / ${info.plan.budget.toLocaleString()}자</span></small>
        <button class="mmc-btn mmc-sm mmc-ghost" data-action="inject-preview">${SVG.eye}<span>주입 미리보기</span></button>
      </div>
    </section>`;
  }
  function statCards() {
    const rows = safeArray(state.currentData?.items);
    const promises = rows.filter((item) => item.type === "promise");
    const anchors = rows.filter((item) => item.type === "anchor");
    const plan = anchorInjectionPlan();
    const memory = elementMemory();
    const wiki = wikiState();
    const cards = [
      ["promise", SVG.promise, "약속", promises.filter((item) => item.status === "active").length, `진행 중 · 전체 ${promises.length}`],
      ["anchor", SVG.anchor, "기억 앵커", plan.selected.length + activeKeywordAnchors().length, `주입 중 · 전체 ${anchors.length}`],
      ["element", SVG.element, "요소 기억", memory.entities.length, `검색 가능 ${memory.entities.filter((entity) => elementTriggerConditions(entity).length).length}`],
      ["wiki", SVG.wiki, "이야기 위키", wiki.docs.length, `항상 기억 ${wikiAlwaysDocs(wiki).length} · 제안 ${wiki.proposals.length}`],
    ];
    return `<div class="mmc-stats">${cards.map(([tab, icon, label, value, sub]) => `<button class="mmc-stat" data-action="tab" data-tab="${tab}"><span class="mmc-stat-top"><i>${icon}</i><span>${label}</span></span><b>${value}</b><small>${esc(sub)}</small></button>`).join("")}</div>`;
  }
  function timelineMarkup() {
    const rows = [];
    for (const item of safeArray(state.currentData?.items)) rows.push({ kind: item.type, icon: item.type === "promise" ? SVG.promise : SVG.anchor, title: displayText(item.title, item.titleKo), label: item.type === "promise" ? "약속" : "기억 앵커", at: item.updatedAt || item.createdAt, created: item.createdAt && item.createdAt === item.updatedAt, action: "edit-item", id: item.id });
    for (const entity of elementMemory().entities) rows.push({ kind: "element", icon: SVG.element, title: displayText(entity.name, entity.nameKo), label: "요소 기억", at: entity.updatedAt || entity.createdAt, created: entity.createdAt && entity.createdAt === entity.updatedAt, action: "edit-element", id: entity.id });
    for (const doc of wikiState().docs) rows.push({ kind: "wiki", icon: SVG.wiki, title: displayText(doc.title, doc.titleKo), label: "위키 문서", at: doc.updatedAt || doc.createdAt, created: doc.createdAt && doc.createdAt === doc.updatedAt, action: "wiki-open", id: doc.id });
    const list = rows.filter((row) => row.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
    return `<section class="mmc-card mmc-timeline">
      <header class="mmc-card-head"><b>최근 변화</b></header>
      ${list.length ? `<ol>${list.map((row) => `<li><button data-action="${row.action}" data-id="${esc(row.id)}"><i class="is-${row.kind}">${row.icon}</i><span><b>${esc(truncate(row.title, 48))}</b><small>${row.label} · ${row.created ? "추가" : "수정"}</small></span><time>${esc(relTime(row.at))}</time></button></li>`).join("")}</ol>` : '<div class="mmc-empty">아직 기록이 없어요.</div>'}
    </section>`;
  }
  function overviewView() {
    return `<div class="mmc-overview">
      <div data-mmc-summary-alert-slot>${statusBanners()}</div>
      <div class="mmc-ov-grid">${injectMarkup()}${inboxMarkup()}</div>
      ${statCards()}
      ${timelineMarkup()}
    </div>`;
  }
  function injectPreviewLayer() {
    const info = injectionSummary();
    const blocks = info.parts.filter((part) => part.text).map((part) => `<section class="mmc-preview-block is-${part.id}"><header><b>${esc(part.label)}</b><small>${part.count}개 · 약 ${part.tokens.toLocaleString()} tokens</small></header><pre>${esc(part.text)}</pre></section>`).join("");
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-preview-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">INJECTION PREVIEW</span><h3>RP에 늘 들어가는 기억</h3><small>전용 로어북에 이 내용이 상시 항목으로 들어가요. 조건부 항목은 키워드가 나올 때만 붙어요.</small></div><button class="mmc-icon-btn" data-action="close-layer" aria-label="닫기">${SVG.close}</button></header>
      <div class="mmc-layer-body">${blocks || '<div class="mmc-empty">지금은 상시로 들어가는 기억이 없어요.</div>'}<div class="mmc-candidate-note">조건부 · 앵커 키워드 ${info.keywordAnchors}개 · 요소 기억 ${info.elementConds}개 · 위키 문서 ${info.wikiConds}개는 대화에 키워드가 나올 때만 붙습니다.</div></div>
      <footer><button class="mmc-btn" data-action="sync" ${ownershipAllowsData() ? "" : "disabled"}>${SVG.sync}<span>다시 동기화</span></button><div><button class="mmc-btn mmc-primary" data-action="close-layer">확인</button></div></footer>
    </section></div>`;
  }

  function filteredItems(type) {
    const items = safeArray(state.currentData?.items).filter((item) => item.type === type).sort(prioritySort);
    if (type === "promise") {
      if (state.filter === "active") return items.filter((item) => item.status === "active");
      if (state.filter === "hold") return items.filter((item) => item.status === "hold");
      if (state.filter === "done") return items.filter((item) => ["done", "cancelled"].includes(item.status));
      return items;
    }
    if (state.filter === "archived") return items.filter((item) => item.archived);
    if (state.filter === "active") return items.filter((item) => item.active && !item.archived);
    return items;
  }

  function promiseLine(item) {
    const schedule = item.scheduleText ? ` / 예정: ${truncate(item.scheduleText, 90)}` : "";
    return `- ${item.priority === "high" ? "[중요] " : ""}${truncate(item.title, 90)}: ${truncate(item.content, 320)}${schedule}`;
  }
  function promiseRow(item, index = 0) {
    const checked = item.status === "done";
    const selected = item.id === state.promiseSelectedId;
    const chips = [
      item.scheduleText ? `<span class="mmc-chip">${esc(truncate(item.scheduleText, 28))}</span>` : "",
      item.status !== "active" ? `<span class="mmc-chip is-${item.status}">${esc(PROMISE_STATUS_LABEL[item.status] || item.status)}${item.status === "done" && item.updatedAt ? ` · ${esc(sourceDate(item.updatedAt).split(" ")[0] || "")}` : ""}</span>` : "",
      item.sourceType === "summary" || item.sourceType === "model" ? '<span class="mmc-chip is-soft">요약에서</span>' : item.sourceType === "manual" ? '<span class="mmc-chip is-soft">직접 추가</span>' : "",
    ].join("");
    return `<article class="mmc-ticket prio-${esc(item.priority || "normal")} is-${esc(item.status)} ${selected ? "is-selected" : ""}" data-item-id="${esc(item.id)}">
      <button class="mmc-check ${checked ? "is-checked" : ""}" data-action="toggle-promise-done" data-id="${esc(item.id)}" title="${checked ? "다시 진행 중" : "완료로 표시"}" aria-label="${checked ? "다시 진행 중" : "완료로 표시"}">${checked ? "✓" : ""}</button>
      <button class="mmc-ticket-main" data-action="promise-open" data-id="${esc(item.id)}">
        <b>${esc(displayText(item.title, item.titleKo))}</b>
        <small>${esc(truncate(displayText(item.content, item.contentKo), 90))}</small>
        ${chips ? `<span class="mmc-chips">${chips}</span>` : ""}
      </button>
      <span class="mmc-ticket-no">${String(index + 1).padStart(2, "0")}</span>
    </article>`;
  }


  function anchorRow(item) {
    const checked = item.active && !item.archived;
    const plan = anchorInjectionPlan();
    const injectedAlways = item.activation !== "always" || plan.selected.some((row) => row.id === item.id);
    const mode = item.archived ? "보관" : !item.active ? "꺼짐" : item.activation === "keyword" ? (safeArray(item.keywords).length ? "키워드" : "키워드 없음") : injectedAlways ? "주입 중" : "예산 대기";
    const lifespan = ANCHOR_LIFESPAN_LABEL[item.lifespan] || ANCHOR_LIFESPAN_LABEL.permanent;
    const evidence = item.sourceQuote || safeArray(item.sourceIds).length;
    const wait = checked && item.activation === "always" && !injectedAlways;
    const keywords = item.activation === "keyword" && safeArray(item.keywords).length ? `<span class="mmc-kw">${item.keywords.slice(0, 6).map((word) => `<i>${esc(word)}</i>`).join("")}</span>` : "";
    return `<article class="mmc-anchor ${!checked ? "is-muted" : ""} ${wait ? "is-budget-wait" : ""} prio-${esc(item.priority || "normal")}" data-item-id="${esc(item.id)}">
      <button class="mmc-check mmc-pin-check ${checked ? "is-checked" : ""}" data-action="toggle-anchor-active" data-id="${esc(item.id)}" title="${checked ? "주입 끄기" : "주입 켜기"}" aria-label="${checked ? "주입 끄기" : "주입 켜기"}">${checked ? "•" : ""}</button>
      <button class="mmc-anchor-main" data-action="edit-item" data-id="${esc(item.id)}">
        <b>${esc(displayText(item.title, item.titleKo))}</b>
        <small>${esc(truncate(displayText(item.content, item.contentKo), 150))}</small>
        ${keywords}
        <span class="mmc-chips"><span class="mmc-chip">${esc(ANCHOR_CATEGORY_LABEL[item.category] || "기억")}</span><span class="mmc-chip ${wait || mode === "키워드 없음" ? "is-warn" : mode === "주입 중" || mode === "키워드" ? "is-ok" : ""}">${mode}</span><span class="mmc-chip is-soft">${esc(lifespan)}</span>${item.priority === "high" ? '<span class="mmc-chip is-high">중요</span>' : ""}</span>
      </button>
      <span class="mmc-anchor-side">${evidence ? `<button class="mmc-evidence-link" data-action="view-evidence" data-kind="item" data-id="${esc(item.id)}">근거</button>` : ""}<button class="mmc-mini" data-action="anchor-move" data-id="${esc(item.id)}" title="${item.activation === "keyword" ? "항상 기억으로 옮기기" : "키워드로 떠오름으로 옮기기"}">${item.activation === "keyword" ? "항상으로" : "키워드로"}</button></span>
    </article>`;
  }


  function promiseDetail(item) {
    if (!item) return `<div class="mmc-detail-empty">${SVG.promise}<b>약속을 골라 주세요</b><small>왼쪽 목록에서 약속을 누르면 상세와 RP에 들어가는 문장이 보여요.</small></div>`;
    const data = state.currentData;
    const injected = activePromises().slice(0, data.maxPromises).some((row) => row.id === item.id);
    const evidence = item.sourceQuote || safeArray(item.sourceIds).length;
    const sourceLabel = item.sourceType === "summary" ? "요약에서" : item.sourceType === "model" ? "모델 정리" : item.sourceType === "message" ? "대화에서" : "직접 추가";
    return `<header class="mmc-detail-head">
        <button class="mmc-btn mmc-sm mmc-ghost mmc-m-only" data-action="promise-back">${SVG.back}<span>목록</span></button>
        <span class="mmc-chips">${item.priority === "high" ? '<span class="mmc-chip is-high">중요</span>' : ""}<span class="mmc-chip is-soft">${sourceLabel}</span></span>
        <h3>${esc(displayText(item.title, item.titleKo))}</h3>
      </header>
      <div class="mmc-stepper" role="group" aria-label="약속 상태">${Object.entries(PROMISE_STATUS_LABEL).map(([id, label]) => `<button class="${item.status === id ? "is-on" : ""} is-${id}" data-action="promise-status" data-id="${esc(item.id)}" data-status="${id}">${label}</button>`).join("")}</div>
      <section class="mmc-detail-sec"><span class="mmc-label">내용</span><p class="mmc-detail-body">${esc(displayText(item.content, item.contentKo))}</p></section>
      <div class="mmc-kv"><div><span>예정·조건</span><b>${esc(item.scheduleText || "정하지 않음")}</b></div><div><span>중요도</span><b>${esc(PRIORITY_LABEL[item.priority] || "보통")}</b></div><div><span>최근 수정</span><b>${esc(sourceDate(item.updatedAt) || "-")}</b></div></div>
      ${evidence ? `<section class="mmc-detail-sec"><span class="mmc-label">근거</span>${item.sourceQuote ? `<blockquote class="mmc-quote">${esc(truncate(item.sourceQuote, 260))}</blockquote>` : ""}<button class="mmc-evidence-link" data-action="view-evidence" data-kind="item" data-id="${esc(item.id)}">근거 전체 보기</button></section>` : ""}
      <section class="mmc-detail-sec"><span class="mmc-label">RP에 이렇게 들어가요</span><pre class="mmc-inject-pre ${injected ? "" : "is-off"}">${injected ? esc(promiseLine(item)) : item.status === "active" ? "상시 주입 상한 밖이라 지금은 들어가지 않아요. (설정 › 약속 상시 주입 상한)" : "진행 중인 약속만 RP에 들어가요."}</pre></section>
      <footer class="mmc-detail-foot"><button class="mmc-btn" data-action="edit-item" data-id="${esc(item.id)}">${SVG.edit}<span>편집</span></button><button class="mmc-btn mmc-ghost mmc-danger-text" data-action="delete-item" data-id="${esc(item.id)}">${SVG.trash}<span>삭제</span></button></footer>`;
  }
  function promiseView() {
    const all = safeArray(state.currentData?.items).filter((item) => item.type === "promise");
    const items = filteredItems("promise");
    if (!items.some((item) => item.id === state.promiseSelectedId)) state.promiseSelectedId = items[0]?.id || "";
    const selected = items.find((item) => item.id === state.promiseSelectedId) || null;
    const count = (filter) => filter === "active" ? all.filter((item) => item.status === "active").length : filter === "hold" ? all.filter((item) => item.status === "hold").length : filter === "done" ? all.filter((item) => ["done", "cancelled"].includes(item.status)).length : all.length;
    const pane = state.promisePane === "detail" && selected ? "detail" : "list";
    return `<div data-mmc-summary-alert-slot>${statusBanners()}</div>
      <div class="mmc-split" data-pane="${pane}">
        <section class="mmc-card mmc-listpane">
          ${filterBar(count)}
          <div class="mmc-tickets">${items.length ? items.map((item, index) => promiseRow(item, index)).join("") : `<div class="mmc-empty">${all.length ? "이 상태의 약속이 없어요." : "아직 보관된 약속이 없어요.<br>직접 추가하거나 대화에서 가져와 보세요."}</div>`}</div>
          <footer class="mmc-listpane-foot">${mainActions()}</footer>
        </section>
        <section class="mmc-card mmc-detail">${promiseDetail(selected)}</section>
      </div>`;
  }
  function anchorView() {
    const items = filteredItems("anchor");
    const always = items.filter((item) => item.activation !== "keyword");
    const keyword = items.filter((item) => item.activation === "keyword");
    const all = safeArray(state.currentData?.items).filter((item) => item.type === "anchor");
    const count = (filter) => filter === "active" ? all.filter((item) => item.active && !item.archived).length : filter === "archived" ? all.filter((item) => item.archived).length : all.length;
    const lane = (kind, rows, title, help, icon) => `<section class="mmc-lane is-${kind}"><header><i>${icon}</i><span><b>${title}</b><small>${help}</small></span><em class="mmc-count">${rows.length}</em></header><div class="mmc-lane-list">${rows.length ? rows.map(anchorRow).join("") : `<div class="mmc-empty">${kind === "always" ? "항상 기억할 앵커가 없어요." : "키워드로 떠오를 앵커가 없어요."}</div>`}</div></section>`;
    return `<div data-mmc-summary-alert-slot>${statusBanners()}</div>
      ${anchorBudgetPanel()}
      <div class="mmc-toolbar">${filterBar(count)}${mainActions()}</div>
      <div class="mmc-lanes">
        ${lane("always", always, "항상 기억", "예산 안에서 매 턴 들어가요 · 중요도·최근 수정 순", SVG.pin)}
        ${lane("keyword", keyword, "키워드로 떠오름", "대화에 키워드가 나올 때만 들어가요", SVG.search)}
      </div>`;
  }


  function filterBar(count = null) {
    const options = state.activeTab === "promise"
      ? [["active", "진행 중"], ["hold", "보류"], ["done", "완료"], ["all", "전체"]]
      : [["active", "사용 중"], ["archived", "보관됨"], ["all", "전체"]];
    return `<div class="mmc-seg" role="tablist">${options.map(([id, label]) => `<button class="mmc-filter ${state.filter === id ? "is-active" : ""}" data-action="set-filter" data-filter="${id}">${label}${count ? ` <i>${count(id)}</i>` : ""}</button>`).join("")}</div>`;
  }


  function anchorBudgetPanel() {
    const plan = anchorInjectionPlan();
    const keywordCount = activeKeywordAnchors().length;
    const pct = Math.min(100, Math.round((plan.used / Math.max(1, plan.budget)) * 100));
    const over = plan.excluded.length > 0;
    return `<section class="mmc-card mmc-budget ${over ? "is-over" : ""}">
      <div class="mmc-budget-head"><div><b>작업기억 예산</b><small>항상 기억 ${plan.used.toLocaleString()} / ${plan.budget.toLocaleString()}자 · 실제 주입 ${plan.selected.length}/${plan.candidates.length}개${keywordCount ? ` · 키워드 ${keywordCount}개 별도` : ""}</small></div><strong>${pct}%</strong><button class="mmc-btn mmc-sm" data-action="health-check">${SVG.spark}<span>기억 건강검진</span></button></div>
      <div class="mmc-budget-track"><i style="width:${pct}%"></i></div>
      ${over ? `<small class="mmc-budget-warning">상한 또는 예산 때문에 ${plan.excluded.length}개가 상시 주입에서 대기 중이에요. 지워지지는 않고, 중요도·최근 수정 순서로 주입할 기억을 고릅니다.</small>` : ""}
    </section>`;
  }


  function mainActions() {
    if (state.activeTab === "promise") return `<div class="mmc-actions">
      <button class="mmc-btn mmc-primary" data-action="new-item" data-type="promise">${SVG.plus}<span>직접 추가</span></button>
      <button class="mmc-btn" data-action="open-source" data-source="messages" data-target="promise">${SVG.message}<span>대화에서 가져오기</span></button>
    </div>`;
    return `<div class="mmc-actions">
      <button class="mmc-btn mmc-primary" data-action="new-item" data-type="anchor">${SVG.plus}<span>직접 추가</span></button>
      <button class="mmc-btn" data-action="open-source" data-source="summaries" data-target="anchor">${SVG.summary}<span>요약에서</span></button>
      <button class="mmc-btn" data-action="open-source" data-source="messages" data-target="anchor">${SVG.message}<span>대화에서</span></button>
    </div>`;
  }


  function chatOptions() {
    return state.chats.map((chat) => `<option value="${esc(chat.id)}" ${chat.id === state.selectedChatId ? "selected" : ""}>${esc(chatSelectLabel(chat))}</option>`).join("");
  }

  function pendingSummaryBanner() {
    const count = state.pendingSummaryRows.length;
    const ready = state.reviewSourceRows.length > 0;
    if (ready) {
      return `<section class="mmc-summary-alert is-ready"><span class="mmc-alert-icon">${SVG.inbox}</span><div><b>모델 분석 완료 · 갱신 후보 ${state.reviewCandidates.length}개</b><small>아직 보관함에는 적용되지 않았어요. 결과를 확인한 뒤 골라서 적용하거나 검토 완료로 표시하세요.</small></div><div><button class="mmc-btn mmc-sm mmc-primary" data-action="open-review-draft">결과 확인</button></div></section>`;
    }
    if (!count) return "";
    const advanced = advancedMemoryEnabled();
    const modelButton = state.summaryUpdateMode === "notify_only" ? "" : `<button class="mmc-btn mmc-sm mmc-model-btn" data-action="review-model">${SVG.spark}<span>모델로 통합 정리</span></button>`;
    const modeText = advanced ? "고급 메모리 보호 모드 · 자동 처리 없이 수동 확인" : (SUMMARY_UPDATE_MODE_LABEL[state.summaryUpdateMode] || "알림 + 모델 정리 버튼");
    return `<section class="mmc-summary-alert"><span class="mmc-alert-icon">${SVG.inbox}</span><div><b>새 요약 ${count}개 · 기억 갱신이 필요해요</b><small>${esc(modeText)} · 요약 내용은 아직 약속/앵커에 반영되지 않았어요.</small></div><div><button class="mmc-btn mmc-sm" data-action="review-pending">내용 확인</button>${modelButton}</div></section>`;
  }


  function autoUndoBanner() {
    const undo = state.currentData?.lastAutoReviewUndo;
    if (!undo) return "";
    const count = safeArray(undo.updated).length + safeArray(undo.created).length;
    return `<section class="mmc-summary-alert mmc-undo-alert"><span class="mmc-alert-icon">${SVG.warn}</span><div><b>직전 자동 적용 ${count}개를 되돌릴 수 있어요</b><small>자동 적용 뒤 직접 수정한 기록은 덮어쓰지 않고 건너뜁니다.</small></div><div><button class="mmc-btn mmc-sm" data-action="undo-auto-review">자동 적용 되돌리기</button></div></section>`;
  }


  // Marinara-only agents do not exist in SillyTavern.
  async function refreshAgentNotice() {}
  function agentNoticeBanner() { return ""; }

  function advancedMemoryBanner() {
    if (!advancedMemoryEnabled()) return "";
    return `<section class="mmc-advanced-memory-note"><span class="mmc-alert-icon">${SVG.info}</span><div><b>고급 메모리 사용 중</b><small>순정 자동요약 대신 고급 메모리가 문맥을 관리합니다. 실제로 생성된 summaryEntries는 계속 수동 검토할 수 있고, 요소 원문 추출도 그대로 쓸 수 있어요.</small></div></section>`;
  }


  // 개요 탭은 요약·되돌리기 알림을 '검토 대기' 카드에 모아 보여 준다. 다른 탭은 해야 할 일만 띠로 보여 준다.
  function statusBanners() {
    if (state.activeTab === "overview") return `${advancedMemoryBanner()}${agentNoticeBanner()}`;
    return `${pendingSummaryBanner()}${autoUndoBanner()}`;
  }


  function ownershipGuardView() {
    const ownership = state.ownership || {};
    const backup = ownership.backup;
    const raw = parseRecord(state.quarantinedData);
    const itemCount = safeArray(raw.items).length;
    const elementCount = safeArray(parseRecord(raw.elementMemory).entities).length;
    const claimed = ownership.ownerChatId ? `<code>${esc(ownership.ownerChatId)}</code>` : "확인 불가";
    const recoveryButton = backup ? `<button class="mmc-btn mmc-primary" data-action="restore-memory-backup">기억 복구</button>` : "";
    const confirmButton = state.quarantinedData ? `<button class="mmc-btn" data-action="confirm-quarantined-memory">격리 데이터를 이 RP용으로 확정</button>` : "";
    return `<section class="mmc-ownership-guard"><span class="mmc-kicker">MEMORY OWNERSHIP GUARD</span><h2>${ownership.status === "recovery" ? "복구 가능한 기억을 찾았습니다" : "다른 RP 기억을 격리했습니다"}</h2><p>${esc(ownership.reason || "기억 소유권을 확인해야 합니다.")}</p><dl><div><dt>표시된 소유 RP</dt><dd>${claimed}</dd></div><div><dt>판정 근거</dt><dd>${esc(ownership.evidence || "없음")}</dd></div>${state.quarantinedData ? `<div><dt>격리 내용</dt><dd>약속·앵커 ${itemCount}개 · 요소 ${elementCount}개</dd></div>` : ""}${backup ? `<div><dt>복구 백업</dt><dd>${esc(sourceDate(backup.savedAt) || backup.savedAt || "저장 시각 없음")}</dd></div>` : ""}</dl><div class="mmc-setting-warning"><b>보호 모드</b><small>확인 전에는 이 데이터를 자동 로드·주입·로어북 동기화하지 않습니다. 원본 격리 데이터와 일치하는 로어북 백업도 자동으로 덮어쓰지 않습니다.</small></div><div class="mmc-ownership-actions">${recoveryButton}${confirmButton}</div></section>`;
  }

  function mainView() {
    if (!state.currentChat || !state.currentData) return `<div class="mmc-empty mmc-empty-large">RP방을 찾지 못했습니다. 새로고침 후 다시 열어 주세요.</div>`;
    if (!ownershipAllowsData()) return ownershipGuardView();
    if (state.activeTab === "overview") return overviewView();
    if (state.activeTab === "element") return `<div data-mmc-summary-alert-slot>${statusBanners()}</div>${elementMainView()}`;
    if (state.activeTab === "wiki") return `<div data-mmc-summary-alert-slot>${statusBanners()}</div>${wikiMainView()}`;
    if (state.activeTab === "anchor") return anchorView();
    return promiseView();
  }


  function syncChip() {
    const data = state.currentData;
    if (!data) return "";
    const error = data.lastSyncError;
    const label = !ownershipAllowsData() ? "소유권 확인 필요" : error ? "동기화 확인 필요" : data.lastSyncAt ? `로어북 동기화됨 · ${relTime(data.lastSyncAt)}` : "로어북 동기화";
    return `<button class="mmc-sync ${error || !ownershipAllowsData() ? "is-bad" : data.lastSyncAt ? "is-ok" : ""}" data-action="sync" title="${esc(error || "전용 로어북 다시 동기화")}"><i class="mmc-sync-dot"></i><span>${esc(label)}</span>${SVG.sync}</button>`;
  }
  function shellMarkup() {
    const counts = tabCounts();
    const tabs = tabMeta().map((tab) => {
      const on = state.activeTab === tab.id;
      const badge = tab.id === "overview"
        ? (inboxRows().length ? '<i class="mmc-tab-dot"></i>' : "")
        : `<em>${counts[tab.id]}</em>`;
      return `<button class="mmc-tab ${on ? "is-active" : ""}" data-action="tab" data-tab="${tab.id}" ${on ? 'aria-current="page"' : ""}>${tab.icon}<span class="mmc-tab-long">${tab.label}</span><span class="mmc-tab-short">${tab.short}</span>${badge}</button>`;
    }).join("");
    return `<div class="mmc-overlay" data-action="overlay-close">
      <section class="mmc-shell" role="dialog" aria-modal="true" aria-label="기억 보관함" data-tab="${esc(state.activeTab)}">
        <header class="mmc-bar">
          <div class="mmc-brand"><span class="mmc-brand-mark">${SVG.memory}</span><span class="mmc-brand-text"><b>기억 보관함</b><small>MEMORY VAULT · v${VERSION}</small></span></div>
          <label class="mmc-story"><span class="mmc-story-icon">${SVG.book}</span><span class="mmc-story-copy"><small>현재 이야기</small><select id="mmc-chat-select" aria-label="현재 이야기">${chatOptions()}</select></span></label>
          <span class="mmc-bar-spacer"></span>
          ${syncChip()}
          <div class="mmc-head-actions">
            <button class="mmc-icon-btn" data-action="help" title="사용법" aria-label="사용법">${SVG.help}</button>
            <button class="mmc-icon-btn" data-action="settings" title="설정" aria-label="설정">${SVG.gear}</button>
            <button class="mmc-icon-btn" data-action="close" title="닫기" aria-label="닫기">${SVG.close}</button>
          </div>
        </header>
        <nav class="mmc-tabs" aria-label="기억 종류">${tabs}</nav>
        <main class="mmc-body">${mainView()}</main>
        ${state.layer ? layerMarkup() : ""}
        ${state.busy ? busyMarkup() : ""}
      </section>
    </div>`;
  }


  function layerMarkup() {
    if (state.layer === "editor") return editorLayer();
    if (state.layer === "element-editor") return elementEditorLayer();
    if (state.layer === "element-candidates") return elementCandidateLayer();
    if (state.layer === "element-settings") return elementSettingsLayer();
    if (state.layer === "wiki-editor") return wikiEditorLayer();
    if (state.layer === "wiki-draft") return wikiDraftLayer();
    if (state.layer === "wiki-candidates") return wikiCandidateLayer();
    if (state.layer === "wiki-proposal") return wikiProposalLayer();
    if (state.layer === "wiki-settings") return wikiSettingsLayer();
    if (state.layer === "source") return sourceLayer();
    if (state.layer === "candidates") return candidateLayer();
    if (state.layer === "review-candidates") return reviewCandidateLayer();
    if (state.layer === "health-candidates") return healthCandidateLayer();
    if (state.layer === "raw-repair") return rawRepairLayer();
    if (state.layer === "help") return helpLayer();
    if (state.layer === "settings") return settingsLayer();
    if (state.layer === "evidence") return evidenceLayer();
    if (state.layer === "inject-preview") return injectPreviewLayer();
    return "";
  }

  function evidenceIdsMarkup(ids) {
    const rows = safeArray(ids).map(String).filter(Boolean);
    return rows.length ? `<div class="mmc-evidence-ids">${rows.map((id) => `<code>${esc(id)}</code>`).join("")}</div>` : '<small>저장된 원문 ID가 없습니다.</small>';
  }

  function evidenceLayer() {
    const view = state.evidenceView || {};
    if (view.kind === "wiki") {
      const doc = wikiState().docs.find((row) => row.id === view.id);
      if (!doc) return "";
      const rows = doc.sources.map((source, index) => `<article class="mmc-evidence-fact ${Number(view.index) === index + 1 ? "is-focus" : ""}"><header class="mmc-evidence-fact-head"><span>[${index + 1}]</span><b>${esc(WIKI_SOURCE_KIND_LABEL[source.kind] || source.kind)}</b><small>${esc(source.label)}</small></header>${source.quote ? `<pre>${esc(source.quote)}</pre>` : "<small>저장된 원문이 없습니다.</small>"}</article>`).join("");
      return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-evidence-layer" data-layer-stop><header><div><span class="mmc-kicker">SOURCE EVIDENCE</span><h3>${esc(doc.title)} · 근거</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header><div class="mmc-layer-body">${rows || '<div class="mmc-empty">연결된 근거 자료가 없습니다.</div>'}</div><footer><span></span><button class="mmc-btn mmc-primary" data-action="close-layer">확인</button></footer></section></div>`;
    }
    if (view.kind === "element") {
      const entity = elementMemory().entities.find((row) => row.id === view.id);
      if (!entity) return "";
      const groups = [["현재 사실", entity.currentFacts], ["이력", entity.historyFacts]].map(([label, facts]) => {
        const rows = safeArray(facts).filter((fact) => fact.source).map((fact) => `<article class="mmc-evidence-fact"><b>${esc(fact.text)}</b>${evidenceIdsMarkup(fact.source.messageIds)}${safeArray(fact.source.fingerprints).length ? `<details><summary>원문 지문 보기</summary>${evidenceIdsMarkup(fact.source.fingerprints)}</details>` : ""}</article>`).join("");
        return rows ? `<section class="mmc-evidence-group"><h4>${label}</h4>${rows}</section>` : "";
      }).join("");
      return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-evidence-layer" data-layer-stop><header><div><span class="mmc-kicker">SOURCE EVIDENCE</span><h3>${esc(entity.name)} · 근거</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header><div class="mmc-layer-body">${groups || '<div class="mmc-empty">표시할 근거 정보가 없습니다.</div>'}</div><footer><span></span><button class="mmc-btn mmc-primary" data-action="close-layer">확인</button></footer></section></div>`;
    }
    const item = safeArray(state.currentData?.items).find((row) => row.id === view.id);
    if (!item) return "";
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-evidence-layer" data-layer-stop><header><div><span class="mmc-kicker">SOURCE EVIDENCE</span><h3>${esc(item.title)} · 근거</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header><div class="mmc-layer-body"><section class="mmc-evidence-group"><h4>저장된 원문</h4>${item.sourceQuote ? `<pre>${esc(item.sourceQuote)}</pre>` : '<small>저장된 원문 인용이 없습니다.</small>'}</section><section class="mmc-evidence-group"><h4>원문 ID</h4>${evidenceIdsMarkup(item.sourceIds)}</section></div><footer><span></span><button class="mmc-btn mmc-primary" data-action="close-layer">확인</button></footer></section></div>`;
  }

  function editorLayer() {
    const d = state.draft || normalizeItem({ type: state.activeTab });
    const isAnchor = d.type === "anchor";
    const source = d.sourceQuote ? `<details class="mmc-source-quote"><summary>가져온 원문 보기</summary><p>${esc(d.sourceQuote)}</p></details>` : "";
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-editor" data-layer-stop>
      <header><div><span class="mmc-kicker">${isAnchor ? "MEMORY ANCHOR" : "PROMISE NOTE"}</span><h3>${d.id ? "기록 편집" : isAnchor ? "새 기억 앵커" : "새 약속"}</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        <label class="mmc-field"><span>제목</span><input id="mmc-draft-title" value="${esc(d.title)}" maxlength="200"></label>
        <label class="mmc-field"><span>내용</span><textarea id="mmc-draft-content" rows="6">${esc(d.content)}</textarea></label>
        ${hasKoText(d.titleKo, d.contentKo) ? `<details class="mmc-source-quote"><summary>한국어 표시본 보기 · 원문은 위 칸에 그대로 보관됩니다</summary><p>${esc([d.titleKo, d.contentKo].filter(Boolean).join("\n"))}</p></details>` : ""}
        ${isAnchor ? `<div class="mmc-field-row">
          <label class="mmc-field"><span>분류</span><select id="mmc-draft-category">${Object.entries(ANCHOR_CATEGORY_LABEL).map(([id, label]) => `<option value="${id}" ${d.category === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="mmc-field"><span>기억 방식</span><select id="mmc-draft-activation"><option value="always" ${d.activation !== "keyword" ? "selected" : ""}>항상 기억</option><option value="keyword" ${d.activation === "keyword" ? "selected" : ""}>키워드가 나올 때</option></select></label>
        </div>
        <label class="mmc-field"><span>키워드 <small>쉼표로 구분 · 조건부 기억일 때 사용</small></span><input id="mmc-draft-keywords" value="${esc(safeArray(d.keywords).join(", "))}" placeholder="예: 병원, 수술, 진료"></label>
        <div class="mmc-field-row"><label class="mmc-field"><span>중요도</span><select id="mmc-draft-priority">${["high", "normal", "low"].map((p) => `<option value="${p}" ${d.priority === p ? "selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}</select></label><label class="mmc-field"><span>기억 수명</span><select id="mmc-draft-lifespan">${Object.entries(ANCHOR_LIFESPAN_LABEL).map(([id, label]) => `<option value="${id}" ${d.lifespan === id ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
        <label class="mmc-check-line"><input id="mmc-draft-archived" type="checkbox" ${d.archived ? "checked" : ""}><span>보관만 하고 주입하지 않기</span></label>` : `<div class="mmc-field-row">
          <label class="mmc-field"><span>상태</span><select id="mmc-draft-status">${Object.entries(PROMISE_STATUS_LABEL).map(([id, label]) => `<option value="${id}" ${d.status === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="mmc-field"><span>중요도</span><select id="mmc-draft-priority">${["high", "normal", "low"].map((p) => `<option value="${p}" ${d.priority === p ? "selected" : ""}>${PRIORITY_LABEL[p]}</option>`).join("")}</select></label>
        </div><label class="mmc-field"><span>예정·조건 <small>선택</small></span><input id="mmc-draft-schedule" value="${esc(d.scheduleText || "")}" placeholder="예: 이번 주말 / 퇴원 후 / 다음 비 오는 날"></label>`}
        ${source}
      </div>
      <footer>${d.id ? `<button class="mmc-btn mmc-danger" data-action="delete-item" data-id="${esc(d.id)}">${SVG.trash}<span>삭제</span></button>` : `<span></span>`}<div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-draft">저장</button></div></footer>
    </section></div>`;
  }

  function sourceRow(row) {
    const checked = state.sourceSelected.has(String(row.id));
    const meta = state.sourceMode === "summaries"
      ? `${row.origin === "automated" ? "자동 요약" : row.origin === "manual" ? "수동 요약" : "요약"}${row.messageCount ? ` · ${row.messageCount}개 메시지` : ""}`
      : `${roleLabel(row.role)}${row.createdAt ? ` · ${sourceDate(row.createdAt)}` : ""}`;
    const title = state.sourceMode === "summaries" ? String(row.title || "요약") : truncate(String(row.content || ""), 72);
    const body = state.sourceMode === "summaries" ? String(row.content || "") : String(row.content || "");
    return `<label class="mmc-source-row ${checked ? "is-selected" : ""}"><input type="checkbox" data-source-id="${esc(row.id)}" ${checked ? "checked" : ""}><span class="mmc-source-copy"><b>${esc(title)}</b><small>${esc(meta)}</small><p>${esc(truncate(body, 300))}</p></span></label>`;
  }

  function connectionOptions() {
    if (!state.connections.length) return '<option value="">사용 가능한 모델 연결 없음</option>';
    return state.connections.map((c) => {
      const label = c.model && !c.label.includes(c.model) ? `${c.label} · ${c.model}` : c.label;
      return `<option value="${esc(c.id)}" ${c.id === state.modelConnectionId ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");
  }

  function sourceLayer() {
    const isReview = state.sourceTarget === "review";
    const title = isReview ? "새 요약 검토" : state.sourceMode === "summaries" ? "순정 요약에서 가져오기" : "최근 대화에서 가져오기";
    const empty = state.sourceMode === "summaries" ? "이 방에 사용할 수 있는 summaryEntries가 없습니다." : "불러올 최근 메시지가 없습니다.";
    const modelTitle = isReview ? "약속 + 앵커 통합 정리" : "약속 + 앵커 한 번에 분류";
    const modelHelp = isReview ? "선택한 새 요약과 현재 활성 기록을 함께 비교합니다. 모델은 제안만 하고 자동 적용하지 않습니다." : "선택한 원문은 모델에 한 번만 보내며, 같은 응답에서 약속과 앵커를 함께 분류합니다. 현재 SillyTavern API 연결을 사용합니다.";
    const footer = isReview
      ? `<button class="mmc-btn" data-action="source-mark-reviewed" ${state.sourceSelected.size ? "" : "disabled"}>검토 완료로 표시</button><div><button class="mmc-btn" data-action="source-local-promise" ${state.sourceSelected.size ? "" : "disabled"}>약속으로 수동 정리</button><button class="mmc-btn" data-action="source-local-anchor" ${state.sourceSelected.size ? "" : "disabled"}>앵커로 수동 정리</button><button class="mmc-btn mmc-model-btn" data-action="source-model-review" ${state.sourceSelected.size && state.modelConnectionId ? "" : "disabled"}>${SVG.spark}<span>모델로 통합 정리</span></button></div>`
      : `<span></span><div><button class="mmc-btn" data-action="source-local" ${state.sourceSelected.size ? "" : "disabled"}>로컬로 가져오기</button><button class="mmc-btn mmc-model-btn" data-action="source-model" ${state.sourceSelected.size && state.modelConnectionId ? "" : "disabled"}>${SVG.spark}<span>모델로 한 번에 정리</span></button></div>`;
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-source-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">${isReview ? "SUMMARY UPDATE" : "SOURCE · READ ONLY"}</span><h3>${title}</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body">
        ${isReview ? '<div class="mmc-candidate-note">새 요약 자체는 수정하지 않습니다. 필요한 기억만 약속/앵커에 반영한 뒤 이 알림을 검토 완료로 표시합니다.</div>' : ""}
        <div class="mmc-source-toolbar"><button class="mmc-btn" data-action="source-select-all">전체 선택</button><button class="mmc-btn" data-action="source-clear">해제</button><span>${state.sourceSelected.size}개 선택 · 약 ${estimateTokens(sourceToText())} tokens</span></div>
        <div class="mmc-source-list">${state.sourceRows.length ? state.sourceRows.map(sourceRow).join("") : `<div class="mmc-empty">${empty}</div>`}</div>
        <section class="mmc-model-strip"><div><b>${modelTitle}</b><small>${modelHelp}</small></div><select id="mmc-source-model">${connectionOptions()}</select></section>
      </div>
      <footer>${footer}</footer>
    </section></div>`;
  }

  function candidateRow(item, index) {
    const checked = state.candidateSelected.has(String(index));
    const detail = item.type === "anchor"
      ? ["앵커", ANCHOR_CATEGORY_LABEL[item.category] || "설정·사실", ANCHOR_LIFESPAN_LABEL[item.lifespan] || "영구"].join(" · ")
      : ["약속", PRIORITY_LABEL[item.priority] || "보통"].join(" · ");
    return `<label class="mmc-candidate is-${item.type === "promise" ? "promise" : "anchor"} ${checked ? "is-selected" : ""}"><input type="checkbox" data-candidate-index="${index}" ${checked ? "checked" : ""}><span><b>${esc(item.title)}</b><small>${esc(detail)}</small><p>${esc(item.content)}</p>${safeArray(item.keywords).length ? `<em>${esc(item.keywords.join(" · "))}</em>` : ""}</span></label>`;
  }

  function candidateGroup(type) {
    const label = type === "promise" ? "약속" : "기억 앵커";
    const hint = type === "promise" ? "앞으로 지키거나 실행할 약속·계획" : "이후 RP에서 잊으면 곤란한 관계·상태·사건·설정";
    const indices = state.candidates
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === type)
      .sort((a, b) => Number(state.candidateSelected.has(String(b.index))) - Number(state.candidateSelected.has(String(a.index))))
      .map(({ index }) => index);
    if (!indices.length) return "";
    return `<section class="mmc-candidate-group is-${type}"><div class="mmc-candidate-group-head"><span class="mmc-type-chip">${label}</span><div><b>${label} 후보 ${indices.length}개</b><small>${hint}</small></div></div><div class="mmc-candidate-list" data-candidate-group="${type}">${indices.map((index) => candidateRow(state.candidates[index], index)).join("")}</div></section>`;
  }

  function candidateLayer() {
    const groups = `${candidateGroup("promise")}${candidateGroup("anchor")}`;
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-source-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">MODEL SUGGESTIONS</span><h3>약속 · 기억 앵커 후보</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body"><div class="mmc-candidate-note">한 번의 모델 정리 결과를 약속과 기억 앵커로 나눠 표시합니다. 체크한 항목만 실제 보관함에 저장되며, 선택한 후보는 각 분류 안에서 위쪽으로 모입니다.</div><div class="mmc-candidate-toolbar"><b data-selected-count="candidate">선택됨 ${state.candidateSelected.size}개</b><small>저장 전 닫기에는 확인창이 표시됩니다.</small></div>${groups || '<div class="mmc-empty">후보를 찾지 못했습니다.</div>'}</div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-candidates" ${state.candidateSelected.size ? "" : "disabled"}>선택 ${state.candidateSelected.size}개 추가</button></div></footer>
    </section></div>`;
  }

  function reviewCandidateRow(item, index) {
    const checked = state.reviewSelected.has(String(index));
    const existing = item.targetId ? safeArray(state.currentData?.items).find((row) => row.id === item.targetId) : null;
    const conflict = !!(existing && item.baseUpdatedAt && existing.updatedAt !== item.baseUpdatedAt);
    const title = item.title || existing?.title || "기억 기록";
    const content = item.content || existing?.content || item.reason || "";
    const detail = [REVIEW_ACTION_LABEL[item.action] || item.action, REVIEW_TYPE_LABEL[item.type] || item.type, item.category ? ANCHOR_CATEGORY_LABEL[item.category] : "", item.type === "anchor" ? ANCHOR_LIFESPAN_LABEL[item.lifespan] : ""].filter(Boolean).join(" · ");
    const before = existing && ["update", "complete", "archive"].includes(item.action) ? `<small class="mmc-review-before">기존: ${esc(truncate(existing.content || existing.title, 150))}</small>` : "";
    return `<label class="mmc-candidate mmc-review-candidate is-${item.type === "promise" ? "promise" : "anchor"} ${checked ? "is-selected" : ""} ${conflict ? "is-conflict" : ""}"><input type="checkbox" data-review-index="${index}" ${checked ? "checked" : ""} ${item.action === "keep" || conflict ? "disabled" : ""}><span><b>${esc(title)}</b><small><strong data-review-action="${esc(item.action)}">${esc(detail)}</strong></small>${conflict ? '<small class="mmc-conflict-note">충돌 · 후보 생성 뒤 원본이 수정되어 자동 적용하지 않습니다.</small>' : ""}${before}<p>${esc(content)}</p>${item.reason ? `<em>${esc(item.reason)}</em>` : ""}</span></label>`;
  }

  function reviewCandidateGroup(type) {
    const label = type === "promise" ? "약속" : "기억 앵커";
    const indices = state.reviewCandidates
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === type)
      .sort((a, b) => Number(state.reviewSelected.has(String(b.index))) - Number(state.reviewSelected.has(String(a.index))))
      .map(({ index }) => index);
    if (!indices.length) return "";
    return `<section class="mmc-candidate-group is-${type}"><div class="mmc-candidate-group-head"><span class="mmc-type-chip">${label}</span><div><b>${label} 갱신 ${indices.length}개</b><small>${type === "promise" ? "추가·갱신·완료 후보" : "추가·갱신·보관 후보"}</small></div></div><div class="mmc-candidate-list" data-review-group="${type}">${indices.map((index) => reviewCandidateRow(state.reviewCandidates[index], index)).join("")}</div></section>`;
  }

  function reviewCandidateLayer() {
    const actionable = state.reviewCandidates.some((item) => item.action !== "keep");
    const groups = `${reviewCandidateGroup("promise")}${reviewCandidateGroup("anchor")}`;
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-source-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">MEMORY UPDATE REVIEW</span><h3>약속 · 앵커 갱신 제안</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body"><div class="mmc-candidate-note">새 요약과 현재 기록을 비교한 결과입니다. 약속과 기억 앵커를 분리해 표시하며 ADD/UPDATE/COMPLETE/ARCHIVE는 체크한 것만 적용됩니다. KEEP은 참고 표시입니다.</div><div class="mmc-candidate-toolbar"><b data-selected-count="review">선택됨 ${state.reviewSelected.size}개</b><small>적용 전 닫기에는 확인창이 표시됩니다.</small></div>${groups || '<div class="mmc-empty">새로 반영할 기억을 찾지 못했습니다. 아래 버튼으로 이번 요약을 검토 완료 처리할 수 있습니다.</div>'}</div>
      <footer><div><button class="mmc-btn mmc-danger" data-action="discard-review">후보 폐기</button><button class="mmc-btn" data-action="review-mark-done">이번 요약 검토 완료</button></div><div><button class="mmc-btn" data-action="close-layer">나중에</button><button class="mmc-btn mmc-primary" data-action="apply-review" ${state.reviewSelected.size && actionable ? "" : "disabled"}>선택 ${state.reviewSelected.size}개 적용</button></div></footer>
    </section></div>`;
  }

  function healthCandidateRow(item, index) {
    const checked = state.healthSelected.has(String(index));
    const existing = item.targetId ? safeArray(state.currentData?.items).find((row) => row.id === item.targetId) : null;
    const conflict = !!(existing && item.baseUpdatedAt && existing.updatedAt !== item.baseUpdatedAt);
    const title = item.title || existing?.title || "기억 기록";
    const content = item.content || existing?.content || item.reason || "";
    const lifespan = item.type === "anchor" ? (ANCHOR_LIFESPAN_LABEL[item.lifespan] || "") : "";
    const detail = [REVIEW_ACTION_LABEL[item.action] || item.action, REVIEW_TYPE_LABEL[item.type] || item.type, item.category ? ANCHOR_CATEGORY_LABEL[item.category] : "", lifespan].filter(Boolean).join(" · ");
    const before = existing && ["update", "complete", "archive"].includes(item.action) ? `<small class="mmc-review-before">기존: ${esc(truncate(existing.content || existing.title, 150))}</small>` : "";
    return `<label class="mmc-candidate mmc-review-candidate is-${item.type === "promise" ? "promise" : "anchor"} ${checked ? "is-selected" : ""} ${conflict ? "is-conflict" : ""}"><input type="checkbox" data-health-index="${index}" ${checked ? "checked" : ""} ${item.action === "keep" || conflict ? "disabled" : ""}><span><b>${esc(title)}</b><small><strong data-review-action="${esc(item.action)}">${esc(detail)}</strong></small>${conflict ? '<small class="mmc-conflict-note">충돌 · 검토 뒤 원본이 수정되어 적용하지 않습니다.</small>' : ""}${before}<p>${esc(content)}</p>${item.reason ? `<em>${esc(item.reason)}</em>` : ""}</span></label>`;
  }

  function healthCandidateLayer() {
    const actionable = state.healthCandidates.some((item) => item.action !== "keep");
    const order = state.healthCandidates.map((_, index) => index).sort((a, b) => Number(state.healthSelected.has(String(b))) - Number(state.healthSelected.has(String(a))));
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-source-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">MEMORY HEALTH CHECK</span><h3>기억 건강검진</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body"><div class="mmc-candidate-note">현재 약속·앵커와 최근 요약을 비교해 중복, 모순, 오래된 현재 상태, 끝난 사건, 지나치게 긴 기억을 점검했습니다. 모델은 제안만 하며 체크한 변경만 적용됩니다. 새 사실을 임의로 추가하지 않습니다.</div><div class="mmc-candidate-toolbar"><b data-selected-count="health">선택됨 ${state.healthSelected.size}개</b><small>적용 전 닫기에는 확인창이 표시됩니다.</small></div><div class="mmc-candidate-list">${state.healthCandidates.length ? order.map((index) => healthCandidateRow(state.healthCandidates[index], index)).join("") : '<div class="mmc-empty">정리할 문제를 찾지 못했습니다. 현재 기억 상태를 그대로 유지해도 됩니다.</div>'}</div></div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">닫기</button><button class="mmc-btn mmc-primary" data-action="apply-health" ${state.healthSelected.size && actionable ? "" : "disabled"}>선택 ${state.healthSelected.size}개 적용</button></div></footer>
    </section></div>`;
  }

  function rawRepairLayer() {
    const recovery = state.rawRecovery || { kind: "candidate", text: "", rows: [] };
    const label = recovery.kind === "review" ? "약속 · 앵커 통합 정리" : recovery.kind === "health" ? "기억 건강검진" : recovery.kind === "element" ? "요소 기억 추출" : recovery.kind === "wiki" ? "이야기 위키 초안" : recovery.kind === "wiki-update" ? "이야기 위키 변경 제안" : "약속 · 기억 앵커 통합 후보";
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-raw-repair" data-layer-stop>
      <header><div><span class="mmc-kicker">MODEL RESPONSE RECOVERY</span><h3>모델 응답 복구</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <div class="mmc-layer-body"><div class="mmc-candidate-note"><b>${esc(label)}</b> 응답을 JSON으로 바로 읽지 못했습니다. 자동 복구를 이미 시도했으며, 아래 원문은 재호출 없이 보존되어 있습니다. 그대로 <b>다시 읽기</b>를 먼저 눌러보고, 실패하면 JSON 부분만 남기거나 끝 쉼표 등을 고쳐 다시 읽어 주세요.</div><textarea id="mmc-raw-repair-text" spellcheck="false" aria-label="모델 원문 응답">${esc(recovery.text)}</textarea></div>
      <footer><button class="mmc-btn mmc-danger" data-action="discard-raw-recovery">응답 버리기</button><div><button class="mmc-btn mmc-primary" data-action="parse-raw-recovery">수정본 다시 읽기</button></div></footer>
    </section></div>`;
  }

  async function applyRecoveredRows(text) {
    const recovery = state.rawRecovery;
    if (!recovery) throw new Error("복구할 모델 원문이 없습니다.");
    if (recovery.kind === "wiki") {
      const result = parseWikiDraftJson(text, safeArray(recovery.rows));
      if (!result.ok) throw new Error("아직 위키 초안 JSON을 읽지 못했습니다. JSON 객체 부분만 남기거나 문법을 조금 고쳐 다시 시도해 주세요.");
      state.wikiCandidates = result.rows;
      state.wikiCandidateSelected = new Set(result.rows.map((row, i) => String(i)));
      state.rawRecovery = null;
      state.layer = "wiki-candidates";
      toast("모델 응답에서 위키 초안을 복구했습니다.");
      return;
    }
    if (recovery.kind === "wiki-update") {
      const doc = wikiState().docs.find((row) => row.id === String(recovery.docId || ""));
      if (!doc) throw new Error("변경 제안을 적용할 문서를 찾지 못했습니다.");
      const result = parseWikiProposalJson(text, doc);
      if (!result.ok) throw new Error("아직 변경 제안 JSON을 읽지 못했습니다. JSON 객체 부분만 남기거나 문법을 조금 고쳐 다시 시도해 주세요.");
      await storeWikiProposal(doc, result, safeArray(recovery.rows));
      return;
    }
    if (recovery.kind === "element") {
      const memory = elementMemory();
      const result = parseElementProposalJson(text, memory, safeArray(recovery.rows));
      if (!result.ok) throw new Error("아직 요소 기억 JSON을 읽지 못했습니다. JSON 객체 부분만 남기거나 문법을 조금 고쳐 다시 시도해 주세요.");
      state.elementCandidateOverflow = Math.max(0, result.rows.length - ELEMENT_CANDIDATE_LIMIT);
      state.elementCandidates = result.rows.slice(0, ELEMENT_CANDIDATE_LIMIT);
      state.elementCandidateSelected = new Set(state.elementCandidates.map((_, i) => String(i)));
      state.elementExtractInfo = recovery.extractInfo || null;
      state.rawRecovery = null;
      state.layer = "element-candidates";
      toast("모델 응답에서 요소 기억 후보를 복구했습니다.");
      return;
    }
    const mode = recovery.kind === "candidate" ? "mixed-candidate" : recovery.kind;
    const result = parseModelRows(text, mode);
    if (!result.ok) throw new Error("아직 JSON 후보를 읽지 못했습니다. JSON 배열/객체 부분만 남기거나 문법을 조금 고쳐 다시 시도해 주세요.");
    if (recovery.kind === "candidate") {
      const parsed = result.rows.map(normalizeCandidate).filter(Boolean).slice(0, 12);
      if (!parsed.length && result.rows.length) throw new Error("JSON은 읽었지만 후보 필드(title/content 등)를 해석하지 못했습니다.");
      const rows = selectedSourceRows();
      const quote = sourceToText(rows).slice(0, 12000);
      const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
      state.candidates = parsed.map((item) => ({ ...item, id: "", sourceType: "model", sourceIds: ids, sourceQuote: quote }));
      state.candidateSelected = new Set(parsed.map((_, i) => String(i)));
      state.rawRecovery = null;
      state.layer = "candidates";
      toast(result.repaired ? "모델 응답을 보정해 후보를 복구했습니다." : "모델 응답에서 후보를 복구했습니다.");
      return;
    }
    const normalized = result.rows.map(normalizeReviewCandidate).filter((item) => item && (recovery.kind !== "health" || item.action !== "add")).slice(0, 20);
    if (!normalized.length && result.rows.length) throw new Error("JSON은 읽었지만 action/type/targetId 같은 후보 필드를 해석하지 못했습니다.");
    if (recovery.kind === "review") {
      state.reviewCandidates = normalized;
      state.reviewSelected = new Set(normalized.map((item, i) => item.action === "keep" ? null : String(i)).filter(Boolean));
      state.reviewSourceRows = safeArray(recovery.rows).slice();
      await persistPendingReview();
      state.rawRecovery = null;
      state.layer = "review-candidates";
    } else {
      state.healthCandidates = normalized;
      state.healthSelected = new Set(normalized.map((item, i) => item.action === "keep" ? null : String(i)).filter(Boolean));
      state.rawRecovery = null;
      state.layer = "health-candidates";
    }
    toast(result.repaired ? "모델 응답을 보정해 제안을 복구했습니다." : "모델 응답에서 제안을 복구했습니다.");
  }

  function helpUsageMarkup() {
    return `<div class="mmc-guide mmc-guide-steps">
      <section><b>1. 이야기 고르기</b><p>머리줄의 <strong>현재 이야기</strong>에서 관리할 RP방을 고릅니다. 약속·기억 앵커·요소 기억·위키는 RP별로 따로 보관됩니다.</p></section>
      <section><b>1-1. 개요 탭</b><p>매 턴 RP에 늘 들어가는 기억의 양(약 tokens)과 구성, 검토할 것(새 요약·위키 변경 제안·예산 대기 앵커 등), 최근 변화를 한 화면에 모아 보여 줍니다. <strong>주입 미리보기</strong>로 실제 들어가는 문장을 확인할 수 있습니다.</p></section>
      <section><b>2. 기억 종류 고르기</b><p><strong>약속</strong>은 앞으로 지킬 계획, <strong>기억 앵커</strong>는 중요한 사건·관계·상태, <strong>요소 기억</strong>은 물건·장소·취향처럼 오래 지나도 이어져야 하는 대상별 사실을 관리합니다. <strong>위키</strong>는 이 셋을 지우지 않고 그 위에 올리는, 사람이 읽고 고치는 문서 계층입니다.</p></section>
      <section><b>2-1. 이야기 위키</b><p>등장인물·관계·장소·물건·사건·조직·세계관을 문서로 정리합니다. <strong>AI 초안</strong>은 이미 저장된 요소 기억·약속·앵커·요약·최근 대화만 근거로 삼아 문서를 씁니다. 기억을 새로 만들지 않고 조직할 뿐입니다. 본문의 <code>[1]</code>을 누르면 그 문장의 근거 원문을 볼 수 있고, <code>[문서 제목]</code>은 다른 문서로 이어집니다.</p></section>
      <section><b>2-2. 위키에서 내 수정이 지워지지 않게 하기</b><p>섹션마다 <strong>🔒 사용자 편집</strong> 또는 <strong>AI 관리</strong>를 고를 수 있습니다. 새 기억이 생기면 문서를 바로 바꾸지 않고 <strong>변경 제안</strong>으로 보여 주며, 반영을 누른 것만 들어갑니다. 잠근 섹션은 충돌 사실만 알리고 절대 덮어쓰지 않습니다. 제안을 만든 뒤 직접 고친 섹션도 건너뜁니다.</p></section>
      <section><b>2-3. 위키의 세 가지 상태</b><p>서로 다른 기능입니다. <strong>AI 수정 잠금</strong>은 내용 변경만 막고 참조는 그대로 허용합니다. <strong>AI 참조 제외</strong>는 RP 생성 컨텍스트에서만 뺍니다. <strong>항상 기억</strong>은 본문 전체가 아니라 <strong>개요 한 줄만</strong> 상시 주입하고, 본문은 키워드가 맞을 때만 불러옵니다.</p></section>
      <section><b>3. 요소 기억 추출</b><p>요소 탭에서 최근 N턴 또는 직접 지정한 완결 RP 턴을 모델에게 읽힙니다. 모델은 후보만 만들며, 저장 전에 이름·현재 사실·이력·검색 조건을 직접 고칠 수 있습니다.</p></section>
      <section><b>4. 검색 조건</b><p>별칭은 같은 대상의 다른 이름이고 자동 검색어가 아닙니다. <strong>단독 호출어</strong>는 하나만 등장해도 호출되고, <strong>조합 호출조건</strong>은 같은 줄의 모든 단어가 있어야 호출됩니다.</p></section>
      <section><b>5. 새 요약이 생겼을 때</b><p>새 순정 요약은 기존 약속·앵커 갱신 알림에 사용됩니다. 요소 기억 수동 추출은 요약이 아니라 원문 RP를 직접 읽습니다.</p></section>
      <section><b>고급 메모리를 사용할 때</b><p>SillyTavern Summarize가 저장한 요약을 읽습니다. 요약이 없어도 최근 대화·턴 범위 추출과 수동 편집은 사용할 수 있습니다.</p></section>
      <section><b>소유권 경고가 보일 때</b><p>설정 프로필에서 다른 RP의 metadata가 들어온 경우 기억을 격리합니다. 현재 RP와 일치하는 비활성 로어북 백업이 있으면 기억 복구를 우선하고, 의도적인 복사일 때만 격리 데이터를 현재 RP용으로 확정하세요.</p></section>
      <section><b>6. 설정</b><p>보관함 설정은 화면(테마·글자)·주입·자동화·모델·로어북 탭으로 나뉩니다. 요소 기억과 이야기 위키의 모델·지침·주입 ON/OFF는 각 기능의 설정에서 따로 조절합니다. 위키 설정의 <strong>모양</strong>은 보관함 테마를 그대로 보여 주고, 바꾸기를 누르면 보관함 설정의 테마로 이동합니다.</p></section>
      <section><b>SillyTavern에서 사용하기</b><p>확장 메뉴에서 기억 보관함을 열 수 있습니다. 현재 열린 개인·그룹 채팅만 편집하며, 다른 이야기로 옮기려면 SillyTavern에서 채팅을 전환해 주세요. 기존 채팅 로어북 연결은 유지됩니다.</p></section>
    </div>`;
  }

  function helpFeaturesMarkup() {
    return `<div class="mmc-guide mmc-guide-features">
      <section><b>약속 보관</b><p>약속·계획을 진행 중 / 보류 / 완료 / 취소 상태로 관리하고, 진행 중인 약속만 현재 기억에 전달합니다.</p></section>
      <section><b>기억 앵커</b><p>관계, 현재 상태, 진행 사건, 성향·취향, 설정·사실, 주의사항을 고정합니다. 항상 기억 또는 키워드 발동을 선택할 수 있습니다.</p></section>
      <section><b>요소 기억</b><p>물건·장소·취향·소유·위치·현재 상태를 대상별로 누적합니다. current/이력을 분리하고, 원문에서 찾은 후보를 사용자가 승인한 뒤에만 저장합니다.</p></section>
      <section><b>요소 검색 조건</b><p>별칭과 검색 조건을 분리해 일반명사 오발화를 줄입니다. 검색 테스트에서 어떤 조건으로 어떤 요소가 호출되는지 미리 확인할 수 있습니다.</p></section>
      <section><b>이야기 위키</b><p>기존 기억을 대체하지 않고 그 위에 얹는 편집 레이어입니다. 분류와 <code>/</code> 하위 분류, 개요, Markdown 본문, 별칭, 한국어·영어 키워드, 관련 문서, 근거 자료를 문서 단위로 보관합니다.</p></section>
      <section><b>위키 근거와 문서 연결</b><p>AI가 쓴 문장에는 가능한 범위에서 <code>[1]</code> 같은 근거 번호가 붙고, 눌러서 원본 기억·요약·대화를 확인할 수 있습니다. <code>[문서 제목]</code>으로 문서를 잇고, 이 문서가 참조하는 문서와 이 문서를 참조하는 문서를 양쪽으로 보여 줍니다.</p></section>
      <section><b>위키 변경 제안</b><p>새 기억이 생겨도 문서를 바로 고치지 않습니다. 관련 기억 건수를 알리고, 섹션 단위 diff로 반영·무시를 고르게 합니다. 잠긴 섹션과 그 사이 직접 고친 섹션은 덮어쓰지 않고 충돌만 알립니다.</p></section>
      <section><b>위키 한영 대응</b><p>요소 기억과 같은 검색 엔진을 씁니다. 별칭은 같은 대상의 다른 이름이고, 실제 호출은 한국어·영어 키워드와 조합 호출조건으로만 일어납니다. 한출·영출 어느 쪽에서도 같은 문서를 찾을 수 있습니다.</p></section>
      <section><b>기억 수명 · 작업기억 예산</b><p>앵커에 영구 / 현재 상태 / 사건 종료까지의 수명을 붙이고, 상시 주입할 기억의 글자 예산을 정해 중요한 기억을 짧게 유지합니다.</p></section>
      <section><b>새 요약 갱신</b><p>순정 자동요약이 새로 생기면 기억 갱신이 필요하다는 알림을 표시합니다. 알림만 받기, 모델 분석 후 승인, 실험적 자동 적용 등 처리 방식을 설정할 수 있습니다.</p></section>
      <section><b>모델 1회 통합 분류</b><p>선택한 대화나 요약을 모델에 한 번 보내 약속과 기억 앵커를 동시에 분류합니다. 새 요약 정리에서는 현재 기록과 비교해 추가·갱신·완료·보관·유지를 제안합니다.</p></section>
      <section><b>기억 건강검진</b><p>원할 때만 모델을 호출해 중복·모순·오래된 상태·끝난 사건·완료된 약속·지나치게 긴 기억을 점검합니다. 새 사실을 임의로 추가하지 않고 정리 후보만 제안합니다.</p></section>
      <section><b>로컬 사용</b><p>모델 호출 없이 최근 대화나 순정 요약을 편집 초안으로 가져와 직접 정리할 수 있습니다.</p></section>
      <section><b>안전장치</b><p>모델 후보는 사용자가 선택한 항목만 반영합니다. RP 소유권이 맞지 않는 기억은 자동 로드·주입·동기화하지 않으며, 전용 로어북에는 주입되지 않는 구조화 백업을 보관합니다. 원본 RP 메시지와 순정 요약은 수정하지 않습니다.</p></section>
      <section><b>테마 하나로 전체 색 맞춤</b><p>리본 라일락 · 스토리 로즈 · 아카이브 그린 · SillyTavern 테마 따르기 중 하나를 고르면 보관함 전체와 이야기 위키가 같은 색으로 바뀝니다. 위키만 따로 색이 달라지지 않습니다. 현재 사용자 폰트를 따르고, 보관함 안 글자 크기는 따로 조절할 수 있습니다.</p></section>
    </div>`;
  }

  function helpLayer() {
    const tab = state.helpTab === "features" ? "features" : "usage";
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-help-layer" data-layer-stop>
      <header><div><span class="mmc-kicker">GUIDE</span><h3>기억 보관함 안내</h3></div><button class="mmc-icon-btn" data-action="close-layer">${SVG.close}</button></header>
      <nav class="mmc-help-tabs" aria-label="기억 보관함 안내 탭"><button class="${tab === "usage" ? "is-active" : ""}" data-action="help-tab" data-help-tab="usage">사용법</button><button class="${tab === "features" ? "is-active" : ""}" data-action="help-tab" data-help-tab="features">포함 기능</button></nav>
      <div class="mmc-layer-body">${tab === "features" ? helpFeaturesMarkup() : helpUsageMarkup()}</div>
      <footer><span></span><button class="mmc-btn mmc-primary" data-action="close-layer">확인</button></footer>
    </section></div>`;
  }

  function themePreviewMarkup(id) {
    return `<span class="mmc-tp" data-tp="${id}" aria-hidden="true"><span class="mmc-tp-app"><i></i><b></b><b></b><b></b></span><span class="mmc-tp-wiki"><i></i><b></b><b></b><b></b><s></s></span></span>`;
  }
  function settingsLayer() {
    const data = state.currentData || defaultData();
    const legacy = parseRecord(state.currentChat?.metadata)[LEGACY_PROMISE_KEY];
    const advanced = advancedMemoryEnabled();
    const tab = ["screen", "inject", "auto", "model", "data"].includes(state.settingsTab) ? state.settingsTab : "screen";
    const tabs = [["screen", "화면"], ["inject", "주입"], ["auto", "자동화"], ["model", "모델"], ["data", "로어북"]];
    const themeCards = UI_THEMES.map((theme) => `<label class="mmc-theme-card">
      <input type="radio" name="mmc-ui-theme" value="${theme.id}" ${state.uiThemeMode === theme.id ? "checked" : ""}>
      <span class="mmc-theme-card-ui">${themePreviewMarkup(theme.id)}<strong>${theme.label}</strong><small>${theme.help}</small><i class="mmc-theme-check">✓</i></span>
    </label>`).join("");
    const pane = (id, body) => `<div class="mmc-sheet-pane" data-settings-pane="${id}" ${tab === id ? "" : "hidden"}>${body}</div>`;
    return `<div class="mmc-layer-backdrop" data-action="close-layer"><section class="mmc-layer mmc-settings-layer mmc-sheet" data-layer-stop>
      <header><div class="mmc-sheet-title"><span class="mmc-sheet-icon">${SVG.gear}</span><h3>보관함 설정</h3></div><button class="mmc-icon-btn" data-action="close-layer" aria-label="닫기">${SVG.close}</button></header>
      <nav class="mmc-sheet-nav" role="tablist">${tabs.map(([id, label]) => `<button class="${tab === id ? "is-active" : ""}" data-action="settings-tab" data-settings-tab="${id}" role="tab">${label}</button>`).join("")}</nav>
      <div class="mmc-layer-body">
        ${pane("screen", `
          <section class="mmc-set-card mmc-theme-setting">
            <div class="mmc-set-head"><b>테마</b><small>하나를 고르면 <strong>보관함 전체</strong>(머리줄·탭·약속·앵커·요소·<strong>위키 문서</strong>·설정)가 같은 색으로 바뀌어요. 고르는 즉시 미리 보여 주고, 저장해야 유지돼요.</small></div>
            <div class="mmc-theme-cards">${themeCards}</div>
            <div class="mmc-theme-note">${SVG.info}<span>예전 ‘위키 탭 테마’(나무위키풍 그린)는 <b>아카이브 그린</b>으로 합쳐졌어요. 이제 위키만 따로 색이 달라지지 않아요.</span></div>
          </section>
          <section class="mmc-set-card">
            <div class="mmc-set-head"><b>읽기</b></div>
            <label class="mmc-setting"><span><b>글자 크기</b><small>기억 보관함 안의 글씨만 바뀌어요.</small></span><select id="mmc-ui-font-size"><option value="normal" ${state.uiFontSize === "normal" ? "selected" : ""}>보통</option><option value="large" ${state.uiFontSize === "large" ? "selected" : ""}>크게</option><option value="xlarge" ${state.uiFontSize === "xlarge" ? "selected" : ""}>아주 크게</option></select></label>
            <label class="mmc-setting"><span><b>기억 표시 언어</b><small>약속·앵커·요소 기억·위키 전체에 적용돼요. 원문은 그대로 보존되고 RP에는 언제나 원문만 들어가요.</small></span><select id="mmc-ko-display"><option value="auto" ${state.koDisplay !== "original" ? "selected" : ""}>번역이 있으면 한국어</option><option value="original" ${state.koDisplay === "original" ? "selected" : ""}>항상 원문</option></select></label>
          </section>`)}
        ${pane("inject", `
          <section class="mmc-set-card">
            <div class="mmc-set-head"><b>상시 주입</b><small>매 턴 RP에 들어가는 양을 정해요. 넘치는 항목은 지우지 않고 대기로 남겨요.</small></div>
            <label class="mmc-setting"><span><b>약속 상시 주입 상한</b><small>중요도 순으로 이 개수까지만 넣어요.</small></span><input id="mmc-max-promises" type="number" min="1" max="20" value="${data.maxPromises}"></label>
            <label class="mmc-setting"><span><b>항상 기억 앵커 상한</b><small>키워드 앵커는 조건부라 이 숫자에 들어가지 않아요.</small></span><input id="mmc-max-anchors" type="number" min="1" max="24" value="${data.maxAnchors}"></label>
            <label class="mmc-setting"><span><b>상시 앵커 기억 예산</b><small>항상 기억 앵커 본문에 쓸 최대 글자 수 · 600~12000자.</small></span><input id="mmc-anchor-budget" type="number" min="600" max="12000" step="100" value="${data.anchorBudgetChars}"></label>
          </section>`)}
        ${pane("auto", `
          <section class="mmc-set-card">
            <div class="mmc-set-head"><b>새 요약이 생겼을 때</b></div>
            <label class="mmc-setting mmc-setting-model"><span><b>새 요약 갱신 방식</b><small>새 순정 요약이 확인됐을 때 알림과 모델 처리 방식을 정해요. 자동 분석/적용은 선택 모델을 부르므로 API 비용이 생길 수 있어요. 기본값은 ‘알림 + 모델 정리 버튼’이에요.${advanced ? " 지금은 고급 메모리가 켜져 있어 무인 자동 분석·적용은 멈추고 수동 검토만 제공해요." : ""}</small></span><select id="mmc-summary-update-mode">${Object.entries(SUMMARY_UPDATE_MODE_LABEL).map(([id, label]) => `<option value="${id}" ${state.summaryUpdateMode === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
            <div class="mmc-setting-warning"><b>자동화 단계 안내</b><small><strong>자동 분석 후 승인 대기</strong>는 모델이 후보까지만 만들고 적용은 사용자가 해요. <strong>완전 자동 적용</strong>은 모델 판단이 곧바로 약속/앵커에 반영되는 실험 기능이에요. SillyTavern 요약 확장이 메시지에 저장한 요약을 감지해요.</small></div>
          </section>`)}
        ${pane("model", `
          <section class="mmc-set-card">
            <label class="mmc-setting mmc-setting-model"><span><b>후보·갱신 기본 모델</b><small>SillyTavern에서 현재 선택한 API와 모델을 사용해요. 모델 변경은 SillyTavern 연결 설정에서 해 주세요. 자동 분석/적용 모드에서는 새 요약을 감지할 때 이 모델이 자동으로 불릴 수 있어요.</small></span><select id="mmc-settings-model">${connectionOptions()}</select></label>
          </section>
          <section class="mmc-setting-block"><div class="mmc-setting-block-head"><span><b>통합 정리 분류 프롬프트</b><small>약속과 기억 앵커를 어떻게 나눌지 정해요. JSON 출력 형식 규칙은 확장이 따로 고정해요.</small></span><button class="mmc-btn mmc-sm" data-action="reset-review-prompt">기본값 복원</button></div><textarea id="mmc-review-prompt" rows="9">${esc(state.reviewPrompt || DEFAULT_REVIEW_PROMPT)}</textarea></section>
          <label class="mmc-setting-block"><span><b>모델 정리 추가 지침</b><small>개인 취향만 덧붙이세요. 예: 사소한 취향은 앵커로 만들지 말 것 / 관계 변화와 신체 상태를 우선.</small></span><textarea id="mmc-review-extra" rows="4" placeholder="선택 사항">${esc(state.reviewExtraInstruction || "")}</textarea></label>`)}
        ${pane("data", `
          <div class="mmc-setting-card"><div><b>기억 데이터 가져오기 · 내보내기</b><small>Marinara memoryCabinetV1 JSON, 보관함 로어북의 구조화 백업, SillyTavern 보관함 JSON을 지원해요. 확장 설치 ZIP에는 RP 기억이 들어 있지 않아요.</small></div><div class="mmc-inline-actions"><button class="mmc-btn" data-action="import-memory">JSON 가져오기</button><button class="mmc-btn" data-action="export-memory" ${state.currentData ? "" : "disabled"}>JSON 내보내기</button></div></div>
          <p class="mmc-muted">World Info의 MemoryVault_ 파일은 자동 관리됩니다. 직접 연결할 필요 없이 현재 채팅에서만 스캔해요. 실제 주입량은 SillyTavern World Info 예산의 영향을 받아요.</p>
          <div class="mmc-setting-card"><div><b>전용 로어북</b><small>${data.lorebookId ? `연결 ID ${esc(data.lorebookId)}` : "아직 생성되지 않음"}${data.lastSyncAt ? ` · 최근 동기화 ${esc(sourceDate(data.lastSyncAt))}` : ""}</small>${data.lastSyncError ? `<em>${esc(data.lastSyncError)}</em>` : ""}</div><button class="mmc-btn" data-action="sync" ${ownershipAllowsData() ? "" : "disabled"}>${SVG.sync}<span>다시 동기화</span></button></div>
          <div class="mmc-setting-card"><div><b>기존 약속보관함 기록 가져오기</b><small>${legacy ? "이 RP에서 기존 promiseKeeperV1 데이터를 찾았어요. 원본은 그대로 두고 기억 보관함으로 복사해요." : "이 RP에서는 기존 약속보관함 데이터를 찾지 못했어요."}</small></div><button class="mmc-btn" data-action="import-legacy" ${legacy ? "" : "disabled"}>복사해 가져오기</button></div>
          <div class="mmc-setting-card"><div><b>요소 기억 · 이야기 위키 설정</b><small>추출·주입 지침과 모델은 각 기능의 설정에서 따로 정해요.</small></div><div class="mmc-inline-actions"><button class="mmc-btn" data-action="element-settings">요소 설정</button><button class="mmc-btn" data-action="wiki-settings">위키 설정</button></div></div>`)}
      </div>
      <footer><span></span><div><button class="mmc-btn" data-action="close-layer">취소</button><button class="mmc-btn mmc-primary" data-action="save-settings">저장</button></div></footer>
    </section></div>`;
  }


  function busyMarkup() {
    return `<div class="mmc-busy"><div class="mmc-spinner"></div><b>${esc(state.busyText || "처리 중…")}</b><small id="mmc-busy-time"></small></div>`;
  }

  function setBusy(onValue, text = "처리 중…") {
    state.busy = !!onValue;
    state.busyText = text;
    if (state.busyTimer) clearInterval(state.busyTimer);
    state.busyTimer = null;
    if (onValue) {
      state.busyStartedAt = Date.now();
      state.busyTimer = setInterval(() => {
        const node = document.getElementById("mmc-busy-time");
        if (node) node.textContent = `${Math.floor((Date.now() - state.busyStartedAt) / 1000)}초 경과`;
      }, 500);
    }
    render();
  }

  function toast(message, error = false) {
    let node = document.getElementById(TOAST_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = TOAST_ID;
      node.className = "mmc-toast";
      document.body.append(node);
      applyUiPreferences();
      cleanupFns.push(() => node.remove());
    }
    node.textContent = String(message || "");
    node.classList.toggle("is-error", error);
    node.classList.add("is-show");
    window.clearTimeout(node.__mmcTimer);
    node.__mmcTimer = window.setTimeout(() => node.classList.remove("is-show"), 2600);
  }

  function applyUiPreferences() {
    const fontSize = ["normal", "large", "xlarge"].includes(state.uiFontSize) ? state.uiFontSize : "normal";
    const themeMode = UI_THEME_IDS.includes(state.uiThemeMode) ? state.uiThemeMode : "ribbon";
    const root = document.getElementById(ROOT_ID);
    const launcher = document.getElementById(LAUNCHER_ID);
    const toastNode = document.getElementById(TOAST_ID);
    for (const node of [root, launcher, toastNode]) {
      if (!node) continue;
      node.dataset.mmcFontSize = fontSize;
      node.dataset.mmcTheme = themeMode;
      delete node.dataset.mmcWikiTheme;
    }
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const previousLayer = String(root.dataset.mmcRenderedLayer || "");
    const nextLayer = String(state.layer || "");
    const previousView = String(root.dataset.mmcRenderedView || "");
    const nextView = `${state.activeTab}:${state.activeTab === "wiki" ? state.wikiSelectedId : ""}`;
    const sameView = previousView === nextView;
    const bodyScroll = sameView ? (root.querySelector(".mmc-body")?.scrollTop || 0) : 0;
    const wikiScroll = sameView ? (root.querySelector(".mmc-wiki-main")?.scrollTop || 0) : 0;
    const wikiListScroll = root.querySelector(".mmc-wiki-list")?.scrollTop || 0;
    const layerScroll = previousLayer === nextLayer ? (root.querySelector(".mmc-layer-body")?.scrollTop || 0) : 0;
    applyUiPreferences();
    root.innerHTML = shellMarkup();
    root.dataset.mmcRenderedLayer = nextLayer;
    root.dataset.mmcRenderedView = nextView;
    const nextBody = root.querySelector(".mmc-body");
    if (nextBody && bodyScroll > 0) nextBody.scrollTop = bodyScroll;
    const nextWiki = root.querySelector(".mmc-wiki-main");
    if (nextWiki && wikiScroll > 0) nextWiki.scrollTop = wikiScroll;
    const nextWikiList = root.querySelector(".mmc-wiki-list");
    if (nextWikiList && wikiListScroll > 0) nextWikiList.scrollTop = wikiListScroll;
    const nextLayerBody = root.querySelector(".mmc-layer-body");
    if (nextLayerBody && layerScroll > 0) nextLayerBody.scrollTop = layerScroll;
    updateLauncherBadge();
  }

  function closeModal({ force = false } = {}) {
    const hasGeneratedDraft = state.candidates.length > 0 || state.healthCandidates.length > 0 || state.elementCandidates.length > 0 || state.wikiCandidates.length > 0 || !!state.rawRecovery?.text;
    if (!force && hasGeneratedDraft) {
      const message = state.rawRecovery?.text
        ? "아직 복구하지 않은 모델 원문 응답이 있습니다.\n정말 기억 보관함을 닫을까요? 닫으면 이번 응답 원문은 사라집니다."
        : state.healthCandidates.length > 0
        ? "아직 적용하지 않은 기억 건강검진 제안이 있습니다.\n정말 기억 보관함을 닫을까요? 닫으면 이번 모델 결과는 사라집니다."
        : "아직 저장하지 않은 모델 후보가 있습니다.\n정말 기억 보관함을 닫을까요? 닫으면 이번 모델 결과는 사라집니다.";
      if (!window.confirm(message)) return false;
    }
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    state.layer = null;
    state.draft = null;
    state.promisePane = "list";
    state.sourceRows = [];
    state.sourceSelected.clear();
    state.candidates = [];
    state.candidateSelected.clear();
    state.elementCandidates = [];
    state.elementCandidateSelected.clear();
    state.elementExtractInfo = null;
    state.elementCandidateOverflow = 0;
    state.elementDraft = null;
    state.wikiCandidates = [];
    state.wikiCandidateSelected.clear();
    state.wikiDraft = null;
    state.wikiSourceRows = [];
    state.wikiSourceSelected.clear();
    state.wikiProposalDocId = "";
    state.wikiProposalSelected.clear();
    state.reviewCandidates = [];
    state.reviewSelected.clear();
    state.reviewSourceRows = [];
    state.healthCandidates = [];
    state.healthSelected.clear();
    state.rawRecovery = null;
    state.evidenceView = null;
    return true;
  }

  async function openModal() {
    if (state.busy || state.syncing) return;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.hidden = false;
    setBusy(true, "기억 보관함을 불러오는 중…");
    try {
      await loadUiState();
      await loadChats();
      await loadCurrentChat();
      await loadConnections();
      await checkNewSummaries({ refreshChat: false, baselineIfUnknown: true, renderAfter: false });
      saveUiState();
    } catch (error) {
      console.error("[기억 보관함] load failed", error);
      toast(`불러오기 실패: ${error.message}`, true);
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }

  function captureDraft() {
    if (!state.draft) return;
    state.draft.title = String(document.getElementById("mmc-draft-title")?.value || "").trim();
    state.draft.content = String(document.getElementById("mmc-draft-content")?.value || "").trim();
    state.draft.priority = String(document.getElementById("mmc-draft-priority")?.value || "normal");
    if (state.draft.type === "anchor") {
      state.draft.category = String(document.getElementById("mmc-draft-category")?.value || "setting");
      state.draft.activation = String(document.getElementById("mmc-draft-activation")?.value || "always") === "keyword" ? "keyword" : "always";
      state.draft.keywords = String(document.getElementById("mmc-draft-keywords")?.value || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 24);
      state.draft.lifespan = Object.prototype.hasOwnProperty.call(ANCHOR_LIFESPAN_LABEL, document.getElementById("mmc-draft-lifespan")?.value) ? document.getElementById("mmc-draft-lifespan").value : "permanent";
      state.draft.archived = Boolean(document.getElementById("mmc-draft-archived")?.checked);
      if (state.draft.archived) state.draft.active = false;
    } else {
      state.draft.status = String(document.getElementById("mmc-draft-status")?.value || "active");
      state.draft.scheduleText = String(document.getElementById("mmc-draft-schedule")?.value || "").trim();
    }
  }

  function selectedSourceRows() { return state.sourceRows.filter((row) => state.sourceSelected.has(String(row.id))); }
  function sourceToText(rows = selectedSourceRows()) {
    if (state.sourceMode === "summaries") return rows.map((row) => `[${row.title || "요약"}]\n${row.content || ""}`).join("\n\n");
    return rows.map((row) => `${roleLabel(row.role)}: ${row.content || ""}`).join("\n\n");
  }

  async function openSource(mode, target) {
    state.sourceMode = mode === "summaries" ? "summaries" : "messages";
    state.sourceTarget = target === "promise" ? "promise" : "anchor";
    state.sourceSelected.clear();
    setBusy(true, state.sourceMode === "summaries" ? "요약을 불러오는 중…" : "최근 대화를 불러오는 중…");
    try {
      if (state.sourceMode === "summaries") {
        const fresh = await api(`chats/${encodeURIComponent(state.selectedChatId)}`);
        state.currentChat = { ...state.currentChat, ...fresh, metadata: parseRecord(fresh?.metadata) };
        const meta = parseRecord(fresh?.metadata);
        let entries = safeArray(meta.summaryEntries).filter((row) => row && String(row.content || "").trim());
        if (!entries.length && String(meta.summary || "").trim()) entries = [{ id: "legacy-summary", title: "현재 통합 요약", content: String(meta.summary), origin: "legacy", enabled: true }];
        state.sourceRows = entries.filter((row) => row.enabled !== false).slice().sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))).slice(0, 80);
      } else {
        const payload = await api(`chats/${encodeURIComponent(state.selectedChatId)}/messages?limit=120`);
        state.sourceRows = extractArray(payload, ["messages", "items", "results"]).filter((row) => ["user", "assistant"].includes(String(row.role || "")) && String(row.content || "").trim()).slice(-80).reverse();
      }
      state.layer = "source";
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }

  function makeLocalDraft(targetOverride = "") {
    const rows = selectedSourceRows();
    if (!rows.length) throw new Error("가져올 원문을 선택해 주세요.");
    const fullText = sourceToText(rows);
    const text = fullText.slice(0, 16000);
    const sourceQuote = fullText.slice(0, 12000);
    const sourceIds = rows.map((row) => String(row.id || "")).filter(Boolean);
    const target = targetOverride === "promise" || targetOverride === "anchor" ? targetOverride : state.sourceTarget;
    if (target === "anchor") {
      const first = rows[0];
      state.draft = normalizeAnchor({
        id: "",
        title: state.sourceMode === "summaries" ? String(first?.title || "요약에서 가져온 기억") : "대화에서 가져온 기억",
        content: text,
        sourceType: state.sourceMode === "summaries" ? "summary" : "message",
        sourceIds,
        sourceQuote,
      });
    } else {
      state.draft = normalizePromise({
        id: "",
        title: state.sourceMode === "summaries" ? "요약에서 가져온 약속" : "대화에서 가져온 약속",
        content: text,
        sourceType: state.sourceMode === "summaries" ? "summary" : "message",
        sourceIds,
        sourceQuote,
      });
    }
    state.draft.id = "";
    state.layer = "editor";
    render();
  }

  function extractGeneratedText(payload) {
    if (typeof payload === "string") return payload.trim();
    const seen = new Set();
    const walk = (value, depth = 0) => {
      if (depth > 9 || value == null) return "";
      if (typeof value === "string") return value.trim();
      if (typeof value !== "object" || seen.has(value)) return "";
      seen.add(value);
      if (Array.isArray(value)) {
        const parts = value.map((item) => walk(item, depth + 1)).filter(Boolean);
        return parts.join("\n").trim();
      }
      for (const key of ["content", "text", "output_text", "output", "response", "message"]) {
        const candidate = value?.[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
        const nested = walk(candidate, depth + 1); if (nested) return nested;
      }
      for (const key of ["data", "result"]) { const nested = walk(value?.[key], depth + 1); if (nested) return nested; }
      const choice = Array.isArray(value?.choices) ? value.choices[0] : null;
      if (choice) { const nested = walk(choice, depth + 1); if (nested) return nested; }
      return "";
    };
    return walk(payload);
  }

  function collectBalancedJsonFragments(text) {
    const raw = String(text || "");
    const out = [];
    const seen = new Set();
    const push = (value) => {
      const v = String(value || "").trim();
      if (!v || seen.has(v)) return;
      seen.add(v); out.push(v);
    };
    push(raw);
    for (const match of raw.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)) push(match[1]);
    const stack = [];
    let start = -1;
    let quote = "";
    let escaped = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (stack.length && (ch === '"' || ch === "'")) { quote = ch; continue; }
      if (ch === "[" || ch === "{") {
        if (!stack.length) start = i;
        stack.push(ch);
        continue;
      }
      if (ch === "]" || ch === "}") {
        if (!stack.length) continue;
        const open = stack[stack.length - 1];
        if ((open === "[" && ch !== "]") || (open === "{" && ch !== "}")) { stack.length = 0; start = -1; continue; }
        stack.pop();
        if (!stack.length && start >= 0) { push(raw.slice(start, i + 1)); start = -1; }
      }
    }
    return out;
  }

  function repairJsonishText(value) {
    const raw = String(value || "").replace(/^\uFEFF/, "").trim();
    let out = "";
    let quote = "";
    let escaped = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      const next = raw[i + 1];
      if (!quote) {
        if (ch === "/" && next === "/") { while (i < raw.length && raw[i] !== "\n") i += 1; out += "\n"; continue; }
        if (ch === "/" && next === "*") { i += 2; while (i < raw.length - 1 && !(raw[i] === "*" && raw[i + 1] === "/")) i += 1; i += 1; continue; }
        if (ch === '"') { quote = '"'; escaped = false; out += ch; continue; }
        if (ch === "'") { quote = "'"; escaped = false; out += '"'; continue; }
        out += ch;
        continue;
      }
      if (quote === '"') {
        out += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quote = "";
        continue;
      }
      if (escaped) {
        if (ch === "'") out += "'";
        else if (ch === '"') out += '\\"';
        else out += `\\${ch}`;
        escaped = false;
        continue;
      }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === "'") { out += '"'; quote = ""; continue; }
      if (ch === '"') { out += '\\"'; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    }
    if (quote === "'") out += '"';

    let fixed = "";
    quote = ""; escaped = false;
    let outside = "";
    const flushOutside = () => {
      if (!outside) return;
      outside = outside
        .replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null")
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*(?=[}\]])/g, "");
      fixed += outside; outside = "";
    };
    for (let i = 0; i < out.length; i += 1) {
      const ch = out[i];
      if (!quote) {
        if (ch === '"') { flushOutside(); quote = '"'; escaped = false; fixed += ch; }
        else outside += ch;
        continue;
      }
      fixed += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quote = "";
    }
    flushOutside();
    return fixed.trim();
  }

  function rowsFromParsedModel(parsed, mode = "generic") {
    if (Array.isArray(parsed)) return parsed;
    if (!isRecord(parsed)) return null;
    const genericKeys = ["items", "candidates", "results", "records", "suggestions", "memories", "updates", "actions", "entries", "output"];
    for (const key of genericKeys) if (Array.isArray(parsed[key])) return parsed[key];
    for (const key of [...genericKeys, "data", "result", "response", "payload"]) {
      if (isRecord(parsed[key])) { const nested = rowsFromParsedModel(parsed[key], mode); if (nested) return nested; }
    }
    if (Array.isArray(parsed.data)) return parsed.data;

    if (mode === "review" || mode === "health" || mode === "mixed-candidate") {
      const merged = [];
      const promiseRows = parsed.promises || parsed.promise || parsed.promiseItems;
      const anchorRows = parsed.anchors || parsed.anchor || parsed.memoryAnchors || parsed.memory_anchors;
      if (Array.isArray(promiseRows)) promiseRows.forEach((row) => merged.push(isRecord(row) && !row.type ? { ...row, type: "promise" } : row));
      if (Array.isArray(anchorRows)) anchorRows.forEach((row) => merged.push(isRecord(row) && !row.type ? { ...row, type: "anchor" } : row));
      if (merged.length || Array.isArray(promiseRows) || Array.isArray(anchorRows)) return merged;
    } else if (mode === "anchor") {
      for (const key of ["anchors", "memoryAnchors", "memory_anchors"]) if (Array.isArray(parsed[key])) return parsed[key];
    } else if (mode === "promise") {
      for (const key of ["promises", "promiseItems"]) if (Array.isArray(parsed[key])) return parsed[key];
    }

    if (mode === "review" || mode === "health") {
      if (parsed.action || parsed.targetId) return [parsed];
    } else if (mode === "mixed-candidate") {
      if ((parsed.type === "promise" || parsed.type === "anchor") && (parsed.title || parsed.content || parsed.text)) return [parsed];
    } else if (parsed.title || parsed.content || parsed.text) return [parsed];
    const values = Object.values(parsed);
    if (values.length && values.every((row) => isRecord(row))) return values;
    return null;
  }

  function parseModelRows(text, mode = "generic") {
    const fragments = collectBalancedJsonFragments(text);
    for (const fragment of fragments) {
      for (const candidate of [fragment, repairJsonishText(fragment)]) {
        if (!candidate) continue;
        try {
          const parsed = JSON.parse(candidate);
          const rows = rowsFromParsedModel(parsed, mode);
          if (rows !== null) return { ok: true, rows, repaired: candidate !== fragment };
        } catch {}
      }
    }
    return { ok: false, rows: [], repaired: false };
  }

  function parseCandidateJson(text) {
    return parseModelRows(text, "mixed-candidate");
  }

  function parseJsonArray(text, mode = "review") {
    return parseModelRows(text, mode);
  }

  function openRawRecovery(kind, text, rows = []) {
    state.rawRecovery = { kind, text: String(text || ""), rows: safeArray(rows).slice() };
    state.layer = "raw-repair";
    toast("모델 응답의 JSON 형식이 흔들렸습니다. 원문을 보존했으니 수정 없이 다시 읽거나 직접 고칠 수 있습니다.", true);
  }

  function normalizeCandidate(row) {
    if (!isRecord(row)) return null;
    const title = String(row.title || "").trim();
    const content = String(row.content || row.text || "").trim();
    const type = row.type === "promise" ? "promise" : row.type === "anchor" ? "anchor" : "";
    if (!title || !content || !type) return null;
    const titleKo = String(row.titleKo || "").trim();
    const contentKo = String(row.contentKo || "").trim();
    if (type === "promise") return normalizePromise({ id: "", title, content, titleKo, contentKo, priority: row.priority, scheduleText: row.scheduleText || row.schedule || "", sourceType: "model" });
    return normalizeAnchor({ id: "", title, content, titleKo, contentKo, category: row.category, priority: row.priority, activation: row.activation, keywords: safeArray(row.keywords), lifespan: row.lifespan, sourceType: "model" });
  }

  function modelSystemPrompt() {
    return [
      "Read the supplied roleplay source ONCE and classify useful continuity into PROMISE and MEMORY ANCHOR candidates in the same response.",
      "PROMISE = an explicit agreed future action, plan, appointment, duty, or commitment. Do not turn wishes, emotions, guesses, or general facts into promises.",
      "MEMORY ANCHOR = a relationship change, lasting current state, unresolved ongoing event, stable preference, canon fact, or explicit caution whose loss would materially break continuity.",
      "Avoid trivial scene details, speculative psychology, duplicates, and unsupported inference.",
      "Return JSON only: an array of 0-12 objects. Every object MUST include type (promise|anchor), title, content.",
      "For promise objects you may also return priority (high|normal|low) and scheduleText.",
      "For anchor objects you may also return category (relationship|state|event|preference|setting|caution), priority (high|normal|low), activation (always|keyword), keywords (array of 0-8 strings), lifespan (permanent|current_state|until_event).",
      "Use lifespan=permanent for durable canon/relationship facts, current_state for temporary states that should be replaced when changed, and until_event for unresolved threads that should retire when the event ends.",
      "Prefer always for facts that should persist every turn. Use keyword only for narrow facts that matter only when a topic returns.",
      "The first character of your response must be [ and the last character must be ]. Do not use Markdown fences or explanatory prose.",
      "Write titles and contents in the same language as the source. Do not translate an English roleplay into Korean.",
      "When the source is not Korean, also return titleKo and contentKo with a short Korean rendering for display only.",
      LANGUAGE_CONTRACT,
      KEYWORD_LANGUAGE_CONTRACT,
    ].join("\n");
  }

  function reviewSystemPrompt() {
    const schema = [
      "Return JSON only: an array of zero or more objects.",
      "The first character of your response must be [ and the last character must be ]. Do not use Markdown fences or explanatory prose.",
      "Each object: action (add|update|keep|complete|archive), type (promise|anchor), targetId, title, content, reason.",
      "For promise objects you may also return priority (high|normal|low) and scheduleText.",
      "For anchor objects you may also return category (relationship|state|event|preference|setting|caution), priority (high|normal|low), activation (always|keyword), keywords (array of 0-8 strings), lifespan (permanent|current_state|until_event).",
      "ADD must not use targetId. UPDATE/KEEP/COMPLETE/ARCHIVE must use an exact targetId from CURRENT MEMORY.",
      "COMPLETE is only for promises that were fulfilled. ARCHIVE is only for anchors whose old state is clearly obsolete. KEEP causes no change.",
      "You may also return titleKo and contentKo: a short Korean rendering used only for on-screen display.",
      "Do not invent facts. If nothing should change, return [].",
      LANGUAGE_CONTRACT,
      KEYWORD_LANGUAGE_CONTRACT,
    ].join("\n");
    return [state.reviewPrompt || DEFAULT_REVIEW_PROMPT, state.reviewExtraInstruction ? `[USER EXTRA INSTRUCTION]\n${state.reviewExtraInstruction}` : "", schema].filter(Boolean).join("\n\n");
  }

  function reviewMemorySnapshot() {
    return safeArray(state.currentData?.items).filter((item) => {
      if (item.type === "promise") return item.status === "active" || item.status === "hold";
      return item.type === "anchor" && item.active && !item.archived;
    }).map((item) => item.type === "promise"
      ? { id: item.id, type: "promise", title: item.title, content: item.content, status: item.status, priority: item.priority, scheduleText: item.scheduleText }
      : { id: item.id, type: "anchor", title: item.title, content: item.content, category: item.category, priority: item.priority, activation: item.activation, keywords: item.keywords, lifespan: item.lifespan });
  }

  function normalizeReviewCandidate(row) {
    if (!isRecord(row)) return null;
    const action = ["add", "update", "keep", "complete", "archive"].includes(String(row.action || "").toLowerCase()) ? String(row.action).toLowerCase() : "";
    const type = row.type === "promise" ? "promise" : row.type === "anchor" ? "anchor" : "";
    if (!action || !type) return null;
    if (action === "complete" && type !== "promise") return null;
    if (action === "archive" && type !== "anchor") return null;
    const targetId = String(row.targetId || "");
    const existing = targetId ? safeArray(state.currentData?.items).find((item) => item.id === targetId && item.type === type) : null;
    if (action !== "add" && !existing) return null;
    const title = String(row.title || existing?.title || "").trim();
    const content = String(row.content || row.text || existing?.content || "").trim();
    if (["add", "update"].includes(action) && (!title || !content)) return null;
    const base = { candidateId: String(row.candidateId || uid("rvc")), action, type, targetId, baseUpdatedAt: String(row.baseUpdatedAt || existing?.updatedAt || ""), title, content, titleKo: String(row.titleKo || "").trim(), contentKo: String(row.contentKo || "").trim(), reason: String(row.reason || "").trim(), priority: ["high", "normal", "low"].includes(row.priority) ? row.priority : existing?.priority || "normal" };
    if (type === "promise") return { ...base, scheduleText: String(row.scheduleText || row.schedule || existing?.scheduleText || "") };
    return { ...base, category: Object.prototype.hasOwnProperty.call(ANCHOR_CATEGORY_LABEL, row.category) ? row.category : existing?.category || "setting", activation: row.activation === "keyword" ? "keyword" : row.activation === "always" ? "always" : existing?.activation || "always", keywords: safeArray(row.keywords).map((x) => String(x).trim()).filter(Boolean).slice(0, 8), lifespan: Object.prototype.hasOwnProperty.call(ANCHOR_LIFESPAN_LABEL, row.lifespan) ? row.lifespan : existing?.lifespan || "permanent" };
  }

  function healthSystemPrompt() {
    const schema = [
      "You audit an existing roleplay working-memory list. Do not create new facts and do not propose ADD actions.",
      "Use the recent summaries only as evidence for whether a stored item became obsolete, completed, contradictory, or can be made shorter without losing meaning.",
      "Check especially: duplicate records, contradictory active states, current_state or until_event anchors that are now resolved, fulfilled promises, and overly verbose records that can be compressed.",
      "For duplicates, prefer UPDATE on the record that should remain and ARCHIVE on obsolete duplicate anchors. Never archive durable facts merely because they are old.",
      "COMPLETE is only for promises explicitly fulfilled in the supplied evidence. ARCHIVE is only for anchors clearly obsolete or duplicated. UPDATE must preserve supported facts.",
      "Return JSON only: an array of zero or more objects.",
      "The first character of your response must be [ and the last character must be ]. Do not use Markdown fences or explanatory prose.",
      "Each object: action (update|keep|complete|archive), type (promise|anchor), targetId, title, content, reason.",
      "For promise objects you may also return priority (high|normal|low) and scheduleText.",
      "For anchor objects you may also return category (relationship|state|event|preference|setting|caution), priority (high|normal|low), activation (always|keyword), keywords (array of 0-8 strings), lifespan (permanent|current_state|until_event).",
      "targetId must exactly match an id from CURRENT MEMORY. If no safe maintenance action is needed, return [].",
      "Write titles, contents, and reasons in the same language as the source.",
      "When the source is not Korean, also return titleKo and contentKo with a short Korean rendering for display only.",
      KEYWORD_LANGUAGE_CONTRACT,
    ].join("\n");
    return [schema, state.reviewExtraInstruction ? `[USER EXTRA INSTRUCTION]\n${state.reviewExtraInstruction}` : ""].filter(Boolean).join("\n\n");
  }

  function healthEvidenceRows() {
    return summaryRowsFromMetadata(state.currentChat?.metadata).slice(-6);
  }

  async function generateHealthCandidates() {
    if (!state.currentData) throw new Error("점검할 기억 보관함을 찾지 못했습니다.");
    const connectionId = String(state.modelConnectionId || chooseDefaultConnection(state.currentChat) || "");
    if (!connectionId) throw new Error("설정에서 기억 건강검진에 사용할 모델 연결을 선택해 주세요.");
    state.modelConnectionId = connectionId;
    await saveUiState();
    setBusy(true, "모델이 기억 보관함을 건강검진하는 중…");
    try {
      let evidence = healthEvidenceRows();
      if (!evidence.length) {
        try {
          const fresh = await api(`chats/${encodeURIComponent(state.selectedChatId)}`);
          if (fresh) {
            state.currentChat = { ...state.currentChat, ...fresh, id: String(fresh.id || state.selectedChatId), metadata: parseRecord(fresh.metadata) };
            evidence = healthEvidenceRows();
          }
        } catch {}
      }
      const snapshot = reviewMemorySnapshot();
      const plan = anchorInjectionPlan();
      const evidenceText = evidence.length ? sourceToTextForSummaryRows(evidence).slice(0, 50000) : "(No recent summary evidence available. In this case only suggest safe duplicate/compression maintenance; do not infer completion or obsolescence.)";
      const payload = await api("generate/raw", {
        method: "POST", timeoutMs: MODEL_TIMEOUT_MS,
        body: {
          connectionId, runId: uid("memory-health"), streaming: false,
          messages: [
            { role: "system", content: healthSystemPrompt() },
            { role: "user", content: `[CURRENT MEMORY]\n${JSON.stringify(snapshot, null, 2)}\n[/CURRENT MEMORY]\n\n[WORKING MEMORY BUDGET]\nAlways-anchor budget: ${plan.budget} characters; currently selected ${plan.selected.length}/${plan.candidates.length}, line characters ${plan.used}.\n[/WORKING MEMORY BUDGET]\n\n[RECENT SUMMARY EVIDENCE]\n${evidenceText}\n[/RECENT SUMMARY EVIDENCE]` },
          ],
          parameters: { maxTokens: 2800, reasoningEffort: null },
        },
      });
      const output = extractGeneratedText(payload);
      const parsedResult = parseJsonArray(output, "health");
      if (!parsedResult.ok) { openRawRecovery("health", output); return; }
      const rawRows = parsedResult.rows;
      state.healthCandidates = rawRows.map(normalizeReviewCandidate).filter((item) => item && item.action !== "add").slice(0, 20);
      state.healthSelected = new Set(state.healthCandidates.map((item, i) => item.action === "keep" ? null : String(i)).filter(Boolean));
      state.layer = "health-candidates";
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }

  function sourceToTextForSummaryRows(rows) {
    return safeArray(rows).map((row) => `[${row.title || "요약"}]\n${row.content || ""}`).join("\n\n");
  }

  async function applyHealthCandidates() {
    const chosen = state.healthCandidates.filter((_, i) => state.healthSelected.has(String(i)) && state.healthCandidates[i].action !== "keep");
    if (!chosen.length) throw new Error("적용할 건강검진 변경을 선택해 주세요.");
    const data = await freshOwnedData();
    const evidence = healthEvidenceRows();
    const sourceIds = evidence.map((row) => String(row.id || "")).filter(Boolean);
    const sourceQuote = sourceToTextForSummaryRows(evidence).slice(0, 12000);
    const stamp = nowIso();
    const conflicts = [];
    let applied = 0;
    for (const item of chosen) {
      const index = data.items.findIndex((row) => row.id === item.targetId && row.type === item.type);
      if (index < 0) { conflicts.push(item); continue; }
      const existing = data.items[index];
      if (item.baseUpdatedAt && existing.updatedAt !== item.baseUpdatedAt) { conflicts.push(item); continue; }
      if (item.action === "update") {
        const mergedSources = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds]));
        data.items[index] = item.type === "promise"
          ? normalizePromise({ ...existing, title: item.title, content: item.content, titleKo: item.titleKo || existing.titleKo, contentKo: item.contentKo || existing.contentKo, priority: item.priority, scheduleText: item.scheduleText, sourceType: "health-check", sourceIds: mergedSources, sourceQuote: sourceQuote || existing.sourceQuote, updatedAt: stamp })
          : normalizeAnchor({ ...existing, title: item.title, content: item.content, titleKo: item.titleKo || existing.titleKo, contentKo: item.contentKo || existing.contentKo, category: item.category, priority: item.priority, activation: item.activation, keywords: item.keywords, lifespan: item.lifespan, sourceType: "health-check", sourceIds: mergedSources, sourceQuote: sourceQuote || existing.sourceQuote, updatedAt: stamp });
      } else if (item.action === "complete" && existing.type === "promise") {
        existing.status = "done"; existing.sourceType = "health-check"; existing.sourceIds = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds])); existing.sourceQuote = sourceQuote || existing.sourceQuote; existing.updatedAt = stamp;
      } else if (item.action === "archive" && existing.type === "anchor") {
        existing.archived = true; existing.active = false; existing.sourceType = "health-check"; existing.sourceIds = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds])); existing.sourceQuote = sourceQuote || existing.sourceQuote; existing.updatedAt = stamp;
      } else continue;
      applied += 1;
    }
    if (applied) await persistData(data);
    if (conflicts.length) {
      const conflictSet = new Set(conflicts);
      state.healthCandidates = state.healthCandidates.filter((item) => conflictSet.has(item));
      state.healthSelected.clear();
      state.layer = "health-candidates";
      toast(`${applied}개 반영 · 충돌 ${conflicts.length}개는 원본을 보호하고 남겨뒀습니다.`, true);
    } else {
      state.healthCandidates = []; state.healthSelected.clear(); state.layer = null;
      toast(`${applied}개 건강검진 변경을 반영했습니다.`);
    }
    render();
  }

  async function generateReviewCandidates(rows = selectedSourceRows(), { showLayer = true } = {}) {
    if (!rows.length) throw new Error("정리할 새 요약을 선택해 주세요.");
    const connectionId = String(document.getElementById("mmc-source-model")?.value || state.modelConnectionId || "");
    if (!connectionId) throw new Error("사용할 모델 연결을 선택해 주세요.");
    state.modelConnectionId = connectionId;
    await saveUiState();
    setBusy(true, "모델이 약속과 기억 앵커를 함께 비교하는 중…");
    try {
      const sourceText = sourceToText(rows).slice(0, 100000);
      const snapshot = reviewMemorySnapshot();
      const payload = await api("generate/raw", {
        method: "POST", timeoutMs: MODEL_TIMEOUT_MS,
        body: {
          connectionId, runId: uid("memory-review"), streaming: false,
          messages: [
            { role: "system", content: reviewSystemPrompt() },
            { role: "user", content: `[CURRENT MEMORY — MAY BE UPDATED]\n${JSON.stringify(snapshot, null, 2)}\n[/CURRENT MEMORY]\n\n[NEW SUMMARY — SOURCE OF NEW FACTS]\n${sourceText}\n[/NEW SUMMARY]` },
          ],
          parameters: { maxTokens: 3000, reasoningEffort: null },
        },
      });
      const output = extractGeneratedText(payload);
      const parsedResult = parseJsonArray(output, "review");
      if (!parsedResult.ok) { openRawRecovery("review", output, rows); return false; }
      const rawRows = parsedResult.rows;
      state.reviewCandidates = rawRows.map(normalizeReviewCandidate).filter(Boolean).slice(0, 20);
      state.reviewSelected = new Set(state.reviewCandidates.map((item, i) => item.action === "keep" ? null : String(i)).filter(Boolean));
      state.reviewSourceRows = rows.slice();
      await persistPendingReview();
      if (showLayer) state.layer = "review-candidates";
      return true;
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }

  async function openPendingReview({ runModel = false } = {}) {
    await checkNewSummaries({ refreshChat: true, baselineIfUnknown: true, renderAfter: false });
    if (!state.pendingSummaryRows.length) { toast("새로 검토할 요약이 없습니다."); render(); return; }
    state.sourceMode = "summaries";
    state.sourceTarget = "review";
    state.sourceRows = state.pendingSummaryRows.slice();
    state.sourceSelected = new Set(state.sourceRows.map((row) => String(row.id || "")));
    state.layer = "source";
    render();
    if (runModel) await generateReviewCandidates(state.sourceRows);
  }

  async function applyReviewCandidates({ auto = false } = {}) {
    const chosen = state.reviewCandidates.map((item, index) => ({ item, index })).filter(({ item, index }) => state.reviewSelected.has(String(index)) && item.action !== "keep");
    if (!chosen.length) throw new Error("적용할 변경을 선택해 주세요.");
    const data = await freshOwnedData();
    const sourceIds = state.reviewSourceRows.map((row) => String(row.id || "")).filter(Boolean);
    const sourceQuote = state.reviewSourceRows.map((row) => `[${row.title || "요약"}]\n${row.content || ""}`).join("\n\n").slice(0, 12000);
    const now = nowIso();
    const conflicts = [];
    const applied = [];
    const undo = { createdAt: now, sourceBatchKey: summaryBatchKey(state.reviewSourceRows), updated: [], created: [] };
    for (const { item, index: candidateIndex } of chosen) {
      if (item.action === "add") {
        const created = item.type === "promise"
          ? normalizePromise({ ...item, id: uid("promise"), sourceType: "summary-model-review", sourceIds, sourceQuote, createdAt: now, updatedAt: now })
          : normalizeAnchor({ ...item, id: uid("anchor"), sourceType: "summary-model-review", sourceIds, sourceQuote, createdAt: now, updatedAt: now });
        data.items.unshift(created);
        undo.created.push({ id: created.id, appliedUpdatedAt: created.updatedAt });
        applied.push(candidateIndex);
        continue;
      }
      const index = data.items.findIndex((row) => row.id === item.targetId && row.type === item.type);
      if (index < 0) { conflicts.push({ item, reason: "원본 기록 없음" }); continue; }
      const existing = data.items[index];
      if (item.baseUpdatedAt && existing.updatedAt !== item.baseUpdatedAt) { conflicts.push({ item, reason: "후보 생성 뒤 원본 수정됨" }); continue; }
      const before = JSON.parse(JSON.stringify(existing));
      if (item.action === "update") {
        const mergedSources = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds]));
        data.items[index] = item.type === "promise"
          ? normalizePromise({ ...existing, title: item.title, content: item.content, titleKo: item.titleKo || existing.titleKo, contentKo: item.contentKo || existing.contentKo, priority: item.priority, scheduleText: item.scheduleText, sourceType: "summary-model-review", sourceIds: mergedSources, sourceQuote, updatedAt: now })
          : normalizeAnchor({ ...existing, title: item.title, content: item.content, titleKo: item.titleKo || existing.titleKo, contentKo: item.contentKo || existing.contentKo, category: item.category, priority: item.priority, activation: item.activation, keywords: item.keywords, lifespan: item.lifespan, sourceType: "summary-model-review", sourceIds: mergedSources, sourceQuote, updatedAt: now });
      } else if (item.action === "complete" && existing.type === "promise") {
        existing.status = "done"; existing.sourceType = "summary-model-review"; existing.sourceIds = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds])); existing.sourceQuote = sourceQuote || existing.sourceQuote; existing.updatedAt = now;
      }
      else if (item.action === "archive" && existing.type === "anchor") {
        existing.archived = true; existing.active = false; existing.sourceType = "summary-model-review"; existing.sourceIds = Array.from(new Set([...safeArray(existing.sourceIds).map(String), ...sourceIds])); existing.sourceQuote = sourceQuote || existing.sourceQuote; existing.updatedAt = now;
      }
      else continue;
      undo.updated.push({ id: existing.id, before, appliedUpdatedAt: data.items[index].updatedAt });
      applied.push(candidateIndex);
    }
    if (!applied.length && conflicts.length) {
      state.currentData = data;
      state.reviewSelected.clear();
      await persistPendingReview();
      toast(`충돌 ${conflicts.length}개 · 후보 생성 뒤 수정된 원본은 덮어쓰지 않았습니다.`, true);
      render();
      return;
    }
    data.lastAutoReviewUndo = auto && applied.length ? undo : data.lastAutoReviewUndo;
    if (!conflicts.length) data.pendingReview = null;
    await persistData(data);
    if (conflicts.length) {
      const conflictKeys = new Set(conflicts.map(({ item }) => item));
      state.reviewCandidates = state.reviewCandidates.filter((item) => conflictKeys.has(item));
      state.reviewSelected = new Set();
      state.layer = "review-candidates";
      await persistPendingReview();
      toast(`${applied.length}개 반영 · 충돌 ${conflicts.length}개는 원본을 보호하고 남겨뒀습니다.`, true);
      render();
      return;
    }
    await markSummaryRowsReviewed(state.reviewSourceRows);
    state.reviewCandidates = []; state.reviewSelected.clear(); state.reviewSourceRows = []; state.layer = null;
    toast(auto ? `자동 정리로 ${applied.length}개 변경을 반영했습니다. 1회 되돌리기가 가능합니다.` : `${applied.length}개 변경을 반영했습니다.`);
    render();
  }

  async function undoAutoReview() {
    const data = await freshOwnedData();
    const undo = data.lastAutoReviewUndo;
    if (!undo) throw new Error("되돌릴 자동 적용 기록이 없습니다.");
    let restored = 0;
    let removed = 0;
    let skipped = 0;
    for (const row of safeArray(undo.updated)) {
      const index = data.items.findIndex((item) => item.id === row.id);
      if (index < 0 || data.items[index].updatedAt !== row.appliedUpdatedAt) { skipped += 1; continue; }
      data.items[index] = normalizeItem(row.before);
      restored += 1;
    }
    const createdById = new Map(safeArray(undo.created).map((row) => [row.id, row]));
    data.items = data.items.filter((item) => {
      const row = createdById.get(item.id);
      if (!row) return true;
      if (item.updatedAt !== row.appliedUpdatedAt) { skipped += 1; return true; }
      removed += 1;
      return false;
    });
    data.lastAutoReviewUndo = null;
    await persistData(data);
    toast(`자동 적용 되돌리기 완료 · 복원 ${restored}개 · 신규 제거 ${removed}개${skipped ? ` · 직접 수정 보호 ${skipped}개` : ""}`);
    render();
  }

  async function generateCandidates() {
    const rows = selectedSourceRows();
    if (!rows.length) throw new Error("원문을 선택해 주세요.");
    const connectionId = String(document.getElementById("mmc-source-model")?.value || state.modelConnectionId || "");
    if (!connectionId) throw new Error("사용할 모델 연결을 선택해 주세요.");
    state.modelConnectionId = connectionId;
    await saveUiState();
    setBusy(true, "모델이 약속과 기억 앵커를 한 번에 분류하는 중…");
    try {
      const text = sourceToText(rows).slice(0, 100000);
      const payload = await api("generate/raw", {
        method: "POST",
        timeoutMs: MODEL_TIMEOUT_MS,
        body: {
          connectionId,
          runId: uid("memory-candidate"),
          streaming: false,
          messages: [
            { role: "system", content: modelSystemPrompt() },
            { role: "user", content: `[SOURCE — READ ONLY]\n${text}\n[/SOURCE]` },
          ],
          parameters: { maxTokens: 1800, reasoningEffort: null },
        },
      });
      const output = extractGeneratedText(payload);
      const parsedResult = parseCandidateJson(output);
      if (!parsedResult.ok) { openRawRecovery("candidate", output, rows); return; }
      const parsed = parsedResult.rows.map(normalizeCandidate).filter(Boolean).slice(0, 12);
      if (!parsed.length && parsedResult.rows.length) { openRawRecovery("candidate", output, rows); return; }
      const quote = sourceToText(rows).slice(0, 12000);
      const ids = rows.map((row) => String(row.id || "")).filter(Boolean);
      state.candidates = parsed.map((item) => ({ ...item, id: "", sourceType: "model", sourceIds: ids, sourceQuote: quote }));
      state.candidateSelected = new Set(parsed.map((_, i) => String(i)));
      state.layer = "candidates";
    } finally {
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    }
  }

  function chooseMemoryImport() {
    const chatId = state.selectedChatId;
    if (!chatId) { toast("채팅을 먼저 열어 주세요.", true); return; }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_IMPORT_BYTES) throw new Error("10 MiB 이하의 JSON을 선택해 주세요.");
        const raw = parseImport(await file.text());
        if (host.getCurrentChatId() !== chatId || state.selectedChatId !== chatId) throw new Error("채팅이 바뀌었습니다. 현재 채팅에서 다시 가져와 주세요.");
        const count = safeArray(raw.items).length + safeArray(raw.elementMemory?.entities).length + safeArray(raw.wiki?.docs).length;
        if (!window.confirm(`이 JSON의 기억 ${count}개로 현재 채팅의 보관함을 교체할까요?\n기존 기억은 JSON으로 내려받고 채팅 안에도 직전 가져오기 백업을 남깁니다. 원본 메시지는 바꾸지 않습니다.`)) return;
        setBusy(true, "기억 데이터를 가져오는 중…");
        const previous = parseRecord(state.currentChat?.metadata)[DATA_KEY];
        if (previous && hasMeaningfulMemoryData(previous)) downloadJson(exportData(previous), "memory-vault-before-import.json");
        const data = resetManagedPointersForOwner(raw, chatId).data;
        data.elementMemory.connectionId = "";
        data.wiki.connectionId = "";
        await patchChatMetadata(chatId, { [DATA_KEY]: data, ...(previous ? { memoryVaultImportBackup: previous } : {}) });
        await loadCurrentChat();
        await syncLorebook({ silent: true });
        state.layer = null;
        toast(`기억 ${count}개를 현재 채팅으로 가져왔습니다.`);
      } catch (error) { toast(error.message, true); }
      finally { setBusy(false); render(); }
    }, { once: true });
    input.click();
  }

  async function importLegacy() {
    const legacy = parseRecord(state.currentChat?.metadata)[LEGACY_PROMISE_KEY];
    if (!isRecord(legacy)) throw new Error("가져올 기존 약속보관함 데이터가 없습니다.");
    const data = normalizeData(state.currentData);
    const existingFingerprints = new Set(data.items.map((item) => `${item.type}|${item.title}|${item.content}`));
    let added = 0;
    for (const old of safeArray(legacy.items)) {
      const item = old.type === "note"
        ? normalizeAnchor({
            title: old.title || "기존 주요사항",
            content: old.content || old.note || old.quote || "",
            category: "setting",
            priority: old.priority,
            active: old.status === "active",
            archived: old.status !== "active",
            sourceType: "legacy-promise-keeper",
            sourceIds: old.sourceMessageId ? [old.sourceMessageId] : [],
            sourceQuote: old.quote || "",
            createdAt: old.createdAt,
            updatedAt: old.updatedAt,
          })
        : normalizePromise({
            title: old.title || "기존 약속",
            content: old.content || old.note || old.quote || "",
            status: old.status,
            priority: old.priority,
            scheduleText: old.scheduleText,
            sourceType: "legacy-promise-keeper",
            sourceIds: old.sourceMessageId ? [old.sourceMessageId] : [],
            sourceQuote: old.quote || "",
            createdAt: old.createdAt,
            updatedAt: old.updatedAt,
          });
      const fp = `${item.type}|${item.title}|${item.content}`;
      if (!item.content.trim() || existingFingerprints.has(fp)) continue;
      existingFingerprints.add(fp);
      data.items.push(item);
      added += 1;
    }
    data.legacyImportedAt = nowIso();
    await persistData(data);
    toast(`${added}개 기록을 복사해 가져왔습니다. 기존 약속보관함 원본은 유지됩니다.`);
  }

  async function handleClick(event) {
    const actionEl = event.target.closest?.("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (state.busy || state.syncing || state.actionPending) return;
    state.actionPending = true;
    try {
      if (action === "export-memory") { downloadJson(exportData(state.currentData), "memory-vault.json"); return; }
      if (action === "import-memory") { chooseMemoryImport(); return; }
      if (String(action || "").startsWith("wiki-") || String(action || "").startsWith("reset-wiki-")) { if (await handleWikiAction(action, actionEl)) return; }
      if (action === "overlay-close" && event.target !== actionEl) return;
      if (action === "overlay-close" || action === "close") return closeModal();
      if (action === "close-layer" && event.target.closest?.("[data-layer-stop]") && !event.target.closest?.(".mmc-icon-btn, footer")) return;
      if (action === "close-layer") { requestCloseLayer(); return; }
      if (action === "dismiss-agent-note") {
        const id = String(actionEl.dataset.id || "");
        if (!id) return;
        state.agentNoticeDismissed = { ...parseRecord(state.agentNoticeDismissed), [id]: true };
        await saveUiState();
        render();
        return;
      }
      if (action === "help") { state.helpTab = "usage"; state.layer = "help"; render(); return; }
      if (action === "help-tab") { state.helpTab = actionEl.dataset.helpTab === "features" ? "features" : "usage"; render(); return; }
      if (action === "settings") { state.settingsTab = "screen"; state.layer = "settings"; render(); return; }
      if (action === "open-theme-settings") { state.settingsTab = "screen"; state.layer = "settings"; render(); return; }
      if (action === "settings-tab") {
        // 탭 전환은 다시 그리지 않는다. 입력 중인 값이 사라지지 않게 DOM만 바꾼다.
        const next = String(actionEl.dataset.settingsTab || "screen");
        state.settingsTab = next;
        const layer = actionEl.closest?.(".mmc-layer");
        layer?.querySelectorAll?.("[data-settings-pane]").forEach((node) => { node.hidden = node.dataset.settingsPane !== next; });
        layer?.querySelectorAll?.("[data-settings-tab]").forEach((node) => node.classList.toggle("is-active", node.dataset.settingsTab === next));
        const body = layer?.querySelector?.(".mmc-layer-body");
        if (body) body.scrollTop = 0;
        return;
      }
      if (action === "inject-preview") { state.layer = "inject-preview"; render(); return; }
      if (action === "promise-open") {
        state.promiseSelectedId = String(actionEl.dataset.id || "");
        state.promisePane = "detail";
        render(); return;
      }
      if (action === "promise-back") { state.promisePane = "list"; render(); return; }
      if (action === "promise-status") {
        const next = String(actionEl.dataset.status || "");
        if (!Object.prototype.hasOwnProperty.call(PROMISE_STATUS_LABEL, next)) return;
        const data = normalizeData(state.currentData); const item = data.items.find((x) => x.id === actionEl.dataset.id && x.type === "promise"); if (!item || item.status === next) return;
        item.status = next; item.updatedAt = nowIso(); await persistData(data); render(); return;
      }
      if (action === "anchor-move") {
        const data = normalizeData(state.currentData); const item = data.items.find((x) => x.id === actionEl.dataset.id && x.type === "anchor"); if (!item) return;
        if (item.activation !== "keyword" && !safeArray(item.keywords).length) {
          state.draft = { ...item, activation: "keyword", keywords: [], sourceIds: safeArray(item.sourceIds).slice() };
          state.layer = "editor"; render();
          toast("키워드로 떠오르게 하려면 키워드를 하나 이상 넣어 주세요.");
          return;
        }
        item.activation = item.activation === "keyword" ? "always" : "keyword"; item.updatedAt = nowIso(); await persistData(data); render(); return;
      }
      if (action === "restore-memory-backup") {
        if (!window.confirm("현재 metadata 대신 이 RP 전용 로어북의 비활성 백업으로 기억을 복구할까요? 격리 중인 다른 RP 데이터는 적용하지 않습니다.")) return;
        await restoreFromMatchingBackup(); return;
      }
      if (action === "confirm-quarantined-memory") {
        if (!window.confirm("격리된 기억을 현재 RP의 독립 복사본으로 확정할까요? 표시된 소유 RP가 다른 방이라면 의도적으로 복사하는 작업입니다. 기존 소유 방의 로어북은 수정하지 않습니다.")) return;
        await confirmQuarantinedDataForCurrentChat(); return;
      }
      if (action === "view-evidence") { state.evidenceView = { kind: String(actionEl.dataset.kind || "item"), id: String(actionEl.dataset.id || "") }; state.layer = "evidence"; render(); return; }
      if (action === "health-check") { await generateHealthCandidates(); return; }
      if (action === "review-pending") { await openPendingReview({ runModel: false }); return; }
      if (action === "review-model") { await openPendingReview({ runModel: true }); return; }
      if (action === "open-review-draft") { state.layer = "review-candidates"; render(); return; }
      if (action === "undo-auto-review") { if (!window.confirm("직전 자동 적용을 되돌릴까요? 이후 직접 수정한 기록은 보호하고 건너뜁니다.")) return; await undoAutoReview(); return; }
      if (action === "tab") {
        const nextTab = String(actionEl.dataset.tab || "promise");
        state.activeTab = TAB_IDS.includes(nextTab) ? nextTab : "overview";
        state.filter = "active";
        state.promisePane = "list";
        saveUiState(); render(); return;
      }
      if (action === "set-filter") { state.filter = actionEl.dataset.filter || "active"; saveUiState(); render(); return; }
      if (action === "expand-list") { state.expanded[actionEl.dataset.type] = true; saveUiState(); render(); return; }
      if (action === "collapse-list") { state.expanded[actionEl.dataset.type] = false; saveUiState(); render(); return; }
      if (action === "element-settings") { state.layer = "element-settings"; render(); return; }
      if (action === "new-element") { state.elementDraft = normalizeElement({ id: "", name: "" }); state.elementDraft.id = ""; state.layer = "element-editor"; render(); return; }
      if (action === "edit-element") {
        const entity = elementMemory().entities.find((row) => row.id === actionEl.dataset.id);
        if (!entity) return;
        state.elementDraft = JSON.parse(JSON.stringify(entity)); state.layer = "element-editor"; render(); return;
      }
      if (action === "delete-element") {
        const id = String(actionEl.dataset.id || state.elementDraft?.id || "");
        if (!id || !window.confirm("이 요소 기억을 삭제할까요? 전용 로어북 검색에서도 빠집니다.")) return;
        const data = normalizeData(state.currentData); data.elementMemory.entities = data.elementMemory.entities.filter((row) => row.id !== id);
        await persistData(data); state.layer = null; state.elementDraft = null; render(); return;
      }
      if (action === "save-element") {
        const lines = (id, max) => String(document.getElementById(id)?.value || "").split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, max);
        const name = String(document.getElementById("mmc-element-name")?.value || "").trim().slice(0, 80);
        if (!name) throw new Error("요소 이름을 입력해 주세요.");
        const aliases = normalizeTextList(lines("mmc-element-aliases", 8), 8, 80);
        const standaloneTriggers = normalizeTextList(lines("mmc-element-triggers", 8), 8, 80);
        const triggerGroups = normalizeTriggerGroups(lines("mmc-element-groups", 8).map((line) => line.split(/[,＋+]/)));
        const currentTexts = lines("mmc-element-current", Number.MAX_SAFE_INTEGER).map((x) => x.slice(0, 300));
        const historyTexts = lines("mmc-element-history", Number.MAX_SAFE_INTEGER).map((x) => x.slice(0, 300));
        if (!currentTexts.length && !historyTexts.length) throw new Error("현재 사실이나 이력을 하나 이상 입력해 주세요.");
        const data = normalizeData(state.currentData); const memory = data.elementMemory; const now = nowIso();
        if (state.elementDraft?.id) {
          const idx = memory.entities.findIndex((row) => row.id === state.elementDraft.id); if (idx < 0) throw new Error("수정할 요소를 찾지 못했습니다.");
          const old = memory.entities[idx];
          memory.entities[idx] = normalizeElement({ ...old, name, aliases, standaloneTriggers, triggerGroups, currentFacts: mergeFactLines(old.currentFacts, currentTexts, now), historyFacts: mergeFactLines(old.historyFacts, historyTexts, now), updatedAt: now });
        } else {
          if (elementFindMatches(memory.entities, name).length) throw new Error("같은 이름이나 별칭을 가진 요소가 이미 있습니다.");
          memory.entities.push(normalizeElement({ id: uid("element"), name, aliases, standaloneTriggers, triggerGroups, currentFacts: currentTexts.map((text) => ({ id: uid("elf"), text, source: null, createdAt: now })), historyFacts: historyTexts.map((text) => ({ id: uid("elf"), text, source: null, createdAt: now })), createdAt: now, updatedAt: now }));
        }
        memory.originChatId = state.selectedChatId; data.elementMemory = memory; await persistData(data); state.layer = null; state.elementDraft = null; render(); return;
      }
      if (action === "extract-elements") {
        if (state.elementExtractMode === "range") { state.elementRangeStart = Math.max(1, Number(document.getElementById("mmc-element-range-start")?.value) || state.elementRangeStart); state.elementRangeEnd = Math.max(state.elementRangeStart, Number(document.getElementById("mmc-element-range-end")?.value) || state.elementRangeEnd); }
        else state.elementExtractTurns = Math.max(1, Math.min(100, Number(document.getElementById("mmc-element-turns")?.value) || state.elementExtractTurns));
        await saveUiState(); await generateElementCandidates(); return;
      }
      if (action === "element-select-all") { state.elementCandidateSelected = new Set(state.elementCandidates.map((_, i) => String(i))); render(); return; }
      if (action === "element-select-none") { state.elementCandidateSelected.clear(); render(); return; }
      if (action === "save-element-candidates") { await applyElementCandidates(); return; }
      if (action === "reset-element-extraction-prompt") { const box = document.getElementById("mmc-element-extraction-prompt"); if (box) box.value = DEFAULT_ELEMENT_EXTRACTION_PROMPT; return; }
      if (action === "reset-element-injection-prompt") { const box = document.getElementById("mmc-element-injection-prompt"); if (box) box.value = DEFAULT_ELEMENT_INJECTION_PROMPT; return; }
      if (action === "save-element-settings") {
        const data = normalizeData(state.currentData); const memory = data.elementMemory;
        memory.connectionId = String(document.getElementById("mmc-element-model")?.value || "");
        memory.injectionEnabled = !!document.getElementById("mmc-element-injection-enabled")?.checked;
        memory.extractionPrompt = String(document.getElementById("mmc-element-extraction-prompt")?.value || "").trim().slice(0, 8000);
        memory.injectionPrompt = String(document.getElementById("mmc-element-injection-prompt")?.value || "").trim().slice(0, 8000);
        memory.extractTurns = state.elementExtractTurns; memory.originChatId = state.selectedChatId; data.elementMemory = memory;
        await persistData(data); state.layer = null; render(); return;
      }
      if (action === "new-item") {
        state.draft = actionEl.dataset.type === "anchor" ? normalizeAnchor({ id: "" }) : normalizePromise({ id: "" });
        state.draft.id = ""; state.layer = "editor"; render(); return;
      }
      if (action === "edit-item") {
        const item = state.currentData.items.find((x) => x.id === actionEl.dataset.id);
        if (!item) return;
        state.draft = { ...item, keywords: safeArray(item.keywords).slice(), sourceIds: safeArray(item.sourceIds).slice() };
        state.layer = "editor"; render(); return;
      }
      if (action === "save-draft") {
        captureDraft();
        if (!state.draft?.title?.trim()) throw new Error("제목을 입력해 주세요.");
        if (!state.draft?.content?.trim()) throw new Error("내용을 입력해 주세요.");
        if (state.draft.type === "anchor" && state.draft.activation === "keyword" && !state.draft.keywords.length && !state.draft.archived) throw new Error("키워드 기억에는 검색 키워드를 하나 이상 입력해 주세요.");
        const data = normalizeData(state.currentData);
        const now = nowIso();
        if (state.draft.id) {
          const idx = data.items.findIndex((x) => x.id === state.draft.id);
          if (idx < 0) throw new Error("수정할 기록을 찾지 못했습니다.");
          data.items[idx] = normalizeItem({ ...data.items[idx], ...state.draft, updatedAt: now });
        } else {
          const created = normalizeItem({ ...state.draft, id: uid(state.draft.type), createdAt: now, updatedAt: now });
          data.items.unshift(created);
        }
        await persistData(data);
        state.layer = null; state.draft = null; render(); return;
      }
      if (action === "delete-item") {
        const id = actionEl.dataset.id || state.draft?.id;
        if (!id || !confirm("이 기록을 삭제할까요? 확장이 관리하는 주입 내용에서도 빠집니다.")) return;
        const data = normalizeData(state.currentData);
        data.items = data.items.filter((x) => x.id !== id);
        await persistData(data);
        state.layer = null; state.draft = null; render(); return;
      }
      if (action === "toggle-promise-done") {
        const data = normalizeData(state.currentData); const item = data.items.find((x) => x.id === actionEl.dataset.id && x.type === "promise"); if (!item) return;
        item.status = item.status === "done" ? "active" : "done"; item.updatedAt = nowIso(); await persistData(data); render(); return;
      }
      if (action === "toggle-anchor-active") {
        const data = normalizeData(state.currentData); const item = data.items.find((x) => x.id === actionEl.dataset.id && x.type === "anchor"); if (!item) return;
        if (item.archived) { item.archived = false; item.active = true; } else item.active = !item.active;
        item.updatedAt = nowIso(); await persistData(data); render(); return;
      }
      if (action === "open-source") { await openSource(actionEl.dataset.source, actionEl.dataset.target); return; }
      if (action === "source-select-all") { state.sourceRows.forEach((row) => state.sourceSelected.add(String(row.id))); render(); return; }
      if (action === "source-clear") { state.sourceSelected.clear(); render(); return; }
      if (action === "source-local") { makeLocalDraft(); return; }
      if (action === "source-local-promise") { makeLocalDraft("promise"); return; }
      if (action === "source-local-anchor") { makeLocalDraft("anchor"); return; }
      if (action === "source-model") { await generateCandidates(); return; }
      if (action === "source-model-review") { await generateReviewCandidates(); return; }
      if (action === "parse-raw-recovery") { const box = document.getElementById("mmc-raw-repair-text"); const text = String(box?.value || state.rawRecovery?.text || ""); if (state.rawRecovery) state.rawRecovery.text = text; await applyRecoveredRows(text); render(); return; }
      if (action === "discard-raw-recovery") { if (!window.confirm("보존 중인 모델 원문 응답을 버릴까요? 다시 모델을 호출하지 않으면 복구할 수 없습니다.")) return; const wasElement = ["element", "wiki", "wiki-update"].includes(String(state.rawRecovery?.kind || "")); state.rawRecovery = null; state.layer = wasElement ? null : "source"; render(); return; }
      if (action === "source-mark-reviewed") { const rows = selectedSourceRows(); await markSummaryRowsReviewed(rows); state.layer = null; toast("선택한 요약을 검토 완료로 표시했습니다."); render(); return; }
      if (action === "review-mark-done") { const rows = state.reviewSourceRows.slice(); await clearPendingReview(); await markSummaryRowsReviewed(rows); state.layer = null; toast("이번 요약을 검토 완료로 표시했습니다."); render(); return; }
      if (action === "discard-review") { if (!window.confirm("승인 대기 후보를 폐기할까요? 원본 요약과 기존 기억은 그대로 유지됩니다.")) return; await clearPendingReview(); state.layer = null; toast("승인 대기 후보를 폐기했습니다. 원본 요약은 그대로입니다."); render(); return; }
      if (action === "apply-review") { await applyReviewCandidates(); return; }
      if (action === "apply-health") { await applyHealthCandidates(); return; }
      if (action === "save-candidates") {
        const selected = state.candidates.filter((_, i) => state.candidateSelected.has(String(i)));
        if (!selected.length) return;
        const data = normalizeData(state.currentData);
        const now = nowIso();
        for (const raw of selected.slice().reverse()) {
          const item = normalizeItem({ ...raw, id: uid(raw.type), createdAt: now, updatedAt: now });
          data.items.unshift(item);
        }
        await persistData(data);
        state.layer = null; state.candidates = []; state.candidateSelected.clear(); render(); return;
      }
      if (action === "sync") { await syncLorebook({ silent: false }); return; }
      if (action === "import-legacy") { await importLegacy(); render(); return; }
      if (action === "reset-review-prompt") { const box = document.getElementById("mmc-review-prompt"); if (box) box.value = DEFAULT_REVIEW_PROMPT; return; }
      if (action === "save-settings") {
        const data = normalizeData(state.currentData);
        data.maxPromises = Math.max(1, Math.min(20, Number(document.getElementById("mmc-max-promises")?.value) || data.maxPromises));
        data.maxAnchors = Math.max(1, Math.min(24, Number(document.getElementById("mmc-max-anchors")?.value) || data.maxAnchors));
        data.anchorBudgetChars = Math.max(600, Math.min(12000, Number(document.getElementById("mmc-anchor-budget")?.value) || data.anchorBudgetChars));
        state.modelConnectionId = String(document.getElementById("mmc-settings-model")?.value || state.modelConnectionId || "");
        state.uiFontSize = ["normal", "large", "xlarge"].includes(document.getElementById("mmc-ui-font-size")?.value) ? document.getElementById("mmc-ui-font-size").value : "normal";
        state.koDisplay = String(document.getElementById("mmc-ko-display")?.value || "") === "original" ? "original" : "auto";
        const requestedTheme = String(document.querySelector('input[name="mmc-ui-theme"]:checked')?.value || state.uiThemeMode || "ribbon");
        state.uiThemeMode = UI_THEME_IDS.includes(requestedTheme) ? requestedTheme : "ribbon";
        const requestedMode = String(document.getElementById("mmc-summary-update-mode")?.value || state.summaryUpdateMode || "notify_model");
        if (!Object.prototype.hasOwnProperty.call(SUMMARY_UPDATE_MODE_LABEL, requestedMode)) throw new Error("새 요약 갱신 방식 설정을 확인해 주세요.");
        if (requestedMode === "auto_apply" && state.summaryUpdateMode !== "auto_apply") {
          const ok = window.confirm("완전 자동 적용은 새 요약 감지 때 모델 API 비용이 발생하고, 모델의 ADD/UPDATE/COMPLETE/ARCHIVE 판단이 확인 없이 바로 기억 보관함에 반영됩니다.\n실험 기능을 켤까요?");
          if (!ok) { const modeBox = document.getElementById("mmc-summary-update-mode"); if (modeBox) modeBox.value = state.summaryUpdateMode; return; }
        }
        state.summaryUpdateMode = requestedMode;
        state.reviewPrompt = String(document.getElementById("mmc-review-prompt")?.value || "").trim() || DEFAULT_REVIEW_PROMPT;
        state.reviewExtraInstruction = String(document.getElementById("mmc-review-extra")?.value || "");
        await saveUiState();
        await persistData(data);
        state.layer = null; render();
        if (state.pendingSummaryRows.length) void maybeAutoProcessSummaries();
        return;
      }
    } catch (error) {
      console.error("[기억 보관함]", error);
      toast(error.message || "작업에 실패했습니다.", true);
      state.busy = false;
      if (state.busyTimer) clearInterval(state.busyTimer);
      state.busyTimer = null;
      render();
    } finally { state.actionPending = false; }
  }

  async function handleChange(event) {
    if (state.busy || state.syncing || state.actionPending) return;
    try {
      if (await handleWikiChange(event.target)) return;
      if (event.target?.id === "mmc-chat-select") {
        const nextChatId = String(event.target.value || "");
        if (nextChatId !== state.selectedChatId && (state.candidates.length || state.healthCandidates.length || state.elementCandidates.length || state.wikiCandidates.length || state.rawRecovery?.text)) {
          const ok = window.confirm("아직 저장/적용하지 않은 모델 후보가 있습니다.\n다른 RP 문서로 이동하면 이번 후보는 사라집니다. 이동할까요?");
          if (!ok) { event.target.value = state.selectedChatId; return; }
          state.candidates = []; state.candidateSelected.clear(); state.elementCandidates = []; state.elementCandidateSelected.clear(); state.elementExtractInfo = null; state.elementDraft = null; state.wikiCandidates = []; state.wikiCandidateSelected.clear(); state.wikiDraft = null; state.wikiSourceRows = []; state.wikiSourceSelected.clear(); state.wikiProposalDocId = ""; state.wikiProposalSelected.clear(); state.wikiSelectedId = ""; state.wikiHistory = []; state.reviewCandidates = []; state.reviewSelected.clear(); state.reviewSourceRows = []; state.healthCandidates = []; state.healthSelected.clear(); state.rawRecovery = null;
        }
        state.selectedChatId = nextChatId;
        await saveUiState();
        setBusy(true, "RP 문서를 바꾸는 중…");
        await loadCurrentChat();
        state.modelConnectionId = chooseDefaultConnection(state.currentChat);
        await checkNewSummaries({ refreshChat: false, baselineIfUnknown: true, renderAfter: false });
        state.busy = false;
        if (state.busyTimer) clearInterval(state.busyTimer);
        state.busyTimer = null;
        render();
        return;
      }
      if (event.target?.matches?.("[data-source-id]")) {
        const id = String(event.target.dataset.sourceId || "");
        if (event.target.checked) state.sourceSelected.add(id); else state.sourceSelected.delete(id);
        render(); return;
      }
      if (event.target?.matches?.("[data-candidate-index]")) {
        const id = String(event.target.dataset.candidateIndex || "");
        if (event.target.checked) state.candidateSelected.add(id); else state.candidateSelected.delete(id);
        updateCandidateSelectionDom("candidate", event.target);
        return;
      }
      if (event.target?.matches?.("[data-element-candidate-index]")) {
        const id = String(event.target.dataset.elementCandidateIndex || "");
        if (event.target.checked) state.elementCandidateSelected.add(id); else state.elementCandidateSelected.delete(id);
        render(); return;
      }
      if (event.target?.matches?.("[data-review-index]")) {
        const id = String(event.target.dataset.reviewIndex || "");
        if (event.target.checked) state.reviewSelected.add(id); else state.reviewSelected.delete(id);
        updateCandidateSelectionDom("review", event.target);
        await persistPendingReview();
        return;
      }
      if (event.target?.matches?.("[data-health-index]")) {
        const id = String(event.target.dataset.healthIndex || "");
        if (event.target.checked) state.healthSelected.add(id); else state.healthSelected.delete(id);
        updateCandidateSelectionDom("health", event.target);
        return;
      }
      if (event.target?.name === "mmc-ui-theme") {
        // 저장 전 미리보기: 저장하지 않고 닫으면 render()가 저장된 테마로 되돌린다.
        const preview = UI_THEME_IDS.includes(event.target.value) ? event.target.value : state.uiThemeMode;
        for (const id of [ROOT_ID, LAUNCHER_ID, TOAST_ID]) { const node = document.getElementById(id); if (node) node.dataset.mmcTheme = preview; }
        return;
      }
      if (event.target?.name === "mmc-element-mode") {
        state.elementExtractMode = event.target.value === "range" ? "range" : "recent"; await saveUiState(); render(); return;
      }
      if (event.target?.id === "mmc-source-model") {
        state.modelConnectionId = String(event.target.value || "");
        await saveUiState();
        render(); return;
      }
    } catch (error) {
      toast(error.message || "변경에 실패했습니다.", true);
    }
  }

  function handleInput(event) {
    if (handleWikiInput(event.target)) return;
    if (event.target?.id === "mmc-element-search") { state.elementSearch = String(event.target.value || ""); const list = document.getElementById(ROOT_ID)?.querySelector?.(".mmc-element-list"); if (list) list.innerHTML = elementListMarkup(); return; }
    if (event.target?.id === "mmc-element-test") { state.elementTestText = String(event.target.value || ""); const box = document.getElementById(ROOT_ID)?.querySelector?.(".mmc-element-test-results"); if (box) box.innerHTML = elementTestResultsMarkup(); return; }
  }

  function installDom() {
    if (document.getElementById(ROOT_ID)) return;
    const launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.type = "button";
    launcher.className = "mmc-launcher";
    launcher.title = "기억 보관함";
    launcher.setAttribute("aria-label", "기억 보관함 열기");
    launcher.innerHTML = `${SVG.memory}<span>기억</span><i class="mmc-launcher-badge" hidden>0</i>`;
    document.body.append(launcher);

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.hidden = true;
    document.body.append(root);
    applyUiPreferences();

    on(launcher, "click", openModal);
    on(root, "click", handleClick);
    on(root, "change", handleChange);
    on(root, "input", handleInput);
    on(document, "keydown", (event) => {
      if (event.key !== "Escape" || root.hidden) return;
      if (state.layer) requestCloseLayer(); else closeModal();
    });

    installPassiveSummaryObserver();
    const primeTimer = window.setTimeout(() => { void primeSummaryObserver(); }, 900);
    cleanupFns.push(() => window.clearTimeout(primeTimer), () => launcher.remove(), () => root.remove());
  }

  function cleanup() {
    if (state.busyTimer) clearInterval(state.busyTimer);
    for (const fn of cleanupFns.splice(0)) { try { fn(); } catch {} }
  }

  if (document.readyState === "loading") on(document, "DOMContentLoaded", installDom, { once: true });
  else installDom();
  return { open: openModal, dispose: cleanup };
}
