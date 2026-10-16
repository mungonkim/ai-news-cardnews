// 툰 한 컷(1080x1440)을 HTML로 만든다. 그림은 글씨 없이 생성하고, 말풍선 · 알림 · 효과음은 여기서 얹는다.

export type Position =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type Overlay =
  // 말풍선 / 생각 풍선 / 시간 같은 상자 / 효과음 큰 글씨
  | { kind: 'speech' | 'thought' | 'caption' | 'sfx'; text: string; pos: Position }
  // 메신저 알림 (보낸 사람 + 한 줄)
  | { kind: 'notify'; sender: string; text: string; pos: Position };

// narration: 컷 위쪽 흰 공간에 쓰는 웃빵의 속마음 2~3줄 (있으면 위는 글, 아래는 그림으로 나눈다. 2026-10-16 사용자 요청: 장마다 읽는 맛)
export type Panel = { scene: string; overlays: Overlay[]; narration?: string };

export type Episode = {
  slug: string;
  title: string;
  // true면 고정 주인공 웃빵이 나온다 (2026-10-15부터 매일 편). cast는 조연 설명
  mascot?: boolean;
  // 1컷 아래쪽에 크게 얹는 공감 한 줄 (피드에서 멈추게 하는 훅, 16자 안팎)
  hook?: string;
  // 릴스 맨 앞 0.8초에 먼저 보여 줄 가장 극적인 컷 번호 (1부터, 없으면 3컷)
  highlight?: number;
  // 컷마다 같은 인물로 그리도록 매번 붙이는 인물 설명
  cast: string;
  setting: string;
  panels: Panel[];
  // 인스타 게시물 문구
  caption: string;
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 줄바꿈은 <br>로
const textHtml = (text: string): string => escapeHtml(text).replace(/\n/g, '<br>');

// 말풍선 꼬리는 말풍선이 놓인 쪽으로 (왼쪽 말풍선은 왼쪽 아래, 오른쪽은 오른쪽 아래)
const tailClass = (pos: Position): string => (pos.endsWith('left') ? 'tail-left' : pos.endsWith('right') ? 'tail-right' : 'tail-center');

// 위치별 좌표 (가장자리에서 조금 띄운다)
const POSITION_CSS: Record<Position, string> = {
  'top-left': 'top: 56px; left: 56px;',
  'top-center': 'top: 56px; left: 50%; transform: translateX(-50%);',
  'top-right': 'top: 56px; right: 56px;',
  'middle-left': 'top: 45%; left: 56px;',
  'middle-right': 'top: 45%; right: 56px;',
  'bottom-left': 'bottom: 72px; left: 56px;',
  'bottom-center': 'bottom: 72px; left: 50%; transform: translateX(-50%);',
  'bottom-right': 'bottom: 72px; right: 56px;',
};

// 말풍선 꼬리: 곡선으로 휘어 내려가는 꼬리 (위쪽 끝이 말풍선 테두리를 덮어서 이어져 보인다). 기본은 왼쪽 아래를 가리킨다
const TAIL_SVG =
  '<svg class="tail" viewBox="0 0 60 48" width="60" height="48"><path d="M8 0 C 18 18, 16 32, 4 45 C 28 38, 44 22, 54 0" fill="#fff" stroke="#3a2a1f" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/></svg>';

export const overlayHtml = (overlay: Overlay): string => {
  const style = POSITION_CSS[overlay.pos];
  const text = textHtml(overlay.text);
  switch (overlay.kind) {
    case 'speech':
      return `<div class="bubble speech ${tailClass(overlay.pos)}" style="${style}">${text}${TAIL_SVG}</div>`;
    case 'thought':
      return `<div class="bubble thought ${tailClass(overlay.pos)}" style="${style}">${text}<i class="dot1"></i><i class="dot2"></i></div>`;
    case 'caption':
      return `<div class="caption" style="${style}">${text}</div>`;
    case 'sfx':
      return `<div class="sfx" style="${style}">${text}</div>`;
    case 'notify':
      return `<div class="notify" style="${style}">
        <div class="notify-icon">💬</div>
        <div><div class="notify-sender">${escapeHtml(overlay.sender)}</div><div class="notify-text">${text}</div></div>
      </div>`;
  }
};

// 말풍선 · 시간 상자 · 효과음 · 알림 스타일 (컷 이미지와 릴스가 함께 쓴다)
export const OVERLAY_CSS = `
  /* 2026-10-16 말풍선 디자인 개선 (사용자 요청): 웃빵 테두리와 어울리는 짙은 갈색 선, 곡선 꼬리, 구름 생각 풍선 */
  .bubble {
    position: absolute; max-width: 640px; padding: 26px 42px 28px;
    font-family: 'Jua', 'Pretendard Variable', sans-serif; font-size: 50px; line-height: 1.34; color: #3a2a1f;
    background: #fff; border: 5px solid #3a2a1f; word-break: keep-all; text-align: center;
  }
  .speech { border-radius: 56px; box-shadow: 0 7px 0 rgba(58,42,31,0.16); }
  .speech .tail { position: absolute; bottom: -43px; left: 50%; margin-left: -30px; }
  .speech.tail-right .tail { left: 40%; }
  .speech.tail-left .tail { left: 60%; transform: scaleX(-1); }
  /* 생각 풍선: 둥근 구름 + 작은 동그라미 두 개 */
  .thought { border-radius: 64px; background: #fffaf2; box-shadow: 0 7px 0 rgba(58,42,31,0.12); }
  .thought i { position: absolute; display: block; border-radius: 50%; background: #fffaf2; border: 4px solid #3a2a1f; }
  .thought .dot1 { width: 30px; height: 30px; bottom: -40px; left: 46%; }
  .thought .dot2 { width: 16px; height: 16px; bottom: -66px; left: 40%; }
  .thought.tail-left .dot1 { left: 58%; }
  .thought.tail-left .dot2 { left: 66%; }
  .caption {
    position: absolute; padding: 14px 30px; border-radius: 20px;
    font-family: 'Pretendard Variable', sans-serif; font-weight: 800; font-size: 44px; letter-spacing: 0.5px;
    color: #fff7e8; background: rgba(58,42,31,0.92);
  }
  /* 독백이 있는 컷: 위쪽은 따뜻한 미색 바탕의 글, 아래는 그림 무대 */
  .stage { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden; }
  .stage.with-story { border-top: 5px solid #3a2a1f; }
  .story {
    position: absolute; left: 0; right: 0; top: 0; height: 380px; display: flex; align-items: center;
    padding: 36px 76px 24px; background: #fff8ec; font-family: 'Pretendard Variable', sans-serif; font-weight: 600;
    font-size: 52px; line-height: 1.5; color: #3a2a1f; word-break: keep-all; letter-spacing: -0.5px;
  }
  .sfx {
    position: absolute; font-family: 'Jua', sans-serif; font-size: 110px; color: #ff4f7a;
    -webkit-text-stroke: 6px #fff; paint-order: stroke fill; transform: rotate(-8deg);
  }
  .notify {
    position: absolute; display: flex; gap: 22px; align-items: center; width: 760px; padding: 26px 32px;
    border-radius: 34px; background: rgba(255,255,255,0.96); box-shadow: 0 16px 40px rgba(0,0,0,0.28);
    font-family: 'Pretendard Variable', sans-serif;
  }
  .notify-icon { font-size: 56px; }
  .notify-sender { font-size: 32px; font-weight: 700; color: #6b6b70; }
  .notify-text { font-size: 46px; font-weight: 800; color: #1d1d1f; margin-top: 4px; }
  /* 1컷 훅: 아래쪽 어두운 그라데이션 위에 큰 글씨 */
  .hook {
    position: absolute; left: 0; right: 0; bottom: 0; padding: 120px 60px 80px; text-align: center;
    background: linear-gradient(to top, rgba(20,20,22,0.82), rgba(20,20,22,0.55) 60%, rgba(20,20,22,0));
    font-family: 'Jua', sans-serif; font-size: 78px; line-height: 1.25; color: #fff; word-break: keep-all;
    text-shadow: 0 3px 12px rgba(0,0,0,0.45);
  }
`;

// 독백이 있는 컷에서 위쪽 글 영역 높이 (아래 1060px이 그림)
export const STORY_HEIGHT = 380;

export const hookHtml = (hook: string): string => `<div class="hook">${escapeHtml(hook)}</div>`;

// image는 data 주소, index는 0부터. hook을 주면 아래쪽에 크게 얹는다 (1컷용)
export const buildPanelHtml = (image: string, panel: Panel, index: number, total: number, hook?: string): string => `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1440px; overflow: hidden; background: #fff; }
  .frame { position: relative; width: 1080px; height: 1440px; background: #fff8ec; }
  .art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
${OVERLAY_CSS}
  .page {
    position: absolute; right: 40px; bottom: 28px; font-family: 'Pretendard Variable', sans-serif;
    font-size: 28px; font-weight: 700; color: rgba(255,255,255,0.9); text-shadow: 0 1px 6px rgba(0,0,0,0.5);
  }
</style>
</head>
<body>
<div class="frame">
  ${panel.narration ? `<div class="story"><div>${textHtml(panel.narration)}</div></div>` : ''}
  <div class="stage${panel.narration ? ' with-story' : ''}" style="top: ${panel.narration ? STORY_HEIGHT : 0}px">
    <img class="art" src="${image}" alt="" />
    ${hook ? hookHtml(hook) : ''}
    ${panel.overlays.map(overlayHtml).join('\n    ')}
  </div>
  <div class="page">${index + 1} / ${total}</div>
</div>
</body>
</html>`;
