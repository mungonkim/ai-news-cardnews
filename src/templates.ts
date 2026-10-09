// 카드 한 장(1080x1440)을 HTML로 만드는 템플릿 모음

export type ChatMessage = { role: 'user' | 'ai'; text: string };

// 내용 장에 들어가는 그림 요소
export type Visual =
  | { kind: 'chat'; messages: ChatMessage[]; note?: string }
  | { kind: 'flow'; steps: string[] };

// 내용 장에 넣을 수 있는 이미지 (사진, 화면 캡처 등)
type ImageSlot = {
  // 로컬 파일 경로 또는 주소
  image?: string;
  // 이미지 아래에 작게 표시하는 출처 (예: 이미지: OpenAI)
  imageCredit?: string;
  // middle: 제목 아래, bottom: 본문 아래 (기본 middle)
  imagePosition?: 'middle' | 'bottom';
};

export type Theme = 'dark' | 'light';

export type Slide =
  | {
      type: 'cover';
      tag: string;
      title: string;
      subtitle: string;
      // 표지 사진 경로(로컬 파일 또는 주소). 없으면 그래픽 표지를 쓴다.
      image?: string;
      // 사진 출처 표기 (예: 이미지: OpenAI)
      imageCredit?: string;
      // 그래픽 표지에서 구슬 주변에 떠 있는 장식 문구
      chips?: string[];
    }
  | ({ type: 'point'; label: string; title: string; body: string; visual?: Visual } & ImageSlot)
  | ({ type: 'term'; term: string; english: string; heading: string; body: string } & ImageSlot)
  | ({ type: 'meaning'; title: string; items: string[] } & ImageSlot)
  | { type: 'summary'; title: string; caption: string }
  | { type: 'outro'; cta: string; sub: string; sources: string[] };

export type CardContent = {
  slug: string;
  brand: string;
  // 내용 장의 테마. dark는 어두운 배경, light는 흰 배경 + 장마다 다른 색 그라데이션
  theme?: Theme;
  slides: Slide[];
};

type CoverSlide = Extract<Slide, { type: 'cover' }>;

// 밝은 테마에서 내용 장마다 돌아가며 쓰는 색 (상단 그라데이션 색, 강조 색)
const PALETTE: { tint: string; accent: string }[] = [
  { tint: '#b9a4ff', accent: '#6a3df0' },
  { tint: '#ff9fc0', accent: '#d93a77' },
  { tint: '#ffb59a', accent: '#e0572f' },
  { tint: '#ffc98a', accent: '#c97410' },
  { tint: '#9cc4ff', accent: '#2563eb' },
  { tint: '#9be3b8', accent: '#178a4d' },
];

// HTML 특수문자를 막고, **강조** 표시를 형광펜 효과로 바꾼다
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const format = (text: string): string =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>')
    .replace(/\n/g, '<br />');

// 마지막 장의 행동 유도 아이콘 (직접 그린 단순한 모양)
const icons = {
  heart:
    '<svg viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.6 4.5 6.4 4.5c2 0 3.7 1.1 4.6 2.7h2c.9-1.6 2.6-2.7 4.6-2.7 3.800 0 5.500 3.900 4 7.300C19.500 16.400 12 21 12 21z"/></svg>',
  comment:
    '<svg viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-8l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>',
  bookmark:
    '<svg viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M6 2h12a1 1 0 0 1 1 1v19l-7-4.500L5 22V3a1 1 0 0 1 1-1z"/></svg>',
};

const renderVisual = (visual: Visual): string => {
  switch (visual.kind) {
    case 'chat':
      return `
        <div class="chat">
          ${visual.messages.map((m) => `<div class="bubble ${m.role}">${format(m.text)}</div>`).join('')}
          ${visual.note ? `<div class="chat-note">${escapeHtml(visual.note)}</div>` : ''}
        </div>`;
    case 'flow':
      return `
        <div class="flow">
          ${visual.steps
            .map(
              (step, i) =>
                `${i > 0 ? '<span class="flow-arrow">→</span>' : ''}<div class="flow-step${i === visual.steps.length - 1 ? ' last' : ''}">${format(step)}</div>`,
            )
            .join('')}
        </div>`;
  }
};


// 이미지 박스 (둥근 모서리). 출처는 항상 아래에 작게 적는다.
const renderImage = (slot: ImageSlot): string =>
  slot.image
    ? `<figure class="slide-image"><img src="${escapeHtml(slot.image)}" alt="" />${slot.imageCredit ? `<figcaption>${escapeHtml(slot.imageCredit)}</figcaption>` : ""}</figure>`
    : '';

// 표지 배경: 사진이 있으면 사진, 없으면 구슬 그래픽. dim이면 마지막 장처럼 어둡게 가린다.
const renderCoverBackground = (slide: CoverSlide, dim = false): string => {
  const dimLayer = dim ? '<div class="dim-layer"></div>' : '';
  if (slide.image) {
    return `<img class="cover-photo" src="${escapeHtml(slide.image)}" alt="" />${dim ? '' : '<div class="cover-shade"></div>'}${dimLayer}`;
  }
  const chipPositions = [
    'left: 70px; top: 70px; transform: rotate(-4deg);',
    'right: 50px; top: 250px; transform: rotate(3deg);',
    'right: 110px; top: 575px; transform: rotate(-3deg);',
  ];
  // 어둡게 깐 배경(마지막 장)에서는 글자와 겹치지 않도록 장식 문구와 구슬 글자를 뺀다
  const chips = (dim ? [] : (slide.chips ?? []))
    .slice(0, chipPositions.length)
    .map((chip, i) => `<span class="chip" style="${chipPositions[i]}">${escapeHtml(chip)}</span>`)
    .join('');
  return `
    <div class="orb-wrap">
      <div class="ring" style="width: 760px; height: 760px;"></div>
      <div class="ring" style="width: 960px; height: 960px; opacity: 0.6;"></div>
      <div class="orb">${dim ? '' : '<span>AI</span>'}</div>
      ${chips}
    </div>
    ${dim ? '' : '<div class="cover-shade soft"></div>'}${dimLayer}`;
};

const renderBody = (slide: Slide): string => {
  switch (slide.type) {
    case 'cover':
      return `
        <span class="tag">${escapeHtml(slide.tag)}</span>
        <h1 class="cover-title">${format(slide.title)}</h1>
        <p class="lead">${format(slide.subtitle)}</p>
        <div class="cover-foot">
          <span class="credit">${slide.imageCredit ? escapeHtml(slide.imageCredit) : ''}</span>
          <span class="swipe">밀어서 확인하기 →</span>
        </div>`;
    case 'point': {
      const position = slide.imagePosition ?? 'middle';
      return `
        <span class="label">${escapeHtml(slide.label)}</span>
        <h2 class="title${slide.visual || slide.image ? ' compact' : ''}">${format(slide.title)}</h2>
        ${position === 'middle' ? renderImage(slide) : ''}
        ${slide.visual ? renderVisual(slide.visual) : ''}
        <p class="body${slide.visual || slide.image ? ' compact' : ''}">${format(slide.body)}</p>
        ${position === 'bottom' ? renderImage(slide) : ''}`;
    }
    case 'term': {
      const position = slide.imagePosition ?? 'middle';
      return `
        <span class="label">용어 풀이</span>
        <div class="term-box">
          <div class="term">${escapeHtml(slide.term)}</div>
          <div class="english">${escapeHtml(slide.english)}</div>
        </div>
        ${position === 'middle' ? renderImage(slide) : ''}
        <h2 class="title small">${format(slide.heading)}</h2>
        <p class="body">${format(slide.body)}</p>
        ${position === 'bottom' ? renderImage(slide) : ''}`;
    }
    case 'meaning': {
      const position = slide.imagePosition ?? 'middle';
      return `
        <span class="label accent">그래서 나한테 무슨 의미인데?</span>
        <h2 class="title${slide.image ? ' compact' : ''}">${format(slide.title)}</h2>
        ${position === 'middle' ? renderImage(slide) : ''}
        <ul class="items">
          ${slide.items.map((item, i) => `<li><span class="num">${i + 1}</span><span>${format(item)}</span></li>`).join('')}
        </ul>
        ${position === 'bottom' ? renderImage(slide) : ''}`;
    }
    case 'summary':
      return `
        <span class="label">한 줄 정리</span>
        <div class="summary-box"><h2 class="summary-title">${format(slide.title)}</h2></div>
        <p class="body muted">${format(slide.caption)}</p>`;
    case 'outro':
      return `
        <div class="brand-circle"><span>AI랑<br />친해지기</span></div>
        <h2 class="outro-title">${format(slide.cta)}</h2>
        <p class="outro-sub">${format(slide.sub)}</p>
        <div class="actions">
          <div class="action">
            <span class="action-icon">${icons.heart}</span><span class="action-label">좋아요</span>
          </div>
          <div class="action">
            <span class="action-icon">${icons.comment}</span><span class="action-label">댓글</span>
          </div>
          <div class="action">
            <span class="action-icon">${icons.bookmark}</span><span class="action-label">저장</span>
          </div>
        </div>`;
  }
};

const styles = `
  :root {
    --bg: #0a0a12;
    --text: #f5f5f7;
    --body: #e4e4ec;
    --muted: #a1a1b5;
    --indigo: #818cf8;
    --pink: #f472b6;
    --accent: #818cf8;
    --box-bg: rgba(255,255,255,0.06);
    --box-border: rgba(255,255,255,0.12);
    --bubble-ai: rgba(255,255,255,0.1);
    --gradient: linear-gradient(135deg, #6366f1 0%, #ec4899 100%);
  }
  /* 밝은 테마: 흰 배경, 어두운 글자. 강조 색과 상단 그라데이션 색은 장마다 바뀐다 */
  body.light {
    --bg: #ffffff;
    --text: #14141c;
    --body: #34343f;
    --muted: #6b6b7b;
    --indigo: var(--accent);
    --pink: var(--accent);
    --box-bg: #f5f6fa;
    --box-border: #e2e4ee;
    --bubble-ai: #eceef5;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1080px; height: 1440px; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif;
    word-break: keep-all;
    position: relative;
    overflow: hidden;
  }
  .glow {
    position: absolute; top: -260px; right: -260px;
    width: 760px; height: 760px; border-radius: 50%;
    background: radial-gradient(circle, rgba(99,102,241,0.42) 0%, rgba(236,72,153,0.16) 45%, transparent 70%);
  }
  .tint-top { position: absolute; top: 0; left: 0; right: 0; height: 620px; background: linear-gradient(180deg, var(--tint) 0%, rgba(255,255,255,0) 100%); opacity: 0.75; }
  .frame { position: relative; z-index: 2; height: 100%; padding: 84px 88px; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; font-size: 28px; font-weight: 600; color: var(--muted); letter-spacing: 0.02em; }
  .top .page strong { color: var(--text); }
  /* 사진 표지는 배경이 밝을 수 있어서 상단 글자를 흰색 + 그림자로 읽히게 한다 */
  body.photo .top { color: rgba(255,255,255,0.92); text-shadow: 0 2px 14px rgba(0,0,0,0.45); }
  .content { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
  .content.end { justify-content: flex-end; padding-bottom: 20px; }
  .tag { align-self: flex-start; padding: 12px 28px; border: 2px solid rgba(255,255,255,0.45); border-radius: 999px; font-size: 28px; font-weight: 600; background: rgba(10,10,18,0.35); }
  .label { align-self: flex-start; font-size: 32px; font-weight: 700; color: var(--indigo); }
  .label.accent { color: var(--pink); }
  .cover-title { font-size: 108px; line-height: 1.18; font-weight: 800; letter-spacing: -0.03em; }
  .lead { font-size: 40px; line-height: 1.5; color: #c9c9d8; font-weight: 500; }
  .cover-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; font-size: 30px; color: var(--muted); }
  .credit { font-size: 24px; color: rgba(161,161,181,0.8); }
  .title { font-size: 84px; line-height: 1.25; font-weight: 800; letter-spacing: -0.03em; }
  .title.small { font-size: 60px; }
  .title.compact { font-size: 68px; }
  .body { font-size: 44px; line-height: 1.65; font-weight: 500; color: var(--body); }
  .body.compact { font-size: 38px; line-height: 1.6; }
  .body.muted { color: var(--muted); font-size: 38px; }
  .hl { background: linear-gradient(transparent 62%, rgba(236,72,153,0.55) 62%); padding: 0 4px; }
  .cover-title .hl, .summary-title .hl { background: var(--gradient); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; padding: 0; }
  .title .hl { background: linear-gradient(transparent 70%, rgba(236,72,153,0.55) 70%); }
  /* 밝은 테마에서는 형광펜 대신 그 장의 강조 색으로 굵게 표시한다 */
  body.light .hl, body.light .title .hl { background: none; color: var(--accent); font-weight: 800; padding: 0; }
  body.light .hl, body.light .summary-title .hl, body.light .title .hl { -webkit-text-fill-color: var(--accent); }
  .term-box { padding: 48px 52px; border-radius: 36px; background: var(--box-bg); border: 2px solid rgba(129,140,248,0.5); }
  body.light .term-box { border-color: var(--accent); }
  .term { font-size: 88px; font-weight: 800; letter-spacing: -0.03em; }
  .english { margin-top: 8px; font-size: 36px; color: var(--indigo); font-weight: 600; }
  .items { list-style: none; display: flex; flex-direction: column; gap: 30px; }
  .items li { display: flex; gap: 28px; align-items: flex-start; font-size: 42px; line-height: 1.5; font-weight: 600; }
  .items .num { flex: none; width: 60px; height: 60px; border-radius: 50%; background: var(--gradient); display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 800; margin-top: 4px; color: #fff; }
  body.light .items .num { background: var(--accent); }
  .summary-box { padding: 64px 56px; border-radius: 40px; border: 3px solid transparent; background-image: linear-gradient(#12121c, #12121c), var(--gradient); background-origin: border-box; background-clip: padding-box, border-box; }
  body.light .summary-box { background-image: linear-gradient(#ffffff, #ffffff), var(--gradient); }
  .summary-title { font-size: 76px; line-height: 1.35; font-weight: 800; letter-spacing: -0.03em; }
  .content.center { align-items: center; text-align: center; gap: 30px; }
  .brand-circle { width: 210px; height: 210px; border-radius: 50%; background: rgba(10,10,18,0.78); border: 3px solid rgba(255,255,255,0.22); display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 800; line-height: 1.3; letter-spacing: -0.02em; color: #f5f5f7; }
  .outro-title { font-size: 72px; line-height: 1.3; font-weight: 800; letter-spacing: -0.03em; color: #f5f5f7; }
  .outro-title .hl { background: var(--gradient); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; padding: 0; }
  .outro-sub { font-size: 40px; line-height: 1.55; color: #d4d4e0; font-weight: 500; }
  .outro-sub .hl { background: none; font-weight: 800; color: #fff; padding: 0; }
  .actions { display: flex; gap: 44px; margin-top: 10px; }
  .action { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .action-icon { width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,0.16); display: flex; align-items: center; justify-content: center; color: #fff; }
  .action-label { font-size: 28px; font-weight: 600; color: var(--muted); }
  .sources { margin-top: 24px; font-size: 26px; line-height: 1.6; color: rgba(161,161,181,0.85); }
  .dim-layer { position: absolute; inset: 0; z-index: 1; background: rgba(10,10,18,0.76); }

  /* 표지 그래픽 */
  .cover-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
  /* 사진은 화면 전체에 그대로 보이게 두고, 글자가 읽힐 만큼만 아주 약하게 눌러 준다 */
  .cover-shade { position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.34) 72%, rgba(0,0,0,0.5) 100%); }
  .cover-shade.soft { background: linear-gradient(180deg, rgba(10,10,18,0) 40%, rgba(10,10,18,0.85) 66%, #0a0a12 86%); }
  body.photo .cover-title, body.photo .lead, body.photo .tag, body.photo .cover-foot { text-shadow: 0 2px 20px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.35); }
  body.photo .lead, body.photo .swipe, body.photo .credit { color: rgba(255,255,255,0.92); }
  body.photo .tag { background: rgba(0,0,0,0.28); }
  /* 사진 위에서는 그라데이션 글자 대신 흰 글씨 + 핑크 형광펜으로 강조한다 */
  body.photo .cover-title .hl { background: linear-gradient(transparent 58%, rgba(236,72,153,0.9) 58%); -webkit-text-fill-color: #fff; color: #fff; padding: 0 6px; }
  .orb-wrap { position: absolute; top: 90px; left: 0; width: 1080px; height: 760px; z-index: 0; }
  .ring { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; border: 2px solid rgba(255,255,255,0.16); }
  .orb { position: absolute; left: 50%; top: 50%; width: 500px; height: 500px; transform: translate(-50%, -50%); border-radius: 50%;
    background: radial-gradient(circle at 34% 28%, #c7d2fe 0%, #6366f1 34%, #ec4899 78%, #8b2f6e 100%);
    box-shadow: 0 0 120px rgba(236,72,153,0.55), 0 0 260px rgba(99,102,241,0.45);
    display: flex; align-items: center; justify-content: center; }
  .orb span { font-size: 190px; font-weight: 800; letter-spacing: -0.04em; color: rgba(255,255,255,0.95); text-shadow: 0 8px 40px rgba(0,0,0,0.25); }
  .chip { position: absolute; padding: 16px 30px; border-radius: 999px; background: rgba(18,18,30,0.88); border: 2px solid rgba(255,255,255,0.25); font-size: 30px; font-weight: 600; box-shadow: 0 10px 40px rgba(0,0,0,0.35); color: #f5f5f7; }

  /* 내용 장 그림 요소 */
  .slide-image { margin: 0; }
  .slide-image img { display: block; width: 100%; height: 580px; object-fit: cover; border-radius: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.18); }
  .slide-image figcaption { margin-top: 12px; font-size: 24px; color: var(--muted); text-align: right; }
  .chat { display: flex; flex-direction: column; gap: 18px; padding: 34px; border-radius: 34px; background: var(--box-bg); border: 2px solid var(--box-border); }
  .bubble { max-width: 86%; padding: 22px 30px; border-radius: 28px; font-size: 33px; line-height: 1.5; font-weight: 500; }
  .bubble.user { align-self: flex-end; background: var(--gradient); border-bottom-right-radius: 8px; color: #fff; }
  .bubble.ai { align-self: flex-start; background: var(--bubble-ai); border-bottom-left-radius: 8px; }
  .chat-note { margin-top: 4px; font-size: 25px; color: var(--muted); }
  .flow { display: flex; align-items: center; gap: 14px; }
  .flow-step { flex: 1; padding: 36px 18px; text-align: center; border-radius: 28px; background: var(--box-bg); border: 2px solid rgba(129,140,248,0.45); font-size: 34px; line-height: 1.4; font-weight: 700; }
  body.light .flow-step { border-color: var(--box-border); }
  .flow-step.last { border-color: rgba(244,114,182,0.7); background: rgba(236,72,153,0.12); }
  body.light .flow-step.last { border-color: var(--accent); background: #ffffff; }
  .flow-arrow { font-size: 44px; color: var(--pink); }
`;

export const buildSlideHtml = (
  slide: Slide,
  index: number,
  total: number,
  brand: string,
  cover?: CoverSlide,
  theme: Theme = 'dark',
): string => {
  const page = String(index + 1).padStart(2, '0');
  const all = String(total).padStart(2, '0');
  const isCover = slide.type === 'cover';
  const isOutro = slide.type === 'outro';
  // 밝은 테마는 표지와 마지막 장을 제외한 내용 장에만 적용한다
  const isLight = theme === 'light' && !isCover && !isOutro;
  const palette = PALETTE[(index - 1 + PALETTE.length) % PALETTE.length];
  // 마지막 장은 표지와 같은 배경을 어둡게 깔아 처음과 끝이 이어지게 한다
  const background = isCover
    ? renderCoverBackground(slide)
    : isOutro && cover
      ? renderCoverBackground(cover, true)
      : isLight
        ? '<div class="tint-top"></div>'
        : '<div class="glow"></div>';
  const hasImage = 'image' in slide && Boolean(slide.image) && !isCover;
  const contentClass = `${isCover ? ' end' : isOutro ? ' center' : ''}${hasImage ? ' has-image' : ''}`;
  const bodyClasses = [
    isCover && slide.image ? 'photo' : '',
    isLight ? 'light' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const bodyStyle = isLight ? ` style="--accent: ${palette.accent}; --tint: ${palette.tint};"` : '';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
  <style>${styles}</style>
</head>
<body${bodyClasses ? ` class="${bodyClasses}"` : ''}${bodyStyle}>
  ${background}
  <div class="frame">
    <div class="top">
      <span>${escapeHtml(brand)}</span>
      <span class="page"><strong>${page}</strong> / ${all}</span>
    </div>
    <div class="content${contentClass}">${renderBody(slide)}</div>
  </div>
</body>
</html>`;
};
