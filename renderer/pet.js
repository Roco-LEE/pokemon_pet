// 펫 렌더러: 상태머신(IDLE/WALK/DRAG) + 클릭 반응(REACT) + 포켓몬 전환.

const sprite = document.getElementById('sprite');

const state = {
  mode: 'idle', // 'idle' | 'walk' | 'drag'
  pos: { x: 0, y: 0 }, // 현재 창 좌상단(스크린 좌표)
  size: 192,
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  spritesDir: '',
  pokemonId: 25,
  shiny: false,
  walkEnabled: true,
  walkSpeed: 1.0,
  walkMin: 8,
  walkMax: 20,
  facingLeft: false,
  walkTarget: null,
  idleTimer: null,
  walkRangeFraction: 0.15, // 산책 범위 = 우측 하단 가로폭의 이 비율
};

// 산책 가능한 좌우 경계(스크린 좌표). 우측 하단에서 가로폭 walkRangeFraction 만큼만.
function walkBounds() {
  const right = state.workArea.x + state.workArea.width - state.size;
  const band = state.workArea.width * state.walkRangeFraction;
  const left = Math.max(state.workArea.x, right - band);
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
  // 현재 위치에서 충분히 떨어진 임의 목표
  let target;
  do {
    target = minX + Math.random() * (maxX - minX);
  } while (Math.abs(target - state.pos.x) < state.size * 0.5 && maxX > minX);
  state.walkTarget = target;
  state.facingLeft = target < state.pos.x;
  applyFacing();
  state.mode = 'walk';
}

function stopWalk() {
  state.walkTarget = null;
  state.mode = 'idle';
  scheduleNextWalk();
}

// ---------- 메인 애니메이션 루프 ----------
function tick() {
  if (state.mode === 'walk' && state.walkTarget != null) {
    const dir = state.walkTarget > state.pos.x ? 1 : -1;
    const step = state.walkSpeed * dir;
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
    document.body.classList.add('dragging');
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
  if (wasDrag) {
    state.mode = 'idle';
    scheduleNextWalk();
  } else {
    // 이동 없으면 클릭 → 반응
    react();
    scheduleNextWalk();
  }
});

// 우클릭 → 컨텍스트 메뉴
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.showContextMenu();
});

// ---------- 메인 프로세스 이벤트 ----------
window.pet.onSetPokemon(({ id, shiny }) => setPokemon(id, shiny));
window.pet.onWalkToggle((enabled) => {
  state.walkEnabled = enabled;
  if (enabled) scheduleNextWalk();
  else {
    clearTimeout(state.idleTimer);
    if (state.mode === 'walk') stopWalk();
  }
});

// ---------- 초기화 ----------
async function init() {
  const data = await window.pet.getInit();
  state.spritesDir = data.spritesDir;
  state.pokemonId = data.pokemonId;
  state.shiny = data.config.shiny;
  state.walkEnabled = data.config.walk.enabled;
  state.walkSpeed = data.config.walk.speed || 1.0;
  state.walkMin = data.config.walk.minIntervalSec;
  state.walkMax = data.config.walk.maxIntervalSec;
  if (typeof data.config.walk.rangeFraction === 'number') {
    state.walkRangeFraction = data.config.walk.rangeFraction;
  }
  state.workArea = data.workArea;
  if (data.bounds) {
    state.pos = { x: data.bounds.x, y: data.bounds.y };
    state.size = data.bounds.width;
  }
  setPokemon(state.pokemonId, state.shiny);
  scheduleNextWalk();
  requestAnimationFrame(tick);
}

init();
