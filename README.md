# AI 프로포즈 영상 · 테스트 배포 가이드

## 폴더 구조
```
proposal-deploy/
├── public/
│   └── index.html          ← 고객용 주문서 페이지
├── api/
│   ├── generate-prompts.js ← Anthropic API 호출
│   ├── generate-image.js   ← Higgsfield 이미지 생성
│   ├── generate-video.js   ← Higgsfield 영상 생성
│   ├── video-status.js     ← 영상 완료 상태 조회
│   ├── merge.js            ← 영상 이어붙이기
│   └── save-contact.js     ← Google Sheets 연락처 저장
├── vercel.json             ← Vercel 설정
├── .env.example            ← 환경변수 가이드 (실제 키 입력 금지)
└── README.md               ← 이 파일
```

---

## 배포 순서

### 1. GitHub 저장소 만들기
1. https://github.com 로그인
2. 우상단 `+` → `New repository`
3. 이름: `proposal-video-test`
4. Public 선택 → `Create repository`
5. 이 폴더 안의 모든 파일을 업로드

### 2. Vercel 연결
1. https://vercel.com 로그인 (GitHub 계정으로)
2. `Add New Project`
3. 방금 만든 GitHub 저장소 선택
4. **Framework Preset: Other** 선택
5. Root Directory: `./` (그대로)
6. `Deploy` 클릭

### 3. 환경변수 설정 ⭐ 중요
Vercel 대시보드 → 프로젝트 → `Settings` → `Environment Variables`

| 변수명 | 값 | 설명 |
|---|---|---|
| `DUMMY_MODE` | `true` | 테스트 단계: API 없이 전체 플로우 확인 |
| `ANTHROPIC_API_KEY` | Anthropic 콘솔에서 발급 | 프롬프트 생성 (나중에 입력) |
| `HIGGSFIELD_API_KEY` | `...` | 이미지/영상 생성 (나중에 입력) |

> ⚠️ `DUMMY_MODE=true` 로 먼저 전체 플로우를 테스트하세요.
> 실제 영상이 생성되는 것을 확인 후 `false`로 변경하고 API 키를 입력하세요.

### 4. 배포 확인
- Vercel이 자동으로 `https://프로젝트명.vercel.app` URL을 발급합니다.
- 해당 링크로 접속하면 고객용 주문서가 열립니다.

---

## 수정 → 반영 방법
1. `public/index.html` 수정
2. GitHub에 업로드 (파일 덮어쓰기)
3. Vercel 자동 감지 → 30초~1분 내 자동 배포

---

## 단계별 환경변수 전환

| 단계 | DUMMY_MODE | API 키 | 비용 |
|---|---|---|---|
| 1단계 (지금) | true | 불필요 | 무료 |
| 2단계 (영상 테스트) | false | 필요 | 건당 $1~5 |
| 3단계 (정식 운영) | false | 필요 | 건당 $2~5 |
