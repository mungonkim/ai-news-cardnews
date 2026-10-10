// 이미지 생성: 장면(기사마다 Claude가 작성) + 고정 규칙(prompts/image-prompt.md)으로 프롬프트를 만들어 이미지 API를 호출한다.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImageRequest } from './types.ts';

const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'gpt-image-2';
const IMAGE_QUALITY = process.env.IMAGE_QUALITY ?? 'medium';

// 고정 규칙: 모든 이미지에 같은 문구가 붙는다
const COMMON_RULES =
  '넣지 말 것: 실존 인물을 닮은 얼굴, 브랜드 로고, 읽을 수 있는 긴 글자와 숫자, 워터마크, 만화 같은 어색한 3D 장난감 느낌. 결과는 선명하고 자연스러운 질감의 고품질 이미지여야 한다.';
const COVER_RULES =
  '세로 3:4 비율의 카드뉴스 표지용 이미지. 핵심 요소는 위쪽 60% 안에 두고, 아래쪽 40%는 단순하게 비워 둘 것(제목 글자가 올라갈 자리). 좌우 가장자리는 비워 둘 것.';
const MIDDLE_RULES =
  '가로로 긴 비율(약 3:2)의 이미지. 핵심 요소는 가운데에 두고, 가장자리가 잘려도 이야기가 이어지게 할 것.';

export const buildImagePrompt = (request: ImageRequest): string => {
  const rules = request.slideIndex === 0 ? COVER_RULES : MIDDLE_RULES;
  return `${rules}\n\n장면: ${request.scene}\n촬영: ${request.shoot}\n\n${COMMON_RULES}`;
};

type ImageResponse = { data?: { b64_json?: string }[]; error?: { message?: string } };

const generateOne = async (prompt: string, size: string): Promise<Buffer> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality: IMAGE_QUALITY, n: 1 }),
    signal: AbortSignal.timeout(180000),
  });
  const body = (await response.json()) as ImageResponse;
  const b64 = body.data?.[0]?.b64_json;
  if (!response.ok || !b64) {
    throw new Error(`이미지 생성 실패 (HTTP ${response.status}): ${body.error?.message ?? '알 수 없는 오류'}`);
  }
  return Buffer.from(b64, 'base64');
};

// 한 번 실패하면 한 번 더 시도한다
const generateWithRetry = async (prompt: string, size: string): Promise<Buffer> => {
  try {
    return await generateOne(prompt, size);
  } catch (error) {
    console.warn('이미지 생성을 다시 시도합니다:', error instanceof Error ? error.message : error);
    return generateOne(prompt, size);
  }
};

// 요청한 이미지를 모두 만들어 저장하고, 장 번호별 파일 이름(assetsDir 기준)을 돌려준다
export const generateImages = async (requests: ImageRequest[], assetsDir: string): Promise<Map<number, string>> => {
  await mkdir(assetsDir, { recursive: true });
  const entries = await Promise.all(
    requests.map(async (request): Promise<[number, string]> => {
      const size = request.slideIndex === 0 ? '1024x1536' : '1536x1024';
      const buffer = await generateWithRetry(buildImagePrompt(request), size);
      const fileName = request.slideIndex === 0 ? 'cover.png' : `slide${request.slideIndex + 1}.png`;
      await writeFile(path.join(assetsDir, fileName), buffer);
      return [request.slideIndex, `assets/${fileName}`];
    }),
  );
  return new Map(entries);
};
