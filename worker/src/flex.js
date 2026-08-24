// ชุดออกแบบการ์ด Flex กลาง — ทุกการ์ดที่บอทส่งต้องสร้างจากที่นี่
//
// ก่อนหน้านี้แต่ละการ์ดเขียน layout ของตัวเองแยกกัน ทำให้ padding/สี/ขนาดตัวอักษรไม่ตรงกัน
// พอวางเรียงกันในแชทเลยดูเหมือนมาจากคนละแอป รวมมาไว้ที่เดียวแล้วแก้สไตล์ทีเดียวได้ทั้งระบบ
//
// โครงการ์ดมี 2 แบบพอ:
//   resultCard — แถบหัวสี + ค่าหลักตัวใหญ่ + แถว label/value + ลิงก์ท้ายการ์ด
//   menuCard   — แถบหัวสี + ปุ่มจัดกลุ่ม
// ทั้งคู่คุมด้วยโทเคนชุดเดียวกันข้างล่าง

const T = {
  ink: '#111111',
  inkSoft: '#6B7280',
  inkFaint: '#9CA3AF',
  line: '#EFEFEF',
  brand: '#1560ff',
  green: '#06C755',
  greenSoft: '#E8F8EE',
  blueSoft: '#EEF3FF',
  amberSoft: '#FFF4E5',
  redSoft: '#FDECEC',
  red: '#D64545',
  pad: '18px',
};

export const FLEX_TOKENS = T;

// เส้นคั่นบางกว่า separator ปกติ ใช้คั่นกลุ่มข้อมูลโดยไม่ดึงสายตา
function hairline(margin = 'lg') {
  return { type: 'separator', margin, color: T.line };
}

// แถวข้อมูล label ซ้าย / value ขวา — flex 4:6 เพราะ label ไทยสั้นกว่า value เกือบทุกครั้ง
export function row(label, value, options = {}) {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: options.margin || 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: T.inkSoft, flex: 4, wrap: false },
      {
        type: 'text',
        text: String(value),
        size: 'sm',
        color: options.color || T.ink,
        weight: options.strong ? 'bold' : 'regular',
        flex: 6,
        align: 'end',
        wrap: true,
      },
    ],
  };
}

// แถบหัวการ์ด — ชื่อเรื่อง + ป้ายสถานะเล็กๆ ทางขวา
function header({ title, badge, badgeColor, background }) {
  const contents = [
    { type: 'text', text: title, weight: 'bold', size: 'md', color: T.ink, flex: 1, wrap: true },
  ];
  if (badge) {
    contents.push({
      type: 'box',
      layout: 'vertical',
      backgroundColor: badgeColor || '#FFFFFF',
      cornerRadius: '20px',
      paddingAll: '6px',
      paddingStart: '12px',
      paddingEnd: '12px',
      flex: 0,
      contents: [{ type: 'text', text: badge, size: 'xxs', weight: 'bold', color: T.ink }],
    });
  }
  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: background || T.greenSoft,
    paddingAll: T.pad,
    alignItems: 'center',
    spacing: 'sm',
    contents,
  };
}

// ลิงก์ท้ายการ์ด — คั่นด้วยเส้นบางแล้วจัดกึ่งกลาง ให้อ่านเป็นรายการไม่ใช่ปุ่มก้อนใหญ่
function actionRows(actions) {
  const out = [];
  for (const action of actions) {
    out.push(hairline('none'));
    out.push({
      type: 'box',
      layout: 'vertical',
      paddingAll: '14px',
      action: action.action,
      contents: [{
        type: 'text',
        text: action.label,
        size: 'sm',
        weight: 'bold',
        color: action.color || T.brand,
        align: 'center',
      }],
    });
  }
  return out;
}

// การ์ดผลลัพธ์ — ใช้กับ "พบอาคารแล้ว", "บันทึกห้องสอบแล้ว", "แลกของสำเร็จ" ฯลฯ
//
// hero คือค่าที่ผู้ใช้มองหาก่อนเสมอ (ชื่ออาคาร / จำนวนเหรียญ) วางไว้บนสุดตัวใหญ่
// ที่เหลือเป็นรายละเอียดรอง จัดเป็นแถว label/value ให้กวาดตาหาได้เร็ว
export function resultCard({
  title, badge, badgeColor, headerColor,
  hero, heroColor, heroNote,
  rows = [], note, actions = [], altText,
}) {
  const body = [];

  if (hero) {
    body.push({ type: 'text', text: hero, weight: 'bold', size: 'xxl', color: heroColor || T.ink, wrap: true });
    if (heroNote) {
      body.push({ type: 'text', text: heroNote, size: 'xs', color: T.inkFaint, margin: 'xs', wrap: true });
    }
    if (rows.length) body.push(hairline());
  }

  rows.forEach((r, i) => body.push(i === 0 && !hero ? { ...r, margin: 'none' } : r));

  if (note) {
    if (rows.length) body.push(hairline());
    body.push({ type: 'text', text: note, size: 'xxs', color: T.inkFaint, wrap: true, margin: rows.length ? 'md' : 'none' });
  }

  const bubble = {
    type: 'bubble',
    header: header({ title, badge, badgeColor, background: headerColor }),
    body: { type: 'box', layout: 'vertical', paddingAll: T.pad, contents: body },
  };

  if (actions.length) {
    bubble.footer = {
      type: 'box', layout: 'vertical', paddingAll: '0px', spacing: 'none',
      contents: actionRows(actions),
    };
    bubble.styles = { footer: { separator: false } };
  }

  return { type: 'flex', altText: altText || title, contents: bubble };
}

// การ์ดเมนู — ปุ่มจัดกลุ่มพร้อมหัวข้อกลุ่ม
export function menuCard({ title, subtitle, headerColor, groups = [], altText }) {
  const body = [];

  groups.forEach((group, gi) => {
    if (group.label) {
      body.push({
        type: 'text', text: group.label, size: 'xs', weight: 'bold',
        color: T.inkSoft, margin: gi === 0 ? 'none' : 'xl',
      });
    }
    // เรียงปุ่มทีละ 2 คอลัมน์ — เกินกว่านี้ตัวหนังสือไทยจะถูกตัดกลางคำบนจอแคบ
    for (let i = 0; i < group.items.length; i += 2) {
      const pair = group.items.slice(i, i + 2);
      body.push({
        type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md',
        contents: pair.map((item) => ({
          type: 'box', layout: 'vertical',
          backgroundColor: item.background || T.blueSoft,
          cornerRadius: '10px', paddingAll: '14px', flex: 1,
          action: item.action,
          contents: [{
            type: 'text', text: item.label, size: 'sm', weight: 'bold',
            color: item.color || T.brand, align: 'center', wrap: true,
          }],
        })).concat(pair.length === 1
          ? [{ type: 'box', layout: 'vertical', flex: 1, contents: [{ type: 'filler' }] }]
          : []),
      });
    }
  });

  return {
    type: 'flex',
    altText: altText || title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: headerColor || T.blueSoft,
        paddingAll: T.pad,
        contents: [
          { type: 'text', text: title, weight: 'bold', size: 'md', color: T.ink },
          ...(subtitle ? [{ type: 'text', text: subtitle, size: 'xs', color: T.inkSoft, margin: 'xs', wrap: true }] : []),
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: T.pad, contents: body },
    },
  };
}
