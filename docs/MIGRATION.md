# SillyTavern 마이그레이션 기록

대상: 기억 보관함 `2.0.0-st.1`, SillyTavern `1.19.0` 이상.

## 구현

| Marinara 의존성 | SillyTavern 구현 |
| --- | --- |
| `marinara.extension` manifest | `manifest.json`의 js/css, 표시 이름, 최소 클라이언트 버전 |
| Marinara REST 채팅 목록/메시지 | `getContext()`의 현재 개인·그룹 채팅, 읽기 전용 메시지 변환 |
| `/chats/:id/metadata` | `chatMetadata` 확장 필드 + `saveMetadata()`, 서버 파일 읽기로 저장 확인 |
| `marinara.storage`, localStorage | 사용자별 `extensionSettings.memoryVault`, `saveSettingsDebounced()` |
| `/generate/raw`, 모델 연결 목록 | 현재 연결의 `generateRaw({prompt, responseLength, trimNames:false})` |
| 로어북 CRUD | 어댑터에서 동기화 트랜잭션으로 모은 후 `/api/worldinfo/edit` 한 번으로 저장 |
| RP별 여러 로어북 연결 | 사용자 연결 유지 + `WORLDINFO_ENTRIES_LOADED`의 `chatLore`에 관리 항목 추가 |
| 요소/위키 재귀 트리거 | 이스케이프한 OR 키워드와 AND 정규식 조건으로 직접 변환 |
| fetch 가로채기 요약 감지 | 호스트 이벤트 + 메모리 안의 `extra.memory` 변경 비교 |
| Marinara CSS 변수 | 보관함 범위에서 SillyTavern SmartTheme 변수에 연결 |

`extension.js`에 원본 UI와 기억/후보/위키 규칙을 유지했습니다. 엔진 의존성은 `host.js`, World Info 변환은 `world-info.js`, 데이터 이전은 `migration.js`로 분리했습니다. 전역 `fetch`를 교체하지 않습니다. API 요청에는 SillyTavern의 CSRF 헤더를 사용합니다.

메타데이터 저장 API는 일부 실패를 예외로 반환하지 않아, 저장 후 해당 채팅 파일을 다시 읽고 확장 필드가 일치하는지 확인합니다. 채팅 전환 중 오래된 작업의 쓰기를 차단하며, 모델 응답은 채팅을 떠났다가 돌아온 경우에도 폐기합니다.

World Info 파일은 채팅 소유권의 SHA-256 일부를 이름으로 사용합니다. 스캔 때 관리 항목의 중복/외부 채팅 사본을 제거하고 현재 소유권이 일치하는 항목만 추가합니다. 파일 내용에 원래 구조화 백업을 비활성 항목으로 남겨 메타데이터를 복구할 수 있습니다. 기존 `world_info` 연결이나 다른 확장의 메타데이터는 바꾸지 않습니다.

## 의도한 차이

- 현재 열린 채팅만 편집합니다. 전체 RP 탐색 대신 SillyTavern의 채팅 전환을 사용합니다.
- 기능별 모델 선택 UI에는 현재 SillyTavern 연결만 제공됩니다. Marinara 연결 정보나 비밀키를 복사하지 않습니다.
- 원본의 자체 로어북 tokenBudget은 SillyTavern의 전역 World Info 예산으로 대체됩니다. 예산을 무시하거나 전역 설정을 자동으로 바꾸지 않습니다.
- Marinara 전용 에이전트 실행/감지는 포함하지 않습니다. 원본 설치 안내와 Full page access 요구를 SillyTavern 안내로 바꿨습니다.
- 캐릭터 파일 자체를 이름 변경/복제하거나 외부에서 채팅 메타데이터를 복사한 경우 자동으로 소유권을 추측하지 않습니다. 격리 확인 또는 JSON 가져오기를 사용하세요.
- 앱/확장 설정 파일을 공유해도 계정 사이에 localStorage로 기억 설정이 섞이지 않습니다.

## 기준 소스

- 사용자 제공 `memory_vault_v2.0.0.zip`: SHA-256 `5b13d79d3e8bab4a475909359e1f20432e1215561c852c29bbd7b408d990b7d4`
- SillyTavern release: `06bde939fb1e9c4c8d8641d810f0a916b5bce127` (`1.19.0`)
- Marinara Engine API 참고: `7e28236962a000719dddc13f7fa2630f88b51816`

원본 ZIP의 README·호환성 리뷰·테스트 보고서는 참고 자료로 읽었습니다. 그 문서의 테스트 성공 기록을 이 포팅 버전의 검증 결과로 간주하지 않습니다.

## 포팅 버전 검증 (2026-10-07)

- `npm run check`: 모든 실행 모듈의 구문 검사 통과.
- `npm test`: **21개 통과, 실패·건너뜀 0개**. 저장 실패/롤백, 소유권, 분기, 그룹 저장, 늦은 응답, 시간 초과, 동기화 중 스캔, JSON 변환, AND 검색을 포함합니다.
- `npm run test:browser`: 실제 SillyTavern 1.19.0 + Chromium에서 **10개 시나리오 통과**. 확장 로딩, 수동 저장, JSON 이전/백업, native World Info 스캐너, 데스크톱·모바일 화면, 재접속, 분기, 다른 채팅 격리, 그룹 채팅, AI 후보 검토·선택 저장을 확인했습니다.
- AI 검증은 실제 `generateRaw` 클라이언트 경로와 로컬 모의 HTTP 응답을 사용했습니다. 외부 모델 제공자는 호출하지 않았으며 실제 모델의 응답 품질·개별 제공자 설정은 검증하지 않았습니다.
- 설치 패키지는 실행 파일과 문서만 포함합니다. 사용자 데이터, 테스트 채팅, node_modules, 원본 ZIP은 포함하지 않습니다.

단위 테스트는 제한된 실행 환경에서도 개별 assertion이 실제로 실행되도록 Node의 `--test-isolation=none`으로 실행합니다. 실제 사용자 인스턴스에 설치하거나 GitHub에 푸시/배포한 상태를 뜻하지는 않습니다.
