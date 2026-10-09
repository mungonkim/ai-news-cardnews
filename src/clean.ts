// output 폴더에서 날짜가 붙은 결과물 중 3일이 지난 것을 지운다.
// 사용법: npm run clean   (오늘 포함 최근 3일치만 남긴다)
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const KEEP_DAYS = 3;
const outputDir = path.resolve(import.meta.dirname, '..', 'output');

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const limit = new Date(`${today}T00:00:00+09:00`).getTime() - (KEEP_DAYS - 1) * 24 * 60 * 60 * 1000;

const entries = await readdir(outputDir, { withFileTypes: true });
for (const entry of entries) {
  // 2026-10-09-이름 형식의 폴더만 대상으로 한다 (profile, sample 등은 건드리지 않는다)
  const match = entry.isDirectory() ? entry.name.match(/^(\d{4}-\d{2}-\d{2})-/) : null;
  if (!match) continue;
  if (new Date(`${match[1]}T00:00:00+09:00`).getTime() < limit) {
    await rm(path.join(outputDir, entry.name), { recursive: true, force: true });
    console.log(`삭제: ${entry.name}`);
  }
}
console.log(`최근 ${KEEP_DAYS}일치만 남겼습니다.`);
