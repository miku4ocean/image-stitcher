// 產生 PWA 圖示（零相依：純用 Node 內建 zlib 手刻 PNG 編碼，手法沿用 tests/fixtures/generate.js）。
// 禁止使用任何外部素材／下載圖檔，圖示以程式繪製：底色沿用主畫面背景色（#00CED1），
// 上面畫兩條白色圓角橫條（象徵「兩張截圖上下拼接成一張」），簡潔風格。
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// width x height RGB PNG（無 alpha，color type 2），pixelFn(x, y) 回傳 [r,g,b]
function encodePNG(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: truecolor RGB
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = chunk('IHDR', ihdrData);

  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// 判斷像素中心 (px,py) 是否落在圓角矩形 [x0,y0]-[x1,y1]（半徑 radius）內
function inRoundedRect(px, py, x0, y0, x1, y1, radius) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const nearLeft = px < x0 + radius;
  const nearRight = px > x1 - radius;
  const nearTop = py < y0 + radius;
  const nearBottom = py > y1 - radius;
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const cx = nearLeft ? x0 + radius : x1 - radius;
    const cy = nearTop ? y0 + radius : y1 - radius;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

const BG = [0, 206, 209];   // #00CED1，與主畫面背景色一致
const FG = [255, 255, 255]; // 白色圖形

function drawIcon(size) {
  const margin = size * 0.18;
  const gap = size * 0.08;
  const barHeight = (size - margin * 2 - gap) / 2;
  const radius = size * 0.08;

  const bar1 = { x0: margin, y0: margin, x1: size - margin, y1: margin + barHeight };
  const bar2 = { x0: margin, y0: margin + barHeight + gap, x1: size - margin, y1: size - margin };

  return encodePNG(size, size, (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (inRoundedRect(px, py, bar1.x0, bar1.y0, bar1.x1, bar1.y1, radius)) return FG;
    if (inRoundedRect(px, py, bar2.x0, bar2.y0, bar2.x1, bar2.y1, radius)) return FG;
    return BG;
  });
}

const outDir = __dirname;
const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const t of targets) {
  fs.writeFileSync(path.join(outDir, t.name), drawIcon(t.size));
}

console.log('圖示產生完成：', fs.readdirSync(outDir).filter((f) => f.endsWith('.png')));
