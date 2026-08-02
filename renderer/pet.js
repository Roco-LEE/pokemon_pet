// 펫 렌더러: 상태머신(IDLE/WALK/DRAG/SLEEP) + 클릭 반응(REACT)
// + 울음소리 + 말풍선 + 수면 모드 + 포켓몬 전환.

const sprite = document.getElementById('sprite');
const shadow = document.getElementById('shadow');
const bubble = document.getElementById('bubble');
const zzz = document.getElementById('zzz');

const state = {
  mode: 'idle', // 'idle' | 'walk' | 'drag' | 'sleep'
  pos: { x: 0, y: 0 }, // 현재 창 좌상단(스크린 좌표)
  size: 192,
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  spritesDir: '',
  criesDir: '',
  pokemonId: 25,
  shiny: false,
  walkEnabled: true,
  walkSpeed: 1.0,
  walkMin: 8,
  walkMax: 20,
  facingLeft: false,
  walkTarget: null,
  idleTimer: null,
  walkRangeFraction: 0.15, // 산책 범위 = 좌측 하단 가로폭의 이 비율
  // 울음소리
  soundEnabled: false,
  // 말풍선
  speechEnabled: true,
  speechMin: 25,
  speechMax: 60,
  speechTimer: null,
  bubbleTimer: null,
  // 수면
  sleepEnabled: true,
  sleepIdleMinutes: 5,
  nightStart: 22,
  nightEnd: 7,
  lastActivity: Date.now(),
  sleepChecker: null,
  // 낙하(중력) — 드래그해서 놓으면 바닥으로 떨어짐
  vy: 0,
  groundY: 0, // 바닥에 있을 때의 창 top y (스크린 좌표)
  // 기상 직후 굼뜬(느린) 상태 종료 시각
  grogEndAt: 0,
};

// 낙하 물리 상수
const GRAVITY = 1.6; // 프레임당 가속(px)
const MAX_FALL = 40; // 최대 낙하 속도(px/frame)

// 기상 직후 둔화(굼뜸) 설정
const GROG_MS = 4000; // 굼뜬 지속 시간
const GROG_FACTOR = 0.4; // 이동 속도 배율(느리게)

function effectiveWalkSpeed() {
  return Date.now() < state.grogEndAt ? state.walkSpeed * GROG_FACTOR : state.walkSpeed;
}

// 산책 가능한 좌우 경계(스크린 좌표). 좌측 하단에서 가로폭 walkRangeFraction 만큼만.
function walkBounds() {
  const left = state.workArea.x;
  const band = state.workArea.width * state.walkRangeFraction;
  const right = Math.min(
    state.workArea.x + state.workArea.width - state.size,
    left + band
  );
  return { minX: left, maxX: right };
}

// 윈도우 경로 → file:// URL
function toFileUrl(p) {
  let s = String(p).replace(/\\/g, '/');
  if (!s.startsWith('/')) s = '/' + s;
  return 'file://' + encodeURI(s);
}

function spriteUrl(id, shiny) {
  const sub = shiny ? 'shiny/' : '';
  return toFileUrl(`${state.spritesDir}/${sub}${id}.gif`);
}

function setPokemon(id, shiny) {
  state.pokemonId = id;
  state.shiny = !!shiny;
  const url = spriteUrl(id, state.shiny);
  // 이로치 파일이 없을 수 있으니 실패 시 일반 스프라이트로 폴백
  sprite.onerror = () => {
    sprite.onerror = null;
    sprite.src = spriteUrl(id, false);
  };
  sprite.src = url;
}

function applyFacing() {
  sprite.classList.toggle('flip', state.facingLeft);
}

// 현재 모드에 맞춰 보행 bobbing / 바닥 그림자 상태를 동기화
function applyMotion() {
  const walking = state.mode === 'walk';
  sprite.classList.toggle('walking', walking);
  shadow.classList.toggle('walking', walking);
  // 공중(드래그/낙하)에서는 발밑 그림자를 숨긴다
  document.body.classList.toggle(
    'airborne',
    state.mode === 'drag' || state.mode === 'fall'
  );
  document.body.classList.toggle('resting', state.mode === 'sleep');
}

// ---------- REACT (클릭 반응) ----------
let reactTimer = null;
function react() {
  sprite.classList.remove('react');
  // 리플로우로 애니메이션 재시작
  void sprite.offsetWidth;
  sprite.classList.add('react');
  clearTimeout(reactTimer);
  reactTimer = setTimeout(() => sprite.classList.remove('react'), 520);
}

// ---------- 울음소리 ----------
let cryAudio = null;
function playCry() {
  if (!state.soundEnabled || !state.criesDir) return;
  try {
    const url = toFileUrl(`${state.criesDir}/${state.pokemonId}.ogg`);
    if (cryAudio) {
      cryAudio.pause();
    }
    cryAudio = new Audio(url);
    cryAudio.volume = 0.45;
    cryAudio.play().catch(() => {}); // 파일 없거나 자동재생 차단 시 무시
  } catch {
    /* noop */
  }
}

// ---------- 말풍선 ----------
// 공용 한마디 + 포켓몬별 울음소리 대사
const COMMON_PHRASES = ['반가워!', '놀자~', '심심해...', '뭐해?', '헤헤', '좋아!'];
const CRY_PHRASES = {
  1: ['이상~', '씨!씨!'],
  4: ['파이~', '파이리!'],
  7: ['꼬북꼬북!', '꼬북~'],
  25: ['피카!', '피카츄!'],
  132: ['메타몽?', '몽...'],
  133: ['이브이~'],
};

function phrases() {
  return [...(CRY_PHRASES[state.pokemonId] || []), ...COMMON_PHRASES];
}

function randomPhrase() {
  const list = phrases();
  return list[Math.floor(Math.random() * list.length)];
}

function timeComment() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return '좋은 아침!';
  if (h >= 11 && h < 14) return '점심 먹었어?';
  if (h >= 14 && h < 18) return '오후도 파이팅!';
  if (h >= 18 && h < 22) return '오늘 하루 어땠어?';
  return '늦었네, 안 자?';
}

function showBubble(text, ms = 3000) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(state.bubbleTimer);
  state.bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

function hideBubble() {
  clearTimeout(state.bubbleTimer);
  bubble.classList.remove('show');
}

function scheduleNextSpeech() {
  clearTimeout(state.speechTimer);
  if (!state.speechEnabled) return;
  const ms =
    (state.speechMin + Math.random() * (state.speechMax - state.speechMin)) * 1000;
  state.speechTimer = setTimeout(() => {
    // 깨어 있을 때(idle/walk)만 말한다
    if (state.mode === 'idle' || state.mode === 'walk') {
      // 30% 확률로 시간 코멘트, 아니면 랜덤 한마디
      const text =
        Math.random() < 0.3
          ? timeComment()
          : randomPhrase();
      showBubble(text);
    }
    scheduleNextSpeech();
  }, ms);
}

// ---------- 수면 모드 ----------
function isNight() {
  const h = new Date().getHours();
  const { nightStart, nightEnd } = state;
  // 자정을 넘는 구간(예: 22~7) 처리
  return nightStart <= nightEnd
    ? h >= nightStart && h < nightEnd
    : h >= nightStart || h < nightEnd;
}

function shouldSleep() {
  if (!state.sleepEnabled) return false;
  if (state.mode === 'drag' || state.mode === 'fall') return false;
  if (isNight()) return true;
  const idleMs = state.sleepIdleMinutes * 60 * 1000;
  return Date.now() - state.lastActivity > idleMs;
}

function goSleep() {
  if (state.mode === 'sleep') return;
  clearTimeout(state.idleTimer);
  clearTimeout(state.speechTimer);
  state.walkTarget = null;
  state.mode = 'sleep';
  applyMotion();
  hideBubble();
  sprite.classList.remove('react');
  sprite.classList.add('sleeping');
  zzz.classList.add('show');
}

let grogTimer = null;
function wake() {
  if (state.mode !== 'sleep') return;
  state.mode = 'idle';
  applyMotion();
  sprite.classList.remove('sleeping');
  zzz.classList.remove('show');
  // 기상 직후 잠깐 굼뜨게(느린 이동 + 느린 반응 + 느린 걸음)
  state.grogEndAt = Date.now() + GROG_MS;
  sprite.classList.add('groggy');
  shadow.classList.add('groggy');
  clearTimeout(grogTimer);
  grogTimer = setTimeout(() => {
    sprite.classList.remove('groggy');
    shadow.classList.remove('groggy');
  }, GROG_MS);
  scheduleNextWalk();
  scheduleNextSpeech();
}

// 사용자 상호작용 기록 → 유휴 타이머 리셋, 자고 있으면 깨우기.
// (밤이어도 잠깐 깨어나며, 수면 체커가 다시 재우게 둔다)
function markActivity() {
  state.lastActivity = Date.now();
  wake();
}

// ---------- IDLE → WALK 스케줄 ----------
function scheduleNextWalk() {
  clearTimeout(state.idleTimer);
  if (!state.walkEnabled) return;
  const ms =
    (state.walkMin + Math.random() * (state.walkMax - state.walkMin)) * 1000;
  state.idleTimer = setTimeout(() => {
    if (state.mode === 'idle') startWalk();
  }, ms);
}

function startWalk() {
  const { minX, maxX } = walkBounds();
  if (maxX <= minX) return; // 산책할 공간이 없음
  // 현재 위치에서 충분히 떨어진 임의 목표.
  // 산책 범위가 좁으면 조건을 만족하는 지점이 아예 없을 수 있으므로 시도 횟수를 제한한다.
  // (무한 재추첨 시 렌더러가 통째로 멈춤)
  const minDist = Math.min(state.size * 0.5, (maxX - minX) * 0.5);
  let target = null;
  for (let i = 0; i < 12; i++) {
    const t = minX + Math.random() * (maxX - minX);
    if (Math.abs(t - state.pos.x) >= minDist) {
      target = t;
      break;
    }
  }
  // 실패하면 현재 위치에서 더 먼 쪽 끝으로
  if (target == null) {
    target =
      Math.abs(minX - state.pos.x) > Math.abs(maxX - state.pos.x) ? minX : maxX;
  }
  state.walkTarget = target;
  state.facingLeft = target < state.pos.x;
  applyFacing();
  state.mode = 'walk';
  applyMotion();
}

function stopWalk() {
  state.walkTarget = null;
  state.mode = 'idle';
  applyMotion();
  scheduleNextWalk();
}

// ---------- 낙하 시작(드롭) ----------
function startFall() {
  state.mode = 'fall';
  state.vy = 0;
  state.walkTarget = null;
  clearTimeout(state.idleTimer);
  applyMotion();
}

function land() {
  state.pos.y = state.groundY;
  window.pet.moveTo(state.pos.x, state.pos.y);
  state.vy = 0;
  state.mode = 'idle';
  applyMotion();
  react(); // 착지 통통
  scheduleNextWalk();
}

// ---------- 메인 애니메이션 루프 ----------
function tick() {
  if (state.mode === 'fall') {
    state.vy = Math.min(MAX_FALL, state.vy + GRAVITY);
    let ny = state.pos.y + state.vy;
    if (ny >= state.groundY) {
      land();
    } else {
      state.pos.y = ny;
      window.pet.moveTo(state.pos.x, state.pos.y);
    }
  } else if (state.mode === 'walk' && state.walkTarget != null) {
    const dir = state.walkTarget > state.pos.x ? 1 : -1;
    const step = effectiveWalkSpeed() * dir;
    let nx = state.pos.x + step;
    if (Math.abs(state.walkTarget - state.pos.x) <= Math.abs(step)) {
      nx = state.walkTarget;
    }
    // 산책 경계 클램프
    const { minX, maxX } = walkBounds();
    nx = Math.max(minX, Math.min(maxX, nx));

    state.pos.x = nx;
    window.pet.moveTo(state.pos.x, state.pos.y);

    if (nx === state.walkTarget || nx === minX || nx === maxX) {
      stopWalk();
    }
  }
  requestAnimationFrame(tick);
}

// ---------- 마우스: 클릭 vs 드래그 ----------
let down = null; // { startX, startY, winX, winY, moved }
const DRAG_THRESHOLD = 4;

sprite.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // 좌클릭만
  markActivity(); // 자고 있으면 깨우기
  down = {
    startX: e.screenX,
    startY: e.screenY,
    winX: state.pos.x,
    winY: state.pos.y,
    moved: false,
  };
  // 드래그 시작 동안 산책 중단
  clearTimeout(state.idleTimer);
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!down) return;
  const dx = e.screenX - down.startX;
  const dy = e.screenY - down.startY;
  if (!down.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    down.moved = true;
    state.mode = 'drag';
    state.walkTarget = null;
    applyMotion();
    document.body.classList.add('dragging');
    // 들어올림 → 버둥거림
    hideBubble();
    sprite.classList.add('lifted');
  }
  if (down.moved) {
    state.pos.x = down.winX + dx;
    state.pos.y = down.winY + dy;
    window.pet.moveTo(state.pos.x, state.pos.y);
  }
});

window.addEventListener('mouseup', (e) => {
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  document.body.classList.remove('dragging');
  markActivity();
  if (wasDrag) {
    // 놓음 → 버둥 멈추고 바닥으로 낙하
    sprite.classList.remove('lifted');
    if (state.pos.y < state.groundY) {
      startFall(); // 공중이면 떨어뜨림 (tick이 착지 처리)
    } else {
      land(); // 이미 바닥/그 아래면 즉시 착지
    }
  } else {
    // 이동 없으면 클릭 → 걸음 멈추고 반응 + 울음소리 + 가끔 한마디
    if (state.mode === 'walk') {
      state.walkTarget = null;
      state.mode = 'idle';
      applyMotion();
    }
    react();
    playCry();
    if (state.speechEnabled && Math.random() < 0.5) {
      showBubble(randomPhrase(), 2000);
    }
    scheduleNextWalk();
  }
});

// 우클릭 → 컨텍스트 메뉴
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.showContextMenu();
});

// ---------- 메인 프로세스 이벤트 ----------
window.pet.onSetPokemon(({ id, shiny, announce }) => {
  setPokemon(id, shiny);
  react();
  playCry();
  // 랜덤 뽑기로 이로치가 나오면 축하 한마디
  if (announce && shiny && state.speechEnabled) {
    showBubble('✨ 이로치다! ✨', 4000);
  }
});
window.pet.onWalkToggle((enabled) => {
  state.walkEnabled = enabled;
  if (enabled) scheduleNextWalk();
  else {
    clearTimeout(state.idleTimer);
    if (state.mode === 'walk') stopWalk();
  }
});
window.pet.onSoundToggle((enabled) => {
  state.soundEnabled = enabled;
});
window.pet.onSpeechToggle((enabled) => {
  state.speechEnabled = enabled;
  if (enabled) scheduleNextSpeech();
  else {
    clearTimeout(state.speechTimer);
    hideBubble();
  }
});
window.pet.onSleepToggle((enabled) => {
  state.sleepEnabled = enabled;
  if (!enabled && state.mode === 'sleep') wake();
});

// ---------- 초기화 ----------
async function init() {
  const data = await window.pet.getInit();
  const cfg = data.config;
  state.spritesDir = data.spritesDir;
  state.criesDir = data.criesDir || '';
  state.pokemonId = data.pokemonId;
  state.shiny = cfg.shiny;
  state.walkEnabled = cfg.walk.enabled;
  state.walkSpeed = cfg.walk.speed || 1.0;
  state.walkMin = cfg.walk.minIntervalSec;
  state.walkMax = cfg.walk.maxIntervalSec;
  if (typeof cfg.walk.rangeFraction === 'number') {
    state.walkRangeFraction = cfg.walk.rangeFraction;
  }
  // 울음소리 / 말풍선 / 수면 설정
  if (cfg.sound) state.soundEnabled = !!cfg.sound.enabled;
  if (cfg.speech) {
    state.speechEnabled = cfg.speech.enabled !== false;
    if (typeof cfg.speech.minIntervalSec === 'number') state.speechMin = cfg.speech.minIntervalSec;
    if (typeof cfg.speech.maxIntervalSec === 'number') state.speechMax = cfg.speech.maxIntervalSec;
  }
  if (cfg.sleep) {
    state.sleepEnabled = cfg.sleep.enabled !== false;
    if (typeof cfg.sleep.idleMinutes === 'number') state.sleepIdleMinutes = cfg.sleep.idleMinutes;
    if (typeof cfg.sleep.nightStart === 'number') state.nightStart = cfg.sleep.nightStart;
    if (typeof cfg.sleep.nightEnd === 'number') state.nightEnd = cfg.sleep.nightEnd;
  }
  state.workArea = data.workArea;
  if (data.bounds) {
    state.pos = { x: data.bounds.x, y: data.bounds.y };
    state.size = data.bounds.width;
    state.groundY = data.bounds.y; // 시작 위치 = 바닥
  }
  // 스프라이트를 창 안에서 footprint 크기(하단 중앙)로 그리도록 CSS 변수 설정
  if (data.petFootprint) {
    document.documentElement.style.setProperty('--pet', `${data.petFootprint}px`);
  }
  setPokemon(state.pokemonId, state.shiny);
  applyMotion();
  state.lastActivity = Date.now();
  scheduleNextWalk();
  scheduleNextSpeech();
  // 수면 조건 주기적 확인(유휴/야간)
  state.sleepChecker = setInterval(() => {
    if (state.mode !== 'sleep' && shouldSleep()) goSleep();
  }, 15000);
  requestAnimationFrame(tick);
}

init();
