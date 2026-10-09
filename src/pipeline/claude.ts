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
    throw new Error(`Claude의 답변에서 JSON을 읽지 못했습니다: ${text.slice(0, 200)}`);
  }
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

    text = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  return extractJson(text);
};
