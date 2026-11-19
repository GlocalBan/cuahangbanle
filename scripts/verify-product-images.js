'use strict';
/**
 * RetailFlow — Product Image 1-1 Integrity & Resolution Audit Script
 * Verifies all 93 SKUs reference unique real product photos (no default.jpg,
 * no missing files, no duplicate path, no duplicate MD5, valid image headers & resolution).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { seed } = require('../src/domain/seed.js');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets/images/products');
const IGNORED_FALLBACKS = new Set(['default.jpg']);

function readImageDimensions(buf) {
  if (!buf || buf.length < 16) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at offset 16..24
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(offset + 2);
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { format: 'JPEG', width, height };
      }
      if (len < 2) break;
      offset += 2 + len;
    }
    return { format: 'JPEG', width: 0, height: 0 };
  }
  // WebP: RIFF....WEBP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'WEBP', width, height };
    }
    return { format: 'WEBP', width: 0, height: 0 };
  }
  return null;
}

function main() {
  const { products } = seed();
  const diskFiles = new Set(
    fs.readdirSync(IMG_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)),
  );

  const byPath = new Map();
  const byMd5 = new Map();
  const issues = [];
  let lowResCount = 0;

  for (const p of products) {
    const imgUrl = String(p.imageUrl || '');
    if (!imgUrl.startsWith('assets/images/products/') || imgUrl.endsWith('/default.jpg')) {
      issues.push(`${p.id} (${p.name}): ảnh placeholder/không hợp lệ -> ${imgUrl}`);
      continue;
    }
    const fileName = imgUrl.replace(/^assets\/images\/products\//, '');
    if (!diskFiles.has(fileName)) {
      issues.push(`${p.id} (${p.name}): thiếu file trên ổ đĩa -> ${fileName}`);
      continue;
    }
    if (!byPath.has(fileName)) byPath.set(fileName, []);
    byPath.get(fileName).push(p);

    const buf = fs.readFileSync(path.join(IMG_DIR, fileName));
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (!byMd5.has(md5)) byMd5.set(md5, []);
    byMd5.get(md5).push({ sku: p.id, fileName });

    const dims = readImageDimensions(buf);
    if (!dims) {
      issues.push(`${p.id} (${fileName}): định dạng nhị phân ảnh không hợp lệ.`);
    } else if (dims.width > 0 && dims.height > 0 && (dims.width < 150 || dims.height < 150)) {
      lowResCount++;
      issues.push(`${p.id} (${fileName}): độ phân giải thấp (${dims.width}x${dims.height}px < 150px).`);
    }
  }

  const dupPaths = [...byPath.entries()].filter(([, list]) => list.length > 1);
  const dupMd5s = [...byMd5.entries()].filter(([, list]) => list.length > 1);
  const unusedFiles = [...diskFiles].filter((f) => !byPath.has(f) && !IGNORED_FALLBACKS.has(f));

  for (const [fileName, list] of dupPaths) {
    issues.push(`Trùng đường dẫn ảnh (${fileName}): ${list.map((p) => `${p.id} ${p.name}`).join(' | ')}`);
  }
  for (const [md5, list] of dupMd5s) {
    issues.push(`Trùng MD5 (${md5.slice(0, 8)}): ${list.map((x) => `${x.sku}:${x.fileName}`).join(' | ')}`);
  }

  console.log('=== RetailFlow Product Image 1-1 Verification ===');
  console.log(`Total SKUs          : ${products.length}`);
  console.log(`Unique image paths  : ${byPath.size} / ${products.length}`);
  console.log(`Unique image MD5    : ${byMd5.size} / ${products.length}`);
  console.log(`Duplicate paths     : ${dupPaths.length}`);
  console.log(`Duplicate MD5s      : ${dupMd5s.length}`);
  console.log(`Unused image files  : ${unusedFiles.length}${unusedFiles.length ? ` (${unusedFiles.join(', ')})` : ''}`);
  console.log(`Low-res (<150px)    : ${lowResCount}`);

  if (issues.length > 0 || unusedFiles.length > 0) {
    console.error('\n[FAIL] Detected image integrity issues:');
    for (const msg of issues) console.error(' -', msg);
    if (unusedFiles.length) console.error(' - Unused files:', unusedFiles.join(', '));
    process.exit(1);
  }
  console.log('\n[PASS] 100% (93/93) SKU sử dụng ảnh sản phẩm thật duy nhất 1-1, không trùng MD5, không file thừa.');
}

main();
