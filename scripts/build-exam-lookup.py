#!/usr/bin/env python3
"""data/exam-schedule.json -> data/exam-lookup.json (+ สำเนาใน liff/data/)

รูปแบบกะทัดรัดที่ระบบใช้งานจริง: worker import เข้า bundle ส่วน LIFF fetch เป็นไฟล์ static
ประมาณ 10 KB หลัง gzip เทียบกับไฟล์เต็มที่ 400 KB

ไฟล์นี้เป็น "แหล่งความจริงเดียว" ของเวลาคาบสอบด้วย (period_times) เพราะทั้งสองฝั่งโหลดอยู่แล้ว
ก่อนหน้านี้เวลาคาบถูกประกาศซ้ำ 3 ที่ในโค้ดแล้วเพี้ยนกันจริง

ใช้: python3 scripts/build-exam-lookup.py
     python3 scripts/build-exam-lookup.py --period-a '09:00 - 12:00 น.' --period-b '14:00 - 16:30 น.'
"""
import argparse, json, os, sys

OUT_PATHS = ['data/exam-lookup.json', 'liff/data/exam-lookup.json']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default='data/exam-schedule.json')
    ap.add_argument('--period-a', default='09:00 - 12:00 น.')
    ap.add_argument('--period-b', default='14:00 - 16:30 น.')
    args = ap.parse_args()

    with open(args.source, encoding='utf-8') as f:
        src = json.load(f)

    # ค่าเป็น YYYY-MM-DD ตามด้วยตัวอักษรคาบ ("2026-10-26A") — null คือคณะจัดสอบเองหรือไม่ระบุ
    courses = {}
    for entry in src['courses']:
        courses[entry['course_code']] = (
            entry['exam_date'] + ''.join(entry['periods']) if entry['exam_date'] else None
        )

    doc = {
        'term': src['term'],
        'source_pdf': src['source_pdf'],
        'note': 'ค่าเป็น YYYY-MM-DD ตามด้วยคาบ (A/B) — null คือคณะจัดสอบเองหรือไม่ระบุวันสอบ',
        'period_times': {'A': args.period_a, 'B': args.period_b},
        'exam_dates': src['exam_dates'],
        'courses': courses,
    }

    for path in OUT_PATHS:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        print(f'  {path}: {len(courses)} วิชา, {os.path.getsize(path) // 1024} KB')

    print(f"  เวลาคาบ: A = {args.period_a} | B = {args.period_b}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
