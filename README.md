# 포켓몬 데스크탑 펫 🐾

윈도우 바탕화면 우측 하단에 포켓몬을 펫처럼 띄워두는 Electron 데스크탑 앱.
마우스로 클릭·드래그하며 상호작용하고, 6종 포켓몬을 전환할 수 있습니다. 로컬 전용.

<!-- 데모 GIF/스크린샷을 여기에 넣으면 좋아요 -->
<!-- ![demo](docs/demo.gif) -->

## 기능

- 🖥️ 멀티모니터 환경에서 **맨 우측 모니터 우측 하단**에 자동 배치 (DPI·작업표시줄 자동 보정)
- 🎞️ PokeAPI의 Gen5 애니메이션 스프라이트로 idle 모션
- 🖱️ **클릭** 반응 / **드래그** 이동 / **우클릭** 전환 메뉴
- 🚶 가끔 정해진 범위 안에서 자율 산책 (상태머신: IDLE / WALK / DRAG)
- ✨ 이로치 토글, 설정 영속화(`config.json`)
- 📦 단일 포터블 exe로 빌드 가능

대상 포켓몬: 이상해씨 · 파이리 · 꼬부기 · 피카츄 · 메타몽 · 이브이

## 실행 방법

```bash
npm install          # 의존성 설치
npm run fetch        # PokeAPI에서 스프라이트 다운로드 (최초 1회)
npm start            # 앱 실행
```

> 스프라이트(`assets/sprites/`)는 저작권 문제로 레포에 포함하지 않습니다.
> `npm run fetch`가 [PokeAPI/sprites](https://github.com/PokeAPI/sprites)에서 직접 받아옵니다.

## 포터블 exe 빌드 (윈도우)

```bash
npm run dist         # dist/PokemonPet.exe 생성
```

## 기술 스택

- **Electron** — 투명·프레임리스·항상위 창, 멀티모니터 좌표 제어
- 메인/렌더러 분리 + `contextIsolation` preload 브리지
- 상태머신 기반 애니메이션 루프(`requestAnimationFrame`)

구조와 커스터마이징 지점은 [DEVELOPMENT.md](DEVELOPMENT.md) 참고.

## 라이선스 / 고지

- 이 저장소의 **소스 코드**는 MIT 라이선스로 제공됩니다.
- **포켓몬 및 모든 스프라이트의 저작권은 Nintendo / Creatures Inc. / GAME FREAK inc. / The Pokémon Company에 있습니다.**
- 본 프로젝트는 **비영리 개인 팬 프로젝트**이며 위 권리자와 제휴·후원·승인 관계가 없습니다.
- 스프라이트 에셋은 재배포하지 않으며, 실행 시 PokeAPI를 통해 각자 내려받습니다.
- 상업적 이용을 금합니다.
