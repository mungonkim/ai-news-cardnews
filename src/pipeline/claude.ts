// Claude API 호출 도우미: 질문하고, 답에서 JSON을 꺼내 준다.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5-5';

type AskOptions = {
  system: string;
  user: string;
  // true이면 웹 검색 도구를 쓸 수 있게 한다
  webSearch?: boolean;
  maxTokens?: number;
};

let client: Anthropic | undefined;
const getClient = (): Anthropic => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }
  client ??= new Anthropic();
  return client;
};

// 답변 글에서 JSON 객체를 꺼낸다. ```json 코드 블록이 있으면 마지막 것을, 없으면 가장 바깥 중괄호를 쓴다.
export const extractJson = (text: string): unknown => {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidate = blocks.length > 0 ? blocks[blocks.length - 1][1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // 문자열 안에 줄바꿈이 섞여 깨진 경우를 대비해 줄바꿈을 공백으로 바꿔 한 번 더 읽는다
    try {
      return JSON.parse(candidate.replace(/\r?\n\s*/g, ' '));
    } catch {
      // 아래에서 오류로 알린다
    }
    throw new Error(`Claude의 답변에서 JSON을 읽지 못했습니다: ${text.slice(0, 200)}`);
  }
};

// 구조화된 출력: 응답을 JSON 스키마로 강제한다 (output_config.format).
// 글로 받은 JSON을 읽다가 따옴표 · 잘림으로 자주 깨져서(2026-10-25~26 툰 실패) 툰 대본은 이 방식으로 받는다.
export const askStructured = async (options: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<unknown> => {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: options.maxTokens ?? 16000,
    system: options.system,
    messages: [{ role: 'user', content: options.user }],
    output_config: { format: { type: 'json_schema', schema: options.schema } },
  });
  // 잘렸거나 거절된 답은 JSON이 불완전하므로 이유를 남기고 실패로 처리한다
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`답변이 길이 제한(${options.maxTokens ?? 16000}토큰)에서 잘렸습니다.`);
  }
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude가 답변을 거절했습니다: ${response.stop_details?.category ?? '이유 없음'}`);
  }
  const text = response.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return JSON.parse(text);
};

export const askJson = async (options: AskOptions): Promise<unknown> => {
  const anthropic = getClient();
  const tools: Anthropic.Messages.ToolUnion[] = options.webSearch
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }]
    : [];

  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: options.user }];
  let text = '';

  // 웹 검색이 길어지면 서버가 중간에 멈추므로(pause_turn) 이어서 요청한다
  for (let turn = 0; turn < 6; turn += 1) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    });

    // 웹 검색 인용 때문에 글이 여러 조각으로 오는데, 조각 사이에 줄바꿈을 넣으면 문장 한가운데가 끊겨 JSON이 깨진다
    text = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  return extractJson(text);
};
