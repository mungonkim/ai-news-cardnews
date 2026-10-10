// 슬랙으로 결과(카드 이미지 + 게시물 문구)와 오류를 보낸다.
// 필요한 설정: SLACK_BOT_TOKEN(xoxb-...), SLACK_CHANNEL_ID. 봇 권한은 files:write, chat:write.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type SlackResponse = { ok: boolean; error?: string; upload_url?: string; file_id?: string };

const getConfig = (): { token: string; channel: string } => {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) throw new Error('SLACK_BOT_TOKEN과 SLACK_CHANNEL_ID가 필요합니다.');
  return { token, channel };
};

const callSlack = async (method: string, token: string, body: Record<string, unknown>): Promise<SlackResponse> => {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as SlackResponse;
  if (!result.ok) throw new Error(`슬랙 ${method} 실패: ${result.error ?? response.status}`);
  return result;
};

// 이미지 파일 하나를 슬랙 업로드 공간에 올리고 파일 ID를 돌려준다
const uploadFile = async (token: string, filePath: string): Promise<string> => {
  const data = await readFile(filePath);
  const filename = path.basename(filePath);
  // 업로드 주소 요청은 폼 형식이어야 한다
  const params = new URLSearchParams({ filename, length: String(data.length) });
  const ticketResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const ticket = (await ticketResponse.json()) as SlackResponse;
  if (!ticket.ok || !ticket.upload_url || !ticket.file_id) {
    throw new Error(`슬랙 업로드 주소 요청 실패: ${ticket.error ?? ticketResponse.status}`);
  }
  const upload = await fetch(ticket.upload_url, { method: 'POST', body: new Uint8Array(data) });
  if (!upload.ok) throw new Error(`슬랙 파일 업로드 실패: HTTP ${upload.status}`);
  return ticket.file_id;
};

// 카드 이미지 여러 장을 한 메시지로 보낸다 (파일 이름 순서대로 보인다)
export const sendCards = async (files: string[], message: string): Promise<void> => {
  const { token, channel } = getConfig();
  const ids: string[] = [];
  for (const file of files) ids.push(await uploadFile(token, file));
  await callSlack('files.completeUploadExternal', token, {
    files: ids.map((id, i) => ({
      id,
      title: files[i].endsWith('dm.txt') ? 'DM 자료 (댓글 단 분께 보내기)' : files[i].endsWith('.txt') ? '게시물 문구 원본 (여기서 복사)' : files[i].endsWith('.mp4') ? '릴스 영상 (음악은 앱에서 추가)' : `카드 ${i + 1}`,
    })),
    channel_id: channel,
    initial_comment: message,
  });
};

export const sendText = async (text: string): Promise<void> => {
  const { token, channel } = getConfig();
  await callSlack('chat.postMessage', token, { channel, text });
};
