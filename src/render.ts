// 카드 내용(JSON)을 읽어 슬라이드마다 1080x1440 PNG로 저장한다.
// 사용법: node src/render.ts content/samples/hallucination.json
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { buildSlideHtml, type CardContent, type Slide } from './templates.ts';

// 인스타그램 프로필 격자(3:4)에 맞춘 세로형 1080x1440. 4:5로 만들면 격자에서 좌우가 잘려 보인다.
// 한 게시물의 모든 장은 같은 비율이어야 한다. 3:4면 격자에서 잘리지 않지만,
// 가장자리가 잘리는 화면을 대비해 중요한 글자는 좌우 여백 안쪽에 둔다.
const WIDTH = 1080;
const HEIGHT = 1440;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// 로컬 이미지 파일은 data 주소로 바꿔서 HTML에 직접 넣는다. (주소로 된 이미지는 그대로 둔다.)
const resolveImage = async (image: string, baseDir: string): Promise<string> => {
  if (/^(https?:|data:)/.test(image)) return image;

  const filePath = path.resolve(baseDir, image);
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mime) throw new Error(`지원하지 않는 이미지 형식입니다: ${image}`);

  const data = await readFile(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
};

// 표지와 내용 장의 이미지 경로를 모두 data 주소로 바꾼다
const resolveSlide = async (slide: Slide, baseDir: string): Promise<Slide> => {
  if ('image' in slide && slide.image) {
    return { ...slide, image: await resolveImage(slide.image, baseDir) };
  }
  return slide;
};

// 카드 내용을 PNG로 저장하고, 저장한 파일 경로 목록을 돌려준다.
// baseDir은 카드 JSON 안의 이미지 경로를 해석할 기준 폴더다.
export const renderCard = async (
  content: CardContent,
  baseDir: string,
  outDir: string,
): Promise<string[]> => {
  await mkdir(outDir, { recursive: true });

  // 내 컴퓨터에서는 설치된 Edge를 쓰고, 클라우드(CI)에서는 내려받은 Chromium을 쓴다
  const channel = process.env.CI ? undefined : 'msedge';
  const browser = await chromium.launch({ channel });
  const files: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

    // 사진 경로를 먼저 모두 처리해 두고, 마지막 장이 표지 배경을 다시 쓸 수 있게 한다
    const slides = await Promise.all(content.slides.map((s) => resolveSlide(s, baseDir)));
    const cover = slides.find((s): s is Extract<Slide, { type: 'cover' }> => s.type === 'cover');

    for (const [index, slide] of slides.entries()) {
      const html = buildSlideHtml(slide, index, slides.length, content.brand, cover, content.theme, content.palette);
      await page.setContent(html, { waitUntil: 'networkidle' });
      // 폰트가 모두 불러와진 뒤에 촬영한다
      await page.evaluate(() => document.fonts.ready);

      const filePath = path.join(outDir, `${String(index + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: filePath });
      files.push(filePath);
    }
  } finally {
    await browser.close();
  }
  return files;
};

// 직접 실행하면 JSON 파일 하나를 카드로 만든다
const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isDirectRun) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('카드 내용 JSON 경로를 입력하세요. 예: node src/render.ts content/samples/hallucination.json');
    process.exit(1);
  }
  const content = JSON.parse(await readFile(inputPath, 'utf-8')) as CardContent;
  const baseDir = path.dirname(path.resolve(inputPath));
  try {
    const files = await renderCard(content, baseDir, path.join('output', content.slug));
    files.forEach((f) => console.log(`저장: ${f}`));
  } catch (error: unknown) {
    console.error('렌더링 실패:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
