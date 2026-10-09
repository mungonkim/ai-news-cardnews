// 하루치 카드뉴스를 처음부터 끝까지 만든다.
// 사용법: node src/run.ts [--url 기사주소] [--no-images] [--no-slack]
//   --url        기사 선정을 건너뛰고 이 기사로 만든다
//   --no-images  이미지 API를 쓰지 않는다 (표지는 그래픽 표지로 대체)
//   --no-slack   슬랙으로 보내지 않고 폴더에만 저장한다
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectCandidates } from './pipeline/collect.ts';
import { generateImages } from './pipeline/images.ts';
import { sendCards, sendText } from './pipeline/slack.ts';
import { selectArticle, verifyArticle, writeCard } from './pipeline/steps.ts';
import { renderCard } from './render.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const COVERED_PATH = path.join(ROOT, 'data', 'covered-articles.json');

type CoveredArticle = { date: string; slug: string; topic: string; sources: string[]; note?: string };

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(name);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const log = (message: string): void => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${message}`);

const run = async (): Promise<void> => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const covered = JSON.parse(await readFile(COVERED_PATH, 'utf-8')) as CoveredArticle[];

  // 1. 기사 선정
  log('기사 후보를 모으는 중');
  const { candidates, failures } = await collectCandidates();
  log(`후보 ${candidates.length}건 (실패한 피드 ${failures.length}곳)`);
  const selection = await selectArticle(candidates, covered, option('--url'));
  log(`선정: ${selection.title}`);

  // 2. 사실 확인
  log('공식 원문으로 사실 확인 중');
  const facts = await verifyArticle(selection);
  log(`확인된 사실 ${facts.facts.length}건, 확인하지 못한 내용 ${facts.unverified.length}건`);

  // 3. 카드 작성
  const slug = `${today}-${selection.slug}`;
  const outDir = path.join(ROOT, 'output', slug);
  await mkdir(outDir, { recursive: true });
  log('카드 내용과 게시물 문구를 작성하는 중');
  const written = await writeCard(selection, facts, slug, path.join(ROOT, 'prompts'));

  // 4. 이미지 생성
  if (flag('--no-images')) {
    log('이미지 생성을 건너뜁니다 (그래픽 표지 사용)');
  } else {
    log(`이미지 ${written.images.length}장 생성 중`);
    const generated = await generateImages(written.images, path.join(outDir, 'assets'));
    for (const [index, file] of generated) {
      const slide = written.card.slides[index];
      // 이미지를 넣을 수 있는 장 종류에만 붙인다 (요약, 마지막 장 제외)
      if (['cover', 'point', 'term', 'meaning'].includes(slide.type)) Object.assign(slide, { image: file });
    }
  }
  await writeFile(path.join(outDir, 'card.json'), JSON.stringify(written.card, null, 2));

  // 5. 카드 렌더링
  log('카드 이미지를 만드는 중');
  const files = await renderCard(written.card, outDir, path.join(outDir, 'cards'));

  // 6. 게시물 문구와 확인용 정보 저장
  const experience = selection.experienceCandidate ? `\n\n🧪 체험 후보: ${selection.experienceNote}` : '';
  const unverified = facts.unverified.length > 0 ? `\n\n⚠️ 확인하지 못해 뺀 내용:\n${facts.unverified.map((u) => `- ${u}`).join('\n')}` : '';
  const sourceLines = facts.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n');
  await writeFile(path.join(outDir, 'caption.txt'), written.caption);
  await writeFile(path.join(outDir, 'report.md'), `# ${selection.title}\n\n선정 이유: ${selection.reason}\n\n출처:\n${sourceLines}${experience}${unverified}\n`);

  // 7. 슬랙 알림
  const message = `📰 *오늘의 카드뉴스가 완성됐어요* (${today})\n*${selection.title}*\n선정 이유: ${selection.reason}\n\n*출처*\n${sourceLines}${experience}${unverified}\n\n*게시물 문구 (복사해서 붙여넣기)*\n\`\`\`\n${written.caption}\n\`\`\`\n업로드 전 사실과 문구를 한 번 확인해 주세요.`;
  if (flag('--no-slack')) {
    log(`슬랙 전송을 건너뜁니다. 결과: ${outDir}`);
  } else {
    await sendCards(files, message);
    log('슬랙으로 보냈습니다');
  }

  // 8. 다룬 기사 기록 (중복 방지)
  covered.push({
    date: today,
    slug,
    topic: selection.title,
    sources: facts.sources.map((s) => s.url),
    note: selection.reason,
  });
  await writeFile(COVERED_PATH, `${JSON.stringify(covered, null, 2)}\n`);
  log('완료');
};

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('실패:', message);
  // 실패해도 알림은 받아야 하므로 슬랙으로 알리고(가능하면), 실패로 종료한다
  if (!flag('--no-slack')) {
    await sendText(`⚠️ 카드뉴스 생성에 실패했어요 (${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })})\n${message}`).catch(() => undefined);
  }
  process.exit(1);
}
