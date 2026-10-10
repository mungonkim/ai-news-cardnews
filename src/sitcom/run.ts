// AI 시트콤 한 편 만들기: 기준 장면 이미지 → 구간별 영상(Higgsfield, Kling 3.0) → 편집(자막, 배너) → 슬랙 전송.
// 사용법: node src/sitcom/run.ts [대본 JSON 경로]  (예: content/sitcom/2026-10-10-one-word-email.json)
//   경로를 비우면 content/sitcom/에서 아직 만들지 않은 대본 중 가장 이른 것을 고른다 (매주 월요일 자동 실행)
//   --no-slack  슬랙으로 보내지 않는다
// 필요한 설정: HIGGSFIELD_API_KEY, OPENAI_API_KEY(기준 이미지가 없을 때만), SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateWithRetry } from '../pipeline/images.ts';
import { sendCards, sendText } from '../pipeline/slack.ts';
import { editSitcom, type SubtitleShot } from './edit.ts';
import { download, estimate, generate, uploadFile } from './higgsfield.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
// 영상 모델: Kling 3.0 표준, 이미지 → 영상 (컷 나누기와 소리 지원)
const VIDEO_ENDPOINT = process.env.SITCOM_VIDEO_ENDPOINT ?? 'kling-video/v3.0/std/image-to-video';
// 매 편 같은 강아지와 여자가 나오도록 기준 장면 이미지를 한 번 만들어 저장해 두고 계속 쓴다
const BASE_IMAGE = path.join(ROOT, 'assets', 'sitcom', 'base.png');
const EPISODE_DIR = path.join(ROOT, 'content', 'sitcom');
// 이미 만든 편의 slug 목록 (같은 대본을 두 번 만들지 않게 한다)
const MADE_FILE = path.join(ROOT, 'data', 'sitcom-made.json');
const ACCOUNT_HANDLE = '@ai_chingu';

// 등장인물과 세트 (모든 컷에 같은 설명을 붙여 모습이 바뀌지 않게 한다)
const CAST = `Characters: a photorealistic Shiba Inu dog named Aki (red-orange fur, cream chest and cheeks, deadpan confident face, red collar with a small silver tag) and a fictional American woman in her early 30s named Dana (curly brown bob, round glasses, mustard yellow cardigan over a white shirt, jeans). Dana is not based on any real person.`;
const SET = `Set: a 1990s American multi-camera sitcom living room with a plaid sofa, wood-paneled walls, a warm orange floor lamp, curtains, a low TV cabinet with a boxy CRT TV, and a beige 1990s laptop on the coffee table in front of the dog.`;
const STYLE = `Look: 1990s sitcom on film, warm color, soft studio lighting, slight film grain, realistic fur and skin, natural lip and mouth movement when speaking. Dialogue is spoken in English exactly as written. Characters move their mouths only while saying their own line; as soon as the line ends, the speaker closes its mouth and stays still and silent. The dog's mouth stays closed whenever it is not speaking, including while the audience laughs. Like a real 1990s sitcom, there is no background music under dialogue; music plays only in shots that explicitly ask for a short sitcom transition riff. No subtitles, no captions, no on-screen text, no logos.`;

const BASE_IMAGE_PROMPT = `Vertical photo, a wide straight-on shot from a 1990s American multi-camera sitcom. ${SET} ${CAST} The Shiba Inu sits on the sofa behind the open laptop, looking calm. The woman stands beside the sofa, turned toward the dog. Warm 1990s film color, slight grain, soft studio lighting. No text, no logos, no watermark.`;

type Shot = SubtitleShot & { prompt: string };
// banner: 영상 위쪽 제목. 기본은 넣지 않는다 (사용자 결정, 2026-10-10). 필요할 때만 적는다
type Episode = { slug: string; banner?: string; segments: { shots: Shot[] }[]; caption: string };

const log = (message: string): void => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${message}`);
const flag = (name: string): boolean => process.argv.includes(name);

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

const ensureBaseImage = async (): Promise<boolean> => {
  if (await exists(BASE_IMAGE)) return false;
  log('기준 장면 이미지가 없어 새로 만듭니다 (OpenAI)');
  await mkdir(path.dirname(BASE_IMAGE), { recursive: true });
  await writeFile(BASE_IMAGE, await generateWithRetry(BASE_IMAGE_PROMPT, '1024x1536'));
  return true;
};

const readMade = async (): Promise<string[]> =>
  (await exists(MADE_FILE)) ? (JSON.parse(await readFile(MADE_FILE, 'utf8')) as string[]) : [];

// 아직 만들지 않은 대본 중 파일 이름(날짜)이 오늘(한국 날짜) 이전인 것 가운데 가장 이른 것을 고른다.
// 날짜가 아직 안 된 대본은 고르지 않는다 (보조 예약이 다음 주 대본을 미리 만들지 않게)
const pickNextEpisode = async (): Promise<string | undefined> => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const made = new Set(await readMade());
  const files = (await readdir(EPISODE_DIR)).filter((f) => f.endsWith('.json')).sort();
  const next = files.find((f) => !made.has(f.replace(/\.json$/, '')) && f.slice(0, 10) <= today);
  return next ? path.join(EPISODE_DIR, next) : undefined;
};

// 오늘 날짜로 시작하는 대본을 이미 만들었는지 (예약을 여러 번 걸어 둘 때 판단용)
const alreadyMadeToday = async (): Promise<boolean> => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  return (await readMade()).some((slug) => slug.startsWith(today));
};

const run = async (): Promise<void> => {
  const episodeArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const episodePath = episodeArg ? path.resolve(ROOT, episodeArg) : await pickNextEpisode();
  if (!episodePath) {
    // 예약 실행: 이미 만들었거나 오늘 만들 대본이 없으면 조용히 끝낸다 (보조 예약 중복 방지)
    if (flag('--scheduled') && (await alreadyMadeToday())) {
      log('오늘 만들 대본은 이미 만들었습니다. 이번 예약 실행은 건너뜁니다.');
      return;
    }
    throw new Error('만들 대본이 없습니다. content/sitcom/에 오늘 날짜 이전의 새 대본을 추가해 주세요.');
  }
  log(`대본: ${path.relative(ROOT, episodePath)}`);
  const episode = JSON.parse(await readFile(episodePath, 'utf8')) as Episode;
  const outDir = path.join(ROOT, 'output', 'sitcom', episode.slug);
  await mkdir(outDir, { recursive: true });

  // 이미 만든 구간 영상이 폴더에 있으면 다시 만들지 않는다 (편집만 다시 할 때 비용이 들지 않는다)
  const segmentNames = episode.segments.map((_, i) => `segment${i + 1}.mp4`);
  const existing = await Promise.all(segmentNames.map((name) => exists(path.join(outDir, name))));
  const needsGeneration = existing.some((found) => !found);

  // 1. 기준 장면 이미지 (처음 한 번만 만든다)
  const createdBase = needsGeneration ? await ensureBaseImage() : false;
  const imageUrl = needsGeneration ? await uploadFile(await readFile(BASE_IMAGE), 'image/png') : '';
  if (needsGeneration) log('기준 장면 이미지를 올렸습니다');

  // 2. 구간별 영상: 한 요청에 컷 여러 개(최대 6개, 15초)를 담아 동시에 만든다
  const bodies = episode.segments.map((segment) => {
    for (const shot of segment.shots) {
      if (shot.prompt.length > 512) throw new Error(`컷 설명이 512자를 넘습니다: ${shot.prompt.slice(0, 40)}...`);
    }
    return {
      prompt: `${STYLE}\n${SET}\n${CAST}`,
      image_url: imageUrl,
      sound: 'on',
      multi_shots: true,
      multi_prompt: segment.shots.map((shot) => ({ prompt: shot.prompt, duration: shot.duration })),
      duration: segment.shots.reduce((sum, shot) => sum + shot.duration, 0),
    };
  });
  for (const [i, body] of bodies.entries()) {
    if (!existing[i]) log(`구간 ${i + 1} 예상 비용: ${await estimate(VIDEO_ENDPOINT, body)}`);
  }

  const files = await Promise.all(
    bodies.map(async (body, i) => {
      if (existing[i]) {
        log(`구간 ${i + 1}: 이미 만든 영상을 그대로 씁니다`);
        return segmentNames[i];
      }
      log(`구간 ${i + 1} 영상을 만드는 중 (${body.duration}초)`);
      const result = await generate(VIDEO_ENDPOINT, body, (message) => log(`구간 ${i + 1}: ${message}`));
      if (!result.video?.url) throw new Error(`구간 ${i + 1} 결과에 영상 주소가 없습니다: ${JSON.stringify(result).slice(0, 200)}`);
      const name = segmentNames[i];
      await writeFile(path.join(outDir, name), await download(result.video.url));
      log(`구간 ${i + 1} 완료`);
      return name;
    }),
  );

  // 3. 편집: 이어 붙이고 배너와 자막을 넣는다
  log('편집하는 중 (자막, 배너)');
  const finalFile = await editSitcom(
    episode.segments.map((segment, i) => ({ file: files[i], shots: segment.shots })),
    episode.banner ?? '',
    outDir,
    'final.mp4',
  );
  const caption = `${episode.caption.trimEnd()}\n\n${ACCOUNT_HANDLE}`;
  await writeFile(path.join(outDir, 'caption.txt'), caption);
  log(`완성: ${finalFile}`);
  const made = await readMade();
  if (!made.includes(episode.slug)) await writeFile(MADE_FILE, `${JSON.stringify([...made, episode.slug], null, 2)}\n`);

  // 4. 슬랙 알림
  if (flag('--no-slack')) return;
  const attachments = [finalFile, path.join(outDir, 'caption.txt'), ...(createdBase ? [BASE_IMAGE] : [])];
  const titles = ['AI 시트콤 완성본', '게시물 문구 원본 (여기서 복사)', ...(createdBase ? ['기준 장면 이미지 (처음 만듦)'] : [])];
  await sendCards(
    attachments,
    `🎬 *AI 시트콤이 완성됐어요* (${episode.slug})\n올릴 때 인스타 게시 화면의 AI 표시를 켜 주세요. 음악은 넣지 않았어요.\n\n*게시물 문구*\n\`\`\`\n${caption}\n\`\`\``,
    titles,
  );
  log('슬랙으로 보냈습니다');
};

run().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('실패:', message);
  if (!flag('--no-slack')) {
    await sendText(`:warning: AI 시트콤 만들기에 실패했어요\n${message}`).catch(() => undefined);
  }
  process.exit(1);
});
