// 렌더러 ↔ 메인 안전한 브리지 (contextIsolation).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  // 초기 데이터(설정, 스프라이트 경로, 창/작업영역 정보)
  getInit: () => ipcRenderer.invoke('get-init'),
  getGeometry: () => ipcRenderer.invoke('get-geometry'),

  // 창 이동
  moveBy: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  moveTo: (x, y) => ipcRenderer.send('move-window-to', { x, y }),
  resetPosition: () => ipcRenderer.send('reset-position'),

  // 메뉴 / 종료
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  quit: () => ipcRenderer.send('quit'),

  // 메인 → 렌더러 이벤트 구독
  onSetPokemon: (cb) => ipcRenderer.on('set-pokemon', (_e, data) => cb(data)),
  onWalkToggle: (cb) => ipcRenderer.on('walk-toggle', (_e, enabled) => cb(enabled)),
});
