const ROOT='/Users/watcharapolcharoensuk/Desktop/ram-roo-thang-bot-main';
const { generateMainMenuFlex, generateScheduleFlexMessage } = await import(ROOT+'/worker/src/line.js');
const SIZE=['xxs','xs','sm','md','lg','xl','xxl','3xl','4xl','5xl','full'];
const MARGIN=['none','xs','sm','md','lg','xl','xxl']; const HEX=/^#[0-9A-Fa-f]{6}$/; const errs=[];
function walk(n,p){ if(Array.isArray(n))return n.forEach((x,i)=>walk(x,`${p}[${i}]`));
 if(!n||typeof n!=='object')return;
 if(n.type==='text'&&!n.text) errs.push(p+': text ว่าง');
 if(n.type==='text'&&n.size&&!SIZE.includes(n.size)) errs.push(p+': size ผิด');
 if(n.color&&!HEX.test(n.color)) errs.push(p+': color ผิด');
 if(n.type==='box'&&(!Array.isArray(n.contents)||!n.contents.length)) errs.push(p+': box ว่าง');
 if(n.margin&&!MARGIN.includes(n.margin)) errs.push(p+': margin ผิด');
 if(n.action){const a=n.action;
   if(a.type==='uri'&&!/^https?:\/\//.test(a.uri||'')) errs.push(p+'.action uri ผิด: '+a.uri);
   if(a.label&&[...a.label].length>20) errs.push(`${p}.action label ยาว ${[...a.label].length}`);}
 ['contents','header','body','footer'].forEach(k=>n[k]&&walk(n[k],p+'.'+k)); }
const L='https://liff.line.me/2011201463-2rdSwrwB';
for (const [name, card] of [['เมนูหลัก', generateMainMenuFlex(L)], ['การ์ดตาราง', generateScheduleFlexMessage(L)]]) {
  const b=errs.length; walk(card.contents,name);
  console.log(`  ${errs.length===b?'OK  ':'FAIL'} ${name.padEnd(12)} ${JSON.stringify(card).length} bytes`);
}
console.log('\nปุ่มในเมนู:');
const w=n=>{if(Array.isArray(n))return n.forEach(w); if(!n||typeof n!=='object')return;
  if(n.type==='text'&&n.align==='center')console.log('  ',n.text);
  ['contents','header','body'].forEach(k=>n[k]&&w(n[k]));};
w(generateMainMenuFlex(L).contents);
console.log(errs.length?'\n❌ '+errs.join('\n  '):'\n✅ ผ่าน');
