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
  shiny: false,
};

// 펫(스프라이트) 원본 픽셀 크기. Gen5 애니메이션 GIF는 대략 96px 캔버스.
const SPRITE_BASE = 96;

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

function petSize() {
  const s = Math.max(1, config.scale);
  return SPRITE_BASE * s;
}

// 좌측 모니터 좌하단 좌표 계산
function bottomLeftPosition() {
  const d = getLeftMostDisplay();
  const { x, y, height } = d.workArea;
  const size = petSize();
  const m = config.margin;
  return {
    x: Math.round(x + m),
    y: Math.round(y + height - size - m),
  };
}

function createWindow() {
  const size = petSize();
  const pos = bottomLeftPosition();

  win = new BrowserWindow({
    width: size,
    height: size,
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
    win.setBounds({ x: p.x, y: p.y, width: petSize(), height: petSize() });
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
    { type: 'separator' },
    { label: '위치 좌하단으로 리셋', click: () => resetPosition() },
    { label: '종료', click: () => app.quit() },
  ]);
}

function resetPosition() {
  if (!win) return;
  const p = bottomLeftPosition();
  win.setBounds({ x: p.x, y: p.y, width: petSize(), height: petSize() });
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
    bounds: win ? win.getBounds() : null,
    workArea: currentWorkArea(),
    spriteBase: SPRITE_BASE,
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
