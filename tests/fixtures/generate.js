// 產生 Playwright 測試用最小 PNG 圖檔（零相依：純用 Node 內建 zlib 手刻 PNG 編碼）。
// 每張圖用不同純色，方便測試依像素取樣驗證拼接順序。
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

// width x height 純色 RGB PNG（無 alpha，color type 2）
function encodePNG(width, height, [r, g, b]) {
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

const outDir = __dirname;
const WIDTH = 200;
const HEIGHT = 150;

// 1.png ~ 10.png：每張用可辨識的漸層色（依編號遞增紅色分量），供拼接順序驗證
for (let i = 1; i <= 10; i++) {
  const color = [Math.round((i / 10) * 255), 100, 255 - Math.round((i / 10) * 255)];
  const buf = encodePNG(WIDTH, HEIGHT, color);
  fs.writeFileSync(path.join(outDir, `${i}.png`), buf);
}

// 注意：惡意檔名（含 <script>）因含 "/" 無法作為真實檔名存在於檔案系統，
// 改於測試中用 Playwright setInputFiles({ name, buffer }) 動態指定檔名（見 stitch.spec.ts）。

// 額外一張供「>10 張」記憶體上限測試用
fs.writeFileSync(path.join(outDir, '11.png'), encodePNG(WIDTH, HEIGHT, [0, 255, 0]));

console.log('產生完成：', fs.readdirSync(outDir).filter((f) => f.endsWith('.png')));
