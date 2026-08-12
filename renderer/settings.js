// 설정 창 렌더러: config.json을 손으로 고치는 대신 슬라이더/드롭다운으로 조작한다.
// 모든 변경은 즉시 메인으로 전송되고(라이브 적용), 메인의 방송을 받아 UI를 다시 그린다.
// → 트레이나 우클릭 메뉴에서 바꿔도 이 창의 값이 따라온다.

const api = window.petSettings;
const $ = (id) => document.getElementById(id);

let cfg = null;
let pokemonList = [];
let autoDisplays = []; // 상대 지정 선택지 (맨 왼쪽 / 맨 오른쪽 / 주)
let displays = []; // 실제 감지된 모니터 (전원·케이블 상태에 따라 실시간으로 바뀐다)

const SPRITE_BASE = 96; // 크기 배율을 실제 픽셀로 환산해 보여주기 위한 원본 크기

// 슬라이더: [요소 id, 현재값 읽기, 변경 시 보낼 패치, 표시 문자열]
// 간격 슬라이더는 min > max로 뒤집히지 않도록 반대쪽 값을 같이 밀어준다.
const RANGES = [
  ['scale', (c) => c.scale, (v) => ({ scale: v }), (v) => `${Math.round(SPRITE_BASE * v)}px`],
  ['margin', (c) => c.margin, (v) => ({ margin: v }), (v) => `${v}px`],
  ['walkSpeed', (c) => c.walk.speed, (v) => ({ walk: { speed: v } }), (v) => `${v.toFixed(1)}x`],
  ['walkWidths', (c) => c.walk.widths, (v) => ({ walk: { widths: v } }), (v) => `×${v}`],
  [
    'walkMin',
    (c) => c.walk.minIntervalSec,
    (v, c) => ({
      walk: { minIntervalSec: v, maxIntervalSec: Math.max(v, c.walk.maxIntervalSec) },
    }),
    (v) => `${v}초`,
  ],
  [
    'walkMax',
    (c) => c.walk.maxIntervalSec,
    (v, c) => ({
      walk: { maxIntervalSec: v, minIntervalSec: Math.min(v, c.walk.minIntervalSec) },
    }),
    (v) => `${v}초`,
  ],
  [
    'speechMin',
    (c) => c.speech.minIntervalSec,
    (v, c) => ({
      speech: { minIntervalSec: v, maxIntervalSec: Math.max(v, c.speech.maxIntervalSec) },
    }),
    (v) => `${v}초`,
  ],
  [
    'speechMax',
    (c) => c.speech.maxIntervalSec,
    (v, c) => ({
      speech: { maxIntervalSec: v, minIntervalSec: Math.min(v, c.speech.minIntervalSec) },
    }),
    (v) => `${v}초`,
  ],
  ['sleepIdle', (c) => c.sleep.idleMinutes, (v) => ({ sleep: { idleMinutes: v } }), (v) => `${v}분`],
];

// 체크박스: [요소 id, 현재값 읽기, 변경 시 보낼 패치]
const CHECKS = [
  ['walkEnabled', (c) => c.walk.enabled, (v) => ({ walk: { enabled: v } })],
  ['soundEnabled', (c) => c.sound.enabled, (v) => ({ sound: { enabled: v } })],
  ['speechEnabled', (c) => c.speech.enabled, (v) => ({ speech: { enabled: v } })],
  ['notifyEnabled', (c) => c.notify.enabled, (v) => ({ notify: { enabled: v } })],
  ['sleepEnabled', (c) => c.sleep.enabled, (v) => ({ sleep: { enabled: v } })],
  ['autoLaunch', (c) => c.autoLaunch, (v) => ({ autoLaunch: v })],
];

function fillSelect(el, options) {
  el.innerHTML = '';
  for (const { value, label } of options) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = label;
    el.appendChild(opt);
  }
}

// ---------- 모니터 선택 ----------
// 값 형식: "auto:leftmost" (상대 지정) / "id:1746409647" (특정 모니터 직접 지정)

function displayLabel(d) {
  const tags = [`${d.bounds.width}×${d.bounds.height}`];
  if (d.rotation) tags.push(`${d.rotation}°`);
  if (d.primary) tags.push('주');
  return `${d.name} · ${tags.join(' · ')}`;
}

function fillDisplaySelect() {
  const sel = $('anchorDisplay');
  sel.innerHTML = '';

  const auto = document.createElement('optgroup');
  auto.label = '자동 (모니터가 바뀌어도 유지)';
  for (const d of autoDisplays) {
    const opt = document.createElement('option');
    opt.value = `auto:${d.key}`;
    opt.textContent = d.ko;
    auto.appendChild(opt);
  }
  sel.appendChild(auto);

  const detected = document.createElement('optgroup');
  detected.label = `감지된 모니터 (${displays.length}대)`;
  for (const d of displays) {
    const opt = document.createElement('option');
    opt.value = `id:${d.id}`;
    opt.textContent = displayLabel(d);
    detected.appendChild(opt);
  }
  sel.appendChild(detected);
}

// 실제 모니터 배치를 비율 그대로 축소해 그린다 → 어느 화면에 붙는지 글자보다 빨리 이해된다.
function renderDisplayMap() {
  const box = $('displayMap');
  box.innerHTML = '';
  if (!displays.length) return;

  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const W = maxX - minX;
  const H = maxY - minY;
  const PAD = 6; // 테두리에 딱 붙지 않도록 그림 안쪽 여백(px)
  box.style.aspectRatio = `${W} / ${H}`;
  box.style.padding = `${PAD}px`;

  for (const d of displays) {
    const el = document.createElement('button');
    el.className = 'mon' + (d.anchor ? ' on' : '');
    el.style.left = `calc(${((d.bounds.x - minX) / W) * 100}% + ${PAD}px)`;
    el.style.top = `calc(${((d.bounds.y - minY) / H) * 100}% + ${PAD}px)`;
    el.style.width = `calc(${(d.bounds.width / W) * 100}% - 3px)`;
    el.style.height = `calc(${(d.bounds.height / H) * 100}% - 3px)`;
    el.title = displayLabel(d);
    el.addEventListener('click', () => api.set({ anchor: { displayId: d.id } }));

    // 모니터 이름은 EDID에서 온 값이므로 textContent로만 넣는다
    const name = document.createElement('span');
    name.textContent = d.name + (d.primary ? ' ★' : '');
    const res = document.createElement('span');
    res.className = 'res';
    res.textContent = `${d.bounds.width}×${d.bounds.height}`;
    el.append(name, res);

    // 펫이 붙는 코너를 점으로 표시
    if (d.anchor && cfg) {
      const dot = document.createElement('i');
      dot.className = 'corner';
      const c = cfg.anchor.corner;
      dot.style[c.startsWith('top') ? 'top' : 'bottom'] = '4px';
      dot.style[c.endsWith('right') ? 'right' : 'left'] = '4px';
      el.appendChild(dot);
    }
    box.appendChild(el);
  }

  const anchor = displays.find((d) => d.anchor);
  const chosen = cfg && cfg.anchor.displayId != null;
  const missing = chosen && !displays.some((d) => d.id === cfg.anchor.displayId);
  $('mapHint').textContent = missing
    ? `지정한 모니터가 지금 연결돼 있지 않습니다 → ${anchor ? anchor.name : '다른 모니터'}에 임시 배치 (다시 연결하면 돌아갑니다)`
    : `클릭해서 고를 수 있습니다. 지금 기준: ${anchor ? anchor.name : '-'}`;
}

function buildPokemonGrid() {
  const grid = $('pokeGrid');
  grid.innerHTML = '';
  for (const p of pokemonList) {
    const btn = document.createElement('button');
    btn.textContent = p.ko;
    btn.dataset.id = String(p.id);
    btn.addEventListener('click', () => api.pick(p.id));
    grid.appendChild(btn);
  }
}

// 설정 → UI. 어디서 바뀌었든 항상 전체를 다시 그린다(부분 갱신 버그를 원천 차단).
function render() {
  if (!cfg) return;

  const current = pokemonList.find((p) => p.id === cfg.currentPokemonId);
  $('petName').textContent = `${current ? current.ko : '포켓몬 펫'}${cfg.shiny ? ' ✨' : ''}`;
  for (const btn of $('pokeGrid').children) {
    btn.classList.toggle('on', Number(btn.dataset.id) === cfg.currentPokemonId);
  }

  for (const [id, get, , out] of RANGES) {
    const v = Number(get(cfg));
    $(id).value = String(v);
    $(`${id}Out`).textContent = out(v, cfg);
  }
  for (const [id, get] of CHECKS) {
    $(id).checked = get(cfg) !== false;
  }

  // 특정 모니터를 지정했고 그 모니터가 살아 있으면 그것을, 아니면 상대 지정을 고른다
  const byId = cfg.anchor.displayId != null && displays.some((d) => d.id === cfg.anchor.displayId);
  $('anchorDisplay').value = byId ? `id:${cfg.anchor.displayId}` : `auto:${cfg.anchor.display}`;
  $('anchorCorner').value = cfg.anchor.corner;
  renderDisplayMap();
  $('nightStart').value = String(cfg.sleep.nightStart);
  $('nightEnd').value = String(cfg.sleep.nightEnd);
}

function wire() {
  for (const [id, , patch, out] of RANGES) {
    $(id).addEventListener('input', (e) => {
      const v = Number(e.target.value);
      $(`${id}Out`).textContent = out(v, cfg); // 방송을 기다리지 않고 즉시 숫자 갱신
      api.set(patch(v, cfg));
    });
  }
  for (const [id, , patch] of CHECKS) {
    $(id).addEventListener('change', (e) => api.set(patch(e.target.checked)));
  }

  $('anchorDisplay').addEventListener('change', (e) => {
    const [kind, value] = e.target.value.split(':');
    // 상대 지정으로 돌아갈 때는 특정 모니터 지정을 반드시 해제해야 한다(안 그러면 계속 그게 이긴다)
    api.set(
      kind === 'id'
        ? { anchor: { displayId: Number(value) } }
        : { anchor: { display: value, displayId: null } }
    );
  });
  $('anchorCorner').addEventListener('change', (e) =>
    api.set({ anchor: { corner: e.target.value } })
  );
  $('nightStart').addEventListener('change', (e) =>
    api.set({ sleep: { nightStart: Number(e.target.value) } })
  );
  $('nightEnd').addEventListener('change', (e) =>
    api.set({ sleep: { nightEnd: Number(e.target.value) } })
  );

  $('petVisible').addEventListener('change', (e) => api.setVisible(e.target.checked));
  $('btnRandom').addEventListener('click', () => api.drawRandom());
  $('btnReset').addEventListener('click', () => api.resetPosition());
  $('btnClose').addEventListener('click', () => api.close());
  // Esc로 닫기 (설정 창은 언제든 버려도 되는 창)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.close();
  });
}

async function init() {
  const data = await api.init();
  cfg = data.config;
  pokemonList = data.pokemon;
  autoDisplays = data.autoDisplays;
  displays = data.displays;

  buildPokemonGrid();
  fillDisplaySelect();
  fillSelect(
    $('anchorCorner'),
    data.corners.map((c) => ({ value: c.key, label: c.ko }))
  );
  const hours = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${h}시` }));
  fillSelect($('nightStart'), hours);
  fillSelect($('nightEnd'), hours);

  $('petVisible').checked = data.petVisible;
  render();
  wire();

  api.onConfigChanged((next) => {
    cfg = next;
    render();
  });
  api.onVisibilityChanged((visible) => {
    $('petVisible').checked = visible;
  });
  // 모니터를 켜고 끄거나 해상도를 바꾸면 목록과 배치도를 다시 만든다
  api.onDisplaysChanged((list) => {
    displays = list;
    fillDisplaySelect();
    render();
  });
}

init();
