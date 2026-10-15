// 매일 공감툰 대본 쓰기: 최근에 만든 편을 피해 새 대본(Episode)을 Claude에게 받는다.
import { askJson } from '../pipeline/claude.ts';
import type { Episode, Overlay, Position } from './template.ts';

export type MadeToon = { date: string; slug: string; title: string; category: string };

// 다양하게 돌아가며 고를 일상 분야
export const CATEGORIES = [
  '회사 생활',
  '학교 · 시험',
  '자취 · 혼자 살기',
  '연애 · 썸',
  '가족 · 명절',
  '친구 · 단톡방',
  '반려동물',
  '쇼핑 · 배달 · 택배',
  '운동 · 다이어트',
  '날씨 · 계절',
  '휴대폰 · 인터넷',
  '대중교통 · 출퇴근길',
  '음식 · 맛집',
  '돈 · 월급 · 카드값',
  '잠 · 아침 · 주말',
];

const SYSTEM = `너는 한국 인스타그램의 인기 공감툰 작가다. 독자가 "이거 완전 나잖아" 하며 친구를 태그하고 싶어지는 짧은 일상 만화를 쓴다.

이 계정의 고정 주인공은 "웃빵"이다:
- 사람 크기로 의인화된 식빵 캐릭터. 사람들 사이에서 평범한 20~30대처럼 산다 (회사도 다니고, 자취도 하고, 연애도 한다)
- 웃기고 슬픈("웃픈") 일상을 겪는다. 독자는 웃빵을 보며 자기 얘기라고 느낀다
- 매 편 주인공으로 나온다. 대사에서 자기를 "나"라고 부르고, 다른 인물은 "웃빵아"라고 부를 수 있다
- 빵이라는 설정을 가끔 살짝 쓰면 좋다 (예: 추우면 "식빵 굳겠다"). 매번 빵 농담을 하지는 않는다
- 조연(친구, 가족, 팀장, 동물 등)은 편마다 자유롭게 정한다. 조연은 사람이어도 되고 동물이어도 된다

좋은 공감툰의 조건:
- 누구나 겪어 본 아주 구체적인 한 장면에서 시작한다 (막연한 "월요병"이 아니라 "일요일 밤 11시 59분에 천장 보기")
- 컷이 넘어갈수록 상황이 조금씩 커지고, 마지막 컷에 반전이나 한 줄 펀치가 있다
- 대사는 짧다. 한 말풍선에 22자 이내, 실제 사람이 하는 말투
- 설명하지 않는다. 그림과 표정이 웃음을 만든다
- 누구도 깎아내리지 않는다. 외모 · 성별 · 나이 · 지역 비하, 정치 · 종교, 실존 인물 · 브랜드 · 상표 이름은 쓰지 않는다

그림은 AI가 글씨 없이 그리고, 글자는 모두 오버레이로 얹는다. 그래서:
- scene에는 그림에 그릴 것만 쓴다 (웃빵과 조연의 행동, 표정, 장소, 사물). 웃빵은 scene에 "웃빵"이라고 쓴다. 화면 속 글자나 숫자가 필요하면 그림에 넣지 말고 오버레이로 표현한다
- 휴대폰 메시지 · 알림은 notify 오버레이로 쓴다 (sender: 보낸 사람, text: 내용)
- 시간 · 장소 · "다음 날" 같은 안내는 caption, 효과음은 sfx(1~4자), 속마음은 thought, 말은 speech
- 한 컷의 오버레이는 1~3개. pos는 top-left, top-center, top-right, middle-left, middle-right, bottom-left, bottom-center, bottom-right 중 하나
- 같은 컷에서 notify를 top-center에 두면 다른 오버레이는 top-*에 두지 않는다. 한 컷에서 같은 pos를 두 번 쓰지 않는다
- speech와 thought는 되도록 top-left 또는 top-right (그림 위쪽 15%는 말풍선 자리로 비워 둔다)

반드시 아래 JSON만 출력한다.
{
  "ideas": ["먼저 떠올린 아이디어 6개를 한 줄씩"],
  "chosen_reason": "그중 가장 공유될 만한 것을 고른 이유 한 문장",
  "category": "분야 목록 중 하나",
  "slug": "영어 소문자와 하이픈만, 3~5단어 (예: sunday-night-ceiling)",
  "title": "짧은 한국어 제목",
  "hook": "1컷 아래에 크게 얹을 공감 한 줄, 16자 이내. 읽자마자 '이거 나잖아' 싶게 (예: 퇴근 5분 전 메시지 특징). 과장 · 낚시 금지: 소름, 충격, 끝까지 보세요, 결말 주의 같은 말 쓰지 않는다. 결말을 미리 말하지 않는다",
  "highlight": "릴스 맨 앞에 0.8초 먼저 보여 줄 가장 극적인 컷 번호 (1부터, 표정이 가장 큰 컷. 마지막 펀치 컷은 피한다)",
  "cast": "웃빵을 뺀 조연의 외모를 구체적으로 (나이대, 머리, 옷 색, 동물이면 종과 털색). 조연이 없으면 \"조연 없음\". 사람 조연이 있으면 실존 인물을 닮지 않은 가상의 인물이라고 끝에 쓴다",
  "setting": "주된 장소 한 문장",
  "panels": [{ "scene": "...", "overlays": [{ "kind": "speech", "text": "...", "pos": "top-right" }] }],
  "caption": "인스타 게시물 문구: 첫 줄 공감 훅 + 이모지 1개, 빈 줄, 짧은 한두 줄, 빈 줄, 댓글을 부르는 질문 한 줄 (독자가 자기 경험을 답하고 싶어지게, 예: 여러분은 몇 시까지 버텨 봤어요?), 친구 태그 유도 한 줄, 빈 줄, 해시태그 8~10개 (#웃빵 #공감툰 #인스타툰 #일상툰 포함, #웃빵은 맨 앞)"
}
panels는 4~6개.`;

const POSITIONS: Position[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const KINDS = ['speech', 'thought', 'caption', 'sfx', 'notify'];

// 겹치는 배치를 고친다: 위쪽 가운데 알림이 있으면 위쪽 좌우 오버레이를 아래로, 같은 자리 중복은 빈자리로
const fixLayout = (overlays: Overlay[], hasHook = false): Overlay[] => {
  const hasTopNotify = overlays.some((o) => o.kind === 'notify' && o.pos === 'top-center');
  const used = new Set<Position>();
  return overlays.map((overlay) => {
    let pos = overlay.pos;
    if (hasTopNotify && overlay.kind !== 'notify' && pos.startsWith('top-')) {
      pos = pos === 'top-right' ? 'bottom-right' : 'bottom-left';
    }
    if (hasHook && pos.startsWith('bottom-')) pos = pos === 'bottom-right' ? 'middle-right' : 'middle-left';
    if (used.has(pos)) pos = POSITIONS.find((p) => !used.has(p) && !(hasTopNotify && p.startsWith('top-'))) ?? pos;
    used.add(pos);
    return { ...overlay, pos };
  });
};

type Draft = Omit<Episode, 'highlight'> & { category: string; ideas?: string[]; chosen_reason?: string; highlight?: number | string };

const validate = (draft: Draft): void => {
  if (!draft.slug || !/^[a-z0-9-]+$/.test(draft.slug)) throw new Error(`slug 형식이 틀렸습니다: ${draft.slug}`);
  if (!Array.isArray(draft.panels) || draft.panels.length < 4 || draft.panels.length > 6) {
    throw new Error(`컷 수가 4~6개가 아닙니다: ${draft.panels?.length}`);
  }
  for (const panel of draft.panels) {
    if (!panel.scene || !Array.isArray(panel.overlays)) throw new Error('컷에 scene이나 overlays가 없습니다.');
    for (const overlay of panel.overlays) {
      if (!KINDS.includes(overlay.kind) || !POSITIONS.includes(overlay.pos) || !overlay.text) {
        throw new Error(`오버레이 형식이 틀렸습니다: ${JSON.stringify(overlay)}`);
      }
    }
  }
  if (!draft.title || !draft.cast || !draft.setting || !draft.caption) throw new Error('제목, 인물, 장소, 문구 중 빠진 것이 있습니다.');
  if (!draft.hook || draft.hook.length > 22) throw new Error(`훅 문장이 없거나 너무 깁니다: ${draft.hook}`);
};

export const writeEpisode = async (made: MadeToon[], date: string): Promise<{ episode: Episode; category: string }> => {
  const recent = made.slice(-30);
  const recentCategories = made.slice(-3).map((m) => m.category);
  const user = [
    `오늘 날짜(한국): ${date}`,
    `분야 목록: ${CATEGORIES.join(', ')}`,
    recentCategories.length > 0
      ? `최근 3일에 쓴 분야(오늘은 이것과 다른 분야로): ${recentCategories.join(', ')}`
      : '',
    recent.length > 0 ? `이미 만든 편 제목(비슷한 상황 금지):\n${recent.map((m) => `- ${m.title}`).join('\n')}` : '',
    '계절과 날짜에 어울리는 소재면 더 좋다. 오늘의 공감툰 한 편을 써 줘.',
  ]
    .filter(Boolean)
    .join('\n\n');

  // 형식이 틀리면 한 번 더 받는다
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const draft = (await askJson({ system: SYSTEM, user, maxTokens: 6000 })) as Draft;
      validate(draft);
      const episode: Episode = {
        slug: `${date}-${draft.slug}`,
        title: draft.title,
        mascot: true,
        cast: draft.cast,
        setting: draft.setting,
        hook: draft.hook,
        highlight: Number(draft.highlight) || 3,
        panels: draft.panels.map((p, i) => ({ scene: p.scene, overlays: fixLayout(p.overlays, i === 0) })),
        caption: draft.caption,
      };
      console.log(`아이디어: ${(draft.ideas ?? []).join(' / ')}`);
      console.log(`고른 이유: ${draft.chosen_reason ?? ''}`);
      return { episode, category: draft.category };
    } catch (error) {
      lastError = error;
      console.warn('대본을 다시 받습니다:', error instanceof Error ? error.message : error);
    }
  }
  throw lastError;
};
