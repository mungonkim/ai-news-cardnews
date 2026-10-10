// 기사 선정 → 사실 확인 → 카드 작성, 세 단계의 Claude 호출
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { askJson } from './claude.ts';
import type { Candidate, ImageRequest, Selection, VerifiedFacts, WrittenCard } from './types.ts';
import { PALETTE_NAMES, type CardContent, type PaletteName, type Slide } from '../templates.ts';

const BRAND = 'AI랑 친해지기';
// 게시물 문구 맨 끝에 붙는 인스타그램 계정 아이디
const ACCOUNT_HANDLE = '@ai_chingu';
// 게시물 문구의 해시태그 최대 개수 (참고 계정들은 거의 쓰지 않는다)
const MAX_HASHTAGS = 3;
// AI로 만든 이미지를 쓴 게시물에 붙이는 안내
export const AI_IMAGE_NOTE = '※ 카드 속 이미지는 AI로 생성했어요. (Images are AI-generated.)';

// 해시태그를 앞에서부터 limit개만 남기고 나머지는 지운다
export const limitHashtags = (caption: string, limit: number): string => {
  let count = 0;
  return caption
    .replace(/(^|\s)#[^\s#]+/g, (match) => (++count <= limit ? match : ''))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
};

// 계정 아이디 바로 위에 안내 문구를 넣는다
export const addCaptionNote = (caption: string, note: string): string =>
  caption.endsWith(ACCOUNT_HANDLE)
    ? `${caption.slice(0, -ACCOUNT_HANDLE.length).trimEnd()}\n\n${note}\n\n${ACCOUNT_HANDLE}`
    : `${caption.trimEnd()}\n\n${note}`;

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

const WRITE_SYSTEM = `너는 "AI랑 친해지기" 인스타그램 카드뉴스 작가야. 확인된 사실만으로 카드 7~9장과 게시물 문구, DM 자료, 이미지 요청을 작성해.

[독자와 말투]
- 독자: AI가 궁금하지만 어렵게 느끼는 일반인. 카드 말투는 친근한 설명체("~예요", "~해요").
- 확인된 사실(facts)에 없는 내용은 쓰지 마. unverified는 쓰지 마. 숫자와 날짜는 그대로.
- 기사 문장을 그대로 쓰지 말고 내 말로 쉽게 풀어 써.
- 원칙: **한 장에 이야기 하나.** 한 장에 여러 내용을 몰아넣지 않는다.

[카드 구성 (순서 고정, 전체 7~9장)]
1. cover: tag("AI NEWS | 주제"), title(최대 3줄, 줄당 8자 이내, 핵심 단어를 **강조**), subtitle(2줄)
   - 표지 제목은 **훅**이다. 질문, 비교, 숫자, 반전, 궁금증 중 소식에 맞는 형식 하나. 행동과 결과를 단정적으로 쓰면 더 강하다(예: "이제 클로드도 참지 않는다").
   - 낚시 같은 과장과 확인되지 않은 숫자는 쓰지 않는다.
2. brief(무슨 일이야?): title(2줄, 줄당 12자 이내), lines 정확히 3개(각 30자 이내). 뉴스 전체를 세 줄로 요약한다. 숫자가 facts에 있으면 visual에 큰 숫자 카드 { "kind": "stats", "items": [ { "value": "-50%", "label": "출력 가격" } ] }(2~3개)를 넣어도 된다. **facts에 없는 숫자는 절대 만들지 않는다.**
3. step 3~4장: 포인트 하나씩. title(1~2줄, 줄당 12자 이내), body(2~3문장, 80자 이내). 번호는 코드가 붙인다.
   - step 장의 위쪽에는 이미지가 들어간다(images로 요청). 이미지를 요청하지 않은 step은 visual(stats/chat/flow)을 넣거나, 아무것도 없으면 큰 번호가 들어간다.
4. term(선택): 일반인이 모를 핵심 용어가 있을 때만. term, english, heading(한 줄), body(70자 이내), example(일상 비유 한 문장, 50자 이내)
5. meaning: 독자가 바로 해 볼 수 있는 **행동** 3가지 (items, 각 35자 이내). 카드 위쪽에 "그래서 나한테 무슨 의미인데?"가 이미 표시되므로 title은 "이렇게 써 보세요"처럼 짧은 행동 제목으로 쓰고, 그 문장을 반복하지 않는다. 정보 나열이 아니라 "~해 보세요", "~확인하세요" 같은 행동이어야 한다.
6. outro: cta는 "댓글 남기면\\n**DM**으로 보내드려요" 형태(2줄), offer는 DM 자료 목록 3개(각 12자 이내, 아래 dm 내용과 일치), sub는 "**팔로우**하고 매일 쉬운 AI 소식 받기" 같은 한 줄, sources(출처 문구)

[글자 수]
- 위 글자 수를 지켜. 넘으면 카드가 깨져서 다시 쓰게 된다. 줄바꿈은 \\n.
- 강조는 **단어** 형식으로 장마다 1~2개.

[색]
- card.theme은 "light"(내용 장은 밝은 배경, 표지와 마지막 장은 사진 + 어두운 톤). card.palette에 표지 이미지 분위기와 어울리는 강조색 하나를 고른다 (보라 계열 표지면 violet, 따뜻한 표지면 orange 등). 장마다 색이 달라지지 않는다.

[DM 자료 dm]
- 댓글을 남긴 사람에게 DM으로 보낼 글. 인스타 DM에 그대로 붙여 넣을 수 있게 일반 텍스트로(마크다운 기호 ** # 쓰지 않기), 900자 이내.
- 구성: 첫 인사 한 줄 → "📎 원문 링크" (출처 제목과 주소, 확인된 sources만) → "📖 쉬운 용어 정리" (용어 2~3개, 한 줄씩) → "🧪 바로 해 보기" (독자가 직접 해 볼 방법이나 그대로 복사해 쓸 수 있는 프롬프트 1~2개) → 팔로우 감사 한 줄.
- 출처 주소는 입력으로 받은 것만 쓴다. 주소를 지어내지 않는다.

[이미지]
- images 배열에 이미지가 들어갈 장을 요청해. 표지(slideIndex 0)는 반드시, step 장은 최대 3장 (step 장에만).
- 이미지를 넣는 장에는 card JSON의 해당 슬라이드에 image 필드를 넣지 마. 코드가 채워 줘.
- 각 이미지는 scene(장면)과 shoot(촬영: 카메라, 렌즈, 조명, 분위기)을 써.
- 장면 원칙: 주인공은 하나, 기사의 핵심 변화가 보이는 "순간"을 구체적 사물과 행동으로. 한 기사 안에서 이야기가 이어지게. 장마다 소재와 구도는 다르게.
- 표지는 가장 눈에 띄는 장면. 화면 속 글자가 필요하면 한글 한두 단어만, 나머지는 흐릿한 줄이나 도형으로.
- **실존 인물(알아볼 수 있는 특정인)의 얼굴이나 모습, 브랜드 로고, 유명 캐릭터는 그리지 마.** AI로 만든 실존 인물 이미지는 실제로 없던 장면이라 쓰지 않는다. 사람이 필요하면 뒷모습, 손, 실루엣처럼 특정할 수 없는 일반 사람으로 그려. (실제 사진은 사람이 따로 골라 넣는다)
- 기사가 한국 이야기가 아니면 한국 기관의 엠블럼, 한국어 양식, 한국 간판을 그리지 마. 기사 속 나라와 기관에 맞게 하고(예: 미국 사건이면 영어 글자나 글자 없는 도형), 특정 나라의 공공기관 엠블럼은 기사가 그 기관 이야기일 때만 넣어.
- 장면은 한국어로 써.

[게시물 문구 caption]
- 인스타그램 게시물 본문. 한국어 부분과 영어 부분, 두 부분으로 쓴다.
- 한국어 부분: 첫 줄은 시선을 끄는 한 줄(이모지 1개 허용), 핵심 3줄 요약, 독자 행동 유도("댓글 남겨 주시면 원문 링크·용어 정리·바로 해 보기 방법을 DM으로 보내드려요"처럼 마지막 장 offer와 같은 자료를 약속, 그리고 팔로우), 출처 한 줄, 해시태그 3개 이내.
- 그 아래에 빈 줄과 "—————" 구분선을 넣고, 같은 내용을 외국인 독자를 위해 영어로 쓴다 (Hook 한 줄, 핵심 3줄 요약, 댓글 · 팔로우 유도, Source 한 줄). **영어 부분에는 해시태그를 쓰지 않는다**(한국어 부분과 중복하지 않는다). 한국어 부분을 직역하지 말고 자연스러운 영어로, 용어는 쉽게 풀어 써.
- 전체 길이는 한국어와 영어를 합쳐 1800자 이내. 해시태그는 한국어 부분 끝에만 **최대 3개**(예: #AI뉴스 #주제어 #AINews). 많이 붙이지 않는다(코드가 3개 넘는 태그는 지운다).
- 개인정보는 넣지 마. 마지막 줄의 우리 계정 아이디(@ai_chingu)와 AI 생성 이미지 안내는 코드가 붙이니 직접 쓰지 마.

[출력] 설명 없이 아래 JSON만 코드 블록으로 출력해.
{
  "card": { 카드 JSON. 예시와 같은 구조. theme은 "light", brand는 "${BRAND}", palette는 표지 분위기에 어울리는 색 하나("violet", "pink", "blue", "orange", "green" 중) },
  "caption": "게시물 문구",
  "dm": "DM 자료 글",
  "images": [ { "slideIndex": 0, "scene": "...", "shoot": "..." } ]
}`;

export const writeCard = async (
  selection: Selection,
  facts: VerifiedFacts,
  slug: string,
  promptsDir: string,
  // 이전 시도가 검사에 걸렸을 때, 무엇을 고쳐야 하는지 알려 준다
  feedback?: string,
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
${example}${feedback ? `\n\n[이전 시도에서 고쳐야 할 점 (반드시 반영)]\n${feedback}` : ''}`;

  const raw = (await askJson({ system: WRITE_SYSTEM, user, maxTokens: 10000 })) as {
    card?: CardContent;
    caption?: unknown;
    dm?: unknown;
    images?: ImageRequest[];
  };

  if (!raw.card || !Array.isArray(raw.card.slides) || !isString(raw.caption) || !isString(raw.dm)) {
    throw new Error('카드 작성 결과 형식이 올바르지 않습니다.');
  }
  validateSlides(raw.card.slides);
  // 인스타그램 게시물 문구는 2200자까지만 쓸 수 있다
  if (raw.caption.length > 2200) throw new Error('게시물 문구가 2200자를 넘습니다.');
  // 이미지는 표지와 step 장에만 넣는다 (step은 최대 3장, 비용과 일관성을 위해)
  const slides = raw.card.slides;
  const images = (raw.images ?? [])
    .filter((img) => Number.isInteger(img.slideIndex) && img.slideIndex >= 0 && img.slideIndex < slides.length && isString(img.scene))
    .filter((img) => img.slideIndex === 0 || slides[img.slideIndex].type === 'step')
    .slice(0, 4);
  if (!images.some((img) => img.slideIndex === 0)) {
    throw new Error('표지 이미지 요청이 없습니다.');
  }
  // 게시물 문구 맨 끝에 우리 계정 아이디를 붙인다 (이미 있으면 중복하지 않는다)
  const trimmed = limitHashtags(raw.caption.replaceAll(ACCOUNT_HANDLE, '').trimEnd(), MAX_HASHTAGS);
  const caption = `${trimmed}\n\n${ACCOUNT_HANDLE}`;
  return { dm: raw.dm.trim(), card: { ...raw.card, slug, brand: BRAND, theme: 'light', palette: PALETTE_NAMES.includes(raw.card.palette as PaletteName) ? raw.card.palette : 'violet' }, caption, images };
};

// 카드 구성이 약속과 같은지 확인한다 (장 순서와 종류, 글자 수 한도)
export const validateSlides = (slides: Slide[]): void => {
  const types = slides.map((s) => s.type).join(',');
  // cover, brief, step 3~4장, term(선택), meaning, outro
  if (!/^cover,brief,(step,){3,4}(term,)?meaning,outro$/.test(types)) {
    throw new Error(`카드 구성이 올바르지 않습니다: ${types}. 순서는 cover, brief, step 3~4장, term(선택), meaning, outro 입니다.`);
  }
  const len = (text: string): number => text.replace(/\*\*/g, '').replace(/\n/g, '').length;
  const problems: string[] = [];
  for (const [i, slide] of slides.entries()) {
    const at = `${i + 1}번 장(${slide.type})`;
    if (slide.type === 'brief') {
      if (slide.lines.length !== 3) problems.push(`${at}: lines는 정확히 3개여야 합니다`);
      if (slide.lines.some((l) => len(l) > 36)) problems.push(`${at}: lines 한 줄이 36자를 넘습니다`);
    }
    if (slide.type === 'step') {
      if (len(slide.body) > 95) problems.push(`${at}: body가 95자를 넘습니다 (${len(slide.body)}자)`);
      if (slide.title.split('\n').some((line) => len(line) > 13)) problems.push(`${at}: title 한 줄이 13자를 넘습니다`);
    }
    if (slide.type === 'term' && len(slide.body) > 90) problems.push(`${at}: body가 90자를 넘습니다`);
    if (slide.type === 'meaning') {
      // 위쪽에 "그래서 나한테 무슨 의미인데?"가 이미 있으므로 제목에서 같은 말을 반복하면 안 된다
      if (/무슨\s*의미|나한테.*의미/.test(slide.title.replace(/\*\*/g, ''))) {
        problems.push(`${at}: title이 위쪽 문구("그래서 나한테 무슨 의미인데?")를 반복합니다. 행동을 알려 주는 짧은 제목으로 바꿔 주세요`);
      }
      if (slide.items.length !== 3 || slide.items.some((item) => len(item) > 42)) problems.push(`${at}: items는 3개, 각 42자 이내여야 합니다`);
    }
    if (slide.type === 'outro' && (!slide.offer || slide.offer.length < 2 || slide.offer.length > 4)) {
      problems.push(`${at}: offer(DM 자료 목록)가 2~4개 필요합니다`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join(' / '));
};
