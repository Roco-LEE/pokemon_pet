// Electron 메인 프로세스: 투명 창 생성, 좌측 모니터 좌하단 배치, IPC, 전환 메뉴, 설정 저장.

const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  currentPokemonId: 25,
  scale: 2,
  margin: 24,
  walk: { enabled: true, minIntervalSec: 8, maxIntervalSec: 20, speed: 1.0, rangeFraction: 0.15 },
  sound: { enabled: false },
  speech: { enabled: true, minIntervalSec: 25, maxIntervalSec: 60 },
  sleep: { enabled: true, idleMinutes: 5, nightStart: 22, nightEnd: 7 },
  shiny: false,
};

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

let win = null;
let config = { ...DEFAULT_CONFIG };

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
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('config 저장 실패:', e);
  }
}

// 가장 왼쪽 모니터 = bounds.x 가 가장 작은 디스플레이
function getLeftMostDisplay() {
  const displays = screen.getAllDisplays();
  return displays.reduce((a, b) => (b.bounds.x < a.bounds.x ? b : a));
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

// 좌측 모니터 좌하단 좌표 계산. 스프라이트가 (여백을 제외하고) 좌하단에 붙도록.
function bottomLeftPosition() {
  const d = getLeftMostDisplay();
  const { x, y, height } = d.workArea;
  const win = windowSize();
  const pet = petSize();
  const m = config.margin;
  const padSide = Math.round(pet * PAD_SIDE_FRAC);
  return {
    // 스프라이트 왼쪽이 workArea.x + margin 에 오도록 창은 좌측 여백만큼 더 왼쪽에
    x: Math.round(x + m - padSide),
    // 스프라이트 바닥(=창 바닥)이 workArea 하단 - margin 에 오도록
    y: Math.round(y + height - win.h - m),
  };
}

function createWindow() {
  const win0 = windowSize();
  const pos = bottomLeftPosition();

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 모니터 구성이 바뀌면 좌하단으로 재배치
  const reposition = () => {
    if (!win) return;
    const p = bottomLeftPosition();
    const s = windowSize();
    win.setBounds({ x: p.x, y: p.y, width: s.w, height: s.h });
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);

  win.on('closed', () => {
    win = null;
  });
}

// 현재 모니터 작업영역(산책 경계 계산용)을 렌더러에 제공
function currentWorkArea() {
  const d = getLeftMostDisplay();
  return d.workArea;
}

function buildContextMenu() {
  const items = POKEMON.map((p) => ({
    label: p.ko,
    type: 'radio',
    checked: config.currentPokemonId === p.id,
    click: () => {
      config.currentPokemonId = p.id;
      saveConfig();
      win && win.webContents.send('set-pokemon', { id: p.id, shiny: config.shiny });
    },
  }));

  return Menu.buildFromTemplate([
    ...items,
    { type: 'separator' },
    {
      label: '이로치 토글',
      type: 'checkbox',
      checked: config.shiny,
      click: () => {
        config.shiny = !config.shiny;
        saveConfig();
        win &&
          win.webContents.send('set-pokemon', {
            id: config.currentPokemonId,
            shiny: config.shiny,
          });
      },
    },
    {
      label: '산책 켜기/끄기',
      type: 'checkbox',
      checked: config.walk.enabled,
      click: () => {
        config.walk.enabled = !config.walk.enabled;
        saveConfig();
        win && win.webContents.send('walk-toggle', config.walk.enabled);
      },
    },
    {
      label: '울음소리 켜기/끄기',
      type: 'checkbox',
      checked: config.sound.enabled,
      click: () => {
        config.sound.enabled = !config.sound.enabled;
        saveConfig();
        win && win.webContents.send('sound-toggle', config.sound.enabled);
      },
    },
    {
      label: '말풍선 켜기/끄기',
      type: 'checkbox',
      checked: config.speech.enabled,
      click: () => {
        config.speech.enabled = !config.speech.enabled;
        saveConfig();
        win && win.webContents.send('speech-toggle', config.speech.enabled);
      },
    },
    {
      label: '수면 모드 켜기/끄기',
      type: 'checkbox',
      checked: config.sleep.enabled,
      click: () => {
        config.sleep.enabled = !config.sleep.enabled;
        saveConfig();
        win && win.webContents.send('sleep-toggle', config.sleep.enabled);
      },
    },
    { type: 'separator' },
    { label: '위치 좌하단으로 리셋', click: () => resetPosition() },
    { label: '종료', click: () => app.quit() },
  ]);
}

function resetPosition() {
  if (!win) return;
  const p = bottomLeftPosition();
  const s = windowSize();
  win.setBounds({ x: p.x, y: p.y, width: s.w, height: s.h });
}

// ---------- IPC ----------

// 드래그/산책: 창을 상대 이동
ipcMain.on('move-window', (_e, { dx, dy }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height });
});

// 절대 좌표로 이동
ipcMain.on('move-window-to', (_e, { x, y }) => {
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
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
    spriteBase: SPRITE_BASE,
    petFootprint: petSize(),
  };
});

// 렌더러가 현재 창 위치/작업영역을 요청
ipcMain.handle('get-geometry', () => {
  return {
    bounds: win ? win.getBounds() : null,
    workArea: currentWorkArea(),
  };
});

app.whenReady().then(() => {
  loadConfig();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
