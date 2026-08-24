const ROOT='/Users/watcharapolcharoensuk/Desktop/ram-roo-thang-bot-main';
const { buildDigestCard } = await import(ROOT+'/worker/src/daily.js');
const SIZE=['xxs','xs','sm','md','lg','xl','xxl','3xl','4xl','5xl','full'];
const MARGIN=['none','xs','sm','md','lg','xl','xxl']; const HEX=/^#[0-9A-Fa-f]{6}$/;
const errs=[];
function walk(n,p){ if(Array.isArray(n))return n.forEach((x,i)=>walk(x,`${p}[${i}]`));
 if(!n||typeof n!=='object')return; const t=n.type;
 if(t==='text'){ if(!n.text) errs.push(p+': text ว่าง');
   if(n.size&&!SIZE.includes(n.size)) errs.push(p+': size ผิด');
   if(n.color&&!HEX.test(n.color)) errs.push(p+': color ผิด'); }
 if(t==='box'){ if(!Array.isArray(n.contents)||!n.contents.length) errs.push(p+': box contents ว่าง'); }
 if(n.margin&&!MARGIN.includes(n.margin)) errs.push(p+': margin ผิด');
 if(n.action){ const a=n.action;
   if(a.type==='uri'&&!/^https?:\/\/|^line:\/\//.test(a.uri||'')) errs.push(p+'.action: uri ผิด -> '+a.uri);
   if(a.label&&[...a.label].length>20) errs.push(`${p}.action: label ยาว ${[...a.label].length} > 20 -> "${a.label}"`); }
 ['contents','header','body','footer'].forEach(k=>n[k]&&walk(n[k],p+'.'+k)); }

const mk=(nc,ne)=>({ dateIso:'2026-10-25', dayCode:'W',
  classes:Array.from({length:nc},(_,i)=>({code:`SUB${1000+i}`,time:'07:30-09:20',sortKey:'07:30',place:`SCO ${100+i}`,buildingCode:'SCO'})),
  exams:Array.from({length:ne},(_,i)=>({code:`EXM${1000+i}`,time:'09:00 - 12:00',sortKey:'09:00',place:'SBB 201',buildingCode:'SBB'})) });

for (const [label, d] of [['เรียนอย่างเดียว 3', mk(3,0)], ['สอบอย่างเดียว 1', mk(0,1)],
                          ['ผสม 5+1', mk(5,1)], ['วันหนักมาก 10+2', mk(10,2)],
                          ['ไม่มีห้องเลย', {dateIso:'2026-10-25',dayCode:'W',classes:[],exams:[{code:'X1000',time:'09:00 - 12:00',sortKey:'09:00',place:null,buildingCode:null}]}]]) {
  const before=errs.length;
  const card=buildDigestCard(d,'https://liff.line.me/2011201463-2rdSwrwB');
  walk(card.contents,label);
  const size=JSON.stringify(card).length;
  if(size>50000) errs.push(label+': ใหญ่เกิน 50KB');
  console.log(`  ${errs.length===before?'OK  ':'FAIL'} ${label.padEnd(18)} ${String(size).padStart(5)} bytes  alt="${card.altText}"`);
}
console.log(errs.length ? '\n❌ '+errs.join('\n   ') : '\n✅ ผ่านทุกใบ');
