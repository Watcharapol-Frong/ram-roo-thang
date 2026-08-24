// Works out what a question is asking *for*, separately from what it is asking *about*.
//
// The problem this fixes: retrieveContext() in ai.js only matches topic names (aliases)
// against the current message. A follow-up like "what are the steps to submit it" contains no
// topic name at all, so it never matched, fell through to the AI without the steps attached,
// and the AI answered "no data in the system" while the data was sitting right there.
//
// Follow-up questions about paperwork come in only a few shapes, and keywords separate them
// more reliably than asking an LLM to guess — faster, no quota, and no way to invent an
// answer. Pair this intent with the remembered topic (conversation.js) and answer from data.
//
// Ordered most specific first; the first match wins. "which documents do I need to submit"
// must come out as DOCUMENTS, not STEPS, even though it contains the word "submit".
const INTENT_PATTERNS = [
  ['DOCUMENTS', /เตรียมอะไร|ต้องเตรียม|ต้องใช้อะไร|ใช้อะไรบ้าง|เอกสาร|หลักฐาน|สำเนา|พกอะไร|เตรียมตัว|ต้องมีอะไร/],
  ['FEE',       /ค่าใช้จ่าย|ค่าธรรมเนียม|กี่บาท|ราคา|เสียเงิน|เสียค่า|ฟรีไหม|ฟรีมั้ย|จ่ายเท่าไหร่|เท่าไหร่/],
  ['HOURS',     /กี่โมง|เวลาทำการ|เวลาเปิด|เปิดถึง|ปิดกี่|เปิดวันไหน|วันไหนบ้าง|เสาร์อาทิตย์|วันหยุด|พักเที่ยง/],
  ['DURATION',  /กี่วัน|ใช้เวลา|นานไหม|นานมั้ย|รอกี่|ได้เมื่อไหร่|รับได้เมื่อไหร่|เสร็จเมื่อไหร่/],
  ['PERIOD',    /ช่วงไหน|ช่วงเวลา|เปิดรับเมื่อไหร่|ยื่นได้ถึง|หมดเขต|ปิดรับ|ภายในวันไหน|เดือนไหน/],
  ['CONTACT',   /เบอร์โทร|โทรไปที่|ติดต่อยังไง|สอบถามที่ไหน|เบอร์ติดต่อ|อีเมล|เพจ|ช่องทางติดต่อ/],
  ['LOCATION',  /ที่ไหน|อยู่ไหน|ตรงไหน|ตึกไหน|อาคารไหน|ชั้นไหน|ช่องไหน|ไปยังไง|ไปทางไหน|เส้นทาง|พาไป|นำทาง/],
  ['STEPS',     /ขั้นตอน|ทำยังไง|ทำอย่างไร|ยื่นยังไง|ยื่นอย่างไร|ขอยังไง|ขออย่างไร|สมัครยังไง|วิธีการ|วิธีทำ|วิธีขอ|กระบวนการ|ต้องทำอะไร|เริ่มยังไง|ทำไงต่อ|แล้วไงต่อ/],
];

// The follow-up details a user can ask for. Same names throughout (intent -> field in serviceinfo.js).
export const FOLLOW_UP_INTENTS = INTENT_PATTERNS.map(([intent]) => intent);

export function detectFollowUpIntent(message) {
  const text = String(message || '').toLowerCase();
  if (!text.trim()) return null;
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  return null;
}

// Short questions meaning "carry on from what we were just discussing" without naming which
// aspect — treated as a follow-up on the same topic, answered with the full summary.
const CONTINUATION = /^(ขอ)?(รายละเอียด|ข้อมูล)(เพิ่ม|เติม)?|มีอะไรอีก|อย่างอื่น|ต่อ$|แล้วไง|เพิ่มเติม/;

export function isContinuation(message) {
  return CONTINUATION.test(String(message || '').trim());
}
