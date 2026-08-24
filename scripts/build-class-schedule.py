#!/usr/bin/env python3
"""แปลงตารางบรรยาย (ม.ร.30) ของ ม.รามคำแหง -> data/class-schedule.json

อ่านจากพิกัดบนหน้ากระดาษเหมือน build-exam-schedule.py ด้วยเหตุผลเดียวกัน — ลำดับบรรทัดที่
extract_text() คายออกมาเชื่อไม่ได้ คอลัมน์คนละคอลัมน์ถูกคายปนกันตามลำดับ object ในไฟล์

โครงตาราง (ตำแหน่ง x โดยประมาณ):
    14-25   วิชา(CR)          ACC1101 (3)
    62      รายชื่อกระบวนวิชา  ชื่อวิชา + หมายเหตุ (ไม่ได้ใช้)
    286     วัน-เวลาเรียน      TU 0830-1100
    343     ห้องเรียน          KTB 201
    397     อาจารย์ผู้สอน      (ไม่เก็บ — ไม่ได้ใช้ในฟีเจอร์ และเป็นข้อมูลบุคคล)
    513     วัน/เวลาสอบ        M 26 OCT. 2026 A  (มีในตารางสอบอยู่แล้ว ใช้ตรวจทานเฉยๆ)

วิชาหนึ่งมีได้หลายคาบ — แถวที่ไม่มีรหัสวิชาแต่มีวัน-เวลา คือคาบเพิ่มของวิชาบรรทัดบน

ใช้: python3 scripts/build-class-schedule.py <ไฟล์.pdf> [-o data/class-schedule.json]
"""
import argparse, json, re, sys
from collections import defaultdict
from pypdf import PdfReader

# ไม่บังคับให้จบพอดี — บางหน้าเซลล์เดียวมีทั้งรหัสวิชาและชื่อวิชาต่อท้าย
# ("ZOO4902 (3) (ZO498,BZ492)SPECIAL...") ถ้าใช้ $ จะ match ไม่ติดแล้วคาบทั้งหน้าจับคู่วิชาไม่ได้
CODE_RE = re.compile(r'^([A-Z]{2,4}\d{4})\s*\((\d)\)')
SESSION_RE = re.compile(r'^(M|TU|W|TH|F|S|SU|SUN)\s+(\d{4})-(\d{4})$')
ROOM_RE = re.compile(r'^([A-Z]{2,4})\s*([\w/-]+)$')

X_CODE_MAX = 60
X_SESSION = (270, 335)
X_ROOM = (335, 390)      # 390 ขึ้นไปเป็นชื่ออาจารย์ ไม่เอา
X_SEC = (240, 275)       # "SEC." กับเลขกลุ่ม อยู่คนละเซลล์ติดกัน
Y_TOLERANCE = 2.0


def page_rows(page):
    cells = []
    def visitor(text, cm, tm, font_dict, font_size):
        t = text.strip()
        if t:
            cells.append((tm[5], tm[4], t))
    page.extract_text(visitor_text=visitor)

    rows, current, last_y = [], [], None
    for y, x, t in sorted(cells, key=lambda c: -c[0]):
        if last_y is None or abs(y - last_y) <= Y_TOLERANCE:
            current.append((x, t))
        else:
            rows.append(sorted(current))
            current = [(x, t)]
        last_y = y
    if current:
        rows.append(sorted(current))
    return rows


def hhmm(raw):
    return f'{raw[:2]}:{raw[2:]}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('-o', '--out', default='data/class-schedule.json')
    ap.add_argument('--term', default='1/2569')
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    sessions = []
    orphan_sessions = 0

    for page in reader.pages:
        current_code = None
        current_sec = None
        for row in page_rows(page):
            code_cell = next((t for x, t in row if x < X_CODE_MAX and CODE_RE.match(t)), None)
            if code_cell:
                current_code = CODE_RE.match(code_cell).group(1)
                current_sec = None   # ขึ้นวิชาใหม่ กลุ่มเริ่มนับใหม่

            # วิชาที่เปิดหลายกลุ่มจะมี "SEC. n" คั่น แต่ละกลุ่มเรียนคนละวันคนละห้อง
            # ต้องเก็บไว้ ไม่งั้นนักศึกษากลุ่ม 2 จะได้ตารางของกลุ่ม 1
            sec_cell = [t for x, t in row if X_SEC[0] <= x < X_SEC[1]]
            if sec_cell:
                digits = next((t for t in sec_cell if t.strip().isdigit()), None)
                if digits:
                    current_sec = int(digits)

            session_cell = next((t for x, t in row if X_SESSION[0] <= x < X_SESSION[1] and SESSION_RE.match(t)), None)
            if not session_cell:
                continue

            # คาบที่โผล่มาก่อนเจอรหัสวิชาแรกของหน้า = จับคู่ไม่ได้ ทิ้งแล้วนับไว้
            # ถ้าตัวเลขนี้ไม่ใช่ 0 แปลว่าอ่านโครงหน้าผิด ต้องกลับมาดู ไม่ใช่ปล่อยผ่าน
            if not current_code:
                orphan_sessions += 1
                continue

            day, start, end = SESSION_RE.match(session_cell).groups()
            room = next((t for x, t in row if X_ROOM[0] <= x < X_ROOM[1]), None)

            sessions.append({
                'course_code': current_code,
                'section': current_sec,
                'day': 'SU' if day == 'SUN' else day,
                'start_time': hhmm(start),
                'end_time': hhmm(end),
                'room': room,
                # รหัสอาคารจากชื่อห้อง ใช้ผูกปุ่มนำทาง — "KTB 201" -> "KTB"
                'building_code': (ROOM_RE.match(room).group(1) if room and ROOM_RE.match(room) else None),
            })

    # กันคาบซ้ำ (บางวิชาถูกพิมพ์ซ้ำข้ามหน้า)
    seen, unique = set(), []
    for s in sessions:
        key = (s['course_code'], s['section'], s['day'], s['start_time'], s['end_time'], s['room'])
        if key in seen:
            continue
        seen.add(key)
        unique.append(s)

    by_course = defaultdict(list)
    for s in unique:
        by_course[s['course_code']].append(s)

    doc = {
        'term': args.term,
        'source_pdf': args.pdf.split('/')[-1],
        'total_courses': len(by_course),
        'total_sessions': len(unique),
        'sessions': unique,
    }
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    print(f'เขียน {args.out}')
    print(f'  วิชาที่มีตารางเรียน  {len(by_course)}')
    print(f'  คาบเรียนทั้งหมด      {len(unique)}  (ซ้ำที่ตัดทิ้ง {len(sessions) - len(unique)})')
    print(f'  วิชาที่เรียนหลายคาบ  {sum(1 for v in by_course.values() if len(v) > 1)}')
    print(f'  คาบที่ไม่มีห้องเรียน  {sum(1 for s in unique if not s["room"])}')
    multi_sec = {c: len({x["section"] for x in v if x["section"]}) for c, v in by_course.items()}
    print(f'  วิชาที่เปิดหลายกลุ่ม  {sum(1 for n in multi_sec.values() if n > 1)}')
    if orphan_sessions:
        print(f'  ** คาบที่จับคู่วิชาไม่ได้ {orphan_sessions} — อ่านโครงหน้าผิด อย่าใช้ผลลัพธ์', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
