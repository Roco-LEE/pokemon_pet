// 트레이/앱 아이콘(몬스터볼) PNG를 코드로 생성한다.
// 외부 이미지 에셋이나 라이브러리 없이 Node 기본 모듈(zlib)만으로 PNG를 직접 인코딩한다.
// 재생성: npm run icons

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'assets');

// ---------- 최소 PNG 인코더 (RGBA, 8bit) ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10~12: compression / filter / interlace = 0

  // 각 스캔라인 앞에 필터 바이트(0 = None)를 붙인다
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 몬스터볼 그리기 ----------

const RED = [238, 21, 21];
const WHITE = [246, 246, 246];
const BLACK = [26, 26, 26];

// 정규화 좌표(-1..1)에서 해당 지점의 색을 고른다. 밖이면 null(투명).
function ballColorAt(nx, ny) {
  const d = Math.hypot(nx, ny);
  if (d > 1) return null;

  const outline = 0.1; // 바깥 테두리 두께
  if (d > 1 - outline) return BLACK;

  const button = 0.28; // 가운데 버튼 반지름
  if (d <= button) return d <= button * 0.58 ? WHITE : BLACK;

  if (Math.abs(ny) <= 0.13) return BLACK; // 가운데 띠
  return ny < 0 ? RED : WHITE; // 위 빨강 / 아래 흰색
}

// SS배 슈퍼샘플링으로 계단 현상을 줄인다
const SS = 4;

function renderBall(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = ballColorAt((px - r) / r, (py - r) / r);
          if (c) {
            acc[0] += c[0];
            acc[1] += c[1];
            acc[2] += c[2];
            acc[3] += 255;
          }
        }
      }
      const n = SS * SS;
      const a = acc[3] / n;
      const i = (y * size + x) * 4;
      // 알파가 0이 아닌 샘플들의 평균색 (투명 샘플이 색을 어둡게 끌어내리지 않도록)
      const hit = acc[3] / 255 || 1;
      rgba[i] = Math.round(acc[0] / hit);
      rgba[i + 1] = Math.round(acc[1] / hit);
      rgba[i + 2] = Math.round(acc[2] / hit);
      rgba[i + 3] = Math.round(a);
    }
  }
  return rgba;
}

function write(size, name) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, encodePng(size, size, renderBall(size)));
  console.log(`✔ ${name} (${size}x${size})`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
write(32, 'tray.png'); // 트레이 (고DPI 여유분 포함)
write(256, 'icon.png'); // 창/앱 아이콘
