'use strict';
/**
 * RetailFlow — Real Vietnamese Supermarket Catalog & High-Res 1:1 Packshot Builder
 * - Upgrades existing 93 SKUs (SP001..SP093) to verified >=600x600 1:1 white-bg retail photos
 * - Expands catalog to 320+ real Vietnamese retail SKUs across 14 categories & 22 suppliers
 * - Generates 240x240 thumbnails in assets/images/products/thumbs/
 * - Logs 100% provenance into assets/images/products/SOURCES.csv
 * - NEVER uses AI-generated images, SVGs, or placeholders.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { seed, calcEan13CheckDigit } = require('../src/domain/seed.js');

const ROOT = path.resolve(__dirname, '..');
const IMG_DIR = path.join(ROOT, 'assets/images/products');
const THUMB_DIR = path.join(IMG_DIR, 'thumbs');
const TMP_DIR = path.join(ROOT, '.tmp_catalog_dl');

const HDRS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json,text/html,*/*',
};

const CATEGORIES = [
  { code: 'DM01', name: 'Sữa & Chế phẩm sữa', description: 'Sữa tươi, sữa chua, sữa đặc, sữa hạt, sữa dinh dưỡng', hasExpiry: 1, warnDays: 10, margin: 0.20, minStock: 24, caseUnit: 'Lốc 4 / Thùng 48', unitsPerCase: 48 },
  { code: 'DM02', name: 'Nước giải khát & Trà', description: 'Nước suối, nước ngọt có gas, trà đóng chai, nước tăng lực', hasExpiry: 1, warnDays: 14, margin: 0.24, minStock: 30, caseUnit: 'Thùng 24', unitsPerCase: 24 },
  { code: 'DM03', name: 'Cà phê, Trà khô & Ca cao', description: 'Cà phê hòa tan, cà phê lon, trà túi lọc, bột ca cao', hasExpiry: 1, warnDays: 20, margin: 0.25, minStock: 15, caseUnit: 'Thùng 12', unitsPerCase: 12 },
  { code: 'DM04', name: 'Bia & Đồ uống lên men', description: 'Bia lon, bia chai, nước trái cây lên men', hasExpiry: 1, warnDays: 21, margin: 0.18, minStock: 24, caseUnit: 'Thùng 24 lon', unitsPerCase: 24, nonReturnable: 1 },
  { code: 'DM05', name: 'Mì, Phở & Cháo ăn liền', description: 'Mì gói, mì ly, phở, hủ tiếu, miến, cháo ăn liền', hasExpiry: 1, warnDays: 14, margin: 0.22, minStock: 40, caseUnit: 'Thùng 30 gói', unitsPerCase: 30 },
  { code: 'DM06', name: 'Gạo, Bún & Ngũ cốc', description: 'Gạo thơm ST25/Jasmine, bún khô, miến khô, yến mạch, đậu hạt', hasExpiry: 1, warnDays: 20, margin: 0.18, minStock: 12, caseUnit: 'Bao / Thùng 10', unitsPerCase: 10 },
  { code: 'DM07', name: 'Dầu ăn, Nước chấm & Gia vị', description: 'Dầu ăn, nước mắm, nước tương, tương ớt, hạt nêm, bột ngọt, đường muối', hasExpiry: 1, warnDays: 25, margin: 0.22, minStock: 18, caseUnit: 'Thùng 12', unitsPerCase: 12 },
  { code: 'DM08', name: 'Đồ hộp & Thực phẩm đóng gói', description: 'Cá hộp, pate, xúc xích tiệt trùng, chà bông, nấm khô, đồ khô', hasExpiry: 1, warnDays: 20, margin: 0.25, minStock: 18, caseUnit: 'Thùng 24', unitsPerCase: 24 },
  { code: 'DM09', name: 'Bánh kẹo & Snack', description: 'Bánh quy, bánh bông lan, snack khoai tây, kẹo, hạt dinh dưỡng', hasExpiry: 1, warnDays: 14, margin: 0.27, minStock: 20, caseUnit: 'Thùng 20', unitsPerCase: 20 },
  { code: 'DM10', name: 'Thực phẩm mát & Đông lạnh', description: 'Phô mai, bơ lạt, xúc xích mát, há cảo, bánh bao, đồ ăn sẵn', hasExpiry: 1, warnDays: 7, margin: 0.26, minStock: 12, caseUnit: 'Khay / Thùng 12', unitsPerCase: 12, nonReturnable: 1 },
  { code: 'DM11', name: 'Chăm sóc cá nhân', description: 'Dầu gội, sữa tắm, kem đánh răng, bàn chải, sữa rửa mặt, lăn khử mùi', hasExpiry: 1, warnDays: 30, margin: 0.28, minStock: 12, caseUnit: 'Thùng 12', unitsPerCase: 12 },
  { code: 'DM12', name: 'Hóa phẩm & Vệ sinh nhà cửa', description: 'Nước giặt, nước xả vải, nước rửa chén, lau sàn, tẩy rửa, khăn giấy', hasExpiry: 1, warnDays: 30, margin: 0.26, minStock: 15, caseUnit: 'Thùng 12', unitsPerCase: 12 },
  { code: 'DM13', name: 'Mẹ & Bé', description: 'Tã bỉm, khăn ướt trẻ em, sữa bột, sữa pha sẵn, tắm gội cho bé', hasExpiry: 1, warnDays: 20, margin: 0.22, minStock: 10, caseUnit: 'Thùng 6', unitsPerCase: 6 },
  { code: 'DM14', name: 'Văn phòng phẩm & Tiện ích', description: 'Bút bi, sổ tay, pin, băng keo, túi rác, màng bọc thực phẩm', hasExpiry: 0, warnDays: 0, margin: 0.34, minStock: 15, caseUnit: 'Hộp / Thùng 20', unitsPerCase: 20 },
];

const SUPPLIERS = [
  { id: 'NCC001', name: 'Vinamilk Việt Nam', phone: '02838231111', category: 'Sữa & chế phẩm', areas: 'TP. HCM, Bình Dương' },
  { id: 'NCC002', name: 'Acecook Việt Nam', phone: '02837502000', category: 'Mì ăn liền, thực phẩm khô', areas: 'TP. HCM, Đồng Nai' },
  { id: 'NCC003', name: 'Masan Consumer Corporation', phone: '02835444888', category: 'Gia vị, nước chấm, nước giải khát', areas: 'TP. HCM, Bình Dương' },
  { id: 'NCC004', name: 'Mondelez Kinh Đô Việt Nam', phone: '02838155088', category: 'Bánh kẹo, snack', areas: 'TP. HCM, Bình Dương' },
  { id: 'NCC005', name: 'Nestlé Việt Nam', phone: '02838155099', category: 'Sữa, cà phê, gia vị Maggi', areas: 'TP. HCM, Đồng Nai' },
  { id: 'NCC006', name: 'Tập đoàn TH (TH TrueMilk)', phone: '02438574248', category: 'Sữa tươi sạch', areas: 'Nghệ An, TP. HCM' },
  { id: 'NCC007', name: 'Unilever Việt Nam', phone: '02837668800', category: 'Hóa mỹ phẩm, chăm sóc cá nhân', areas: 'TP. HCM, Bình Dương' },
  { id: 'NCC008', name: 'Suntory PepsiCo Việt Nam', phone: '02838265577', category: 'Nước giải khát, snack, yến mạch', areas: 'TP. HCM, Đồng Nai' },
  { id: 'NCC009', name: 'Lộc Trời Group (Gạo ST25)', phone: '02963877797', category: 'Gạo cao cấp, ngũ cốc', areas: 'An Giang, TP. HCM' },
  { id: 'NCC010', name: 'Bếp Cửa Hàng & Thực phẩm mát', phone: '0908123456', category: 'Đồ ăn chế biến sẵn, thực phẩm mát', areas: 'TP. HCM' },
  { id: 'NCC011', name: 'Coca-Cola Beverages Việt Nam', phone: '02838961000', category: 'Nước ngọt, nước uống đóng chai', areas: 'TP. HCM, Thủ Đức' },
  { id: 'NCC012', name: 'Heineken Việt Nam', phone: '02838222755', category: 'Bia & đồ uống lên men', areas: 'TP. HCM, Đà Nẵng' },
  { id: 'NCC013', name: 'Tổng Công ty Bia Sabeco', phone: '02838294083', category: 'Bia Sài Gòn, bia 333', areas: 'TP. HCM, Toàn quốc' },
  { id: 'NCC014', name: 'Trung Nguyên Legend Group', phone: '02839251852', category: 'Cà phê hòa tan, cà phê rang xay', areas: 'Đắk Lắk, TP. HCM' },
  { id: 'NCC015', name: 'Vifon Việt Nam', phone: '02838153947', category: 'Phở, hủ tiếu, cháo, gia vị', areas: 'TP. HCM, Tân Phú' },
  { id: 'NCC016', name: 'Orion Food Vina', phone: '02743712420', category: 'Bánh ChocoPie, snack khoai tây', areas: 'Bình Dương, TP. HCM' },
  { id: 'NCC017', name: 'Vissan & Hạ Long Canfoco', phone: '02835533999', category: 'Đồ hộp, xúc xích, thực phẩm chế biến', areas: 'TP. HCM, Hải Phòng' },
  { id: 'NCC018', name: 'Cholimex Food & Tường An', phone: '02837653389', category: 'Tương ớt, nước chấm, dầu ăn', areas: 'TP. HCM, Bình Chánh' },
  { id: 'NCC019', name: 'Procter & Gamble (P&G) Việt Nam', phone: '02838221000', category: 'Nước giặt Ariel, Downy, Head & Shoulders', areas: 'Bình Dương, TP. HCM' },
  { id: 'NCC020', name: 'Colgate-Palmolive Việt Nam', phone: '02838239411', category: 'Kem đánh răng, bàn chải, chăm sóc răng miệng', areas: 'TP. HCM, Đồng Nai' },
  { id: 'NCC021', name: 'Diana Unicharm & Kimberly-Clark', phone: '02436445758', category: 'Tã bỉm Bobby, Huggies, khăn ướt, mẹ & bé', areas: 'Hà Nội, TP. HCM' },
  { id: 'NCC022', name: 'Tập đoàn Thiên Long & Tiện ích', phone: '02837505555', category: 'Văn phòng phẩm, bút viết, tiện ích gia đình', areas: 'TP. HCM, Bình Tân' },
];

const UNIT_MAP = [
  ['hộp', 'DVT01'],
  ['gói', 'DVT02'],
  ['chai', 'DVT03'],
  ['lon', 'DVT04'],
  ['túi', 'DVT05'],
  ['hũ', 'DVT06'],
  ['lọ', 'DVT07'],
  ['tuýp', 'DVT08'],
  ['bịch', 'DVT09'],
  ['cuộn', 'DVT10'],
  ['vỉ', 'DVT11'],
  ['cây', 'DVT12'],
  ['lốc', 'DVT13'],
  ['thùng', 'DVT14'],
  ['cái', 'DVT15'],
];

function inferUnit(name, fallback = 'gói') {
  const n = String(name || '').toLowerCase();
  if (/\bthùng\b/.test(n)) return 'thùng';
  if (/\blốc\b/.test(n)) return 'lốc';
  if (/\bchai\b|\b\d+\s*ml\b/.test(n) && !/\blon\b|\bhộp\b|\bgói\b|\btúi\b|\btuýp\b|\bbịch\b/.test(n)) return 'chai';
  if (/\blon\b/.test(n)) return 'lon';
  if (/\btuýp\b/.test(n)) return 'tuýp';
  if (/\bhũ\b/.test(n)) return 'hũ';
  if (/\blọ\b/.test(n)) return 'lọ';
  if (/\bhộp\b/.test(n)) return 'hộp';
  if (/\btúi\b/.test(n)) return 'túi';
  if (/\bbịch\b/.test(n)) return 'bịch';
  if (/\bcuộn\b/.test(n)) return 'cuộn';
  if (/\bvỉ\b/.test(n)) return 'vỉ';
  if (/\bcây\b|\bbút\b/.test(n)) return 'cây';
  if (/\bgói\b/.test(n)) return 'gói';
  return fallback;
}

function inferPackSize(name, unit) {
  const m = String(name || '').match(/(\d+(?:[.,]\d+)?\s*(?:ml|lít|l|kg|g|gr|gam|tờ|miếng|viên|cuộn|cây|gói|hộp|lon|chai))/i);
  return m ? m[1].replace(/\s+/g, '') : `1 ${unit}`;
}

function mapLegacyCategory(p) {
  const name = (p.name || '').toLowerCase();
  const cat = p.category || '';
  if (cat === 'Sữa & Đồ uống') {
    if (/cà phê|coffee|trà túi lọc|ca cao/.test(name)) return 'DM03';
    if (/bia|strongbow/.test(name)) return 'DM04';
    if (/sữa|yogurt|probi|milo|fami|ông thọ/.test(name)) return 'DM01';
    return 'DM02';
  }
  if (cat === 'Mì & Thực phẩm tiện lợi') {
    if (/gạo|bún khô|yến mạch|đậu xanh/.test(name)) return 'DM06';
    if (/nấm đông cô/.test(name)) return 'DM08';
    return 'DM05';
  }
  if (cat === 'Gia vị & Nhu yếu phẩm') return 'DM07';
  if (cat === 'Snack & Bánh kẹo') {
    if (/xúc xích|chà bông|khô bò/.test(name)) return 'DM08';
    return 'DM09';
  }
  if (cat === 'Đồ ăn tiện lợi') return 'DM10';
  if (cat === 'Chăm sóc cá nhân & Tiện ích') {
    if (/rửa chén|giặt|xả vải|lau sàn|khăn giấy|giấy vệ sinh|tẩy|túi rác/.test(name)) return 'DM12';
    if (/tã|bỉm|khăn ướt/.test(name)) return 'DM13';
    if (/pin|bút|sổ|băng keo/.test(name)) return 'DM14';
    return 'DM11';
  }
  return 'DM09';
}

function inferSupplier(name, brand, catCode, defaultSup) {
  const s = `${name} ${brand}`.toLowerCase();
  if (/vinamilk|ông thọ|probi|fami/.test(s)) return 'NCC001';
  if (/acecook|hảo hảo|đệ nhất|phú hương|siukay|modern/.test(s)) return 'NCC002';
  if (/masan|omachi|kokomi|nam ngư|chinsu|chin-su|wake-up|vinacafe/.test(s)) return 'NCC003';
  if (/oreo|kinh đô|cosy|solite|afc|slide|ritz|lu\b/.test(s)) return 'NCC004';
  if (/nestl|milo|maggi|nescafe|kitkat|lavie|cerelac|nan\b/.test(s)) return 'NCC005';
  if (/th true/.test(s)) return 'NCC006';
  if (/unilever|omo|comfort|sunlight|lifebuoy|clear|sunsilk|dove|p\/s|closeup|knorr|lipton|cif|vim|hazeline|pond|rexona|tresemme/.test(s)) return 'NCC007';
  if (/pepsi|7up|mirinda|aquafina|sting|tea\+|revive|twister|lay's|lays|quaker|poca|doritos/.test(s)) return 'NCC008';
  if (/lộc trời|st25|gạo|jasmine/.test(s)) return 'NCC009';
  if (/coca|sprite|fanta|fuzetea|dasani|nutriboost|schweppes/.test(s)) return 'NCC011';
  if (/heineken|tiger|larue|strongbow|bivina|edelweiss/.test(s)) return 'NCC012';
  if (/sài gòn|saigon|333|sabeco|lạc việt/.test(s)) return 'NCC013';
  if (/trung nguyên|g7\b|legend/.test(s)) return 'NCC014';
  if (/vifon|hoàng gia/.test(s)) return 'NCC015';
  if (/orion|chocopie|custas|o'star|swing|marine boy|goute|c'est bon|an\b/.test(s)) return 'NCC016';
  if (/vissan|hạ long|ba cô gái|canfoco|cầu tre|c\.p\.|cp\b|đức việt/.test(s)) return 'NCC017';
  if (/cholimex|simply|neptune|tường an|meizan|cái lân|ajinomoto/.test(s)) return 'NCC018';
  if (/ariel|downy|tide|head\s*&\s*shoulders|pantene|rejoice|safeguard|gillette|oral-b|whisper|pampers/.test(s)) return 'NCC019';
  if (/colgate|palmolive|protex/.test(s)) return 'NCC020';
  if (/bobby|huggies|diana|moony|merries|johnson|pigeon|abbott|similac|ensure|pediasure|friso|enfa|nutifood/.test(s)) return 'NCC021';
  if (/thiên long|flexoffice|energizer|panasonic|double a|3m|scotch|inoci/.test(s)) return 'NCC022';
  if (defaultSup) return defaultSup;
  const fallbackByCat = {
    DM01: 'NCC001', DM02: 'NCC008', DM03: 'NCC014', DM04: 'NCC012', DM05: 'NCC002',
    DM06: 'NCC009', DM07: 'NCC018', DM08: 'NCC017', DM09: 'NCC004', DM10: 'NCC010',
    DM11: 'NCC007', DM12: 'NCC019', DM13: 'NCC021', DM14: 'NCC022',
  };
  return fallbackByCat[catCode] || 'NCC003';
}

function readDims(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m === 0xd9 || m === 0xda) break;
      const l = buf.readUInt16BE(o + 2);
      if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
        return { format: 'JPEG', width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) };
      }
      if (l < 2) break;
      o += 2 + l;
    }
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const c = buf.toString('ascii', 12, 16);
    if (c === 'VP8X' && buf.length >= 30) {
      return { format: 'WEBP', width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    }
    if (c === 'VP8 ' && buf.length >= 30) {
      return { format: 'WEBP', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (c === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { format: 'WEBP', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

function upgradeTikiUrl(thumbUrl) {
  if (!thumbUrl) return '';
  return thumbUrl
    .replace(/\/cache\/\d+x\d+\//, '/cache/750x750/')
    .replace(/\.webp$/i, '.jpg');
}

async function fetchTikiSearch(query, limit = 20) {
  const url = `https://tiki.vn/api/v2/products?limit=${limit}&q=${encodeURIComponent(query)}`;
  try {
    const r = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

async function downloadAndNormalize(imgUrl, outFileName, usedMd5s) {
  const candidates = [
    upgradeTikiUrl(imgUrl),
    imgUrl.replace(/\/cache\/\d+x\d+\//, '/cache/750x750/'),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers: HDRS, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const dims = readDims(buf);
      if (!dims || Math.max(dims.width, dims.height) < 600) continue;

      const tmpIn = path.join(TMP_DIR, `in_${crypto.randomBytes(6).toString('hex')}.${dims.format.toLowerCase()}`);
      const outFull = path.join(IMG_DIR, outFileName);
      const outThumb = path.join(THUMB_DIR, outFileName);
      fs.writeFileSync(tmpIn, buf);
      try {
        // Normalize onto clean 750x750 white square canvas (never stretches or crops packaging)
        execFileSync('convert', [
          tmpIn,
          '-auto-orient',
          '-background', 'white',
          '-alpha', 'remove',
          '-alpha', 'off',
          '-thumbnail', '750x750',
          '-gravity', 'center',
          '-extent', '750x750',
          '-strip',
          '-quality', '84',
          outFull,
        ]);
        const finalBuf = fs.readFileSync(outFull);
        const md5 = crypto.createHash('md5').update(finalBuf).digest('hex');
        if (usedMd5s.has(md5)) {
          fs.unlinkSync(outFull);
          continue;
        }
        execFileSync('convert', [
          outFull,
          '-thumbnail', '240x240',
          '-strip',
          '-quality', '80',
          outThumb,
        ]);
        usedMd5s.add(md5);
        return { ok: true, sourceUrl: url, width: 750, height: 750, md5 };
      } finally {
        if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
      }
    } catch {
      // try next candidate
    }
  }
  return { ok: false };
}

function cleanProductName(rawName) {
  let s = String(rawName || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(hàng chính hãng\)|\(chính hãng\)|hàng chính hãng|chính hãng|mẫu mới|bao bì thay đổi tùy đợt nhập hàng|giao màu ngẫu nhiên/gi, ' ')
    .replace(/^\s*[-–—|•:]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 78) s = s.slice(0, 78).replace(/\s+\S*$/, '').trim();
  return s;
}

function isGoodRetailListing(item) {
  const name = String(item?.name || '').trim();
  if (!name || name.length < 8) return false;
  if (/combo\s+\d+|set\s+\d+|quà tết|giỏ quà|mã giảm|voucher|ebook|sách\b|áo\b|quần\b|giày\b|túi xách/i.test(name)) return false;
  const price = Number(item.price) || 0;
  if (price < 3500 || price > 850000) return false;
  if (!item.thumbnail_url || /default|placeholder/i.test(item.thumbnail_url)) return false;
  return true;
}

// Targeted real Vietnamese retail queries across all 14 categories
const EXPANSION_QUERIES = [
  // DM01: Sữa & Chế phẩm sữa (~22 new)
  { cat: 'DM01', q: 'sữa tươi vinamilk', take: 8 },
  { cat: 'DM01', q: 'sữa tươi th true milk', take: 6 },
  { cat: 'DM01', q: 'sữa chua vinamilk', take: 6 },
  { cat: 'DM01', q: 'sữa hạt vinamilk', take: 5 },
  { cat: 'DM01', q: 'sữa milo nestle', take: 5 },
  { cat: 'DM01', q: 'sữa đặc ngôi sao phương nam', take: 4 },
  // DM02: Nước giải khát & Trà (~22 new)
  { cat: 'DM02', q: 'nước ngọt coca cola', take: 6 },
  { cat: 'DM02', q: 'nước ngọt pepsi', take: 6 },
  { cat: 'DM02', q: 'trà ô long tea plus', take: 5 },
  { cat: 'DM02', q: 'nước tăng lực sting', take: 5 },
  { cat: 'DM02', q: 'nước suối lavie', take: 5 },
  { cat: 'DM02', q: 'nước ép twister', take: 5 },
  // DM03: Cà phê, Trà khô & Ca cao (~18 new)
  { cat: 'DM03', q: 'cà phê g7 trung nguyên', take: 7 },
  { cat: 'DM03', q: 'cà phê nescafe', take: 7 },
  { cat: 'DM03', q: 'trà túi lọc lipton', take: 5 },
  { cat: 'DM03', q: 'trà cosy đào', take: 4 },
  // DM04: Bia & Đồ uống lên men (~16 new)
  { cat: 'DM04', q: 'bia heineken lon', take: 5 },
  { cat: 'DM04', q: 'bia tiger lon', take: 5 },
  { cat: 'DM04', q: 'bia sài gòn lon', take: 5 },
  { cat: 'DM04', q: 'nước trái cây strongbow', take: 5 },
  // DM05: Mì, Phở & Cháo ăn liền (~20 new)
  { cat: 'DM05', q: 'mì hảo hảo acecook', take: 7 },
  { cat: 'DM05', q: 'mì omachi', take: 7 },
  { cat: 'DM05', q: 'phở vifon', take: 6 },
  { cat: 'DM05', q: 'mì cung đình', take: 5 },
  // DM06: Gạo, Bún & Ngũ cốc (~16 new)
  { cat: 'DM06', q: 'gạo st25', take: 6 },
  { cat: 'DM06', q: 'yến mạch quaker', take: 5 },
  { cat: 'DM06', q: 'bún khô miến dong', take: 5 },
  { cat: 'DM06', q: 'ngũ cốc nestle', take: 5 },
  // DM07: Dầu ăn, Nước chấm & Gia vị (~24 new)
  { cat: 'DM07', q: 'dầu ăn simply neptune', take: 6 },
  { cat: 'DM07', q: 'nước mắm nam ngư chinsu', take: 7 },
  { cat: 'DM07', q: 'nước tương maggi', take: 5 },
  { cat: 'DM07', q: 'tương ớt cholimex', take: 5 },
  { cat: 'DM07', q: 'hạt nêm knorr', take: 5 },
  { cat: 'DM07', q: 'bột ngọt ajinomoto', take: 4 },
  // DM08: Đồ hộp & Thực phẩm đóng gói (~18 new)
  { cat: 'DM08', q: 'cá hộp ba cô gái', take: 5 },
  { cat: 'DM08', q: 'pate hạ long', take: 5 },
  { cat: 'DM08', q: 'xúc xích vissan', take: 6 },
  { cat: 'DM08', q: 'rong biển ăn liền', take: 5 },
  // DM09: Bánh kẹo & Snack (~24 new)
  { cat: 'DM09', q: 'bánh oreo', take: 6 },
  { cat: 'DM09', q: 'bánh chocopie orion', take: 6 },
  { cat: 'DM09', q: 'bánh quy cosy', take: 5 },
  { cat: 'DM09', q: 'snack khoai tây lays', take: 6 },
  { cat: 'DM09', q: 'kẹo socola kitkat', take: 5 },
  // DM10: Thực phẩm mát & Đông lạnh (~14 new)
  { cat: 'DM10', q: 'phô mai con bò cười', take: 6 },
  { cat: 'DM10', q: 'bơ thực vật tường an', take: 5 },
  { cat: 'DM10', q: 'xốt mayonnaise kewpie', take: 5 },
  // DM11: Chăm sóc cá nhân (~24 new)
  { cat: 'DM11', q: 'dầu gội clear', take: 6 },
  { cat: 'DM11', q: 'dầu gội head shoulders', take: 5 },
  { cat: 'DM11', q: 'sữa tắm lifebuoy', take: 6 },
  { cat: 'DM11', q: 'kem đánh răng colgate', take: 6 },
  { cat: 'DM11', q: 'kem đánh răng p/s', take: 5 },
  { cat: 'DM11', q: 'sữa tắm dove', take: 5 },
  // DM12: Hóa phẩm & Vệ sinh nhà cửa (~24 new)
  { cat: 'DM12', q: 'nước giặt omo', take: 6 },
  { cat: 'DM12', q: 'nước giặt ariel', take: 6 },
  { cat: 'DM12', q: 'nước xả vải comfort', take: 6 },
  { cat: 'DM12', q: 'nước xả vải downy', take: 6 },
  { cat: 'DM12', q: 'nước rửa chén sunlight', take: 5 },
  { cat: 'DM12', q: 'khăn giấy pulppy', take: 5 },
  // DM13: Mẹ & Bé (~18 new)
  { cat: 'DM13', q: 'tã quần bobby', take: 6 },
  { cat: 'DM13', q: 'tã quần huggies', take: 6 },
  { cat: 'DM13', q: 'khăn ướt em bé bobby', take: 5 },
  { cat: 'DM13', q: 'sữa tắm gội johnson baby', take: 5 },
  // DM14: Văn phòng phẩm & Tiện ích (~18 new)
  { cat: 'DM14', q: 'bút bi thiên long', take: 6 },
  { cat: 'DM14', q: 'pin energizer aa', take: 5 },
  { cat: 'DM14', q: 'màng bọc thực phẩm', take: 5 },
  { cat: 'DM14', q: 'túi đựng rác tự hủy', take: 5 },
];

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function main() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const legacy = seed();
  const usedMd5s = new Set();
  const usedUrls = new Set();
  const usedNames = new Set();
  const sourcesRows = [];
  const finalProducts = [];

  const catByCode = new Map(CATEGORIES.map((c) => [c.code, c]));

  console.log(`[1/3] Upgrading ${legacy.products.length} legacy SKUs (SP001..SP093) to verified 750x750 real retail photos...`);

  // Step 1: Upgrade existing 93 SKUs preserving IDs, filenames, prices, stocks, suppliers
  let legacyUpgraded = 0;
  let legacyFailed = [];

  await runPool(legacy.products, 6, async (p) => {
    const fileName = String(p.imageUrl || '').replace(/^assets\/images\/products\//, '');
    const catCode = mapLegacyCategory(p);
    const catMeta = catByCode.get(catCode);

    // Search Tiki with exact product name, then brand + simplified name
    const shortQ = p.name.replace(/\b(\d+\s*(?:g|kg|ml|l|tờ|gói|hộp|chai|lon))\b/gi, '').trim();
    const queries = [p.name, `${p.brand} ${shortQ}`.trim(), shortQ];
    let result = { ok: false };
    let matchedTitle = '';

    for (const q of queries) {
      const hits = await fetchTikiSearch(q, 10);
      for (const hit of hits) {
        if (!hit.thumbnail_url || usedUrls.has(hit.thumbnail_url)) continue;
        usedUrls.add(hit.thumbnail_url);
        const dl = await downloadAndNormalize(hit.thumbnail_url, fileName, usedMd5s);
        if (dl.ok) {
          result = dl;
          matchedTitle = hit.name;
          break;
        }
      }
      if (result.ok) break;
    }

    if (!result.ok) {
      legacyFailed.push(p.id);
      return;
    }

    legacyUpgraded++;
    const nonReturnable = catMeta.nonReturnable || /sữa chua|bánh mì|cơm|xôi|trứng|xúc xích tươi|bàn chải/i.test(p.name) ? 1 : 0;
    const isSp001To009 = /^SP00[1-9]$/.test(p.id);
    finalProducts.push({
      id: p.id,
      sku: p.sku || p.id,
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      packSize: p.packSize,
      unit: p.unit,
      categoryCode: catCode,
      categoryName: catMeta.name,
      supplierId: isSp001To009 ? p.supplierId : inferSupplier(p.name, p.brand, catCode, p.supplierId),
      price: p.price,
      cost: p.cost,
      stock: p.stock,
      minStock: p.minStock || catMeta.minStock,
      imageUrl: `assets/images/products/${fileName}`,
      thumbUrl: `assets/images/products/thumbs/${fileName}`,
      hasExpiry: catMeta.hasExpiry,
      expiryWarnDays: p.nearExpiryDays || catMeta.warnDays,
      nonReturnable,
      caseUnitName: catMeta.caseUnit,
      unitsPerCase: catMeta.unitsPerCase,
      expiryOffsetDays: p.expiryDate ? Math.round((new Date(p.expiryDate) - new Date()) / 86400000) : 180,
      shelfLifeDays: 240,
      sourceUrl: result.sourceUrl,
      sourceNote: `Tiki Bách Hóa Online (${cleanProductName(matchedTitle).slice(0, 60)})`,
    });
    usedNames.add(p.name.toLowerCase());
  });

  // Sort legacy products by SP number
  finalProducts.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`   Upgraded legacy SKUs: ${legacyUpgraded}/${legacy.products.length}, failed: ${legacyFailed.length} ${legacyFailed.join(',')}`);

  // Step 2: Harvest 230+ new genuine SKUs across all 14 categories
  console.log(`[2/3] Harvesting new verified Vietnamese supermarket SKUs across 14 categories...`);
  const candidates = [];
  await runPool(EXPANSION_QUERIES, 6, async (spec) => {
    const hits = await fetchTikiSearch(spec.q, 24);
    let picked = 0;
    for (const hit of hits) {
      if (picked >= spec.take) break;
      if (!isGoodRetailListing(hit)) continue;
      const cleanName = cleanProductName(hit.name);
      const normKey = cleanName.toLowerCase().replace(/[^a-z0-9à-ỹ]+/g, ' ').trim();
      if (usedNames.has(normKey) || usedUrls.has(hit.thumbnail_url)) continue;
      usedNames.add(normKey);
      usedUrls.add(hit.thumbnail_url);
      candidates.push({ cat: spec.cat, hit, cleanName });
      picked++;
    }
  });

  console.log(`   Candidate new SKUs collected: ${candidates.length}. Downloading & verifying >=600px images...`);

  let nextIdx = 94;
  const acceptedNew = [];

  // Process downloads with controlled concurrency
  await runPool(candidates, 8, async (cand) => {
    const skuNum = nextIdx++;
    const skuId = `SP${String(skuNum).padStart(3, '0')}`;
    const slug = cand.cleanName
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32);
    const fileName = `${skuId.toLowerCase()}_${slug}.jpg`;

    const dl = await downloadAndNormalize(cand.hit.thumbnail_url, fileName, usedMd5s);
    if (!dl.ok) return;

    const catMeta = catByCode.get(cand.cat);
    const unit = inferUnit(cand.cleanName, 'gói');
    const packSize = inferPackSize(cand.cleanName, unit);
    const brand = (cand.hit.brand_name && cand.hit.brand_name !== 'OEM' ? cand.hit.brand_name : cand.cleanName.split(' ').slice(0, 2).join(' ')).trim();
    const rawPrice = Number(cand.hit.price) || 25000;
    const price = Math.max(4000, Math.round(rawPrice / 500) * 500);
    const cost = Math.max(2500, Math.round((price * (1 - catMeta.margin)) / 100) * 100);
    const supplierId = inferSupplier(cand.cleanName, brand, cand.cat);
    const d12 = `8935${String(cand.cat.slice(2)).padStart(2, '0')}${String(skuNum).padStart(6, '0')}`;
    const barcode = d12 + calcEan13CheckDigit(d12);

    // Deterministic stock & realistic shelf-life distribution (including a few near-expiry items!)
    const stock = 18 + ((skuNum * 17) % 140);
    let expiryOffsetDays = catMeta.hasExpiry ? 60 + ((skuNum * 29) % 300) : 0;
    if (catMeta.hasExpiry && skuNum % 31 === 0) expiryOffsetDays = 5; // near-expiry demo batch
    else if (catMeta.hasExpiry && skuNum % 47 === 0) expiryOffsetDays = 10; // near-expiry demo batch

    const nonReturnable = catMeta.nonReturnable || /bàn chải|tã\b|bỉm\b|sữa chua|phô mai|bơ\b/i.test(cand.cleanName) ? 1 : 0;

    acceptedNew.push({
      tempIdx: skuNum,
      name: cand.cleanName,
      brand,
      packSize,
      unit,
      categoryCode: cand.cat,
      categoryName: catMeta.name,
      supplierId,
      price,
      cost,
      stock,
      minStock: catMeta.minStock,
      tempFile: fileName,
      hasExpiry: catMeta.hasExpiry,
      expiryWarnDays: catMeta.warnDays,
      nonReturnable,
      caseUnitName: catMeta.caseUnit,
      unitsPerCase: catMeta.unitsPerCase,
      expiryOffsetDays,
      shelfLifeDays: catMeta.hasExpiry ? Math.max(expiryOffsetDays + 60, 180) : 0,
      sourceUrl: dl.sourceUrl,
      sourceNote: `Tiki Bách Hóa Online (ID ${cand.hit.id})`,
    });
  });

  // Renumber acceptedNew cleanly sequentially from SP094..SPNNN
  acceptedNew.sort((a, b) => a.cat?.localeCompare?.(b.cat) || a.categoryCode.localeCompare(b.categoryCode) || a.tempIdx - b.tempIdx);
  let seq = 94;
  for (const item of acceptedNew) {
    const id = `SP${String(seq).padStart(3, '0')}`;
    const newFile = item.tempFile.replace(/^sp\d+_/, `${id.toLowerCase()}_`);
    if (newFile !== item.tempFile) {
      fs.renameSync(path.join(IMG_DIR, item.tempFile), path.join(IMG_DIR, newFile));
      fs.renameSync(path.join(THUMB_DIR, item.tempFile), path.join(THUMB_DIR, newFile));
    }
    const d12 = `8935${String(item.categoryCode.slice(2)).padStart(2, '0')}${String(seq).padStart(6, '0')}`;
    const barcode = d12 + calcEan13CheckDigit(d12);
    finalProducts.push({
      id,
      sku: id,
      barcode,
      name: item.name,
      brand: item.brand,
      packSize: item.packSize,
      unit: item.unit,
      categoryCode: item.categoryCode,
      categoryName: item.categoryName,
      supplierId: item.supplierId,
      price: item.price,
      cost: item.cost,
      stock: item.stock,
      minStock: item.minStock,
      imageUrl: `assets/images/products/${newFile}`,
      thumbUrl: `assets/images/products/thumbs/${newFile}`,
      hasExpiry: item.hasExpiry,
      expiryWarnDays: item.expiryWarnDays,
      nonReturnable: item.nonReturnable,
      caseUnitName: item.caseUnitName,
      unitsPerCase: item.unitsPerCase,
      expiryOffsetDays: item.expiryOffsetDays,
      shelfLifeDays: item.shelfLifeDays,
      sourceUrl: item.sourceUrl,
      sourceNote: item.sourceNote,
    });
    seq++;
  }

  // Clean up unused files in IMG_DIR and THUMB_DIR
  const activeFiles = new Set(finalProducts.map((p) => p.imageUrl.replace(/^assets\/images\/products\//, '')));
  for (const f of fs.readdirSync(IMG_DIR)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f) && f !== 'default.jpg' && !activeFiles.has(f)) {
      fs.unlinkSync(path.join(IMG_DIR, f));
    }
  }
  for (const f of fs.readdirSync(THUMB_DIR)) {
    if (/\.(jpg|jpeg|png|webp)$/i.test(f) && !activeFiles.has(f)) {
      fs.unlinkSync(path.join(THUMB_DIR, f));
    }
  }
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  // Write SOURCES.csv
  const csvLines = ['SKU,filename,source,note'];
  for (const p of finalProducts) {
    const fn = p.imageUrl.replace(/^assets\/images\/products\//, '');
    const safeNote = String(p.sourceNote || '').replace(/"/g, '""');
    csvLines.push(`${p.id},${fn},"${p.sourceUrl}","${safeNote}"`);
  }
  fs.writeFileSync(path.join(IMG_DIR, 'SOURCES.csv'), csvLines.join('\n') + '\n', 'utf8');

  // Write src/domain/catalog-data.js (UMD compatible with both Node & Browser)
  const cleanCatalogProducts = finalProducts.map(({ sourceUrl, sourceNote, ...rest }) => rest);
  const outJs = `// Auto-generated verified Vietnamese supermarket catalog (${cleanCatalogProducts.length} SKUs, ${CATEGORIES.length} categories, ${SUPPLIERS.length} suppliers)
// Provenance logged in assets/images/products/SOURCES.csv
(function (scope) {
  'use strict';
  const CATALOG_CATEGORIES = ${JSON.stringify(CATEGORIES, null, 2)};
  const CATALOG_SUPPLIERS = ${JSON.stringify(SUPPLIERS, null, 2)};
  const CATALOG_PRODUCTS = ${JSON.stringify(cleanCatalogProducts, null, 2)};
  const api = { CATALOG_CATEGORIES, CATALOG_SUPPLIERS, CATALOG_PRODUCTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(scope.Retail || (scope.Retail = {}), api);
})(globalThis);
`;
  fs.writeFileSync(path.join(ROOT, 'src/domain/catalog-data.js'), outJs, 'utf8');

  // Category distribution summary
  const byCat = {};
  for (const p of finalProducts) byCat[p.categoryCode] = (byCat[p.categoryCode] || 0) + 1;
  console.log(`\n[3/3] DONE! Total verified SKUs: ${finalProducts.length}`);
  console.log('Category counts:', byCat);
  console.log('Legacy failed:', legacyFailed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
