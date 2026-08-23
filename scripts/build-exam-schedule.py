#!/usr/bin/env python3
"""แปลงตารางสอบ PDF ของ ม.รามคำแหง -> data/exam-schedule.json

อ่านจาก "พิกัดจริงบนหน้ากระดาษ" ไม่ใช่ลำดับบรรทัดที่ extract_text() คายออกมา เพราะลำดับบรรทัด
เชื่อไม่ได้ — หน้า 1 คาย 26 รหัสวิชาแต่ 25 วันสอบ ทำให้วันสอบเลื่อนขึ้นหนึ่งช่องตั้งแต่กลางหน้า
(ACC4252 ได้วันของ ACC4246, ACC4344 กลายเป็นไม่มีวันสอบ ทั้งที่ในไฟล์มีอยู่) จับคู่ตามแกน Y
แทน แล้วใช้คอลัมน์ "ลำดับที่" เป็น checksum ว่าต้องได้ 1..N ครบเรียงโดยไม่ขาดไม่ซ้ำ

ใช้: python3 scripts/build-exam-schedule.py <ไฟล์.pdf> [-o data/exam-schedule.json]
"""
import argparse, json, re, sys
from collections import defaultdict
from pypdf import PdfReader

DATE_RE = re.compile(r'^(M|TU|W|TH|F|S|SUN)\s+(\d{1,2})\s+([A-Z]{3})\.?\s+(\d{4})\s+([AB](?:,[AB])*)$')
CODE_RE = re.compile(r'^([A-Z]{2,4}\d{4})\((\d)\)$')
MONTHS = {'JAN':1,'FEB':2,'MAR':3,'APR':4,'MAY':5,'JUN':6,
          'JUL':7,'AUG':8,'SEP':9,'OCT':10,'NOV':11,'DEC':12}
SELF_ADMINISTERED = 'คณะจัดสอบเอง'
Y_TOLERANCE = 2.0   # ตัวอักษรในแถวเดียวกัน baseline ต่างกันได้เล็กน้อย (เจอจริงสุด ~0.3pt)


def extract_cells(page):
    cells = []
    def visitor(text, cm, tm, font_dict, font_size):
        t = text.strip()
        if t:
            cells.append((tm[5], tm[4], t))   # (y, x, text)
    page.extract_text(visitor_text=visitor)
    return cells


def group_rows(cells):
    """รวม cell ที่ baseline ใกล้กันเป็นแถวเดียว คืนลิสต์ของ [(x, text), ...] เรียงจากบนลงล่าง"""
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


def parse_row(texts):
    """คืน (ลำดับที่, รหัสวิชา, หน่วยกิต, ข้อความวันสอบ) หรือ None ถ้าไม่ใช่แถวข้อมูล"""
    idx = code = credits = when = None
    for t in texts:
        if t.isdigit() and idx is None:
            idx = int(t)
            continue
        m = CODE_RE.match(t)
        if m:
            code, credits = m.group(1), int(m.group(2))
            continue
        if t == SELF_ADMINISTERED or DATE_RE.match(t):
            when = t
    if idx is None or code is None:
        return None
    return idx, code, credits, when


def to_iso_date(m):
    return f"{int(m.group(4))}-{MONTHS[m.group(3)]:02d}-{int(m.group(2)):02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('-o', '--out', default='data/exam-schedule.json')
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    entries, skipped = [], []
    for page in reader.pages:
        for texts in ((t for _, t in row) for row in group_rows(extract_cells(page))):
            texts = list(texts)
            parsed = parse_row(texts)
            if parsed is None:
                continue
            idx, code, credits, when = parsed
            entry = {'seq': idx, 'course_code': code, 'credits': credits}
            m = DATE_RE.match(when) if when else None
            if m:
                entry['exam_date'] = to_iso_date(m)
                entry['periods'] = m.group(5).split(',')
            else:
                entry['exam_date'] = None
                entry['periods'] = []
                # ช่องวันสอบว่างจริงในไฟล์ (เจอกับวิชา 0 หน่วยกิตอย่าง ACC3255) ต้องเก็บแถวไว้
                # ไม่ใช่ข้าม ไม่งั้น checksum ลำดับที่จะพัง และที่แย่กว่าคือถ้าไปจับคู่ตามลำดับบรรทัด
                # แถวถัดๆ ไปจะรับวันสอบของแถวอื่นมาทั้งหน้า
                entry['note'] = SELF_ADMINISTERED if when else 'ไม่ระบุวันสอบ'
                if not when:
                    skipped.append((idx, code))
            entries.append(entry)

    entries.sort(key=lambda e: e['seq'])
    seqs = [e['seq'] for e in entries]
    expected = list(range(1, len(seqs) + 1))
    if seqs != expected:
        missing = sorted(set(expected) - set(seqs))
        dupes = sorted({s for s in seqs if seqs.count(s) > 1})
        print(f'checksum ลำดับที่ ไม่ผ่าน — ขาด {missing[:10]} ซ้ำ {dupes[:10]}', file=sys.stderr)
        return 1

    dated = [e for e in entries if e['exam_date']]
    doc = {
        'source_pdf': args.pdf.split('/')[-1],
        'term': '1/2569',
        'total_courses': len(entries),
        'centrally_scheduled': len(dated),
        'faculty_administered': len(entries) - len(dated),
        'exam_dates': sorted({e['exam_date'] for e in dated}),
        'courses': entries,
    }
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    print(f"เขียน {args.out}")
    print(f"  วิชาทั้งหมด        {doc['total_courses']}")
    print(f"  มีวันสอบส่วนกลาง   {doc['centrally_scheduled']}")
    print(f"  คณะจัดสอบเอง       {doc['faculty_administered']}")
    print(f"  ช่วงวันสอบ         {doc['exam_dates'][0]} ถึง {doc['exam_dates'][-1]} ({len(doc['exam_dates'])} วัน)")
    if skipped:
        print(f"  แถวที่ไม่มีคอลัมน์วันสอบเลย {len(skipped)}: {skipped[:5]}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
