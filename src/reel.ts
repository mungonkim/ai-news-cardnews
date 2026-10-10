// 카드 PNG(1080x1440)를 차례로 보여 주는 릴스용 세로 영상(1080x1920, 9:16)을 만든다.
// 카드는 가운데에 두고, 위아래 빈 곳은 같은 카드를 흐리게 깔아 채운다.
// 음악은 넣지 않는다. 인스타 앱에서 올릴 때 인기 음원을 고르는 편이 노출에 유리하고 저작권 문제도 없다.
// 필요: ffmpeg (없으면 영상만 건너뛰고 나머지는 그대로 진행한다). 경로는 FFMPEG_PATH로 바꿀 수 있다.
// 사용법(직접 실행): node src/reel.ts <카드 PNG 폴더> [출력 파일]
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const WIDTH = 1080;
const HEIGHT = 1920;
const CARD_HEIGHT = 1440;

// 장마다 보여 주는 시간(초): 표지는 짧게, 글이 있는 내용 장은 읽을 시간을 준다
const durationFor = (index: number, total: number): number => {
  if (index === 0) return 2.5;
  if (index === total - 1) return 3;
  return 4;
};

const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 종료 코드 ${code}: ${stderr.slice(-500)}`))));
  });

// 영상을 만들고 파일 경로를 돌려준다. 실패하면 경고만 남기고 undefined를 돌려준다 (카드 발송은 계속해야 하므로).
export const makeReel = async (
  cardFiles: string[],
  outFile: string,
  log: (message: string) => void = console.log,
): Promise<string | undefined> => {
  if (cardFiles.length === 0) return undefined;
  const durations = cardFiles.map((_, i) => durationFor(i, cardFiles.length));
  const total = durations.reduce((a, b) => a + b, 0);

  const inputs = cardFiles.flatMap((file, i) => ['-loop', '1', '-t', String(durations[i]), '-i', file]);
  const scaled = cardFiles.map((_, i) => `[${i}:v]scale=${WIDTH}:${CARD_HEIGHT},setsar=1,fps=30[c${i}]`).join(';');
  const chain = cardFiles.map((_, i) => `[c${i}]`).join('');
  const filter = [
    scaled,
    `${chain}concat=n=${cardFiles.length}:v=1:a=0[seq]`,
    '[seq]split[bgsrc][fg]',
    `[bgsrc]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=40:2,eq=brightness=-0.25[bg]`,
    `[bg][fg]overlay=0:${(HEIGHT - CARD_HEIGHT) / 2},format=yuv420p[v]`,
  ].join(';');

  const args = [
    '-y',
    ...inputs,
    // 소리 없는 오디오 트랙 (오디오가 아예 없는 영상을 거부하는 경우를 대비)
    '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', filter,
    '-map', '[v]', '-map', `${cardFiles.length}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    outFile,
  ];

  try {
    log(`릴스 영상을 만드는 중 (${cardFiles.length}장, ${total}초)`);
    await runFfmpeg(args);
    return outFile;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log('ffmpeg가 없어 릴스 영상을 건너뜁니다 (카드는 그대로 진행)');
    } else {
      log(`릴스 영상 만들기 실패, 건너뜁니다: ${reason}`);
    }
    return undefined;
  }
};

// 직접 실행: 이미 만든 카드 폴더로 영상만 다시 만든다
const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isDirectRun) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('카드 PNG 폴더를 입력하세요. 예: node src/reel.ts output/2026-10-09-google-synthid-detector-public/cards');
    process.exit(1);
  }
  const files = (await readdir(dir)).filter((f) => /^\d+\.png$/.test(f)).sort().map((f) => path.join(dir, f));
  const out = process.argv[3] ?? path.join(path.dirname(path.resolve(dir)), 'reel.mp4');
  const result = await makeReel(files, out);
  if (!result) process.exit(1);
  console.log(`저장: ${result}`);
}
