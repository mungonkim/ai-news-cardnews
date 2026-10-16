// 모션툰 릴스: 이미 그린 컷 그림(art-XX.png)에 움직임을 줘서 세로 영상(1080x1920, 30fps)을 만든다.
// - 컷마다 천천히 확대되고, 다음 컷은 부드럽게 겹쳐 나타난다
// - 말풍선 · 알림 · 시간 상자는 하나씩 톡 튀어나오고, 효과음 글씨는 살짝 흔들린다
// 시간(t)을 직접 정해 한 장씩 찍기 때문에 컴퓨터 속도와 상관없이 매번 같은 영상이 나온다.
// 음악은 넣지 않는다. 인스타 앱에서 올릴 때 인기 음원을 고르는 편이 노출에 유리하고 저작권 문제도 없다.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { type Episode, hookHtml, OVERLAY_CSS, overlayHtml, STORY_HEIGHT } from './template.ts';

const storyHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');

const WIDTH = 1080;
const HEIGHT = 1920;
// 휴대폰 릴스 화면은 위쪽(상태 표시줄 · 상단 메뉴)과 아래쪽(문구 · 버튼)이 가려진다 (2026-10-15 사용자 확인: 맨 위 제목이 잘림).
// 그래서 제목은 위에서 260px 아래에, 툰은 0.89배로 줄여 가운데(가로 960, 세로 1280)에 둔다.
const PANEL_SCALE = 960 / 1080;
const PANEL_LEFT = 60;
const PANEL_TOP = 380;
const FPS = 30;
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
// 맨 앞에 가장 극적인 컷을 먼저 보여 주는 시간 (처음 1초 안에 멈추게 하는 훅)
const INTRO = 0.8;

// 컷마다 보여 줄 시간: 오버레이가 다 뜬 뒤 읽을 시간을 준다. 마지막 컷은 조금 더 길게
const panelDurations = (episode: Episode): number[] =>
  episode.panels.map((panel, i) => {
    // 독백이 있으면 글자 수만큼 읽을 시간을 더 준다 (한 글자 0.05초, 최대 2.5초)
    const reading = Math.min(2.5, (panel.narration?.length ?? 0) * 0.05);
    const base = 0.6 + panel.overlays.length * 0.75 + 1.6 + reading;
    return Math.max(3, base) + (i === episode.panels.length - 1 ? 0.8 : 0);
  });

const buildHtml = (
  episode: Episode,
  arts: string[],
  starts: number[],
  durations: number[],
  handle: string,
  highlight: number,
): string => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #1d1d1f; }
  .bg, .panel { position: absolute; opacity: 0; }
  .bg { inset: -80px; }
  .bg img { width: 100%; height: 100%; object-fit: cover; filter: blur(40px) brightness(0.55); }
  .frame {
    position: absolute; left: ${PANEL_LEFT}px; top: ${PANEL_TOP}px; width: 1080px; height: 1440px; overflow: hidden;
    transform: scale(${PANEL_SCALE}); transform-origin: top left; border-radius: 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  }
  .panel { inset: 0; background: #fff8ec; }
  .panel img.art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform-origin: 50% 60%; }
  .panel .ov > * { scale: 0; }
  /* 맨 앞 하이라이트: 가장 극적인 컷을 확 다가오게 보여 주고 흰 번쩍임으로 1컷에 넘긴다 */
  .intro { position: absolute; inset: 0; overflow: hidden; }
  .intro img.art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .flash { position: absolute; inset: 0; background: #fff; opacity: 0; }
  .title {
    position: absolute; top: 262px; left: 40px; right: 40px; text-align: center; word-break: keep-all;
    font-family: 'Jua', sans-serif; font-size: 72px; color: #fff; text-shadow: 0 4px 16px rgba(0,0,0,0.5);
  }
  .handle {
    position: absolute; top: 1688px; left: 0; right: 0; text-align: center;
    font-family: 'Pretendard Variable', sans-serif; font-weight: 700; font-size: 38px; color: rgba(255,255,255,0.85);
  }
${OVERLAY_CSS}
</style>
</head>
<body>
${arts.map((art, i) => `<div class="bg" data-i="${i}"><img src="${art}" alt="" /></div>`).join('\n')}
<div class="title">${episode.title.replace(/</g, '&lt;')}</div>
<div class="frame">
${episode.panels
  .map(
    // 독백이 있는 컷은 컷 이미지와 같게 위는 글, 아래는 그림 무대
    (panel, i) => `<div class="panel" data-i="${i}">${
      panel.narration ? `<div class="story"><div>${storyHtml(panel.narration)}</div></div>` : ''
    }<div class="stage${panel.narration ? ' with-story' : ''}" style="top: ${panel.narration ? STORY_HEIGHT : 0}px"><img class="art" src="${arts[i]}" alt="" />${
      i === 0 && episode.hook ? hookHtml(episode.hook) : ''
    }<div class="ov">${panel.overlays.map((o) => overlayHtml(o)).join('')}</div></div></div>`,
  )
  .join('\n')}
<div class="intro"><img class="art" src="${arts[highlight]}" alt="" /><div class="ovs">${episode.panels[highlight].overlays
  .map((o) => overlayHtml(o))
  .join('')}</div><div class="flash"></div></div>
</div>
<div class="handle">${handle}</div>
<script>
  const STARTS = ${JSON.stringify(starts)};
  const DURATIONS = ${JSON.stringify(durations)};
  const clamp = (x) => Math.max(0, Math.min(1, x));
  // 살짝 넘쳤다가 돌아오는 튀어나오기
  const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  const INTRO = ${INTRO};
  const HIGHLIGHT = ${highlight};
  window.setTime = (t) => {
    const intro = document.querySelector('.intro');
    if (t < INTRO) {
      // 1.15배에서 1배로 빠르게 다가오고, 끝나기 직전 흰 번쩍임
      const p = t / INTRO;
      intro.style.display = 'block';
      intro.querySelector('img.art').style.transform = 'scale(' + (1.15 - 0.15 * Math.min(1, p * 1.6)) + ')';
      intro.querySelector('.flash').style.opacity = String(clamp((p - 0.75) / 0.25) * 0.9);
    } else {
      intro.style.display = 'none';
    }
    t = t - INTRO;
    STARTS.forEach((s, i) => {
      const d = DURATIONS[i];
      const fade = i === 0 ? 1 : clamp((t - s) / 0.3);
      const visible = t >= s ? fade : 0;
      document.querySelector('.panel[data-i="' + i + '"]').style.opacity = visible;
      document.querySelector('.bg[data-i="' + i + '"]').style.opacity = t < 0 ? (i === HIGHLIGHT ? 1 : 0) : visible;
      const art = document.querySelector('.panel[data-i="' + i + '"] img.art');
      art.style.transform = 'scale(' + (1 + 0.06 * clamp((t - s) / d)) + ')';
      const items = document.querySelectorAll('.panel[data-i="' + i + '"] .ov > *');
      items.forEach((el, j) => {
        const appear = s + 0.5 + j * 0.75;
        const p = clamp((t - appear) / 0.3);
        el.style.scale = p === 0 ? '0' : String(easeOutBack(p));
        // 효과음은 나타난 뒤 0.5초 동안 좌우로 흔들린다
        if (el.classList.contains('sfx')) {
          const k = t - appear;
          const shake = k > 0 && k < 0.5 ? Math.sin(k * 60) * 10 * (1 - k / 0.5) : 0;
          el.style.translate = shake + 'px 0';
        }
      });
    });
  };
</script>
</body>
</html>`;

const toDataUrl = (buffer: Buffer): string => `data:image/png;base64,${buffer.toString('base64')}`;

// previewTimes를 주면 영상 대신 그 시각의 화면만 PNG로 저장한다 (ffmpeg 없는 컴퓨터에서 확인용)
export const makeMotionReel = async (
  episode: Episode,
  artDir: string,
  outFile: string,
  options: { handle?: string; previewTimes?: number[] } = {},
): Promise<string[]> => {
  const arts = await Promise.all(
    episode.panels.map(async (_, i) => toDataUrl(await readFile(path.join(artDir, `art-${String(i + 1).padStart(2, '0')}.png`)))),
  );
  const durations = panelDurations(episode);
  const starts = durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0));
  const total = INTRO + starts[starts.length - 1] + durations[durations.length - 1];
  // 하이라이트 컷: 대본이 정한 번호(1부터), 없으면 3컷
  const highlight = Math.min(Math.max((episode.highlight ?? 3) - 1, 0), episode.panels.length - 1);
  const html = buildHtml(episode, arts, starts, durations, options.handle ?? '@utppang', highlight);

  await mkdir(path.dirname(outFile), { recursive: true });
  const channel = process.env.CI ? undefined : 'msedge';
  const browser = await chromium.launch({ channel });
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const setTime = (t: number): Promise<void> =>
      page.evaluate((time) => (window as unknown as { setTime: (x: number) => void }).setTime(time), t);

    if (options.previewTimes) {
      const files: string[] = [];
      for (const t of options.previewTimes) {
        await setTime(t);
        const file = outFile.replace(/\.mp4$/, `-t${t}.png`);
        await writeFile(file, await page.screenshot({ type: 'png' }));
        files.push(file);
      }
      return files;
    }

    // 화면을 한 장씩 찍어 ffmpeg에 바로 흘려보낸다
    const ffmpeg = spawn(
      FFMPEG,
      ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', outFile],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    const done = new Promise<void>((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 종료 코드 ${code}: ${stderr.slice(-500)}`))));
    });
    const frames = Math.ceil(total * FPS);
    for (let f = 0; f < frames; f += 1) {
      await setTime(f / FPS);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    }
    ffmpeg.stdin.end();
    await done;
    console.log(`릴스 영상: ${outFile} (${total.toFixed(1)}초, ${frames}프레임)`);
    return [outFile];
  } finally {
    await browser.close();
  }
};
