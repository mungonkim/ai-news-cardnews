# AI 뉴스 카드뉴스 시스템

매일 최신 AI 뉴스 한 건을 골라, AI를 잘 모르는 사람도 이해할 수 있는 인스타그램 카드뉴스(7장)와 게시물 문구를 만들어 슬랙으로 보낸다. 업로드는 사람이 직접 한다.

## 동작 순서
```
GitHub Actions (매일 08:00 KST)
 1. RSS로 기사 후보 수집 (src/pipeline/collect.ts, 목록은 feeds.ts)
 2. Claude가 기사 1건 선정 (일상 영향, 공식 발표, 설명 용이성) + 체험 후보 표시
 3. Claude가 공식 원문으로 사실 확인 (확인하지 못한 내용은 카드에서 제외)
 4. Claude가 카드 7장 + 게시물 문구 + 이미지 장면 작성
 5. 이미지 API로 표지와 중간 장 이미지 생성 (src/pipeline/images.ts)
 6. HTML 템플릿 → Chromium → PNG 1080x1350 (src/render.ts, templates.ts)
 7. 슬랙으로 카드 + 게시물 문구 + 출처 전송, 오류도 슬랙으로 알림
 8. 다룬 기사 기록(data/covered-articles.json)으로 중복 방지
```

## 필요한 비밀키 (GitHub Secrets에만 넣는다. 코드나 채팅에 적지 않는다)
| 이름 | 용도 |
|---|---|
| ANTHROPIC_API_KEY | 기사 선정, 사실 확인, 카드 작성 |
| OPENAI_API_KEY | 이미지 생성 (모델은 IMAGE_MODEL 환경변수로 바꿀 수 있다) |
| SLACK_BOT_TOKEN | 슬랙 봇 토큰 (권한: files:write, chat:write) |
| SLACK_CHANNEL_ID | 결과를 받을 채널 ID |

## 실행
```bash
npm ci
cp .env.example .env        # 값을 채운다 (내 컴퓨터에서 시험할 때만)
npm run start:local -- --no-slack            # 폴더에만 저장
npm run start:local -- --url <기사 주소>       # 특정 기사로 만들기
npm run start:local -- --no-images --no-slack  # 이미지 API 없이 구조만 확인
npm run collect                               # RSS 후보만 확인
npm run typecheck
```
결과는 `output/<날짜-이름>/`에 `cards/`(PNG), `caption.txt`, `report.md`, `card.json`으로 저장된다.

## 폴더
- `src/pipeline/` 수집, Claude 호출, 이미지, 슬랙
- `src/templates.ts`, `src/render.ts` 카드 디자인과 렌더링
- `prompts/image-prompt.md` 이미지 프롬프트 체계, `prompts/card-example.json` 카드 JSON 예시
- `content/` 직접 만든 카드 (첫 카드와 샘플)
- `data/covered-articles.json` 다룬 기사 기록

## 규칙
- 확인된 사실만 카드에 쓴다. 기사 문장과 이미지는 그대로 쓰지 않는다.
- 개인정보와 비밀키는 저장소에 넣지 않는다.
