# 포켓몬 데스크탑 펫 — 개발 문서

> 모니터 3개 환경에서, **맨 우측 모니터의 우측 하단**에 포켓몬을 펫처럼 띄워두는 로컬 전용 앱.
> 마우스로 클릭·드래그하며 상호작용하고, 6종 포켓몬을 전환할 수 있다.

---

## 1. 개요 / 목표

| 항목 | 내용 |
|------|------|
| 사용 환경 | 윈도우 11, 로컬 단일 사용자(본인) 전용. 배포·공유 없음 |
| 위치 | 3개 모니터 중 **가장 오른쪽 모니터의 우측 하단** 코너 |
| 형태 | 투명 배경 · 프레임 없음 · 항상 위(always-on-top) · 작업표시줄 미표시 |
| 대상 포켓몬 | 피카츄 / 메타몽 / 이브이 / 파이리 / 이상해씨 / 꼬부기 (6종) |
| 상호작용 | 클릭 반응 + 자율 산책 + 드래그 이동 + 포켓몬 전환 메뉴 |
| 비목표 | 온라인 기능, 멀티유저, 배틀/육성 같은 게임 로직 |

---

## 2. 기술 스택

| 영역 | 선택 | 근거 |
|------|------|------|
| 런타임 | **Electron** | 투명·프레임리스·항상위 창과 멀티모니터 좌표 지정이 가장 쉬움. 스프라이트 애니메이션을 HTML/CSS/JS로 부드럽게 처리 |
| 언어 | JavaScript (필요 시 TypeScript로 확장) | 초기엔 단순 JS로 빠르게 |
| 렌더링 | HTML `<img>` (애니메이션 GIF) + CSS transform | Gen5 애니메이션 스프라이트가 GIF라 별도 스프라이트시트 처리 불필요 |
| 에셋 | **PokeAPI 공개 스프라이트 자동 다운로드** | 최초 1회 스크립트로 받아 로컬 캐시. 개인 로컬용 |
| 패키징 | electron-builder (선택, 후순위) | 나중에 더블클릭 실행 exe로 만들고 싶을 때 |

---

## 3. 대상 포켓몬 & 에셋

### 3.1 PokeAPI 스프라이트 출처
- 저장소: `https://github.com/PokeAPI/sprites`
- **Gen5 (Black/White) 애니메이션 GIF** 사용 — idle 상태에서 살짝 움직여 펫에 적합.
- Raw URL 패턴:
  ```
  https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/{id}.gif
  ```
- 이로치(shiny)도 필요하면 `.../animated/shiny/{id}.gif`.

### 3.2 포켓몬 ID 표

| 한글명 | 영문명 | 전국도감 ID | 파일명 |
|--------|--------|------------|--------|
| 이상해씨 | Bulbasaur | 1 | `1.gif` |
| 파이리 | Charmander | 4 | `4.gif` |
| 꼬부기 | Squirtle | 7 | `7.gif` |
| 피카츄 | Pikachu | 25 | `25.gif` |
| 메타몽 | Ditto | 132 | `132.gif` |
| 이브이 | Eevee | 133 | `133.gif` |

> 참고: Gen5 애니메이션 스프라이트는 **정면 idle 애니메이션 1종**만 제공. 걷기는 좌우 반전 + 창 이동으로 표현한다(별도 보행 스프라이트 없음).

### 3.3 다운로드 전략
- `scripts/fetch-sprites.js`가 위 6개 ID를 받아 `assets/sprites/{id}.gif`로 저장.
- 이미 존재하면 건너뜀(idempotent). 오프라인이어도 캐시로 동작.

---

## 4. 폴더 구조

```
pokemon/
├─ DEVELOPMENT.md          # 이 문서
├─ package.json
├─ main.js                 # Electron 메인 프로세스 (창 생성·모니터 배치·IPC)
├─ preload.js              # 렌더러↔메인 안전한 브리지
├─ renderer/
│  ├─ index.html           # 펫 표시용 투명 페이지
│  ├─ style.css            # 투명 배경, 스프라이트 위치
│  └─ pet.js               # 상태머신·애니메이션·마우스 핸들링
├─ assets/
│  └─ sprites/             # 자동 다운로드된 {id}.gif
├─ scripts/
│  └─ fetch-sprites.js     # PokeAPI에서 스프라이트 받기
└─ config.json             # 사용자 설정(현재 포켓몬, 크기 등)
```

---

## 5. 핵심 기능 명세

### 5.1 상태 머신 (renderer/pet.js)

```
        ┌──────────── 클릭 ───────────┐
        ▼                             │
   ┌─────────┐  랜덤 타이머   ┌─────────┐
   │  IDLE   │ ───────────▶  │  WALK   │
   │(제자리) │ ◀───────────  │(좌우이동)│
   └─────────┘  목적지 도착   └─────────┘
        │  ▲                      │
   드래그│  │드롭                  │드래그
        ▼  │                      ▼
   ┌─────────┐                ┌─────────┐
   │  DRAG   │                │ REACT   │ (클릭 시 점프/반짝 등 짧은 모션)
   └─────────┘                └─────────┘
```

| 상태 | 동작 | 진입 조건 | 이탈 조건 |
|------|------|-----------|-----------|
| IDLE | 제자리에서 GIF 재생 | 시작 시, WALK 종료, REACT 종료 | 랜덤 타이머(예: 8~20초) → WALK / 클릭 → REACT |
| WALK | 화면 하단을 따라 좌우로 천천히 이동, 진행 방향으로 좌우 반전 | IDLE에서 랜덤 발동 | 목적지 도착 또는 화면 경계 → IDLE |
| REACT | 클릭 시 짧은 반응 모션(점프·통통 튀기·살짝 확대) + 선택적 사운드 | 펫 클릭 | 모션 종료(약 0.5~1초) → 직전 상태 |
| DRAG | 마우스를 따라 창 이동 | 펫을 누른 채 이동 | 마우스 버튼 떼면 → IDLE |

### 5.2 자율 산책(WALK) 규칙
- 이동 범위: **현재 모니터의 작업영역 하단**으로 제한(작업표시줄 위).
- 속도: 픽셀/프레임 느리게(예: 0.5~1.5px). requestAnimationFrame 기반.
- 이동 중 화면 끝에 닿으면 방향 전환.
- 이동은 **창 자체를 옮기는 방식**(`main` 프로세스에 IPC로 좌표 전달) 또는 창을 넓게 두고 **내부에서 스프라이트만 이동**하는 방식 중 택1 → 아래 6·7장에서 결정.

### 5.3 클릭 반응(REACT)
- 좌클릭: 점프/통통 모션 + (옵션) 짧은 울음소리.
- 더블클릭(옵션): 특별 반응.
- 우클릭: **컨텍스트 메뉴**(포켓몬 전환 / 위치 리셋 / 종료) — 8장 참고.

---

## 6. 윈도우 / 모니터 배치 로직 (main.js)

### 6.1 "맨 우측 모니터" 판별
```js
const { screen } = require('electron');
const displays = screen.getAllDisplays();
// bounds.x 가 가장 큰 디스플레이 = 가장 오른쪽
const rightMost = displays.reduce((a, b) => (b.bounds.x > a.bounds.x ? b : a));
```

### 6.2 우측 하단 배치
```js
const { x, y, width, height } = rightMost.workArea; // 작업표시줄 제외
const win.setBounds({
  x: x + width  - PET_W - MARGIN,
  y: y + height - PET_H - MARGIN,
  width: PET_W, height: PET_H,
});
```
- 모니터 해상도/배율(DPI)이 달라도 `workArea` 기준이라 안전.
- 모니터 구성이 바뀌면(`screen.on('display-*')`) 재배치하는 핸들러 추가.

### 6.3 창 옵션
```js
new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  focusable: true,          // 클릭/드래그 받으려면 필요
  webPreferences: { preload, contextIsolation: true },
});
win.setAlwaysOnTop(true, 'screen-saver'); // 전체화면 위에도 뜨게(선택)
```

---

## 7. 마우스 상호작용 & 투명영역 처리 (중요 설계 포인트)

투명 창에서 **스프라이트 부분만 클릭**되고 **빈 영역은 뒤 창이 클릭**되게 하는 것이 관건. 두 가지 접근:

- **A안 — 타이트 창(권장 초기):** 창을 스프라이트 크기에 딱 맞춰 작게(예 96×96~128×128) 유지. 빈 여백이 거의 없어 클릭 통과 이슈 최소화. 산책은 6.2 좌표를 IPC로 갱신해 창을 옮김.
- **B안 — 넓은 창 + 마우스 영역 포워딩:** 창을 모니터 하단 띠 전체로 크게 두고 `win.setIgnoreMouseEvents(true, { forward: true })`로 기본은 통과, 스프라이트 위에 마우스가 오면 `setIgnoreMouseEvents(false)`로 토글. 내부에서 스프라이트만 이동. 구현 복잡도 ↑.

> **결정: A안으로 시작.** 산책/이동은 창 좌표를 옮기는 방식. 추후 부드러움이 필요하면 B안 검토.

### 드래그 이동
- `renderer`에서 `mousedown`→`mousemove` 시 마우스 변위만큼 창을 이동(IPC `move-window`).
- 짧게 누르고 떼면(이동 거의 없음) → 클릭(REACT)으로 간주, 길게 끌면 → DRAG.

---

## 8. 포켓몬 전환 메뉴

- **우클릭 컨텍스트 메뉴**(Electron `Menu`)로 제공:
  - 피카츄 / 메타몽 / 이브이 / 파이리 / 이상해씨 / 꼬부기 선택
  - 구분선
  - "위치 우측하단으로 리셋"
  - "종료"
- 선택 시 렌더러에 IPC로 알려 `<img src>`를 해당 `{id}.gif`로 교체하고 `config.json`에 저장.
- (옵션) 이로치 토글.

---

## 9. 설정 (config.json)

```json
{
  "currentPokemonId": 25,
  "scale": 2,
  "margin": 24,
  "walk": { "enabled": true, "minIntervalSec": 8, "maxIntervalSec": 20, "speed": 1.0 },
  "sound": { "enabled": false },
  "shiny": false
}
```
- 앱 시작 시 로드, 변경 시 저장. 다음 실행에 마지막 포켓몬/위치 복원.

---

## 10. 개발 단계 (마일스톤)

| 단계 | 목표 | 완료 기준 |
|------|------|-----------|
| **M0. 부트스트랩** | Electron 프로젝트 초기화, 빈 투명창 띄우기 | 우측 모니터 우하단에 투명 창이 뜬다 |
| **M1. 에셋** | `fetch-sprites.js`로 6종 GIF 다운로드 | `assets/sprites/`에 6개 파일 |
| **M2. 표시** | 현재 포켓몬 GIF를 우하단에 렌더 | 피카츄가 제자리에서 움직인다 |
| **M3. 클릭 반응** | 클릭 시 REACT 모션 | 클릭하면 점프/통통 반응 |
| **M4. 드래그** | 마우스로 펫 이동 | 끌어서 원하는 위치로 옮긴다 |
| **M5. 자율 산책** | IDLE↔WALK 상태머신 | 가끔 좌우로 걷다 멈춘다 |
| **M6. 전환 메뉴** | 우클릭으로 6종 전환 + 설정 저장 | 메뉴에서 바꾸면 즉시 교체·재시작해도 유지 |
| **M7. 마감(옵션)** | 사운드, 이로치, exe 패키징, 자동 시작 | 더블클릭 실행 가능 |

---

## 11. 빌드 / 실행 / 패키징

```bash
npm install            # electron 설치
node scripts/fetch-sprites.js   # 최초 1회 에셋 다운로드
npm start              # electron . 실행
```
- (M7) `electron-builder`로 포터블 exe 생성, 윈도우 시작 프로그램 등록은 선택.

---

## 12. 리스크 / 결정 필요 항목

| # | 항목 | 메모 |
|---|------|------|
| 1 | 클릭 통과 정밀도 | A안(타이트 창)으로 충분한지, 픽셀 단위 히트박스까지 필요한지 |
| 2 | 산책 시 창 이동의 부드러움 | OS 창 이동이 끊기면 B안(내부 이동) 전환 |
| 3 | 사운드 소스 | 울음소리도 PokeAPI cries(`.../cries/latest/{id}.ogg`) 사용 가능 — 기본 off |
| 4 | 멀티모니터 변경 대응 | 모니터 뺐다 꽂을 때 자동 재배치 수준 |
| 5 | 전체화면 게임 위 표시 | `screen-saver` 레벨 항상위가 과한지 |

---

## 13. 향후 확장 아이디어 (비필수)
- 키보드 입력/시간대에 따른 반응(밤엔 졸기 등)
- 여러 마리 동시 표시
- 진화 애니메이션, 이로치 확률 등장
- 트레이 아이콘으로 표시/숨김 토글

---

## 부록 A. 핵심 IPC 채널(초안)

| 채널 | 방향 | 페이로드 | 용도 |
|------|------|----------|------|
| `move-window` | renderer→main | `{dx, dy}` 또는 `{x, y}` | 드래그/산책 창 이동 |
| `reset-position` | renderer→main | – | 우하단 복귀 |
| `set-pokemon` | main→renderer | `{id}` | 메뉴 선택 반영 |
| `get-config` / `save-config` | 양방향 | config 객체 | 설정 로드/저장 |
| `quit` | renderer→main | – | 종료 |
