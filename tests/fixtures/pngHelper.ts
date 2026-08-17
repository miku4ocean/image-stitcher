// 產生 Playwright 測試用的合成 PNG（沿用 tests/fixtures/generate.js 的零相依手刻 PNG 手法：
// 純用 Node 內建 zlib 編碼，不引入任何新的 npm 相依套件）。
// 與 generate.js 的差異：這裡參數化寬高／顏色，供拼接品質測試（tests/quality.spec.ts、
// tests/touch.spec.ts）動態產生「刻意不同尺寸」的合成圖片，不需要額外的固定 fixture 檔案。
'use strict';
import zlib from 'zlib';

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

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function pngHeader(width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  return Buffer.concat([signature, chunk('IHDR', ihdrData)]);
}

/** width x height 純色 RGB PNG（無 alpha，color type 2）。*/
export function makeSolidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const [r, g, b] = rgb;
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
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([pngHeader(width, height), idat, iend]);
}

/**
 * width x height 的上下二色帶 PNG：0..splitY-1 列為 topRgb，splitY..height-1 列為 bottomRgb。
 * 用來驗證「裁切後只留下其中一色帶」這類需要真實視覺內容比對的案例（純色圖無法驗證裁切範圍是否正確，
 * 因為裁哪裡顏色都一樣）。
 */
export function makeHorizontalSplitPng(
  width: number,
  height: number,
  topRgb: [number, number, number],
  bottomRgb: [number, number, number],
  splitY: number
): Buffer {
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    const [r, g, b] = y < splitY ? topRgb : bottomRgb;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([pngHeader(width, height), idat, iend]);
}
