# Vercel + Firebase 설정 (비밀 링크 기능)

담당자 1명이 캠프명단·일정을 세팅 → **공유 코드 링크** 생성 → 누구나 그 링크를 열면
모든 서류가 자동 세팅된 채로 다운로드됩니다.

브라우저는 Firestore에 **직접 접근하지 않습니다.** Vercel 서버 함수가 서비스 계정(Admin)으로
대신 읽고 씁니다. 따라서 Firestore 보안 규칙은 **`allow read, write: if false` 그대로** 두세요(가장 안전).

---

## 1단계 — Firebase (먼저 환경변수)

### 1) 서비스 계정 키 발급
Firebase 콘솔 → ⚙️ **프로젝트 설정** → **서비스 계정** 탭 → **새 비공개 키 생성** → JSON 다운로드.
JSON 안에서 다음 3개 값을 사용합니다:
- `project_id`
- `client_email`
- `private_key`  (`-----BEGIN PRIVATE KEY-----\n...` 형태, 줄바꿈 포함)

### 2) Vercel 환경변수 등록
Vercel 프로젝트 → **Settings → Environment Variables** 에서 3개 추가:

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | JSON 의 `project_id` |
| `FIREBASE_CLIENT_EMAIL` | JSON 의 `client_email` |
| `FIREBASE_PRIVATE_KEY` | JSON 의 `private_key` **전체** (앞뒤 따옴표 빼고 그대로 붙여넣기. `\n` 이 들어있어도 그대로 두세요 — 코드가 변환합니다) |

저장 후 **Redeploy**.

### 3) Firestore
- 콘솔에서 **Cloud Firestore** 생성(기본 `(default)` DB).
- 규칙은 `if false` 그대로 둡니다.

### 확인
- 앱에서 명단 업로드 → 변환 → "공유 코드" 입력 → **링크 만들기** → 링크가 나오면 성공.
- 그 링크를 새 탭에서 열면 서류가 자동 세팅됩니다.

---

## 2단계 — Groq (그다음, AI 추진의견)  *예정*
| Name | Value |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com 에서 발급 |

(결과보고서·운영사례집·안전업무일지의 주/보조/안전 추진의견 자동 작성 — 프로그램 문서를 컨텍스트로 사용)

---

## 참고
- GitHub Pages(외부 공유용)에는 `/api` 서버 함수가 없으므로 **공유 링크 기능은 Vercel 에서만** 동작합니다.
  (서류 자동작성·다운로드 자체는 양쪽 모두 동작)
- 저장 데이터: `camps/{코드}` 문서에 명단·설정 JSON. 학생 실명 포함(친구용 비공개 링크 전제).
