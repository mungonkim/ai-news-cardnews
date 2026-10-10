// Higgsfield API 도우미: 파일 올리기, 생성 요청, 완료될 때까지 기다리기.
// 필요한 설정: HIGGSFIELD_API_KEY (형식: "키ID:시크릿", 콜론으로 이어 붙인다)
// 문서: https://docs.higgsfield.ai/docs/quickstart.md
import { randomUUID } from 'node:crypto';

const BASE_URL = 'https://api.higgsfield.ai';
// 상태 확인 간격과 최대 대기 시간
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 25 * 60_000;

type UploadTicket = {
  public_url: string;
  upload_url: string;
  upload_headers?: Record<string, string>;
};

export type HiggsfieldResult = {
  status: string;
  request_id: string;
  video?: { url: string };
  images?: { url: string }[];
};

type SubmitResponse = { request_id: string; status_url: string; status: string };

const authHeader = (): string => {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error('HIGGSFIELD_API_KEY가 설정되지 않았습니다.');
  if (!key.includes(':')) {
    throw new Error('HIGGSFIELD_API_KEY 형식이 맞지 않습니다. "키ID:시크릿"처럼 콜론으로 이어 붙여 다시 등록해 주세요.');
  }
  return `Key ${key.trim()}`;
};

const readJson = async <T>(response: Response, what: string): Promise<T> => {
  const text = await response.text();
  if (!response.ok) {
    const hint = response.status === 401 ? ' (API 키가 틀렸거나 형식이 맞지 않습니다)' : response.status === 402 ? ' (크레딧이 부족합니다)' : '';
    throw new Error(`Higgsfield ${what} 실패 (HTTP ${response.status})${hint}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
};

// 로컬 파일 내용을 Higgsfield 저장소에 올리고, 모델 요청에 넣을 공개 주소를 돌려준다
export const uploadFile = async (data: Buffer, contentType: string): Promise<string> => {
  const ticketResponse = await fetch(`${BASE_URL}/files/generate-upload-url`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  });
  const ticket = await readJson<UploadTicket>(ticketResponse, '업로드 주소 요청');
  // 저장소 주소에는 API 키를 보내지 않는다 (안내된 헤더만 보낸다)
  const upload = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, ...ticket.upload_headers },
    body: new Uint8Array(data),
  });
  if (!upload.ok) throw new Error(`Higgsfield 파일 업로드 실패 (HTTP ${upload.status})`);
  return ticket.public_url;
};

// 생성 전에 예상 비용을 물어본다. 실패해도 생성은 계속한다 (참고용)
export const estimate = async (endpoint: string, body: Record<string, unknown>): Promise<string> => {
  try {
    const response = await fetch(`${BASE_URL}/estimate/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.text()).slice(0, 300);
  } catch (error) {
    return `예상 비용 확인 실패: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 생성을 요청하고 끝날 때까지 기다린 뒤 결과를 돌려준다
export const generate = async (
  endpoint: string,
  body: Record<string, unknown>,
  log: (message: string) => void,
): Promise<HiggsfieldResult> => {
  const submitResponse = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      // 응답을 못 받고 다시 보낼 때 같은 작업이 두 번 생기지 않게 한다
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const submitted = await readJson<SubmitResponse>(submitResponse, '생성 요청');
  log(`요청 접수: ${submitted.request_id}`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const statusResponse = await fetch(submitted.status_url, { headers: { Authorization: authHeader() } });
    const result = await readJson<HiggsfieldResult>(statusResponse, '상태 확인');
    if (result.status === 'completed') return result;
    if (['failed', 'nsfw', 'canceled'].includes(result.status)) {
      throw new Error(`Higgsfield 생성이 끝나지 못했습니다 (${result.status}): ${JSON.stringify(result).slice(0, 300)}`);
    }
  }
  throw new Error(`Higgsfield 생성이 ${POLL_TIMEOUT_MS / 60_000}분 안에 끝나지 않았습니다 (${submitted.request_id}).`);
};

export const download = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`결과 파일 내려받기 실패 (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};
