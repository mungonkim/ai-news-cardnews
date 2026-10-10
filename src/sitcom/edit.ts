// 시트콤 편집: 구간 영상을 이어 붙이고, 위쪽 제목 배너와 영어 + 한국어 자막을 입혀 세로 영상(1080x1920)을 만든다.
// 필요: ffmpeg, ffprobe, 한글 글꼴(Noto Sans CJK KR). GitHub Actions에서는 워크플로가 설치한다.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const WIDTH = 1080;
const HEIGHT = 1920;
// 위쪽 배너 높이 (영상은 그 아래에 놓인다)
const BANNER_HEIGHT = 200;
const FONT = 'Noto Sans CJK KR';

export type SubtitleShot = { duration: number; en?: string; ko?: string };
export type EditSegment = { file: string; shots: SubtitleShot[] };

const run = (command: string, args: string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-3000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${command} 종료 코드 ${code}: ${stderr.slice(-800)}`))));
  });

// 영상 길이(초)와 소리 트랙이 있는지 확인한다
const probe = async (file: string, cwd: string): Promise<{ duration: number; hasAudio: boolean }> => {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], cwd);
  const info = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  return {
    duration: Number(info.format?.duration ?? 0),
    hasAudio: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
  };
};

// ASS 자막 시간 형식 (시:분:초.백분의일초)
const assTime = (seconds: number): string => {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// 자막 글자 안의 중괄호와 줄바꿈은 ASS 문법과 겹치므로 바꿔 둔다
const assText = (text: string): string => text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');

const buildAss = (banner: string, total: number, lines: { start: number; end: number; en?: string; ko?: string }[]): string => {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Banner,${FONT},56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,60,60,70,1
Style: En,${FONT},50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,70,70,330,1
Style: Ko,${FONT},50,&H0000E5FF,&H0000E5FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,70,70,210,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = [`Dialogue: 0,${assTime(0)},${assTime(total)},Banner,,0,0,0,,${assText(banner)}`];
  for (const line of lines) {
    if (line.en) events.push(`Dialogue: 0,${assTime(line.start)},${assTime(line.end)},En,,0,0,0,,${assText(line.en)}`);
    if (line.ko) events.push(`Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Ko,,0,0,0,,${assText(line.ko)}`);
  }
  return `${header}${events.join('\n')}\n`;
};

// 구간 영상들을 이어 붙여 완성본을 만든다. workDir 안의 파일 이름으로 다룬다
export const editSitcom = async (segments: EditSegment[], banner: string, workDir: string, outName: string): Promise<string> => {
  const probes = await Promise.all(segments.map((s) => probe(s.file, workDir)));

  // 자막 시간: 요청한 컷 길이를 실제 구간 길이에 맞게 비례로 맞춘다
  const lines: { start: number; end: number; en?: string; ko?: string }[] = [];
  let offset = 0;
  segments.forEach((segment, i) => {
    const requested = segment.shots.reduce((sum, shot) => sum + shot.duration, 0);
    const ratio = requested > 0 ? probes[i].duration / requested : 1;
    let cursor = offset;
    for (const shot of segment.shots) {
      const length = shot.duration * ratio;
      lines.push({ start: cursor + 0.1, end: cursor + length - 0.1, en: shot.en, ko: shot.ko });
      cursor += length;
    }
    offset += probes[i].duration;
  });
  await writeFile(path.join(workDir, 'subs.ass'), buildAss(banner, offset, lines));

  // 각 구간: 가로 1080에 맞추고 배너 아래에 놓는다. 소리가 없는 구간은 무음을 채운다
  const inputs: string[] = [];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  for (const segment of segments) inputs.push('-i', segment.file);
  segments.forEach((_, i) => {
    filters.push(
      `[${i}:v]scale=${WIDTH}:${HEIGHT - BANNER_HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:${BANNER_HEIGHT}:black,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    if (probes[i].hasAudio) {
      filters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${probes[i].duration.toFixed(2)}[a${i}]`);
    }
    concatInputs.push(`[v${i}][a${i}]`);
  });
  filters.push(`${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[vc][ac]`);
  filters.push(`[vc]subtitles=subs.ass[vout]`);

  await run(
    FFMPEG,
    [
      '-y',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vout]',
      '-map',
      '[ac]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outName,
    ],
    workDir,
  );
  return path.join(workDir, outName);
};
