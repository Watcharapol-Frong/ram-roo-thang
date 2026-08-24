// อ่านข้อมูลบริการ/ขั้นตอนราชการให้เป็นชิ้นๆ แล้วตอบเฉพาะชิ้นที่ถูกถาม
//
// ทำไมต้องมีไฟล์นี้: ของเดิม service มีแต่ steps ก้อนเดียวเป็นสตริงยาว ซึ่งตอบได้ท่าเดียวคือ
// เทออกมาทั้งก้อน ถามว่า "ต้องเตรียมอะไร" ก็ได้ขั้นตอน 1-5 มาให้อ่านเอาเอง
//
// รับข้อมูลได้สองแบบ และตั้งใจให้ทับกันได้:
//   1. ฟิลด์แยก (location/documents/procedure/fee/hours/...) — ใช้ก่อนเสมอถ้ามี
//   2. steps ก้อนเดิม — แกะหัวข้อ 📍/📋/🔄 ออกมาให้อัตโนมัติ ถ้าไม่มีหัวข้อก็ถือเป็นขั้นตอนล้วน
// แปลว่าเติมฟิลด์แยกทีละบริการได้เรื่อยๆ โดยที่ตัวที่ยังไม่เติมก็ยังตอบได้เหมือนเดิม

const SECTION_MARKERS = [
  { key: 'location',  test: /^📍/ },
  { key: 'documents', test: /^📋/ },
  { key: 'procedure', test: /^🔄/ },
  { key: 'fee',       test: /^💰/ },
  { key: 'hours',     test: /^🕒|^⏰/ },
  { key: 'notes',     test: /^⚠️|^💡|^📝/ },
];

// ตัดหัวข้อกับเครื่องหมายท้ายหัวข้อออก เหลือแต่เนื้อ ("📋 สิ่งที่ต้องเตรียมไป:" -> "")
function stripHeading(line) {
  return line.replace(/^[^\s]*\s*/, '').replace(/^[^:：]*[:：]\s*/, '').trim();
}

// ตัดเลขลำดับหน้าบรรทัดออก เก็บเป็น array เพื่อให้ฝั่งแสดงผลจัดเลขใหม่เองได้
function toItems(lines) {
  return lines
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•])\s*/, '').trim())
    .filter(Boolean);
}

// แกะ steps ก้อนเดียวเป็นส่วนๆ ตามหัวข้อ emoji ที่ทีมใช้กรอกข้อมูลอยู่แล้ว
export function parseStepsBlob(blob) {
  const out = { location: null, documents: [], procedure: [], fee: null, hours: null, notes: null };
  if (!blob) return out;

  const lines = String(blob).split('\n');
  let current = 'procedure';   // ไม่มีหัวข้อ = ทั้งก้อนคือขั้นตอน (เคสส่วนใหญ่ในชุดข้อมูลตอนนี้)
  const buckets = { location: [], documents: [], procedure: [], fee: [], hours: [], notes: [] };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const marker = SECTION_MARKERS.find((m) => m.test.test(line));
    if (marker) {
      current = marker.key;
      const inline = stripHeading(line);
      if (inline) buckets[current].push(inline);   // "📍 สถานที่: อาคาร X" — เนื้อหาอยู่บรรทัดเดียวกับหัวข้อ
      continue;
    }
    buckets[current].push(line);
  }

  out.location = buckets.location.join(' ') || null;
  out.documents = toItems(buckets.documents);
  out.procedure = toItems(buckets.procedure);
  out.fee = buckets.fee.join(' ') || null;
  out.hours = buckets.hours.join(' ') || null;
  out.notes = buckets.notes.join('\n') || null;
  return out;
}

const asArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// รวมข้อมูลบริการหนึ่งรายการให้เป็นรูปเดียวกันเสมอ ไม่ว่าต้นทางจะกรอกมาแบบไหน
export function normalizeService(service) {
  const parsed = parseStepsBlob(service && service.steps);
  return {
    id: service.service_id,
    name: service.name,
    building_id: service.building_id || null,
    short_answer: service.short_answer || null,
    location: service.location || parsed.location || null,
    documents: asArray(service.documents).length ? asArray(service.documents) : parsed.documents,
    procedure: asArray(service.procedure).length ? asArray(service.procedure) : parsed.procedure,
    fee: service.fee || parsed.fee || null,
    hours: service.hours || parsed.hours || null,
    duration: service.duration || null,
    period: service.period || null,
    contact: service.contact || null,
    notes: service.notes || parsed.notes || null,
  };
}

// ด้านไหนของบริการนี้ที่ "มีข้อมูลจริง" — ใช้ทั้งตอนเลือกคำตอบและตอนสร้างปุ่มต่อยอด
// จะได้ไม่เสนอปุ่มที่กดแล้วเจอ "ยังไม่มีข้อมูล" ซึ่งเป็นการหลอกให้กดเปล่า
export function availableIntents(info) {
  const has = [];
  if (info.procedure.length) has.push('STEPS');
  if (info.documents.length) has.push('DOCUMENTS');
  if (info.fee) has.push('FEE');
  if (info.hours) has.push('HOURS');
  if (info.duration) has.push('DURATION');
  if (info.period) has.push('PERIOD');
  if (info.contact) has.push('CONTACT');
  if (info.location || info.short_answer || info.building_id) has.push('LOCATION');
  return has;
}

const numbered = (items) => items.map((s, i) => `${i + 1}. ${s}`).join('\n');
const bulleted = (items) => items.map((s) => `• ${s}`).join('\n');

// ข้อความคำตอบของแต่ละ intent — คืน null ถ้าบริการนี้ยังไม่มีข้อมูลด้านนั้น
// ผู้เรียกต้องรับมือกับ null เอง (เสนอด้านที่มีแทน ไม่ใช่ตอบว่าไม่มีแล้วจบ)
export function answerForIntent(info, intent) {
  switch (intent) {
    case 'STEPS':
      if (!info.procedure.length) return null;
      return `ขั้นตอน${info.name}\n\n${numbered(info.procedure)}`;

    case 'DOCUMENTS':
      if (!info.documents.length) return null;
      return `สิ่งที่ต้องเตรียมไป (${info.name})\n\n${bulleted(info.documents)}`;

    case 'FEE':
      return info.fee ? `ค่าใช้จ่าย: ${info.fee}` : null;

    case 'HOURS':
      return info.hours ? `เวลาทำการ: ${info.hours}` : null;

    case 'DURATION':
      return info.duration ? `ระยะเวลาดำเนินการ: ${info.duration}` : null;

    case 'PERIOD':
      return info.period ? `ช่วงเวลาที่เปิดรับ: ${info.period}` : null;

    case 'CONTACT':
      return info.contact ? `ช่องทางติดต่อ: ${info.contact}` : null;

    case 'LOCATION': {
      const place = info.location || info.short_answer;
      return place ? `${info.name}\n${place}` : null;
    }

    default:
      return null;
  }
}

// สรุปทุกด้านที่มีข้อมูล ใช้ตอบคำถามกว้างๆ อย่าง "ขอรายละเอียดเพิ่ม"
export function fullSummary(info) {
  const parts = [info.name];
  if (info.location || info.short_answer) parts.push(`\n📍 ${info.location || info.short_answer}`);
  if (info.hours) parts.push(`🕒 ${info.hours}`);
  if (info.fee) parts.push(`💰 ${info.fee}`);
  if (info.period) parts.push(`🗓 เปิดรับ: ${info.period}`);
  if (info.duration) parts.push(`⏳ ใช้เวลา: ${info.duration}`);
  if (info.documents.length) parts.push(`\nสิ่งที่ต้องเตรียม\n${bulleted(info.documents)}`);
  if (info.procedure.length) parts.push(`\nขั้นตอน\n${numbered(info.procedure)}`);
  if (info.contact) parts.push(`\nติดต่อ: ${info.contact}`);
  if (info.notes) parts.push(`\n${info.notes}`);
  return parts.join('\n');
}

// ข้อมูลจริงที่ส่งให้ AI ใช้อ้างอิงตอนต้องเรียบเรียงเอง — สั้นและเป็นข้อเท็จจริงล้วน
// (เดิม AI ไม่เคยได้รับ steps เลย ถูกถามเรื่องที่ไม่มีข้อมูลแล้วโดนสั่งห้ามเดา จึงได้แต่ปฏิเสธ)
export function groundingText(info) {
  const lines = [`บริการ: ${info.name}`];
  if (info.location || info.short_answer) lines.push(`สถานที่: ${info.location || info.short_answer}`);
  if (info.hours) lines.push(`เวลาทำการ: ${info.hours}`);
  if (info.fee) lines.push(`ค่าใช้จ่าย: ${info.fee}`);
  if (info.duration) lines.push(`ระยะเวลาดำเนินการ: ${info.duration}`);
  if (info.period) lines.push(`ช่วงเวลาที่เปิดรับ: ${info.period}`);
  if (info.contact) lines.push(`ติดต่อ: ${info.contact}`);
  if (info.documents.length) lines.push(`เอกสารที่ต้องเตรียม: ${info.documents.join(' / ')}`);
  if (info.procedure.length) lines.push(`ขั้นตอน: ${info.procedure.map((s, i) => `${i + 1}) ${s}`).join(' ')}`);
  if (info.notes) lines.push(`หมายเหตุ: ${info.notes}`);
  return lines.join('\n');
}
