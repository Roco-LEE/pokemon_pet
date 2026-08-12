// Electron 메인 프로세스: 투명 창 생성, 모니터/코너 배치, IPC, 트레이, 설정 창, 설정 저장.

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  screen,
  nativeImage,
  powerMonitor,
} = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  currentPokemonId: 25,
  scale: 2,
  margin: 24,
  // 배치 기준: 어느 모니터의 어느 코너에 붙일지 (책상 배치에 종속되는 값)
  // display = 상대 지정(맨 왼쪽/맨 오른쪽/주). displayId = 특정 모니터 직접 지정(있으면 우선).
  anchor: { display: 'leftmost', displayId: null, corner: 'bottom-left' },
  // widths = 산책 범위를 "펫 너비의 N배"로. 화면 비율에 휘둘리지 않는다.
  walk: { enabled: true, minIntervalSec: 8, maxIntervalSec: 20, speed: 1.0, widths: 3 },
  sound: { enabled: false },
  speech: { enabled: true, minIntervalSec: 25, maxIntervalSec: 60 },
  sleep: { enabled: true, idleMinutes: 5, nightStart: 22, nightEnd: 7 },
  // 윈도우 알림/시스템 이벤트가 오면 펫이 그쪽을 쳐다본다
  notify: { enabled: true },
  // 윈도우 로그인 시 자동 실행
  autoLaunch: false,
  shiny: false,
};

// 얕은 병합으로는 통째로 갈아치워지는 중첩 설정들 (예전 config.json에 없는 키를 채워야 한다)
const NESTED_KEYS = ['anchor', 'walk', 'sound', 'speech', 'sleep', 'notify'];

// 펫(스프라이트) 원본 픽셀 크기. Gen5 애니메이션 GIF는 대략 96px 캔버스.
const SPRITE_BASE = 96;

// 창 여백(스프라이트 footprint 대비 비율). 점프/버둥 시 잘리지 않도록 확보.
const PAD_TOP_FRAC = 0.45; // 위쪽 점프 헤드룸
const PAD_SIDE_FRAC = 0.15; // 좌우 버둥(회전) 여유

const POKEMON = [
  { id: 1, ko: '이상해씨' },
  { id: 4, ko: '파이리' },
  { id: 7, ko: '꼬부기' },
  { id: 25, ko: '피카츄' },
  { id: 132, ko: '메타몽' },
  { id: 133, ko: '이브이' },
];

// 랜덤 뽑기에서 이로치가 나올 확률 (1/16)
const SHINY_CHANCE = 1 / 16;

// 배치 기준 선택지 (트레이/우클릭 → 위치, 설정 창 드롭다운)
const ANCHOR_DISPLAYS = [
  { key: 'leftmost', ko: '맨 왼쪽 모니터' },
  { key: 'rightmost', ko: '맨 오른쪽 모니터' },
  { key: 'primary', ko: '주 모니터' },
];
const ANCHOR_CORNERS = [
  { key: 'bottom-left', ko: '좌하단' },
  { key: 'bottom-right', ko: '우하단' },
  { key: 'top-left', ko: '좌상단' },
  { key: 'top-right', ko: '우상단' },
];

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

let win = null;
let tray = null;
let settingsWin = null;
let config = { ...DEFAULT_CONFIG };
let petVisible = true; // 트레이에서 숨김/보이기 (앱을 껐다 켜면 항상 보이는 상태로 시작)

// 중복 실행 방지: 이미 떠 있으면 새 인스턴스는 즉시 종료
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  for (const key of NESTED_KEYS) {
    config[key] = { ...DEFAULT_CONFIG[key], ...(config[key] || {}) };
  }
}

function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('config 저장 실패:', e);
  }
}

// 설정 창 슬라이더는 드래그하는 내내 변경을 쏟아낸다 → 디스크 쓰기는 잠잠해진 뒤 한 번만.
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveConfig, 400);
}

// 좌→우 순으로 정렬한 실제 모니터 목록. 화면상의 배치 순서와 목록 순서를 일치시킨다.
function sortedDisplays() {
  return screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x);
}

// 모니터 표시 이름. EDID 라벨(예: "LG IPS FULLHD")이 있으면 쓰고, 없으면 좌→우 순번으로.
function displayName(d, index) {
  const label = (d.label || '').trim();
  // 윈도우가 장치 경로(\\.\DISPLAY1)를 주기도 한다 — 사람이 읽을 이름이 아니면 버린다
  return label && !label.startsWith('\\') ? label : `모니터 ${index + 1}`;
}

// 설정 창/메뉴에 넘길 모니터 목록 (직렬화 가능한 형태로만)
function listDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  const anchorId = getAnchorDisplay().id;
  return sortedDisplays().map((d, i) => ({
    id: d.id,
    name: displayName(d, i),
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    rotation: d.rotation,
    primary: d.id === primaryId,
    // 지금 펫이 기준으로 삼는 모니터 (상대 지정이 어디로 풀렸는지 보여준다)
    anchor: d.id === anchorId,
  }));
}

// 배치 기준 디스플레이.
// 1) anchor.displayId로 특정 모니터를 지정했으면 그것. 단 그 모니터가 사라졌으면 2)로 폴백한다
//    (설정은 지우지 않는다 — 모니터를 다시 꽂으면 원래 자리로 돌아가야 하니까).
// 2) anchor.display = leftmost | rightmost | primary 상대 지정.
function getAnchorDisplay() {
  const displays = screen.getAllDisplays();
  if (config.anchor.displayId != null) {
    const found = displays.find((d) => d.id === config.anchor.displayId);
    if (found) return found;
  }
  switch (config.anchor.display) {
    case 'rightmost':
      return displays.reduce((a, b) => (b.bounds.x > a.bounds.x ? b : a));
    case 'primary':
      return screen.getPrimaryDisplay();
    case 'leftmost':
    default:
      return displays.reduce((a, b) => (b.bounds.x < a.bounds.x ? b : a));
  }
}

// 창이 실제로 올라가 있는 디스플레이(다른 모니터로 끌고 갔을 수 있음)
function displayAt(bounds) {
  return bounds ? screen.getDisplayMatching(bounds) : getAnchorDisplay();
}

function anchorSide() {
  return config.anchor.corner.endsWith('right') ? 'right' : 'left';
}

// 스프라이트 footprint(바닥에 닿는 실제 표시 크기)
function petSize() {
  const s = Math.max(1, config.scale);
  return SPRITE_BASE * s;
}

// 실제 창 크기 = footprint + 여백(점프/버둥 헤드룸)
function windowSize() {
  const pet = petSize();
  return {
    w: Math.round(pet * (1 + PAD_SIDE_FRAC * 2)),
    h: Math.round(pet * (1 + PAD_TOP_FRAC)),
  };
}

// 설정된 코너 좌표 계산. 스프라이트가 (창 여백을 제외하고) 해당 코너에 붙도록.
function anchorPosition() {
  const { x, y, width, height } = getAnchorDisplay().workArea;
  const win = windowSize();
  const m = config.margin;
  const padSide = Math.round(petSize() * PAD_SIDE_FRAC);
  const corner = config.anchor.corner;
  return {
    // 스프라이트 좌/우 끝이 workArea 안쪽 margin 위치에 오도록 창 여백만큼 보정
    x: Math.round(
      corner.endsWith('right')
        ? x + width - win.w - m + padSide
        : x + m - padSide
    ),
    // 스프라이트 바닥(=창 바닥)이 기준선에 오도록
    y: Math.round(
      corner.startsWith('top') ? y + m : y + height - win.h - m
    ),
  };
}

// 해당 위치에서의 "바닥" y좌표(= 창 top). 펫이 올라가 있는 디스플레이 기준.
// 상단 코너에 붙여둔 경우엔 화면 꼭대기가 바닥(선반 위에 앉은 셈) — 드롭해도 화면 끝까지 떨어지지 않는다.
function groundYFor(bounds) {
  const wa = displayAt(bounds).workArea;
  return config.anchor.corner.startsWith('top')
    ? Math.round(wa.y + config.margin)
    : Math.round(wa.y + wa.height - windowSize().h - config.margin);
}

// 화면 밖 이탈 방지: 어느 디스플레이에서도 충분히 보이지 않으면 가장 가까운 곳으로 되돌린다.
const MIN_VISIBLE = 48; // 가로·세로 각각 최소한 이만큼(px)은 보여야 다시 집을 수 있다
function rescueBounds(b) {
  const displays = screen.getAllDisplays();
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };

  // 가로·세로를 따로 본다. 면적만 보면 폭 몇 px짜리 세로띠도 통과해 버린다.
  const visibleEnough = displays.some(({ workArea: wa }) => {
    const w = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const h = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return w >= Math.min(MIN_VISIBLE, b.width) && h >= Math.min(MIN_VISIBLE, b.height);
  });
  if (visibleEnough) return b; // 모니터 간 드래그·경계 걸침은 그대로 허용

  // 창 중심에서 가장 가까운 작업영역으로 끌어온다
  const nearest = displays.reduce((best, d) => {
    const wa = d.workArea;
    const dx = Math.max(wa.x - center.x, 0, center.x - (wa.x + wa.width));
    const dy = Math.max(wa.y - center.y, 0, center.y - (wa.y + wa.height));
    const dist = Math.hypot(dx, dy);
    return dist < best.dist ? { dist, wa } : best;
  }, { dist: Infinity, wa: displays[0].workArea }).wa;

  return {
    ...b,
    x: Math.round(Math.max(nearest.x, Math.min(nearest.x + nearest.width - b.width, b.x))),
    y: Math.round(Math.max(nearest.y, Math.min(nearest.y + nearest.height - b.height, b.y))),
  };
}

// 창 지오메트리를 렌더러에 통보(모니터 구성 변경·크기 변경·리셋 시 렌더러 상태 재동기화)
function sendGeometry() {
  if (!win) return;
  const bounds = win.getBounds();
  win.webContents.send('geometry-changed', {
    bounds,
    workArea: displayAt(bounds).workArea,
    groundY: groundYFor(bounds),
    anchorSide: anchorSide(),
    petFootprint: petSize(), // 크기 설정을 바꾸면 스프라이트 표시 크기도 같이 바뀐다
  });
}

function createWindow() {
  const win0 = windowSize();
  const pos = anchorPosition();

  win = new BrowserWindow({
    width: win0.w,
    height: win0.h,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 모니터 구성이 바뀌면 기준 코너로 재배치하고, 렌더러 좌표계도 다시 맞춘다.
  // (통보하지 않으면 렌더러가 옛 workArea/groundY를 믿고 펫을 예전 자리로 되돌린다)
  const reposition = () => {
    if (!win) return;
    const p = anchorPosition();
    const s = windowSize();
    win.setBounds({ x: p.x, y: p.y, width: s.w, height: s.h });
    sendGeometry();
    broadcastDisplays();
    refreshTray(); // "위치" 서브메뉴의 모니터 목록도 실제 구성을 따라간다
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);

  win.on('closed', () => {
    win = null;
  });
}

// 산책 경계 계산용 작업영역. 펫이 올라가 있는 디스플레이 기준(다른 모니터로 옮겼을 수 있음).
function currentWorkArea() {
  return displayAt(win ? win.getBounds() : null).workArea;
}

// ---------- 설정 변경 파이프라인 ----------

// 설정 변경은 전부 여기로 모인다(트레이·우클릭 메뉴·설정 창).
// 저장 → 필요한 창 재배치/리사이즈 → 렌더러와 설정 창에 방송.
function applyConfigPatch(patch) {
  const before = {
    scale: config.scale,
    margin: config.margin,
    display: config.anchor.display,
    displayId: config.anchor.displayId,
    corner: config.anchor.corner,
    autoLaunch: config.autoLaunch,
    notify: config.notify.enabled,
  };

  for (const [key, value] of Object.entries(patch)) {
    if (NESTED_KEYS.includes(key) && value && typeof value === 'object') {
      config[key] = { ...config[key], ...value };
    } else {
      config[key] = value;
    }
  }
  scheduleSave();

  const moved =
    config.anchor.display !== before.display ||
    config.anchor.displayId !== before.displayId ||
    config.anchor.corner !== before.corner ||
    config.margin !== before.margin;

  if (moved) resetPosition();
  else if (config.scale !== before.scale) resizeToScale();

  if (config.autoLaunch !== before.autoLaunch) applyAutoLaunch();
  if (config.notify.enabled !== before.notify) syncNotificationWatcher();

  broadcastConfig();
}

// 설정 변경을 펫 렌더러와 설정 창 양쪽에 알린다(어느 쪽에서 바꿔도 UI가 따라오도록)
function broadcastConfig() {
  win && win.webContents.send('config-changed', config);
  settingsWin && settingsWin.webContents.send('config-changed', config);
  broadcastDisplays(); // 기준 모니터 표시(anchor 플래그)가 설정 따라 바뀐다
  refreshTray();
}

// 모니터 구성은 앱이 켜져 있는 동안에도 바뀐다(전원 off, 케이블 분리, 해상도 변경).
// 설정 창의 목록·배치도가 실제 환경을 따라가야 한다.
function broadcastDisplays() {
  settingsWin && settingsWin.webContents.send('displays-changed', listDisplays());
}

// 크기(scale) 변경: 발밑(창 하단 중앙)을 고정한 채 창만 키우거나 줄인다.
// 좌상단 기준으로 리사이즈하면 펫이 공중에 뜨거나 바닥을 파고든다.
function resizeToScale() {
  if (!win) return;
  const b = win.getBounds();
  const s = windowSize();
  const centerX = b.x + b.width / 2;
  const bottom = b.y + b.height;
  win.setBounds(
    rescueBounds({
      x: Math.round(centerX - s.w / 2),
      y: Math.round(bottom - s.h),
      width: s.w,
      height: s.h,
    })
  );
  sendGeometry();
}

function resetPosition() {
  if (!win) return;
  const p = anchorPosition();
  const s = windowSize();
  win.setBounds({ x: p.x, y: p.y, width: s.w, height: s.h });
  sendGeometry();
}

// 포켓몬 교체. 랜덤 뽑기일 때만 이로치가 나올 수 있다.
function applyPokemon(id, shiny, announce = false) {
  config.currentPokemonId = id;
  config.shiny = !!shiny;
  saveConfig();
  // 등장 연출(반응·울음소리·이로치 축하)은 전용 이벤트로, 설정 동기화는 방송으로.
  win && win.webContents.send('set-pokemon', { id, shiny: config.shiny, announce });
  broadcastConfig();
}

function drawRandomPokemon() {
  const pool = POKEMON.filter((p) => p.id !== config.currentPokemonId);
  const list = pool.length ? pool : POKEMON;
  const pick = list[Math.floor(Math.random() * list.length)];
  applyPokemon(pick.id, Math.random() < SHINY_CHANCE, true);
}

function currentPokemonName() {
  const p = POKEMON.find((x) => x.id === config.currentPokemonId);
  return p ? p.ko : '포켓몬';
}

// ---------- 보이기 / 숨기기 ----------

function setPetVisible(visible) {
  if (!win) return;
  petVisible = !!visible;
  if (petVisible) {
    win.showInactive(); // 포커스를 뺏지 않고 등장 (작업 중이던 창 그대로)
    win.setAlwaysOnTop(true, 'screen-saver');
    pokePet('appear');
  } else {
    win.hide();
  }
  refreshTray();
  settingsWin && settingsWin.webContents.send('visibility-changed', petVisible);
}

// ---------- 메뉴 (트레이 / 우클릭 공용) ----------

function pokemonItems() {
  return POKEMON.map((p) => ({
    label: p.ko,
    type: 'radio',
    checked: config.currentPokemonId === p.id,
    // 직접 고르면 항상 일반 스프라이트 (이로치는 랜덤 뽑기 전용)
    click: () => applyPokemon(p.id, false),
  }));
}

// 기능 on/off 토글들. [설정 경로, 라벨] 목록으로 한 번에 만든다.
function toggleItems() {
  return [
    ['walk', '산책'],
    ['sound', '울음소리'],
    ['speech', '말풍선'],
    ['sleep', '수면 모드'],
    ['notify', '알림 반응'],
  ].map(([key, label]) => ({
    label: `${label} 켜기/끄기`,
    type: 'checkbox',
    checked: !!config[key].enabled,
    click: () => applyConfigPatch({ [key]: { enabled: !config[key].enabled } }),
  }));
}

function positionSubmenu() {
  const displays = listDisplays();
  return [
    // 상대 지정 — 모니터를 뺐다 꽂아도 "맨 왼쪽"은 항상 성립한다
    ...ANCHOR_DISPLAYS.map((d) => ({
      label: d.ko,
      type: 'radio',
      checked: config.anchor.displayId == null && config.anchor.display === d.key,
      click: () => applyConfigPatch({ anchor: { display: d.key, displayId: null } }),
    })),
    { type: 'separator' },
    // 실제로 감지된 모니터 직접 지정
    ...displays.map((d) => ({
      label: `${d.name} · ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (주)' : ''}`,
      type: 'radio',
      checked: config.anchor.displayId === d.id,
      click: () => applyConfigPatch({ anchor: { displayId: d.id } }),
    })),
    { type: 'separator' },
    ...ANCHOR_CORNERS.map((c) => ({
      label: c.ko,
      type: 'radio',
      checked: config.anchor.corner === c.key,
      click: () => applyConfigPatch({ anchor: { corner: c.key } }),
    })),
    { type: 'separator' },
    { label: '기준 위치로 리셋', click: () => resetPosition() },
  ];
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    ...pokemonItems(),
    { type: 'separator' },
    { label: '랜덤 뽑기 🎲', click: () => drawRandomPokemon() },
    ...toggleItems(),
    { type: 'separator' },
    { label: '위치', submenu: positionSubmenu() },
    { label: '설정 열기…', click: () => openSettings() },
    { label: '숨기기 (트레이에서 다시 부르기)', click: () => setPetVisible(false) },
    { label: '종료', click: () => app.quit() },
  ]);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '펫 보이기',
      type: 'checkbox',
      checked: petVisible,
      click: () => setPetVisible(!petVisible),
    },
    { type: 'separator' },
    { label: '포켓몬', submenu: pokemonItems() },
    { label: '랜덤 뽑기 🎲', click: () => drawRandomPokemon() },
    { type: 'separator' },
    { label: '설정 열기…', click: () => openSettings() },
    { label: '위치', submenu: positionSubmenu() },
    {
      label: '윈도우 시작 시 자동 실행',
      type: 'checkbox',
      checked: !!config.autoLaunch,
      click: () => applyConfigPatch({ autoLaunch: !config.autoLaunch }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(
    `${currentPokemonName()}${config.shiny ? ' ✨' : ''} — 포켓몬 펫${petVisible ? '' : ' (숨김)'}`
  );
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  // 좌클릭 = 숨겼다 다시 부르기 (트레이의 핵심 동작)
  tray.on('click', () => setPetVisible(!petVisible));
  tray.on('double-click', () => openSettings());
  refreshTray();
}

// ---------- 설정 창 ----------

function openSettings() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 380,
    minHeight: 480,
    title: '포켓몬 펫 설정',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#1d2027',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ---------- 윈도우 시작 시 자동 실행 ----------

function applyAutoLaunch() {
  if (process.platform === 'linux') return; // 지원 대상 아님
  try {
    app.setLoginItemSettings({
      openAtLogin: !!config.autoLaunch,
      // 개발 중(electron .)에는 electron.exe가 실행 파일이라 프로젝트 경로를 인자로 넘겨야 한다
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(process.argv[1] || __dirname)],
    });
  } catch (e) {
    console.error('자동 실행 설정 실패:', e);
  }
}

// ---------- 알림 / 시스템 이벤트 반응 ----------

// 윈도우 토스트 알림은 알림 DB(wpndatabase.db)의 WAL에 기록된다.
// 내용은 읽지 않고 "파일이 커졌다"는 사실만 보고 반응한다 — 네이티브 모듈 없이 가능한 가장 가벼운 감지.
//
// fs.watch는 쓰지 않는다: 알림 서비스가 WAL 파일을 계속 열어둔 탓에 윈도우가 디렉터리 엔트리
// 갱신을 미루고, 변경 통지가 10초 이상 늦거나 아예 오지 않았다(실측). 크기를 직접 재는 편이 정확하다.
const NOTIFY_POLL_MS = 1500; // stat 한 번 = 사실상 공짜
const NOTIFY_DEBOUNCE_MS = 15000; // 알림 하나가 표시·만료·정리로 여러 번 기록된다 → 한 번의 반응으로 묶는다
let notifyTimer = null;
let notifySize = -1;
let lastNotifyAt = 0;

function notificationWal() {
  const local = process.env.LOCALAPPDATA;
  return local
    ? path.join(local, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db-wal')
    : null;
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1; // 파일이 없거나 접근 불가 → 이번 턴은 건너뛴다
  }
}

function startNotifyWatcher() {
  if (notifyTimer || process.platform !== 'win32') return;
  const file = notificationWal();
  if (!file) return;
  notifySize = fileSize(file);
  if (notifySize < 0) return; // 알림 DB가 없는 환경이면 조용히 비활성화
  notifyTimer = setInterval(() => {
    const size = fileSize(file);
    if (size < 0) return;
    const grew = size > notifySize;
    // 줄어드는 경우(체크포인트로 WAL이 비워짐)도 기준값은 갱신해야 다음 증가를 잡는다
    notifySize = size;
    if (!grew) return;
    const now = Date.now();
    if (now - lastNotifyAt < NOTIFY_DEBOUNCE_MS) return;
    lastNotifyAt = now;
    pokePet('notification');
  }, NOTIFY_POLL_MS);
}

function stopNotifyWatcher() {
  clearInterval(notifyTimer);
  notifyTimer = null;
}

function syncNotificationWatcher() {
  config.notify.enabled ? startNotifyWatcher() : stopNotifyWatcher();
}

// 알림이 뜨는 쪽(윈도우는 주 모니터 우하단) 기준으로 펫이 어느 방향을 볼지
function notifyDirection() {
  if (!win) return 'right';
  const wa = screen.getPrimaryDisplay().workArea;
  const b = win.getBounds();
  return wa.x + wa.width < b.x + b.width / 2 ? 'left' : 'right';
}

// 펫에게 "이런 일이 있었다"고 알리는 단일 통로 (알림/잠금해제/절전복귀/등장)
function pokePet(kind) {
  if (!win || !petVisible) return;
  if (kind !== 'appear' && !config.notify.enabled) return;
  win.webContents.send('pet-event', { kind, direction: notifyDirection() });
}

// ---------- IPC ----------

// 드래그/산책: 창을 상대 이동
ipcMain.on('move-window', (_e, { dx, dy }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds(rescueBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) }));
});

// 절대 좌표로 이동
ipcMain.on('move-window-to', (_e, { x, y }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds(rescueBounds({ ...b, x: Math.round(x), y: Math.round(y) }));
});

ipcMain.on('reset-position', () => resetPosition());

ipcMain.on('show-context-menu', () => {
  buildContextMenu().popup({ window: win });
});

ipcMain.on('quit', () => app.quit());

ipcMain.handle('get-init', () => {
  return {
    config,
    pokemonId: config.currentPokemonId,
    spritesDir: path.join(__dirname, 'assets', 'sprites'),
    criesDir: path.join(__dirname, 'assets', 'cries'),
    bounds: win ? win.getBounds() : null,
    workArea: currentWorkArea(),
    groundY: win ? groundYFor(win.getBounds()) : 0,
    anchorSide: anchorSide(),
    spriteBase: SPRITE_BASE,
    petFootprint: petSize(),
  };
});

// 렌더러가 현재 창 위치/작업영역을 요청 (드롭 직후 등, 다른 모니터로 옮겨졌을 수 있을 때)
ipcMain.handle('get-geometry', () => {
  const bounds = win ? win.getBounds() : null;
  return {
    bounds,
    workArea: currentWorkArea(),
    groundY: bounds ? groundYFor(bounds) : 0,
    anchorSide: anchorSide(),
    petFootprint: petSize(),
  };
});

// ---- 설정 창용 ----
ipcMain.handle('settings-init', () => ({
  config,
  pokemon: POKEMON,
  autoDisplays: ANCHOR_DISPLAYS, // 상대 지정 선택지
  displays: listDisplays(), // 실제 감지된 모니터
  corners: ANCHOR_CORNERS,
  petVisible,
}));

ipcMain.on('set-config', (_e, patch) => applyConfigPatch(patch || {}));
ipcMain.on('pick-pokemon', (_e, id) => applyPokemon(id, false));
ipcMain.on('draw-random', () => drawRandomPokemon());
ipcMain.on('set-pet-visible', (_e, visible) => setPetVisible(visible));
ipcMain.on('open-settings', () => openSettings());
ipcMain.on('close-settings', () => settingsWin && settingsWin.close());

// ---------- 앱 수명주기 ----------

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  applyAutoLaunch(); // 설정과 실제 OS 등록 상태를 매 실행마다 맞춘다(경로가 바뀌었을 수 있음)
  syncNotificationWatcher();

  // 잠금 해제 / 절전 복귀도 "무슨 일이 생겼다"로 취급해 펫이 반응한다
  powerMonitor.on('unlock-screen', () => pokePet('unlock'));
  powerMonitor.on('resume', () => pokePet('resume'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 이미 실행 중인데 또 실행하면 → 펫을 다시 보여준다(숨겨둔 걸 잊고 재실행하는 경우)
app.on('second-instance', () => {
  if (!petVisible) setPetVisible(true);
  else openSettings();
});

app.on('before-quit', () => {
  if (saveTimer) saveConfig(); // 디바운스 대기 중인 변경을 흘리지 않는다
  stopNotifyWatcher();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// 설정 창을 닫아도 앱은 트레이에 남는다. 종료는 트레이/메뉴의 "종료"로만.
app.on('window-all-closed', () => {
  if (!win) app.quit();
});
