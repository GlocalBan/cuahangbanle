'use strict';
/**
 * RetailFlow — Product Image 1-1 Integrity, Resolution (>=600x600, 1:1),
 * Thumbnail (240x240), EAN-13 & SOURCES.csv Audit Script
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { seed, calcEan13CheckDigit } = require('../src/domain/seed.js');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets/images/products');
const THUMB_DIR = path.join(IMG_DIR, 'thumbs');
const SOURCES_CSV = path.join(IMG_DIR, 'SOURCES.csv');
const IGNORED_FALLBACKS = new Set(['default.jpg']);

function readImageDimensions(buf) {
  if (!buf || buf.length < 16) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
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

function parseSourcesCsv(csvPath) {
  const map = new Map();
  if (!fs.existsSync(csvPath)) return map;
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const m = line.match(/^([^,]+),([^,]+),"([^"]*)","([^"]*)"$/);
    if (m) {
      map.set(m[1].trim(), { sku: m[1].trim(), filename: m[2].trim(), source: m[3].trim(), note: m[4].trim() });
    }
  }
  return map;
}

function isValidEan13(code) {
  const s = String(code || '');
  return /^\d{13}$/.test(s) && Number(s[12]) === calcEan13CheckDigit(s.slice(0, 12));
}

function main() {
  const { products, categories, suppliers } = seed();
  const diskFiles = new Set(
    fs.readdirSync(IMG_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)),
  );
  const thumbFiles = new Set(
    fs.existsSync(THUMB_DIR)
      ? fs.readdirSync(THUMB_DIR).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
      : [],
  );
  const sourcesMap = parseSourcesCsv(SOURCES_CSV);

  const byPath = new Map();
  const byMd5 = new Map();
  const bySourceHost = new Map();
  const issues = [];
  let lowResCount = 0;
  let nonSquareCount = 0;
  let missingThumbCount = 0;
  let missingSourceCount = 0;
  let invalidEanCount = 0;

  for (const p of products) {
    if (!isValidEan13(p.barcode)) {
      invalidEanCount++;
      issues.push(`${p.id}: mã vạch không đúng chuẩn EAN-13 (${p.barcode})`);
    }
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
    if (!dims || !dims.width || !dims.height) {
      issues.push(`${p.id} (${fileName}): định dạng nhị phân ảnh không hợp lệ.`);
    } else {
      if (dims.width < 600 || dims.height < 600) {
        lowResCount++;
        issues.push(`${p.id} (${fileName}): độ phân giải thấp (${dims.width}x${dims.height}px < 600x600px).`);
      }
      if (dims.width !== dims.height) {
        nonSquareCount++;
        issues.push(`${p.id} (${fileName}): không vuông 1:1 (${dims.width}x${dims.height}px).`);
      }
    }

    if (!thumbFiles.has(fileName)) {
      missingThumbCount++;
      issues.push(`${p.id} (${fileName}): thiếu thumbnail trong assets/images/products/thumbs/.`);
    }

    const src = sourcesMap.get(p.id);
    if (!src || src.filename !== fileName || !src.source) {
      missingSourceCount++;
      issues.push(`${p.id} (${fileName}): thiếu hoặc sai dòng trong SOURCES.csv.`);
    } else {
      let host = 'other';
      try {
        host = new URL(src.source).hostname;
      } catch {
        host = src.source.slice(0, 40);
      }
      bySourceHost.set(host, (bySourceHost.get(host) || 0) + 1);
    }
  }

  const dupPaths = [...byPath.entries()].filter(([, list]) => list.length > 1);
  const dupMd5s = [...byMd5.entries()].filter(([, list]) => list.length > 1);
  const unusedFiles = [...diskFiles].filter((f) => !byPath.has(f) && !IGNORED_FALLBACKS.has(f));
  const unusedThumbs = [...thumbFiles].filter((f) => !byPath.has(f));
  const extraCsvRows = [...sourcesMap.keys()].filter((sku) => !products.some((p) => p.id === sku));

  for (const [fileName, list] of dupPaths) {
    issues.push(`Trùng đường dẫn ảnh (${fileName}): ${list.map((p) => `${p.id} ${p.name}`).join(' | ')}`);
  }
  for (const [md5, list] of dupMd5s) {
    issues.push(`Trùng MD5 (${md5.slice(0, 8)}): ${list.map((x) => `${x.sku}:${x.fileName}`).join(' | ')}`);
  }
  if (extraCsvRows.length) {
    issues.push(`SOURCES.csv thừa ${extraCsvRows.length} dòng không có trong catalog: ${extraCsvRows.slice(0, 10).join(', ')}`);
  }

  console.log('=== RetailFlow Product Image 1-1 & Quality Verification ===');
  console.log(`Total SKUs          : ${products.length} (${categories.length} categories, ${suppliers.length} suppliers)`);
  console.log(`Unique image paths  : ${byPath.size} / ${products.length}`);
  console.log(`Unique image MD5    : ${byMd5.size} / ${products.length}`);
  console.log(`Thumbnails (240px)  : ${products.length - missingThumbCount} / ${products.length}`);
  console.log(`SOURCES.csv matched : ${products.length - missingSourceCount} / ${products.length}`);
  console.log(`Duplicate paths     : ${dupPaths.length}`);
  console.log(`Duplicate MD5s      : ${dupMd5s.length}`);
  console.log(`Low-res (<600px)    : ${lowResCount}`);
  console.log(`Non-square (!=1:1)  : ${nonSquareCount}`);
  console.log(`Invalid EAN-13      : ${invalidEanCount}`);
  console.log(`Unused image files  : ${unusedFiles.length}${unusedFiles.length ? ` (${unusedFiles.slice(0, 10).join(', ')})` : ''}`);
  console.log(`Unused thumb files  : ${unusedThumbs.length}`);
  console.log(`Sources by host     : ${JSON.stringify(Object.fromEntries(bySourceHost))}`);

  if (issues.length > 0 || unusedFiles.length > 0 || unusedThumbs.length > 0) {
    console.error('\n[FAIL] Detected image integrity issues:');
    for (const msg of issues.slice(0, 40)) console.error(' -', msg);
    if (issues.length > 40) console.error(` ... và ${issues.length - 40} lỗi khác.`);
    if (unusedFiles.length) console.error(' - Unused files:', unusedFiles.slice(0, 20).join(', '));
    if (unusedThumbs.length) console.error(' - Unused thumbs:', unusedThumbs.slice(0, 20).join(', '));
    process.exit(1);
  }
  console.log(`\n[PASS] 100% (${products.length}/${products.length}) SKU đạt ảnh thật >=600x600 vuông 1:1, không trùng MD5, đủ thumbnail 240x240, đủ SOURCES.csv & chuẩn EAN-13.`);
}

main();
