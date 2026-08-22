// Static server สำหรับพัฒนา LIFF บนเครื่องตัวเอง — zero dependency (ใช้แค่ node)
//
// มีไว้เพราะ ?dev=1 ใน liff/app.js ทำงานเฉพาะ localhost เท่านั้น (ดูคอมเมนต์ DEV_MODE ที่นั่น)
// จึงต้องมีวิธีเสิร์ฟไฟล์ LIFF จาก localhost ที่ commit ไว้ใน repo ให้ทุกคนในทีมใช้ได้เหมือนกัน
// ไม่ใช่ path ชั่วคราวบนเครื่องใครเครื่องหนึ่ง
//
// รัน: node scripts/serve-liff.mjs [dir] [port]   (ดีฟอลต์ liff/ พอร์ต 8123)
// หรือ: cd liff && npm run dev
//
// ทางเลือกที่ใกล้ production กว่า: cd liff && npm run dev:wrangler (เสิร์ฟผ่าน workerd จริง
// ตาม liff/wrangler.jsonc) — ตัวนี้เอาไว้ใช้ตอนอยากได้ของเบาๆ ที่ไม่ต้องมี node_modules

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.resolve(ROOT_DIR, process.argv[2] || 'liff');
const port = Number(process.argv[3] || 8123);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${port}`);
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');

  // กัน path traversal (../) — resolve แล้วต้องยังอยู่ใต้ dir เท่านั้น
  const filePath = path.resolve(dir, relative);
  if (filePath !== dir && !filePath.startsWith(dir + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
  }
});

server.listen(port, () => {
  console.log(`LIFF dev server: http://localhost:${port}/?dev=1`);
  console.log(`  เสิร์ฟจาก: ${dir}`);
  console.log(`  จำลองพิกัดอื่น: http://localhost:${port}/?dev=1&lat=13.7000&lng=100.5000`);
});
