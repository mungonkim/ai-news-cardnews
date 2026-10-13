// 시트콤 편집: 구간 영상을 이어 붙이고, 위쪽 제목 배너와 영어 + 한국어 자막을 입혀 세로 영상(1080x1920)을 만든다.
// 필요: ffmpeg, ffprobe, 한글 글꼴(Noto Sans CJK KR). GitHub Actions에서는 워크플로가 설치한다.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
const WIDTH = 1080;
const HEIGHT = 1920;
const FONT = 'Noto Sans CJK KR';
// 안전 구역: 프로필 격자는 릴스를 3:4로 잘라 위아래 약 240px을 가리고, 재생 화면은 아래쪽에 캡션과 버튼이 겹친다.
// 그래서 제목은 위에서 280px 아래에, 자막은 아래에서 460px 위에 둔다 (y 약 280~1460 안에 글자가 들어간다)
const BANNER_TOP = 280;
const KO_BOTTOM = 460;
const EN_BOTTOM = 580;
// 구간 이음새 소리 페이드(초)
const AUDIO_FADE_IN = 0.15;
const AUDIO_FADE_OUT = 0.4;

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
Style: Banner,${FONT},54,&H00FFFFFF,&H00FFFFFF,&H55000000,&H55000000,1,0,0,0,100,100,0,0,3,16,0,8,60,60,${BANNER_TOP},1
Style: En,${FONT},50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,70,70,${EN_BOTTOM},1
Style: Ko,${FONT},50,&H0000E5FF,&H0000E5FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,70,70,${KO_BOTTOM},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // 제목은 넣지 않는 것이 기본이다 (사용자 결정). 값이 있을 때만 위쪽에 띄운다
  const events = banner ? [`Dialogue: 0,${assTime(0)},${assTime(total)},Banner,,0,0,0,,${assText(banner)}`] : [];
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

  // 각 구간: 가로 1080에 맞춰 화면 가운데에 놓는다 (제목은 영상 위에 반투명 띠로 얹는다). 소리가 없는 구간은 무음을 채운다
  const inputs: string[] = [];
  const filters: string[] = [];
  const concatInputs: string[] = [];
  for (const segment of segments) inputs.push('-i', segment.file);
  segments.forEach((_, i) => {
    filters.push(
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    if (probes[i].hasAudio) {
      // 구간마다 따로 만든 소리라 이음새에서 웃음과 소리가 뚝 끊긴다. 시작은 짧게, 끝은 조금 길게 줄였다 키운다
      const fadeOutStart = Math.max(0, probes[i].duration - AUDIO_FADE_OUT).toFixed(2);
      filters.push(
        `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=${AUDIO_FADE_IN},afade=t=out:st=${fadeOutStart}:d=${AUDIO_FADE_OUT}[a${i}]`,
      );
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
