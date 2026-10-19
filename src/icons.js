import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, checksum]);
}
export function makeIcon(size, outline = false) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const normalizedX = column / size; const normalizedY = row / size;
    const edge = Math.abs(Math.hypot(normalizedX - 0.5, normalizedY - 0.5) - 0.3) < 0.045;
    const cross = Math.abs(normalizedX - 0.5) < 0.035 && normalizedY > 0.28 && normalizedY < 0.72;
    const mark = edge || cross;
    const offset = row * (1 + size * 4) + 1 + column * 4;
    pixels.set(outline ? [255, 255, 255, mark ? 255 : 0] : mark ? [255, 255, 255, 255] : [18, 111, 92, 255], offset);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}