// 기사 선정 → 사실 확인 → 카드 작성, 세 단계의 Claude 호출
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { askJson } from './claude.ts';
import type { Candidate, ImageRequest, Selection, VerifiedFacts, WrittenCard } from './types.ts';
import type { CardContent, Slide } from '../templates.ts';

const BRAND = 'AI랑 친해지기';

type CoveredArticle = { date: string; slug: string; topic: string; sources: string[] };

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// ---------- 1단계: 기사 선정 ----------

const SELECT_SYSTEM = `너는 "AI랑 친해지기" 인스타그램 계정의 뉴스 에디터야.
독자는 AI가 궁금하지만 어렵게 느끼는 일반인(비개발자)이야. 오늘 카드뉴스로 다룰 기사 1건을 골라.

[선정 기준]
1. 최근 24~48시간 안의 소식
2. 공식 발표가 있거나 주요 매체가 확인한 소식 (루머, 추측성 기사 제외)
3. 일반인의 일상에 영향이 크거나, 쉽게 설명할 수 있는 소식
4. 개발자 전용 소식, 기업 대상 비공개 소식, 주가와 실적 중심 소식은 후순위
5. 이미 다룬 기사와 같은 주제는 제외

[체험 후보]
독자가 무료로 5~30분 안에 직접 해 볼 수 있는 도구나 기능이면 experienceCandidate를 true로 하고, 무엇을 해 보면 좋은지 experienceNote에 한두 문장으로 적어.

[출력] 설명 없이 아래 JSON만 코드 블록으로 출력해.
{
  "title": "기사 제목(한국어)",
  "url": "원문 주소",
  "source": "출처 이름",
  "slug": "영문-소문자-하이픈-짧은이름",
  "reason": "고른 이유 두세 문장, 탈락한 주요 후보와 이유 한 줄 포함",
  "experienceCandidate": true,
  "experienceNote": "해 볼 거리 (없으면 빈 문자열)"
}`;

export const selectArticle = async (
  candidates: Candidate[],
  covered: CoveredArticle[],
  forcedUrl?: string,
): Promise<Selection> => {
  const list = candidates
    .slice(0, 80)
    .map((c, i) => `${i + 1}. [${c.source}] ${c.title} (${c.publishedAt.slice(0, 10)}) ${c.url}\n   ${c.summary}`)
    .join('\n');
  const coveredText = covered.map((c) => `- ${c.date} ${c.topic}`).join('\n') || '(없음)';

  const user = forcedUrl
    ? `다음 주소의 기사를 다룰 거야. 웹 검색으로 내용을 확인하고 같은 JSON 형식으로 정리해 줘.\n${forcedUrl}`
    : `오늘은 ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}이야.\n\n[이미 다룬 기사]\n${coveredText}\n\n[RSS로 모은 후보]\n${list}\n\n후보에 마땅한 기사가 없거나 더 큰 소식이 있을 것 같으면 웹 검색으로 보충해도 돼.`;

  const raw = (await askJson({ system: SELECT_SYSTEM, user, webSearch: true, maxTokens: 4000 })) as Partial<Selection>;
  if (!isString(raw.title) || !isString(raw.url) || !isString(raw.slug)) {
    throw new Error('기사 선정 결과 형식이 올바르지 않습니다.');
  }
  return {
    title: raw.title,
    url: raw.url,
    source: raw.source ?? '',
    slug: raw.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'news',
    reason: raw.reason ?? '',
    experienceCandidate: Boolean(raw.experienceCandidate),
    experienceNote: raw.experienceNote ?? '',
  };
};

// ---------- 2단계: 사실 확인 ----------

const VERIFY_SYSTEM = `너는 카드뉴스의 팩트체커야. 선정된 기사의 내용을 공식 발표 원문과 대조해.

[규칙]
- 웹 검색으로 공식 발표(회사 블로그, 공식 공지, 공식 문서)를 찾아 확인해. 자동 접속이 막혀 있으면 우회하지 말고 같은 내용을 올린 다른 공식 경로를 써.
- facts에는 원문에서 직접 확인한 사실만 써. 숫자, 날짜, 이름은 원문 그대로 정확히 써.
- 확인하지 못했거나 기사에만 있는 내용, 추측은 unverified에 따로 적어. unverified는 카드에 쓰지 않아.
- terms에는 일반인이 모를 만한 핵심 용어 1~3개를 쉬운 말로 풀어 써 (중학생도 이해할 수준, 비유 가능).
- 기사 문장을 그대로 복사하지 말고 사실만 짧게 적어.

[출력] 설명 없이 아래 JSON만 코드 블록으로 출력해.
{
  "facts": ["확인한 사실", "..."],
  "unverified": ["확인하지 못한 내용", "..."],
  "sources": [{ "title": "출처 제목", "url": "주소" }],
  "terms": [{ "term": "용어", "plain": "쉬운 설명" }],
  "publishedDate": "2026.10.7"
}`;

export const verifyArticle = async (selection: Selection): Promise<VerifiedFacts> => {
  const user = `[기사]\n제목: ${selection.title}\n출처: ${selection.source}\n주소: ${selection.url}\n\n이 기사의 사실을 공식 원문으로 확인해 줘.`;
  const raw = (await askJson({ system: VERIFY_SYSTEM, user, webSearch: true, maxTokens: 6000 })) as Partial<VerifiedFacts>;
  if (!Array.isArray(raw.facts) || raw.facts.length === 0) {
    throw new Error('확인된 사실이 없어 카드를 만들 수 없습니다.');
  }
  return {
    facts: raw.facts,
    unverified: raw.unverified ?? [],
    sources: raw.sources ?? [{ title: selection.source, url: selection.url }],
    terms: raw.terms ?? [],
    publishedDate: raw.publishedDate ?? '',
  };
};

// ---------- 3단계: 카드 작성 ----------

const WRITE_SYSTEM = `너는 "AI랑 친해지기" 인스타그램 카드뉴스 작가야. 확인된 사실만으로 카드 7장과 게시물 문구, 이미지 요청을 작성해.

[독자와 말투]
- 독자: AI가 궁금하지만 어렵게 느끼는 일반인. 카드 말투는 친근한 설명체("~예요", "~해요").
- 확인된 사실(facts)에 없는 내용은 쓰지 마. unverified는 쓰지 마. 숫자와 날짜는 그대로.
- 기사 문장을 그대로 쓰지 말고 내 말로 쉽게 풀어 써.

[카드 구성 7장 (순서 고정)]
1. cover: tag("AI NEWS | 주제"), title(최대 3줄, 줄당 8자 이내, 핵심 단어를 **강조**), subtitle(2줄)
2. point "무슨 일이야?": 무슨 일이 있었는지. 가능하면 visual(chat 또는 flow)이나 image 중 하나
3. point "뭐가 달라졌어?": 핵심 변화. image 또는 visual
4. term: 핵심 용어 풀이 (term, english, heading, body)
5. meaning "그래서 나한테 무슨 의미인데?": 독자가 바로 해 볼 수 있는 행동 3가지 (items)
6. summary: 한 줄 정리 (title 3줄 이내, caption)
7. outro: cta, sub, sources(출처 문구)

[글자 수 제한 (넘으면 카드가 깨져)]
- point/meaning/summary title: 줄당 10자 이내, 2~3줄 (\\n으로 줄바꿈). body: 90자 이내. term.body: 100자 이내. meaning item: 한 항목 40자 이내.
- 강조는 **단어** 형식으로 장마다 1~2개.

[이미지]
- images 배열에 이미지가 들어갈 장을 요청해. 표지(slideIndex 0)는 반드시, 중간 장은 최대 2장 (point 또는 meaning 장).
- 이미지를 넣는 장에는 card JSON의 해당 슬라이드에 image 필드를 넣지 마. 코드가 채워 줘.
- 각 이미지는 scene(장면)과 shoot(촬영: 카메라, 렌즈, 조명, 분위기)을 써.
- 장면 원칙: 주인공은 하나, 기사의 핵심 변화가 보이는 "순간"을 구체적 사물과 행동으로. 한 기사 안에서 이야기가 이어지게. 장마다 소재와 구도는 다르게.
- 표지는 가장 눈에 띄는 장면. 화면 속 글자가 필요하면 한글 한두 단어만, 나머지는 흐릿한 줄이나 도형으로.
- 기사에 나오는 실존 인물, 브랜드 로고, 유명 캐릭터는 써도 되지만 기사 주제와 관련될 때만.
- 장면은 한국어로 써.

[게시물 문구 caption]
- 인스타그램 게시물 본문. 첫 줄은 시선을 끄는 한 줄(이모지 1개 허용), 핵심 3줄 요약, 독자 행동 유도(댓글, 팔로우), 출처 한 줄, 해시태그 8~10개.
- 개인정보와 계정 아이디는 넣지 마.

[출력] 설명 없이 아래 JSON만 코드 블록으로 출력해.
{
  "card": { 카드 JSON. 예시와 같은 구조. theme은 "light", brand는 "${BRAND}" },
  "caption": "게시물 문구",
  "images": [ { "slideIndex": 0, "scene": "...", "shoot": "..." } ]
}`;

export const writeCard = async (
  selection: Selection,
  facts: VerifiedFacts,
  slug: string,
  promptsDir: string,
): Promise<WrittenCard> => {
  const example = await readFile(path.join(promptsDir, 'card-example.json'), 'utf-8');
  const user = `[선정된 기사]
제목: ${selection.title}
출처: ${selection.source}

[확인된 사실 facts]
${facts.facts.map((f) => `- ${f}`).join('\n')}

[쓰면 안 되는 내용 unverified]
${facts.unverified.map((f) => `- ${f}`).join('\n') || '(없음)'}

[풀어 쓸 용어 terms]
${facts.terms.map((t) => `- ${t.term}: ${t.plain}`).join('\n') || '(없음)'}

[마지막 장 출처]
${facts.sources.map((s) => `- ${s.title}${facts.publishedDate ? ` (${facts.publishedDate})` : ''}`).join('\n')}

[카드 JSON 예시 (구조 참고용, 내용은 새로 쓸 것. slug는 "${slug}"로)]
${example}`;

  const raw = (await askJson({ system: WRITE_SYSTEM, user, maxTokens: 10000 })) as {
    card?: CardContent;
    caption?: unknown;
    images?: ImageRequest[];
  };

  if (!raw.card || !Array.isArray(raw.card.slides) || !isString(raw.caption)) {
    throw new Error('카드 작성 결과 형식이 올바르지 않습니다.');
  }
  validateSlides(raw.card.slides);
  const images = (raw.images ?? []).filter(
    (img) => Number.isInteger(img.slideIndex) && img.slideIndex >= 0 && img.slideIndex < raw.card!.slides.length && isString(img.scene),
  );
  if (!images.some((img) => img.slideIndex === 0)) {
    throw new Error('표지 이미지 요청이 없습니다.');
  }
  return { card: { ...raw.card, slug, brand: BRAND, theme: 'light' }, caption: raw.caption, images };
};

// 카드 구성이 약속과 같은지 확인한다 (장 수와 종류, 글자 수 한도)
export const validateSlides = (slides: Slide[]): void => {
  const expected = ['cover', 'point', 'point', 'term', 'meaning', 'summary', 'outro'];
  const actual = slides.map((s) => s.type);
  if (actual.join() !== expected.join()) {
    throw new Error(`카드 구성이 올바르지 않습니다: ${actual.join(', ')}`);
  }
  const tooLong = (text: string, limit: number): boolean => text.replace(/\*\*/g, '').length > limit;
  for (const slide of slides) {
    if (slide.type === 'point' && tooLong(slide.body, 120)) throw new Error('point 본문이 너무 깁니다.');
    if (slide.type === 'term' && tooLong(slide.body, 130)) throw new Error('term 본문이 너무 깁니다.');
    if (slide.type === 'meaning' && slide.items.some((item) => tooLong(item, 55))) {
      throw new Error('meaning 항목이 너무 깁니다.');
    }
  }
};
