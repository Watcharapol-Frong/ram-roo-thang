// ตรวจการ์ดทุกใบตามข้อจำกัดจริงของ LINE Flex Message
// หาตำแหน่ง repo จากที่ไฟล์นี้อยู่ ไม่ใช่ path ตายตัวของเครื่องใครคนหนึ่ง — ของเดิมชี้ไปที่
// โฟลเดอร์บนเครื่อง Mac ของผู้เขียน สคริปต์เลยรันไม่ได้เลยบนเครื่องอื่นและใน CI
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { resultCard, row, menuCard, FLEX_TOKENS } = await import(ROOT+'/worker/src/flex.js');
const { statusFlexMessage } = await import(ROOT+'/worker/src/health.js');
const { generateMainMenuFlex, generateRoomConfirmFlex } = await import(ROOT+'/worker/src/line.js');

const SIZE=['xxs','xs','sm','md','lg','xl','xxl','3xl','4xl','5xl','full'];
const MARGIN=['none','xs','sm','md','lg','xl','xxl'];
const errs=[];
const HEX=/^#[0-9A-Fa-f]{6}$/;

function walk(node, path){
  if(Array.isArray(node)) return node.forEach((n,i)=>walk(n,`${path}[${i}]`));
  if(!node || typeof node!=='object') return;
  const t=node.type;
  if(!t) errs.push(`${path}: ไม่มี type`);
  if(t==='text'){
    if(typeof node.text!=='string'||!node.text.length) errs.push(`${path}: text ว่างหรือไม่ใช่ string`);
    if(node.size&&!SIZE.includes(node.size)) errs.push(`${path}: size "${node.size}" ไม่ถูกต้อง`);
    if(node.color&&!HEX.test(node.color)) errs.push(`${path}: color "${node.color}" ต้องเป็น #RRGGBB`);
    if(node.weight&&!['regular','bold'].includes(node.weight)) errs.push(`${path}: weight ผิด`);
    if(node.align&&!['start','end','center'].includes(node.align)) errs.push(`${path}: align ผิด`);
  }
  if(t==='box'){
    if(!['vertical','horizontal','baseline'].includes(node.layout)) errs.push(`${path}: layout ผิด`);
    if(!Array.isArray(node.contents)) errs.push(`${path}: box ต้องมี contents เป็น array`);
    else if(node.contents.length===0) errs.push(`${path}: box contents ว่าง (LINE ไม่รับ)`);
    if(node.backgroundColor&&!HEX.test(node.backgroundColor)) errs.push(`${path}: backgroundColor ผิด`);
  }
  if(t==='separator'&&node.color&&!HEX.test(node.color)) errs.push(`${path}: separator color ผิด`);
  if(node.margin&&!MARGIN.includes(node.margin)) errs.push(`${path}: margin "${node.margin}" ไม่ถูกต้อง`);
  if(node.action){
    const a=node.action;
    if(!['uri','postback','message'].includes(a.type)) errs.push(`${path}.action: type ผิด`);
    if(a.type==='uri'&&!/^https?:\/\/|^line:\/\//.test(a.uri||'')) errs.push(`${path}.action: uri ต้องเป็น http/https`);
    if(a.type==='postback'&&(!a.data||a.data.length>300)) errs.push(`${path}.action: postback data ว่างหรือยาวเกิน 300`);
    if(a.label&&a.label.length>20) errs.push(`${path}.action: label ยาวเกิน 20 (${a.label.length})`);
  }
  ['contents','header','body','footer','hero'].forEach(k=>{ if(node[k]) walk(node[k], `${path}.${k}`); });
}

function check(name, msg){
  const before=errs.length;
  if(msg.type!=='flex') errs.push(`${name}: type ต้องเป็น flex`);
  if(!msg.altText) errs.push(`${name}: ไม่มี altText`);
  else if(msg.altText.length>400) errs.push(`${name}: altText ยาวเกิน 400`);
  walk(msg.contents, name);
  const size=JSON.stringify(msg).length;
  if(size>50000) errs.push(`${name}: ใหญ่เกิน 50KB (${size})`);
  console.log(`  ${errs.length===before?'OK  ':'FAIL'} ${name.padEnd(24)} ${size} bytes`);
}

console.log('ตรวจการ์ดทุกแบบที่บอทส่งได้:');
check('การ์ดอาคาร (มีลานจอด)', resultCard({
  title:'พบข้อมูลอาคาร', badge:'KLB', headerColor:FLEX_TOKENS.blueSoft,
  hero:'KLB', heroNote:'อาคารกงไกรลาศ',
  rows:[row('ที่จอดรถใกล้สุด','อาคารหอประชุมพ่อขุนราม (ปานกลาง)',{strong:true,color:'#D98E04'}),
        row('ระยะเดินเท้า','ประมาณ 157 ม. (3 นาที)')],
  note:'* ข้อมูลการนำทางจะปรับตามตำแหน่ง GPS ของคุณโดยอัตโนมัติ',
  actions:[{label:'เริ่มต้นเดินทาง',action:{type:'uri',label:'เริ่มต้นเดินทาง',uri:'https://liff.line.me/x?dest_id=KLB'}}],
  altText:'ข้อมูลอาคารกงไกรลาศ'}));

check('การ์ดอาคาร (ไม่มีลานจอด)', resultCard({
  title:'พบข้อมูลอาคาร', badge:'XYZ', headerColor:FLEX_TOKENS.blueSoft,
  hero:'XYZ', heroNote:'อาคารทดสอบ', rows:[],
  note:'* ข้อมูลการนำทางจะปรับตามตำแหน่ง GPS ของคุณโดยอัตโนมัติ',
  actions:[{label:'เริ่มต้นเดินทาง',action:{type:'uri',label:'เริ่มต้นเดินทาง',uri:'https://liff.line.me/x'}}],
  altText:'ข้อมูลอาคารทดสอบ'}));

check('การ์ดตารางสอบ', resultCard({
  title:'ตารางสอบของคุณ', badge:'ตารางสอบ', headerColor:FLEX_TOKENS.blueSoft,
  hero:'บันทึกวิชาที่จะสอบ', heroNote:'ใส่รหัสวิชา ระบบจะดึงวันและคาบสอบจากประกาศให้เอง',
  rows:[row('วันสอบ','ดึงจากประกาศอัตโนมัติ'),row('ห้องสอบ','ส่งรูปตารางสอบให้อ่าน'),row('แจ้งเตือน','ล่วงหน้า 1 วัน')],
  actions:[{label:'เปิดตารางสอบ',action:{type:'uri',label:'เปิดตารางสอบ',uri:'https://liff.line.me/x?mode=profile'}}],
  altText:'บันทึกวิชาสอบ'}));

// การ์ดยืนยันผลอ่านเอกสาร — สร้างจากฟังก์ชันจริง ครอบทุกแบบของเอกสารที่รับได้
// (ใบลงทะเบียนไม่มีห้องเลย / ตารางสอบมีห้องครบ / อ่านได้บางส่วน / ยาวเกินจนต้องตัด)
const draft=()=>crypto.randomUUID();
const item=(code,room)=>({course_code:code,room,exam_date:'2026-10-19',periods:['A']});
check('ยืนยัน: ใบลงทะเบียน 9 วิชา ไม่มีห้อง', generateRoomConfirmFlex(
  ['LAW1101','LAW1102','LAW1103','LAW1106','LAW2101','LAW2106','LAW2108','LAW2109','LAW2111'].map(c=>item(c,null)),
  [], draft()));
check('ยืนยัน: ตารางสอบมีห้องครบ', generateRoomConfirmFlex(
  Array.from({length:5},(_,i)=>item(`SUB${1000+i}`,`VKB ${500+i}`)), [], draft()));
check('ยืนยัน: มีห้องบางวิชา + ตกบาง', generateRoomConfirmFlex(
  [item('LAW1101','VKB 501'),item('LAW1102',null),item('LAW1103',null)],
  [{code:'EC01003',reason:'ไม่มีรหัสนี้ในตารางสอบของมหาวิทยาลัย'}], draft()));
check('ยืนยัน: 25 วิชา (ต้องตัดเหลือ 12 + สรุป)', generateRoomConfirmFlex(
  Array.from({length:25},(_,i)=>item(`SUB${1000+i}`,i%2?`VKB ${500+i}`:null)), [], draft()));

// การ์ดสถานะสร้างจาก statusFlexMessage ตัวจริง ไม่ได้ก๊อป layout มาวางซ้ำ — ไม่งั้นแก้การ์ดจริง
// แล้วสคริปต์นี้ยังตรวจของเก่าผ่านฉลุยอยู่ ทั้งที่ LINE ปฏิเสธการ์ดใบใหม่
const fakeChecks=(overrides={})=>['config','line_api','database','chat_history','ai','exam_alerts']
  .map(name=>({name,label:{config:'ตั้งค่าระบบ',line_api:'เชื่อมต่อ LINE',database:'ฐานข้อมูล',
    chat_history:'ความจำการคุย',ai:'ผู้ช่วย AI',exam_alerts:'แจ้งเตือนสอบ'}[name],
    status:overrides[name]||'ok',latency_ms:12}));
for(const [name,status,over] of [['การ์ดสถานะ (ปกติ)','ok',{}],
                                 ['การ์ดสถานะ (บางส่วน)','degraded',{ai:'degraded'}],
                                 ['การ์ดสถานะ (ขัดข้อง)','down',{line_api:'down',database:'down'}]]){
  check(name, statusFlexMessage({status,online:status!=='down',checked_at:new Date().toISOString(),
    deep:true,checks:fakeChecks(over)}));
}

check('การ์ดเมนูหลัก (ของจริง)', generateMainMenuFlex('https://liff.line.me/2011201463-2rdSwrwB'));

check('การ์ดเมนู', menuCard({title:'เมนู',subtitle:'ทดสอบ',groups:[{label:'กลุ่ม',items:[
  {label:'ก',action:{type:'message',label:'ก',text:'ก'}},{label:'ข',action:{type:'message',label:'ข',text:'ข'}},
  {label:'ค',action:{type:'message',label:'ค',text:'ค'}}]}],altText:'เมนู'}));

console.log(errs.length ? `\n❌ พบปัญหา ${errs.length} จุด:\n` + errs.map(e=>'   '+e).join('\n')
                        : '\n✅ ผ่านทุกใบ ไม่มีอะไรที่ LINE จะปฏิเสธ');
