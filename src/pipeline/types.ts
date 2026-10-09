// 파이프라인 단계 사이에서 주고받는 데이터 형태
import type { CardContent } from '../templates.ts';

// RSS 등에서 모은 기사 후보
export type Candidate = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string;
};

// 오늘 다룰 기사로 선정된 결과
export type Selection = {
  title: string;
  url: string;
  source: string;
  // 영문 소문자와 하이픈으로 된 짧은 이름 (폴더 이름에 쓴다)
  slug: string;
  reason: string;
  // 사용자가 직접 해 보면 재미있는 소식인지 (체험형 과제 후보)
  experienceCandidate: boolean;
  experienceNote: string;
};

// 공식 원문으로 확인한 사실
export type VerifiedFacts = {
  facts: string[];
  unverified: string[];
  sources: { title: string; url: string }[];
  terms: { term: string; plain: string }[];
  // 기사에 나오는 날짜 (예: 2026.10.7)
  publishedDate: string;
};

// 만들어야 할 이미지 한 장의 요청
export type ImageRequest = {
  // 이미지를 넣을 장 번호 (0부터. 0은 표지)
  slideIndex: number;
  scene: string;
  shoot: string;
};

export type WrittenCard = {
  card: CardContent;
  caption: string;
  images: ImageRequest[];
};
