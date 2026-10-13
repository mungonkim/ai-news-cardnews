// Higgsfield API ?꾩슦誘? ?뚯씪 ?щ━湲? ?앹꽦 ?붿껌, ?꾨즺???뚭퉴吏 湲곕떎由ш린.
// ?꾩슂???ㅼ젙: HIGGSFIELD_API_KEY (?뺤떇: "?짪D:?쒗겕由?, 肄쒕줎?쇰줈 ?댁뼱 遺숈씤??
// 臾몄꽌: https://docs.higgsfield.ai/docs/quickstart.md
import { randomUUID } from 'node:crypto';

const BASE_URL = 'https://api.higgsfield.ai';
// ?곹깭 ?뺤씤 媛꾧꺽怨?理쒕? ?湲??쒓컙
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
  if (!key) throw new Error('HIGGSFIELD_API_KEY媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  if (!key.includes(':')) {
    throw new Error('HIGGSFIELD_API_KEY ?뺤떇??留욎? ?딆뒿?덈떎. "?짪D:?쒗겕由?泥섎읆 肄쒕줎?쇰줈 ?댁뼱 遺숈뿬 ?ㅼ떆 ?깅줉??二쇱꽭??');
  }
  return `Key ${key.trim()}`;
};

const readJson = async <T>(response: Response, what: string): Promise<T> => {
  const text = await response.text();
  if (!response.ok) {
    const hint = response.status === 401 ? ' (API ?ㅺ? ??멸굅???뺤떇??留욎? ?딆뒿?덈떎)' : response.status === 402 ? ' (?щ젅?㏃씠 遺議깊빀?덈떎)' : '';
    throw new Error(`Higgsfield ${what} ?ㅽ뙣 (HTTP ${response.status})${hint}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
};

// 濡쒖뺄 ?뚯씪 ?댁슜??Higgsfield ??μ냼???щ━怨? 紐⑤뜽 ?붿껌???ｌ쓣 怨듦컻 二쇱냼瑜??뚮젮以??
export const uploadFile = async (data: Buffer, contentType: string): Promise<string> => {
  const ticketResponse = await fetch(`${BASE_URL}/files/generate-upload-url`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType }),
  });
  const ticket = await readJson<UploadTicket>(ticketResponse, '?낅줈??二쇱냼 ?붿껌');
  // ??μ냼 二쇱냼?먮뒗 API ?ㅻ? 蹂대궡吏 ?딅뒗??(?덈궡???ㅻ뜑留?蹂대궦??
  const upload = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, ...ticket.upload_headers },
    body: new Uint8Array(data),
  });
  if (!upload.ok) throw new Error(`Higgsfield ?뚯씪 ?낅줈???ㅽ뙣 (HTTP ${upload.status})`);
  return ticket.public_url;
};

// ?앹꽦 ?꾩뿉 ?덉긽 鍮꾩슜??臾쇱뼱蹂몃떎. ?ㅽ뙣?대룄 ?앹꽦? 怨꾩냽?쒕떎 (李멸퀬??
export const estimate = async (endpoint: string, body: Record<string, unknown>): Promise<string> => {
  try {
    const response = await fetch(`${BASE_URL}/estimate/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.text()).slice(0, 900);
  } catch (error) {
    return `?덉긽 鍮꾩슜 ?뺤씤 ?ㅽ뙣: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ?앹꽦???붿껌?섍퀬 ?붿껌 踰덊샇瑜??뚮젮以??(?붽툑? ?대븣 ?섍컙??
export const submit = async (endpoint: string, body: Record<string, unknown>): Promise<string> => {
  const submitResponse = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      // ?묐떟??紐?諛쏄퀬 ?ㅼ떆 蹂대궪 ??媛숈? ?묒뾽????踰??앷린吏 ?딄쾶 ?쒕떎
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return (await readJson<SubmitResponse>(submitResponse, '?앹꽦 ?붿껌')).request_id;
};

export const FAILED_STATUSES = ['failed', 'nsfw', 'canceled'];
// ?곹깭 ?뺤씤???좉퉸 ?ㅽ뙣?대룄(502 ?? ???잛닔源뚯???湲곕떎?몃떎 ?ㅼ떆 臾삳뒗??
const MAX_POLL_ERRORS = 10;

// ?붿껌 踰덊샇濡??앸궇 ?뚭퉴吏 湲곕떎由곕떎. ?꾨즺???ㅽ뙣 ?곹깭瑜?洹몃?濡??뚮젮以??(?ㅽ뙣 ?먮떒? 遺瑜대뒗 履쎌뿉??
export const waitFor = async (requestId: string, log: (message: string) => void): Promise<HiggsfieldResult> => {
  const statusUrl = `${BASE_URL}/requests/${requestId}/status`;
  const startedAt = Date.now();
  let errors = 0;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const statusResponse = await fetch(statusUrl, { headers: { Authorization: authHeader() } });
      const result = await readJson<HiggsfieldResult>(statusResponse, '?곹깭 ?뺤씤');
      errors = 0;
      if (result.status === 'completed' || FAILED_STATUSES.includes(result.status)) return result;
    } catch (error) {
      // ?쒕쾭媛 ?좉퉸 ?묐떟?섏? ?딅뒗 寃?502 ???쇰줈 ?대? ?덉쓣 ???앹꽦??踰꾨━吏 ?딅뒗??
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (errors >= MAX_POLL_ERRORS) throw new Error(`${message.slice(0, 200)} (?붿껌 踰덊샇 ${requestId})`);
      log(`?곹깭 ?뺤씤 ?쇱떆 ?ㅽ뙣 ${errors}/${MAX_POLL_ERRORS}, ?ㅼ떆 ?뺤씤?⑸땲?? ${message.slice(0, 80)}`);
    }
  }
  throw new Error(`Higgsfield ?앹꽦??${POLL_TIMEOUT_MS / 60_000}遺??덉뿉 ?앸굹吏 ?딆븯?듬땲??(?붿껌 踰덊샇 ${requestId}).`);
};

export const download = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`寃곌낵 ?뚯씪 ?대젮諛쏄린 ?ㅽ뙣 (HTTP ${response.status})`);
  return Buffer.from(await response.arrayBuffer());
};
