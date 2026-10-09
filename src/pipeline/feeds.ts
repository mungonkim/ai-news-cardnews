// 기사 후보를 모으는 RSS 목록. 열리지 않는 곳은 건너뛰므로, 맞지 않으면 여기서 고치면 된다.
export type Feed = { source: string; url: string };

export const FEEDS: Feed[] = [
  // 공식 발표
  { source: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { source: 'Google AI', url: 'https://blog.google/technology/ai/rss/' },
  { source: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { source: 'NVIDIA', url: 'https://blogs.nvidia.com/feed/' },
  // 해외 매체
  { source: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { source: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { source: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/' },
  { source: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  // 국내 매체
  { source: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml' },
  // 반응 확인
  { source: 'Hacker News', url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+ChatGPT+OR+Claude+OR+Gemini&points=150' },
];
