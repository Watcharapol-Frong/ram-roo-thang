#!/usr/bin/env bash
# Seed data/baseline-dataset.json เข้า BASELINE_DATA KV namespace
#
# ⚠️ เช็ค syntax `wrangler kv key put` กับ wrangler version ที่ใช้จริงก่อนรัน (README "เริ่มงาน (Setup)")
#    เขียนไว้สำหรับ wrangler v3 — เวอร์ชันอื่นอาจต้องแก้ flag
#
# ก่อนรัน: ต้องมี jq ติดตั้งไว้, ต้อง `npx wrangler kv namespace create BASELINE_DATA` แล้ว
# และใส่ id จริงใน worker/wrangler.toml เรียบร้อยแล้ว
#
# รันจาก root ของ repo: ./scripts/seed-kv.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_FILE="$ROOT_DIR/data/baseline-dataset.json"
WORKER_DIR="$ROOT_DIR/worker"

if ! command -v jq >/dev/null 2>&1; then
  echo "ต้องติดตั้ง jq ก่อน (brew install jq / apt install jq)" >&2
  exit 1
fi

cd "$WORKER_DIR"

echo "Seeding buildings..."
jq -c '.buildings[]' "$DATA_FILE" | while read -r building; do
  building_id=$(echo "$building" | jq -r '.building_id')
  echo "  building:$building_id"
  npx wrangler kv key put "building:$building_id" "$building" --binding=BASELINE_DATA
done

echo "Seeding parking zones..."
jq -c '.parking_zones[]' "$DATA_FILE" | while read -r zone; do
  zone_id=$(echo "$zone" | jq -r '.zone_id')
  echo "  parking_zone:$zone_id"
  npx wrangler kv key put "parking_zone:$zone_id" "$zone" --binding=BASELINE_DATA
done

# services ว่างอยู่จนกว่าทีมจะกรอกข้อมูลจริง (docs/adr/0004) — loop นี้จะไม่ทำอะไรเลยจนกว่านั้น
echo "Seeding services..."
jq -c '.services[]' "$DATA_FILE" | while read -r service; do
  service_id=$(echo "$service" | jq -r '.service_id')
  echo "  service:$service_id"
  npx wrangler kv key put "service:$service_id" "$service" --binding=BASELINE_DATA
done

# poi ยังไม่มี KV namespace/endpoint รองรับ (community submission + moderation — ยังไม่เริ่มพัฒนา)
# จึงตั้งใจไม่ seed ตรงนี้ ดู docs/adr/0004

echo "Done."
