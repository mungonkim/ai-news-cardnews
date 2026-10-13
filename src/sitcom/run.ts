// AI 시트콤 한 편 만들기: 인물 기준 이미지 + 장소 이미지 → 장면별 영상(Higgsfield, Seedance 2.5) → 편집(자막) → 슬랙 전송.
// 사용법: node src/sitcom/run.ts [대본 JSON 경로]  (예: content/sitcom/2026-10-19-lost-remote.json)
//   경로를 비우면 content/sitcom/에서 아직 만들지 않은 대본 중 가장 이른 것을 고른다 (매주 월요일 자동 실행)
//   --no-slack  슬랙으로 보내지 않는다
//   --estimate  영상을 만들지 않고 예상 비용만 확인한다 (요금 없음)
// 필요한 설정: HIGGSFIELD_API_KEY, OPENAI_API_KEY(기준/장소 이미지가 없을 때만), SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateWithRetry } from '../pipeline/images.ts';
import { sendCards, sendText } from '../pipeline/slack.ts';
import { editSitcom, type SubtitleShot } from './edit.ts';
import { download, estimate, FAILED_STATUSES, type HiggsfieldResult, submit, uploadFile, waitFor } from './higgsfield.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
// 영상 모델: Seedance 2.5 참조 이미지 → 영상 (한 번에 최대 30초, 소리 포함, 세로 9:16). 사용자 결정 2026-10-13
const VIDEO_ENDPOINT = process.env.SITCOM_VIDEO_ENDPOINT ?? 'bytedance/seedance-2.5/reference-to-video';
const RESOLUTION = process.env.SITCOM_RESOLUTION ?? '720p';
const MIN_SCENE_SECONDS = 4;
const MAX_SCENE_SECONDS = 30;
// 매 편 같은 강아지와 여자가 나오도록 기준 이미지(거실에 둘이 있는 장면)를 계속 쓴다
const ASSET_DIR = path.join(ROOT, 'assets', 'sitcom');
const BASE_IMAGE = path.join(ASSET_DIR, 'base.png');
const EPISODE_DIR = path.join(ROOT, 'content', 'sitcom');
// 이미 만든 편의 slug 목록 (같은 대본을 두 번 만들지 않게 한다)
const MADE_FILE = path.join(ROOT, 'data', 'sitcom-made.json');
// 요금을 내고 접수한 생성 요청 번호 { slug: { 장면 번호: 요청 번호 } }.
// 실행이 중간에 실패해도 다음 실행이 새로 요청(재결제)하지 않고 이 번호로 결과를 받아 온다
const PENDING_FILE = path.join(ROOT, 'data', 'sitcom-pending.json');
type Pending = Record<string, Record<string, string>>;
const ACCOUNT_HANDLE = '@ai_chingu';

// 등장인물 (모든 장면에 같은 설명을 붙여 모습이 바뀌지 않게 한다)
const CAST = `Characters: a photorealistic Shiba Inu dog named Aki (red-orange fur, cream chest and cheeks, deadpan confident face, red collar with a small silver tag) and a fictional American woman in her early 30s named Dana (curly brown bob, round glasses, mustard yellow cardigan over a white shirt, jeans). Dana is not based on any real person.`;
const STYLE = `Look: 1990s American multi-camera sitcom on film, warm color, soft studio lighting, slight film grain, realistic fur and skin, natural lip and mouth movement when speaking. Vertical 9:16 framing with the characters near the center. Dialogue is spoken in English exactly as written, slowly and clearly in natural American English, with crisp pronunciation and a short pause before and after each line. Characters move their mouths only while saying their own line; as soon as the line ends, the speaker closes its mouth and stays still and silent. The dog's mouth stays closed whenever it is not speaking, including while the audience laughs. Dana speaks in a warm female voice; Aki speaks in a deep calm deadpan male voice, the same voice every time. Studio audience laughter happens only where the timeline asks for it; it starts after the line ends and fades out naturally. Like a real 1990s sitcom, there is no background music under dialogue; music plays only where the timeline asks for a short sitcom slap-bass riff. No subtitles, no captions, no on-screen text, no logos.`;

// 반복해서 쓰는 세트 (시트콤처럼 익숙한 장소 몇 곳을 돌려 쓴다). 대본의 location에 이름을 적는다.
// living-room은 기준 이미지 자체가 세트다. 나머지는 처음 쓸 때 빈 세트 사진을 만들어 assets/sitcom/sets/에 남긴다
const SETS: Record<string, string> = {
  'living-room': `Dana's 1990s living room: a plaid sofa, wood-paneled walls, a warm orange floor lamp, curtains, a low TV cabinet with a boxy CRT TV, a coffee table.`,
  kitchen: `Dana's 1990s kitchen: cream cabinets, a checkered linoleum floor, a big white refrigerator covered in magnets, a small round wooden table with two chairs, a wall phone with a curly cord, a window with gingham curtains.`,
  diner: `A cozy 1990s neighborhood coffee shop: a big worn velvet couch, mismatched armchairs, a counter with a glass pastry case, warm pendant lights, brick walls, large front windows.`,
  park: `A small city park on a sunny autumn afternoon: a green wooden bench, a winding path, orange and yellow trees, a hot dog cart in the background.`,
  office: `Dana's 1990s office: a cubicle with fabric partition walls, a beige desktop computer with a CRT monitor, stacks of paper, a desk phone, fluorescent ceiling lights, a small potted plant.`,
  'vet-clinic': `A friendly 1990s veterinary clinic waiting room: plastic chairs along the wall, a reception counter, pet posters, a water bowl in the corner, a weighing scale for dogs.`,
  car: `Inside Dana's 1990s station wagon parked on a quiet street: front bench seats, a cassette tape player, fuzzy dice hanging from the mirror; Dana in the driver seat, the dog in the passenger seat.`,
};
const setImagePath = (location: string): string => path.join(ASSET_DIR, 'sets', `${location}.png`);
const setImagePrompt = (location: string): string =>
  `Vertical photo, a wide straight-on shot of an empty set from a 1990s American multi-camera sitcom, no people and no animals. ${SETS[location]} Warm 1990s film color, slight grain, soft studio lighting. No text, no logos, no watermark.`;
const BASE_IMAGE_PROMPT = `Vertical photo, a wide straight-on shot from a 1990s American multi-camera sitcom. Set: ${SETS['living-room']} ${CAST} The Shiba Inu sits on the sofa, looking calm. The woman stands beside the sofa, turned toward the dog. Warm 1990s film color, slight grain, soft studio lighting. No text, no logos, no watermark.`;

type Shot = SubtitleShot & { prompt: string };
// 장면 하나 = 영상 요청 하나 (한 장소, 4~30초). location은 SETS의 이름
type Scene = { location?: string; shots: Shot[] };
// banner: 영상 위쪽 제목. 기본은 넣지 않는다 (사용자 결정, 2026-10-10). 필요할 때만 적는다
type Episode = { slug: string; banner?: string; segments: Scene[]; caption: string };

const log = (message: string): void => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${message}`);
const flag = (name: string): boolean => process.argv.includes(name);
const minutes = (ms: number): string => `${(ms / 60_000).toFixed(1)}분`;

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  );

// 기준 이미지나 장소 이미지가 없으면 한 번 만들어 저장한다. 새로 만들었으면 파일 경로를 돌려준다
const ensureImage = async (file: string, prompt: string, what: string): Promise<string | undefined> => {
  if (await exists(file)) return undefined;
  log(`${what}가 없어 새로 만듭니다 (OpenAI)`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await generateWithRetry(prompt, '1024x1536'));
  return file;
};

const readMade = async (): Promise<string[]> =>
  (await exists(MADE_FILE)) ? (JSON.parse(await readFile(MADE_FILE, 'utf8')) as string[]) : [];

const readPending = async (): Promise<Pending> =>
  (await exists(PENDING_FILE)) ? (JSON.parse(await readFile(PENDING_FILE, 'utf8')) as Pending) : {};

// 장면들이 동시에 고치므로 순서대로 쓴다
let pendingWrite: Promise<void> = Promise.resolve();
const updatePending = (slug: string, segment: number, requestId: string | undefined): Promise<void> => {
  pendingWrite = pendingWrite.then(async () => {
    const pending = await readPending();
    const entry = { ...pending[slug] };
    if (requestId) entry[segment] = requestId;
    else delete entry[segment];
    if (Object.keys(entry).length > 0) pending[slug] = entry;
    else delete pending[slug];
    await writeFile(PENDING_FILE, `${JSON.stringify(pending, null, 2)}\n`);
  });
  return pendingWrite;
};

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

// 장면 하나를 Seedance 요청 본문으로 만든다. 컷은 시간표(몇 초~몇 초)로 풀어 쓴다
const buildSceneBody = (scene: Scene, imageUrls: string[], hasSetImage: boolean): Record<string, unknown> => {
  const location = scene.location ?? 'living-room';
  let cursor = 0;
  const timeline = scene.shots.map((shot, i) => {
    const line = `Shot ${i + 1} (${cursor}-${cursor + shot.duration}s): ${shot.prompt}`;
    cursor += shot.duration;
    return line;
  });
  const references = hasSetImage
    ? 'Reference image 1 shows Aki and Dana: keep their faces, fur, hair, glasses and clothes exactly the same. Reference image 2 shows the location: the whole scene takes place there.'
    : 'Reference image 1 shows Aki and Dana in the location: keep their faces, fur, hair, glasses and clothes exactly the same.';
  return {
    prompt: `${references}\nLocation: ${SETS[location]}\n${CAST}\n${STYLE}\nTimeline (hard cuts between shots, one continuous scene):\n${timeline.join('\n')}`,
    image_urls: imageUrls,
    duration: cursor,
    aspect_ratio: '9:16',
    resolution: RESOLUTION,
    generate_audio: true,
  };
};

const run = async (): Promise<void> => {
  const startedAt = Date.now();
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
  for (const [i, scene] of episode.segments.entries()) {
    const location = scene.location ?? 'living-room';
    if (!SETS[location]) throw new Error(`장면 ${i + 1}의 장소 "${location}"가 없습니다. 쓸 수 있는 장소: ${Object.keys(SETS).join(', ')}`);
    const seconds = scene.shots.reduce((sum, shot) => sum + shot.duration, 0);
    if (seconds < MIN_SCENE_SECONDS || seconds > MAX_SCENE_SECONDS) {
      throw new Error(`장면 ${i + 1}의 길이가 ${seconds}초입니다. 장면 하나는 ${MIN_SCENE_SECONDS}~${MAX_SCENE_SECONDS}초여야 합니다.`);
    }
  }
  const outDir = path.join(ROOT, 'output', 'sitcom', episode.slug);
  await mkdir(outDir, { recursive: true });

  // 이미 만든 장면 영상이 폴더에 있으면 다시 만들지 않는다 (편집만 다시 할 때 비용이 들지 않는다)
  const segmentNames = episode.segments.map((_, i) => `segment${i + 1}.mp4`);
  const existing = await Promise.all(segmentNames.map((name) => exists(path.join(outDir, name))));
  const needsGeneration = existing.some((found) => !found);
  const estimateOnly = flag('--estimate');

  // 1. 기준 이미지와 장소 이미지 (처음 한 번만 만든다). 비용만 볼 때는 기준 이미지로 대신한다
  const createdImages: string[] = [];
  const uploaded = new Map<string, string>();
  const upload = async (file: string): Promise<string> => {
    const known = uploaded.get(file);
    if (known) return known;
    const url = await uploadFile(await readFile(file), 'image/png');
    uploaded.set(file, url);
    return url;
  };
  const sceneImages: string[][] = [];
  const sceneHasSet: boolean[] = [];
  if (needsGeneration) {
    const createdBase = await ensureImage(BASE_IMAGE, BASE_IMAGE_PROMPT, '기준 이미지');
    if (createdBase) createdImages.push(createdBase);
    const baseUrl = await upload(BASE_IMAGE);
    for (const [i, scene] of episode.segments.entries()) {
      const location = scene.location ?? 'living-room';
      if (location === 'living-room' || existing[i] || estimateOnly) {
        sceneImages.push([baseUrl]);
        sceneHasSet.push(false);
        continue;
      }
      const created = await ensureImage(setImagePath(location), setImagePrompt(location), `장소 이미지(${location})`);
      if (created) createdImages.push(created);
      sceneImages.push([baseUrl, await upload(setImagePath(location))]);
      sceneHasSet.push(true);
    }
    log('기준 이미지와 장소 이미지를 올렸습니다');
  }

  // 2. 장면별 영상: 장면 하나(한 장소, 최대 30초)를 요청 하나로 동시에 만든다
  const bodies = episode.segments.map((scene, i) => buildSceneBody(scene, sceneImages[i] ?? [], sceneHasSet[i] ?? false));
  const pending = (await readPending())[episode.slug] ?? {};
  for (const [i, body] of bodies.entries()) {
    if (!existing[i] && !pending[i + 1]) log(`장면 ${i + 1} (${String(body.duration)}초) 예상 비용: ${await estimate(VIDEO_ENDPOINT, body)}`);
  }
  if (estimateOnly) {
    log('비용 확인만 하고 끝냅니다 (--estimate)');
    return;
  }

  // 장면 하나가 실패해도 나머지는 끝까지 기다려 받아 둔다 (이미 낸 요금을 버리지 않게)
  const settled = await Promise.allSettled(
    bodies.map(async (body, i) => {
      const segment = i + 1;
      const name = segmentNames[i];
      const segLog = (message: string): void => log(`장면 ${segment}: ${message}`);
      if (existing[i]) {
        segLog('이미 만든 영상을 그대로 씁니다');
        return name;
      }
      const sceneStartedAt = Date.now();
      let result: HiggsfieldResult | undefined;
      const previousId = pending[segment];
      if (previousId) {
        segLog(`지난 실행에서 접수한 요청(${previousId})의 결과를 받아 옵니다 (추가 요금 없음)`);
        result = await waitFor(previousId, segLog);
        if (FAILED_STATUSES.includes(result.status)) {
          segLog(`지난 요청이 ${result.status} 상태라 새로 요청합니다`);
          await updatePending(episode.slug, segment, undefined);
          result = undefined;
        }
      }
      if (!result) {
        segLog(`영상을 만드는 중 (${String(body.duration)}초)`);
        const requestId = await submit(VIDEO_ENDPOINT, body);
        await updatePending(episode.slug, segment, requestId);
        segLog(`요청 접수: ${requestId}`);
        result = await waitFor(requestId, segLog);
      }
      if (FAILED_STATUSES.includes(result.status)) {
        // 실패한 요청은 기록에서 지워 다음 실행이 새로 요청하게 한다
        await updatePending(episode.slug, segment, undefined);
        throw new Error(`장면 ${segment} 생성이 끝나지 못했습니다 (${result.status}): ${JSON.stringify(result).slice(0, 300)}`);
      }
      if (!result.video?.url) throw new Error(`장면 ${segment} 결과에 영상 주소가 없습니다: ${JSON.stringify(result).slice(0, 200)}`);
      await writeFile(path.join(outDir, name), await download(result.video.url));
      segLog(`완료 (생성 ${minutes(Date.now() - sceneStartedAt)})`);
      return name;
    }),
  );
  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failures.length > 0) {
    const reasons = failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)));
    throw new Error(`${reasons.join('\n')}\n(접수된 요청 번호는 data/sitcom-pending.json에 남아 다음 실행이 다시 받아 옵니다)`);
  }
  const generatedIn = Date.now() - startedAt;

  // 3. 편집: 이어 붙이고 자막을 넣는다
  log('편집하는 중 (자막)');
  const finalFile = await editSitcom(
    episode.segments.map((segment, i) => ({ file: segmentNames[i], shots: segment.shots })),
    episode.banner ?? '',
    outDir,
    'final.mp4',
  );
  const caption = `${episode.caption.trimEnd()}\n\n${ACCOUNT_HANDLE}`;
  await writeFile(path.join(outDir, 'caption.txt'), caption);
  const totalTime = minutes(Date.now() - startedAt);
  log(`완성: ${finalFile} (영상 생성까지 ${minutes(generatedIn)}, 전체 ${totalTime})`);
  const made = await readMade();
  if (!made.includes(episode.slug)) await writeFile(MADE_FILE, `${JSON.stringify([...made, episode.slug], null, 2)}\n`);
  for (const segment of episode.segments.keys()) await updatePending(episode.slug, segment + 1, undefined);

  // 4. 슬랙 알림
  if (flag('--no-slack')) return;
  const attachments = [finalFile, path.join(outDir, 'caption.txt'), ...createdImages];
  const titles = [
    'AI 시트콤 완성본',
    '게시물 문구 원본 (여기서 복사)',
    ...createdImages.map((file) => `새로 만든 기준 이미지: ${path.basename(file)}`),
  ];
  await sendCards(
    attachments,
    `🎬 *AI 시트콤이 완성됐어요* (${episode.slug}, 만드는 데 ${totalTime})\n올릴 때 인스타 게시 화면의 AI 표시를 켜 주세요.\n\n*게시물 문구*\n\`\`\`\n${caption}\n\`\`\``,
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
