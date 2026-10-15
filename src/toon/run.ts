// 공감툰 만들기: 대본(JSON) → 컷 그림 생성(글씨 없이) → 말풍선을 얹어 PNG → 슬랙
// 사용법:
//   그림체 시험: node src/toon/run.ts --episode content/toon/xxx.json --mode style-test
//     그림체마다 1컷과 3컷만 만든다 (1컷을 기준으로 3컷을 그려서 인물이 이어지는지도 본다)
//   한 편 전체: node src/toon/run.ts --episode content/toon/xxx.json --mode full --style A
//   API 없이 배치만 확인: --placeholder assets/sitcom/base.png (그림 대신 이 이미지를 쓴다, 슬랙 안 보냄)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { generateWithRetry } from '../pipeline/images.ts';
import { sendCards, sendText } from '../pipeline/slack.ts';
import { buildPanelHtml, type Episode, type Panel } from './template.ts';

const WIDTH = 1080;
const HEIGHT = 1440;
// 3:4에 가깝고 가로세로가 16의 배수인 크기 (gpt-image-2는 임의 크기를 받는다)
const IMAGE_SIZE = '1056x1408';
const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2';
const IMAGE_QUALITY = process.env.IMAGE_QUALITY ?? 'medium';

// 그림체 후보. 시험 결과를 보고 하나를 고른다.
const STYLES: Record<string, string> = {
  A: '심플한 한국 인스타툰 그림체. 굵고 깔끔한 검은 외곽선, 동글동글하고 단순한 2~3등신 캐릭터, 파스텔 톤의 평평한 단색 채색, 그림자 거의 없음, 배경은 꼭 필요한 사물만 단순하게.',
  B: '현대 한국 웹툰 그림체. 깔끔한 선화와 셀 채색, 자연스러운 6등신 인물, 과장된 표정 연출, 사무실 배경을 적당히 자세하게.',
  C: '손으로 그린 낙서 감성 그림체. 연필 · 크레용 질감의 삐뚤빼뚤한 선, 아주 단순한 캐릭터, 흰 종이 배경에 부분적으로만 색칠.',
};

const RULES =
  // 첫 시험(10/15)에서 "위쪽 4분의 1을 비워라"고 했더니 절반 가까이 비워서 인물이 작아졌다 → 비우는 범위를 줄이고 인물 크기를 정한다
  '세로 3:4 한 컷 만화. 맨 위 15% 정도만 벽이나 하늘처럼 단순하게 두고(말풍선 자리), 나머지는 장면으로 꽉 채울 것. 인물은 상반신 위주로 크게, 화면 높이의 절반 이상을 차지하게 그리고 표정이 잘 보이게 할 것. 그림 안에 글자, 숫자, 말풍선, 효과음 글씨, 로고, 워터마크를 절대 넣지 말 것. 실존 인물을 닮은 얼굴 금지.';

const buildPrompt = (episode: Episode, panel: Panel, style: string, withReference: boolean): string =>
  [
    `그림체: ${STYLES[style]}`,
    `등장인물: ${episode.cast}`,
    `장소: ${episode.setting}`,
    `이 컷의 장면: ${panel.scene}`,
    withReference
      ? '함께 준 그림은 같은 만화의 앞 컷이다. 인물의 얼굴, 머리 모양, 옷, 그림체, 색감을 그대로 유지하고 장면만 새로 그릴 것.'
      : '',
    RULES,
  ]
    .filter(Boolean)
    .join('\n');

type ImageResponse = { data?: { b64_json?: string }[]; error?: { message?: string } };

// 기준 그림을 함께 넣어 새 컷을 그린다 (images/edits, JSON 본문)
const editOnce = async (prompt: string, reference: Buffer): Promise<Buffer> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      images: [{ image_url: `data:image/png;base64,${reference.toString('base64')}` }],
      size: IMAGE_SIZE,
      quality: IMAGE_QUALITY,
      n: 1,
    }),
    signal: AbortSignal.timeout(240000),
  });
  const body = (await response.json()) as ImageResponse;
  const b64 = body.data?.[0]?.b64_json;
  if (!response.ok || !b64) {
    throw new Error(`이미지 편집 실패 (HTTP ${response.status}): ${body.error?.message ?? '알 수 없는 오류'}`);
  }
  return Buffer.from(b64, 'base64');
};

const editWithRetry = async (prompt: string, reference: Buffer): Promise<Buffer> => {
  try {
    return await editOnce(prompt, reference);
  } catch (error) {
    console.warn('컷 그림을 다시 시도합니다:', error instanceof Error ? error.message : error);
    return editOnce(prompt, reference);
  }
};

// 첫 컷은 새로 그리고, 나머지 컷은 첫 컷을 기준 그림으로 넣어 동시에 그린다
const drawPanels = async (
  episode: Episode,
  indexes: number[],
  style: string,
  placeholder: Buffer | undefined,
): Promise<Buffer[]> => {
  if (placeholder) return indexes.map(() => placeholder);
  const [first, ...rest] = indexes;
  const firstImage = await generateWithRetry(buildPrompt(episode, episode.panels[first], style, false), IMAGE_SIZE);
  const restImages = await Promise.all(
    rest.map((i) => editWithRetry(buildPrompt(episode, episode.panels[i], style, true), firstImage)),
  );
  return [firstImage, ...restImages];
};

// 그림에 말풍선을 얹어 PNG로 저장한다
const renderPanels = async (
  episode: Episode,
  indexes: number[],
  images: Buffer[],
  outDir: string,
): Promise<string[]> => {
  await mkdir(outDir, { recursive: true });
  const channel = process.env.CI ? undefined : 'msedge';
  const browser = await chromium.launch({ channel });
  const files: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    for (const [n, i] of indexes.entries()) {
      // 원본 그림도 남겨 둔다 (말풍선 위치만 바꿔 다시 렌더할 때 쓴다)
      await writeFile(path.join(outDir, `art-${String(i + 1).padStart(2, '0')}.png`), images[n]);
      const dataUrl = `data:image/png;base64,${images[n].toString('base64')}`;
      await page.setContent(buildPanelHtml(dataUrl, episode.panels[i], i, episode.panels.length), {
        waitUntil: 'networkidle',
      });
      await page.evaluate(() => document.fonts.ready);
      const filePath = path.join(outDir, `${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: filePath });
      files.push(filePath);
    }
  } finally {
    await browser.close();
  }
  return files;
};

const main = async (): Promise<void> => {
  const { values } = parseArgs({
    options: {
      episode: { type: 'string' },
      mode: { type: 'string', default: 'style-test' },
      style: { type: 'string', default: 'A' },
      placeholder: { type: 'string' },
    },
  });
  if (!values.episode) throw new Error('--episode 대본 경로가 필요합니다.');
  const episode = JSON.parse(await readFile(values.episode, 'utf-8')) as Episode;
  const placeholder = values.placeholder ? await readFile(values.placeholder) : undefined;
  const sendSlack = !placeholder;
  const started = Date.now();

  if (values.mode === 'style-test') {
    // 1컷과 3컷 (3컷이 없으면 마지막 컷)
    const indexes = [0, Math.min(2, episode.panels.length - 1)];
    const results = await Promise.allSettled(
      Object.keys(STYLES).map(async (style) => {
        const images = await drawPanels(episode, indexes, style, placeholder);
        const files = await renderPanels(episode, indexes, images, path.join('output', 'toon', episode.slug, `style-${style}`));
        return { style, files };
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('그림체 시험 실패:', result.reason);
        if (sendSlack) await sendText(`🎨 툰 그림체 시험 중 하나가 실패했어요: ${String(result.reason).slice(0, 300)}`);
        continue;
      }
      const { style, files } = result.value;
      files.forEach((f) => console.log(`저장: ${f}`));
      if (sendSlack) {
        await sendCards(files, `🎨 툰 그림체 ${style}: ${STYLES[style].split('.')[0]}\n「${episode.title}」 1컷 · 3컷`, files.map((_, n) => `그림체 ${style} - ${n === 0 ? '1컷' : '3컷'}`));
      }
    }
    if (results.every((r) => r.status === 'rejected')) throw new Error('모든 그림체 시험이 실패했습니다.');
  } else if (values.mode === 'full') {
    const style = values.style ?? 'A';
    if (!STYLES[style]) throw new Error(`없는 그림체입니다: ${style}`);
    const indexes = episode.panels.map((_, i) => i);
    const images = await drawPanels(episode, indexes, style, placeholder);
    const outDir = path.join('output', 'toon', episode.slug, 'full');
    const files = await renderPanels(episode, indexes, images, outDir);
    const captionFile = path.join(outDir, 'caption.txt');
    await writeFile(captionFile, episode.caption);
    files.forEach((f) => console.log(`저장: ${f}`));
    if (sendSlack) await sendCards([...files, captionFile], `🖍️ 오늘의 툰 「${episode.title}」 (${files.length}컷, 그림체 ${style})\n문구는 맨 아래 텍스트 파일에서 복사하세요.`);
  } else {
    throw new Error(`알 수 없는 mode입니다: ${values.mode} (style-test 또는 full)`);
  }
  console.log(`걸린 시간: ${Math.round((Date.now() - started) / 1000)}초`);
};

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('툰 만들기 실패:', message);
  if (process.env.SLACK_BOT_TOKEN) await sendText(`⚠️ 툰 만들기 실패: ${message.slice(0, 500)}`).catch(() => {});
  process.exit(1);
}
