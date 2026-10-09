// RSS 목록에서 최근 기사 후보를 모은다.
import { FEEDS, type Feed } from './feeds.ts';
import type { Candidate } from './types.ts';

const FETCH_TIMEOUT_MS = 15000;
// 최근 몇 시간 안의 기사만 후보로 쓴다
const MAX_AGE_HOURS = 60;

const decode = (text: string): string =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const stripTags = (html: string): string => decode(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const pick = (block: string, tag: string): string => {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
};

// RSS(item)와 Atom(entry) 모두 읽는다
export const parseFeed = (xml: string, source: string): Candidate[] => {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.flatMap((block): Candidate[] => {
    const title = stripTags(pick(block, 'title'));
    const linkText = stripTags(pick(block, 'link'));
    const linkHref = block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '';
    const url = linkText.startsWith('http') ? linkText : decode(linkHref);
    const dateText = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated') || pick(block, 'dc:date');
    const date = new Date(stripTags(dateText));
    if (!title || !url || Number.isNaN(date.getTime())) return [];
    const summary = stripTags(pick(block, 'description') || pick(block, 'summary') || pick(block, 'content:encoded')).slice(0, 300);
    return [{ title, url, source, publishedAt: date.toISOString(), summary }];
  });
};

const fetchFeed = async (feed: Feed): Promise<Candidate[]> => {
  const response = await fetch(feed.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ai-news-cardnews)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseFeed(await response.text(), feed.source);
};

export type CollectResult = { candidates: Candidate[]; failures: string[] };

export const collectCandidates = async (now: Date = new Date()): Promise<CollectResult> => {
  const failures: string[] = [];
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        return await fetchFeed(feed);
      } catch (error) {
        failures.push(`${feed.source}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }),
  );

  const limit = now.getTime() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const seen = new Set<string>();
  const candidates = results
    .flat()
    .filter((c) => new Date(c.publishedAt).getTime() >= limit)
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return { candidates, failures };
};

// 직접 실행하면 후보 목록을 출력한다 (피드 점검용)
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const { candidates, failures } = await collectCandidates();
  console.log(`후보 ${candidates.length}건`);
  candidates.slice(0, 15).forEach((c) => console.log(`- [${c.source}] ${c.title} (${c.publishedAt.slice(0, 10)})`));
  console.log('실패한 피드:', failures.length > 0 ? failures : '없음');
}
