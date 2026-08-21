// แปลง data/baseline-seed.json ให้เป็นรูปแบบที่ `wrangler kv bulk put` ใช้ได้
// แล้วพิมพ์คำสั่งให้รันต่อ (ไม่ยิงเข้า Cloudflare เอง)
//
// วิธีใช้:
//   1. คัดลอก data/baseline-seed.example.json -> data/baseline-seed.json แล้วแก้ข้อมูลจริง
//   2. node scripts/seed-baseline.mjs
//   3. รันคำสั่ง wrangler ที่พิมพ์ออกมา

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, '..', 'data', 'baseline-seed.json');
const outputPath = path.join(__dirname, '..', 'data', 'baseline-seed.bulk.json');

async function main() {
  const raw = await readFile(inputPath, 'utf-8');
  const seed = JSON.parse(raw);

  const entries = [
    ...seed.buildings.map((b) => ({
      key: `building:${b.building_id}`,
      value: JSON.stringify(b),
    })),
    ...seed.parking_zones.map((z) => ({
      key: `parking_zone:${z.zone_id}`,
      value: JSON.stringify(z),
    })),
  ];

  await writeFile(outputPath, JSON.stringify(entries, null, 2));

  console.log(`เขียน ${entries.length} entries ไปที่ ${outputPath}`);
  console.log('รันคำสั่งนี้เพื่ออัปโหลดเข้า BASELINE_DATA KV namespace:');
  console.log(`  wrangler kv bulk put ${outputPath} --binding=BASELINE_DATA`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
