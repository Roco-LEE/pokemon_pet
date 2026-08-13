// 렌더러 ↔ 메인 안전한 브리지 (contextIsolation).
// 펫 창과 설정 창이 같은 preload를 공유한다 (window.pet / window.petSettings).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  // 초기 데이터(설정, 스프라이트 경로, 창/작업영역 정보)
  getInit: () => ipcRenderer.invoke('get-init'),
  getGeometry: () => ipcRenderer.invoke('get-geometry'),

  // 창 이동
  moveBy: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  moveTo: (x, y) => ipcRenderer.send('move-window-to', { x, y }),
  resetPosition: () => ipcRenderer.send('reset-position'),

  // 클릭 통과: 커서가 펫(불투명 픽셀) 위일 때만 창이 마우스를 잡는다
  setInteractive: (on) => ipcRenderer.send('set-interactive', on),

  // 메뉴 / 종료
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  openSettings: () => ipcRenderer.send('open-settings'),
  quit: () => ipcRenderer.send('quit'),

  // 메인 → 렌더러 이벤트 구독
  onGeometryChanged: (cb) => ipcRenderer.on('geometry-changed', (_e, data) => cb(data)),
  onSetPokemon: (cb) => ipcRenderer.on('set-pokemon', (_e, data) => cb(data)),
  // 설정 변경 방송 (트레이·우클릭 메뉴·설정 창 어디서 바꾸든 여기로 온다)
  onConfigChanged: (cb) => ipcRenderer.on('config-changed', (_e, cfg) => cb(cfg)),
  // 알림/시스템 이벤트 (펫이 그쪽을 쳐다본다)
  onPetEvent: (cb) => ipcRenderer.on('pet-event', (_e, data) => cb(data)),
});

contextBridge.exposeInMainWorld('petSettings', {
  init: () => ipcRenderer.invoke('settings-init'),
  set: (patch) => ipcRenderer.send('set-config', patch),
  pick: (id) => ipcRenderer.send('pick-pokemon', id),
  drawRandom: () => ipcRenderer.send('draw-random'),
  setVisible: (visible) => ipcRenderer.send('set-pet-visible', visible),
  resetPosition: () => ipcRenderer.send('reset-position'),
  close: () => ipcRenderer.send('close-settings'),
  onConfigChanged: (cb) => ipcRenderer.on('config-changed', (_e, cfg) => cb(cfg)),
  // 트레이에서 숨기기/보이기를 눌러도 설정 창의 체크박스가 따라오도록
  onVisibilityChanged: (cb) => ipcRenderer.on('visibility-changed', (_e, v) => cb(v)),
  // 모니터를 켜고 끄거나 해상도를 바꾸면 목록·배치도를 다시 그린다
  onDisplaysChanged: (cb) => ipcRenderer.on('displays-changed', (_e, list) => cb(list)),
});
