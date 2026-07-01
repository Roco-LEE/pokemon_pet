// PokeAPI 공개 스프라이트(Gen5 애니메이션 GIF)를 로컬로 받아오는 스크립트.
// 최초 1회만 받으면 되고, 이미 있으면 건너뜀(idempotent).

const fs = require('fs');
const path = require('path');
const https = require('https');

const POKEMON = [
  { id: 1, ko: '이상해씨', en: 'bulbasaur' },
  { id: 4, ko: '파이리', en: 'charmander' },
  { id: 7, ko: '꼬부기', en: 'squirtle' },
  { id: 25, ko: '피카츄', en: 'pikachu' },
  { id: 132, ko: '메타몽', en: 'ditto' },
  { id: 133, ko: '이브이', en: 'eevee' },
];

const BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated';

// PokeAPI cries(울음소리) — latest 세대 .ogg
const CRIES_BASE =
  'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';

const OUT_DIR = path.join(__dirname, '..', 'assets', 'sprites');
const CRIES_DIR = path.join(__dirname, '..', 'assets', 'cries');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      })
      .on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function fetchOne(p, shiny) {
  const dir = shiny ? path.join(OUT_DIR, 'shiny') : OUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${p.id}.gif`);
  const label = `${p.ko}(${p.id})${shiny ? ' 이로치' : ''}`;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`✓ ${label} 이미 있음 — 건너뜀`);
    return;
  }
  const url = `${BASE}/${shiny ? 'shiny/' : ''}${p.id}.gif`;
  process.stdout.write(`↓ ${label} 다운로드 중... `);
  try {
    await download(url, dest);
    console.log('완료');
  } catch (err) {
    console.log('실패:', err.message);
  }
}

async function fetchCry(p) {
  fs.mkdirSync(CRIES_DIR, { recursive: true });
  const dest = path.join(CRIES_DIR, `${p.id}.ogg`);
  const label = `${p.ko}(${p.id}) 울음소리`;
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`✓ ${label} 이미 있음 — 건너뜀`);
    return;
  }
  const url = `${CRIES_BASE}/${p.id}.ogg`;
  process.stdout.write(`↓ ${label} 다운로드 중... `);
  try {
    await download(url, dest);
    console.log('완료');
  } catch (err) {
    console.log('실패:', err.message);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const p of POKEMON) {
    await fetchOne(p, false);
    await fetchOne(p, true);
    await fetchCry(p);
  }
  console.log('\n스프라이트·울음소리 준비 완료 →', OUT_DIR);
}

main();
