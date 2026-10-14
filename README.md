# 기억 보관함 · Memory Vault for SillyTavern

Marinara용 **기억 보관함 v2.0.0**을 **SillyTavern 1.19.0 이상**의 프런트엔드 확장으로 옮긴 버전입니다. 서버 플러그인, Extras 서버, 별도 빌드는 필요하지 않습니다.

약속, 기억 앵커, 요소 기억, 이야기 위키, 한국어 표시본, 테마, 후보 검토와 사용자 편집 잠금 기능을 유지합니다. 현재 열린 **개인 채팅과 그룹 채팅**에서 작동합니다.

## 설치

1. SillyTavern **1.19.0 이상**에서 **확장 → 확장 설치**를 엽니다.
2. 아래 저장소 주소를 붙여 넣고 설치합니다.
3. SillyTavern을 새로고침하고 채팅을 연 뒤 **기억 보관함**을 엽니다.

```text
https://github.com/mallang0723/memoryVaultSilly
```

ZIP으로 수동 설치할 때는 아래 위치에 풉니다. `manifest.json`이 확장 폴더 바로 아래에 있어야 합니다. 이미 ZIP으로 설치했다면 같은 확장을 다른 폴더에 중복 설치하지 마세요.

```text
SillyTavern/
└── public/scripts/extensions/third-party/memoryVaultSilly/
    ├── manifest.json
    ├── index.js
    ├── extension.js
    ├── extension.css
    ├── host.js
    ├── world-info.js
    └── migration.js
```

GitHub 주소로 설치한 버전은 SillyTavern의 확장 관리 화면에서 업데이트할 수 있습니다.

## 사용

1. SillyTavern에서 캐릭터 또는 그룹의 채팅을 엽니다.
2. 오른쪽 **기억** 버튼, 확장 메뉴의 **기억 보관함**, 또는 확장 설정의 **보관함 열기**를 누릅니다.
3. 약속·앵커·요소·위키를 직접 작성하거나, 대화를 골라 AI 후보를 만듭니다.
4. 저장하면 현재 채팅 전용 World Info 파일이 동기화됩니다.

AI 기능은 **SillyTavern에서 현재 선택한 API와 모델**을 사용합니다. API 키를 이 확장에 다시 입력하지 않습니다. 연결이 없어도 수동 편집·검색·가져오기·내보내기는 가능합니다. Marinara의 개별 모델 연결 ID는 이전하지 않습니다.

다른 이야기의 기억을 편집하려면 SillyTavern에서 해당 채팅을 여세요. 확장 안에서 열지 않은 채팅의 파일을 직접 수정하지 않습니다.

## Marinara 기억 데이터 이전

설치 ZIP에는 확장 코드만 들어 있습니다. 이전 RP의 실제 기억은 별도로 가져와야 합니다.

**보관함 → 설정 → 로어북 → JSON 가져오기**에서 다음 형식을 지원합니다.

- `memoryCabinetV1` 데이터 자체 또는 이를 포함한 채팅 `metadata` JSON
- 비활성 **기억 보관함 · 구조화 백업** 항목이 들어 있는 Marinara/ST 로어북 JSON
- 이 확장의 **JSON 내보내기** 파일

확인 후 현재 채팅의 보관함을 교체합니다. 이전 소유 채팅 ID와 로어북 연결 ID는 현재 채팅에 맞게 다시 생성합니다. 기존 기억이 있으면 교체 전 JSON 다운로드와 `chat_metadata.memoryVaultImportBackup`에 직전 사본을 남깁니다. 원본 메시지와 요약은 수정하지 않습니다.

원문과 한국어 표시본은 각각 보존하며, 모델에는 원문만 주입합니다. 잘못된 JSON, 여러 채팅이 섞인 입력, 10 MiB를 넘는 파일은 적용하지 않습니다. 첨부한 설치 ZIP 자체는 기억 데이터로 가져올 수 없습니다.

## 저장과 주입

- 원본 기억: 현재 채팅의 `chat_metadata.memoryCabinetV1`
- 화면·자동화 설정: SillyTavern `extensionSettings.memoryVault`
- 동기화 결과 및 비활성 구조화 백업: World Info의 `MemoryVault_<해시>` 파일
- 직전 JSON 가져오기 백업: `chat_metadata.memoryVaultImportBackup`

`MemoryVault_` 파일은 확장이 관리합니다. **채팅 로어북이나 글로벌 로어북에 직접 연결할 필요가 없습니다.** 기존에 연결한 사용자 로어북은 그대로 두고, `WORLDINFO_ENTRIES_LOADED` 이벤트로 현재 채팅의 기억을 함께 스캔합니다. 확장이 꺼져 있으면 이 자동 연결도 중단됩니다.

약속·상시 앵커·위키 상시 개요는 상시 항목으로, 키워드 앵커·요소·위키 본문은 조건부 항목으로 변환됩니다. 조합 조건은 모든 단어가 있어야 발동하며, SillyTavern의 전역 재귀 검색을 켤 필요가 없습니다. 최근 4개 메시지를 검색하며 **실제 주입량은 SillyTavern World Info 예산의 영향을 받습니다.** 화면의 토큰 수는 추정치입니다. 큰 위키를 사용할 때는 World Info 예산도 확인하세요.

전체 주입을 끄면 조건부 항목도 포함해 보관함 기억을 주입하지 않습니다. 비활성 백업, 이미지, AI 참조 제외 문서는 주입하지 않습니다. 다른 채팅의 소유권이 붙은 데이터는 격리하고, SillyTavern이 만든 정상 분기는 새 소유권과 독립 로어북으로 상속합니다.

World Info의 자동 관리 항목을 직접 편집하면 다음 동기화 때 덮어씁니다. 보관함 화면에서 편집하세요. 확장이 관리하는 파일을 다른 확장의 장기 기억/벡터 수집 대상으로 중복 등록하면 같은 기억이 중복될 수 있습니다.

한글·영어 기억을 의미로 검색하려면 SillyTavern의 기본 **Vector Storage**에서 **Enable for World Info**와 **Enabled for all entries**를 켜세요. OpenAI·Google·OpenRouter·NanoGPT 모델 선택과 설정 순서는 [임베딩 사용 안내](docs/EMBEDDINGS.md)에 정리했습니다. 이 옵션은 현재 연결된 다른 활성 로어북에도 적용됩니다.

[그림 설명 HTML](docs/embedding-visual-guide.html)을 내려받아 브라우저로 열면 원문·번역·검색 범위·AI 전달 과정을 눌러 보며 확인할 수 있습니다.

## 요약 및 자동화

SillyTavern **Summarize**가 메시지의 `extra.memory`에 저장한 요약을 읽습니다. 요약 생성 자체는 SillyTavern에서 설정합니다. 요약이 없어도 대화 원문 추출은 가능합니다.

기본 동작은 새 요약 알림과 사용자가 누르는 모델 정리입니다. 자동 분석·자동 적용을 선택하면 모델 호출 비용이 발생할 수 있습니다. 원본의 후보 검토, 변경 충돌 보호, 직전 자동 적용 되돌리기를 유지합니다. Marinara 전용 Memory Nag/LTM/Advanced Memory 에이전트 감지는 사용하지 않습니다.

모델 요청 중 채팅을 바꾸면 늦게 온 결과를 새 채팅에 적용하지 않습니다. 응답 시간 초과 후에는 이미 시작된 서버 요청이 끝날 때까지 재요청을 막습니다.

## 개발과 검증

실행 파일은 순수 ES 모듈입니다. 설치 시 `npm install`이나 번들링은 필요하지 않습니다. 개발용 테스트는 Node.js 22.8 이상을 사용합니다.

```sh
npm ci
npm run check
npm test
npm run package
```

실제 호스트 통합 테스트:

1. 별도 테스트 데이터 디렉터리로 SillyTavern 1.19+를 실행하고 이 확장을 설치합니다.
2. 첫 사용자 설정을 완료하고 샘플 캐릭터 하나를 준비합니다. 오프라인 테스트에서는 연결 방식을 Chat Completion으로 설정합니다.
3. `ST_BASE_URL=http://127.0.0.1:8000 CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`를 실행합니다.

브라우저 테스트는 개인·그룹 테스트 채팅과 World Info 파일을 생성하므로 **격리된 테스트 데이터 디렉터리**를 사용하세요. 결과 이미지는 `test-results/`, 설치 ZIP은 `dist/`에 생성됩니다. 실제 유료 모델의 응답 품질은 자동 테스트 범위에 포함하지 않습니다.

자세한 호스트 매핑과 검증 범위는 [마이그레이션 기록](docs/MIGRATION.md)을 참조하세요.
