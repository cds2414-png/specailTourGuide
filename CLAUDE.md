# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

「모두의 여행길 Route for All」 — 연령별(40세 이하~70세 이상)·무장애 여행 코스를 2D 내비게이션 시뮬레이터로 미리 달려보는 사이트. GitHub `cds2414-png/specailTourGuide`의 저장소 루트가 이 폴더다.

이름은 2026-10 「느린지도 SLOW MAP」에서 바꿨다. 내부 이름(`slowmap.*` 저장소 키, `slowmap:*` 이벤트, `Slow*` 전역 객체)은 사용자 데이터 호환을 위해 그대로 둔다.

**퍼블리싱 전용**: 순수 HTML/CSS/JS만 쓴다. 프레임워크·번들러·npm 패키지·JS 라이브러리를 추가하지 않는다. 빌드·린트·테스트 단계가 없다. 서버 코드가 없으므로 계정·리뷰·리뷰로 만든 코스·티켓은 모두 브라우저 `localStorage`에 저장되는 **데모 기능**이다. 외부 리소스는 Google Fonts, 토스페이먼츠 SDK(`js.tosspayments.com/v2/standard`, 결제할 때만 동적 로드), 위키백과 REST API(목적지 사진)뿐이다.

## 실행 · 검증

정적 서버로 `index.html`을 연다. 결제·사진·결과 페이지가 동작하려면 `file://`이 아니라 `http(s)://`여야 한다. 모든 경로가 상대 경로라 어느 하위 경로에 배포해도 된다.

이 PC에서는 상위 폴더의 PowerShell 정적 서버(Python/Node 없이 동작, `no-cache`, 점 경로 차단)를 쓴다. 웹 루트가 상위 폴더라 주소는 `http://localhost:5500/travel/index.html`이다.

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File ../.claude/serve.ps1 -Root .. -Port 5500
```

- 배포: `main`에 푸시하면 Vercel(`https://specialtourguide.vercel.app/`)이 자동 배포한다(보통 1분 안). 반영 여부는 `curl`로 바뀐 파일을 받아 확인한다. GitHub Pages는 쓰지 않는다.
- 예전 오타 주소 `specailtourguide.vercel.app`은 정식 주소로 307 리다이렉트된다. 문서·코드에는 정식 주소만 쓴다.
- `vercel.json`이 보안 헤더(nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, 최소 CSP)를 붙인다. 전체 CSP는 아직 `Content-Security-Policy-Report-Only`다. 토스 결제창을 끝까지 시험해 콘솔에 위반이 없으면 강제 적용으로 바꾼다. 외부 출처를 추가하면 CSP도 함께 고친다.
- `.vercelignore`로 `CLAUDE.md`와 `tools/`는 배포하지 않는다.
- 같은 주소에서 `#해시`만 바꾸면 새로 로드되지 않는다. 수정 확인 때는 `?r=2` 같은 쿼리를 붙인다.
- 시뮬레이터·연출은 rAF 루프에 의존한다. 브라우저 창이 숨겨지면 rAF가 완전히 멈춰 시뮬레이션이 진행되지 않는다. 진행이 필요한 테스트는 창을 보이게 하거나, 이벤트(`slowmap:progress` 등)를 직접 보내 로직을 확인한다. `document.open()`으로 페이지를 다시 쓰면 window가 재사용되어 이전 스크립트 인스턴스가 함께 남으므로 그 방식으로 테스트하지 않는다.
- 데스크톱(1440)과 모바일(375)을 모두 확인한다. 뷰포트 에뮬레이션 중에는 iframe(토스 결제창) 안 클릭 좌표가 어긋난다.
- 토스 테스트 결제의 마지막 단계(테스트 PIN 입력)는 사람이 해야 한다. 결과 페이지는 `pay/success.html?orderId=…&paymentKey=…&amount=…` 리다이렉트를 흉내 내어 확인할 수 있다(`sessionStorage`의 `slowmap.pendingOrder`와 금액이 맞아야 함).

## 스크립트 순서와 전역 객체 (순서가 중요)

`index.html` 하단 순서대로 실행되며 각 파일은 IIFE로 전역 객체 하나를 노출한다.

1. `js/view.js` → `SlowView` — 화면 전환 라우터. 가장 먼저 실행되어 첫 화면을 정한다.
2. `js/data.js` → `TRIP`(코드에서는 `T`) — 모든 데이터.
3. `js/analyzer.js` → `SlowAnalyzer` — 리뷰 글 분석. **기본 코스 정류지 + `EXTRA` 장소**로 장소 사전을 만든다.
4. `js/community.js` → `SlowCommunity` — 회원·로그인·리뷰. 시작 시 리뷰로 만든 코스를 `T.COURSES`에 합친다(그래서 app.js보다 먼저).
5. `js/app.js` → `SlowApp` — 코스 카드·연령 패널·무장애 필터·내비 시뮬레이터. 끝에서 `SlowCommunity.onAppReady(SlowApp)`를 호출한다.
6. `js/fx.js` — 프리로더·등고선 히어로·마키·스크롤 장면(자체 rAF 루프).
7. `js/explore.js` → `SlowExplore` — 목적지 둘러보기(사진·티켓), 도착지 티켓 제안, 토스페이먼츠 결제.
8. `js/guide.js` → `SlowGuide` — 여행 가이드 A4 미리보기·인쇄.

`pay/success.html`, `pay/fail.html`은 `js/pay.js`만 쓰는 별도 페이지다.

## 화면 전환 (`view.js`)

- 섹션마다 `data-view`(`top`·`ages`·`access`·`sim`·`reviews`), 상단 메뉴 링크에 `data-nav`. 선택한 화면만 보이고 나머지는 `hidden`. 주소 해시와 뒤로 가기를 따른다.
- 다른 화면으로 이어지는 클릭은 **캡처 단계**에서 먼저 화면을 바꾼다: `[data-go]`→sim, `[data-rating]`·`[data-born]`·`[data-my-reviews]`→reviews, `[data-hero-group]`→ages. 새 진입 버튼을 만들면 여기에 추가한다.
- 숨겨진 화면의 캔버스는 크기가 0이다. 화면을 바꾸면 `slowmap:layout`, `slowmap:view` 이벤트가 나가고 app.js·fx.js가 크기를 다시 잡는다.

## 커스텀 이벤트

`slowmap:layout`(재측정), `slowmap:view`(화면 전환), `slowmap:course`(코스 로드, `{course, legs}`), `slowmap:progress`(시뮬레이터 진행, `{li, phase, stop, stopNo}` — `phase`는 `idle`·`move`·`dwell`·`done`). explore.js는 이 이벤트로 현재 목적지를 따라간다.

## 데이터 (`js/data.js`)

- `GROUPS`: 연령 그룹 `u40`·`g40`·`g50`·`g60`·`o70`. `NEEDS`: 무장애 유형 `wheel`·`walk`·`family`.
- `COURSES`: `group`(연령 id 또는 `'access'`), `need`, `access`(`{mode: car|train|flight, hub, line}` — 출발지에서 여행 지역까지), `localMode`, `gentle`·`a11y`(휴식 안내·콜택시 문구), `stops[]`.
- 정류지: `name`, `lat`·`lng`(근사 좌표), `stay`(분), `road`, `desc`, `a11y[]`, `night`(다음 날로 넘김), `mode`·`line`(그 정류지로 가는 수단 덮어쓰기, 예: `train` + `'해변열차'`).
- `ORIGINS`(출발역 + `airport` + `terminal`), `STATIONS`(기차 선택 시 역), `TICKETS`(**정류지 이름이 키**, 요금은 시연용 예시), `WIKI`(사진 검색어 덮어쓰기, `null`이면 사진 대신 그림), `LAND`·`JEJU`·`CITIES`·`HIGHWAYS`(지도 배경).

## 내비 시뮬레이터 (`js/app.js`)

- 좌표는 `proj()`로 km 평면에 투영한다. `buildRoute(course, originKey, plan)`이 구간(leg) 배열을 만든다. `plan`은 `auto`(코스 추천)·`car`·`transit`(고속버스 + 시내버스/지하철 + 도보)·`train`.
- 도보·휠체어·배·관광열차 구간은 어떤 수단을 골라도 유지된다. 정류장·역·터미널처럼 거쳐 가는 지점은 `minor`, 대기 시간은 `wait`.
- `makeLeg`가 경로 점(`pts`·`cum`), 턴바이턴 안내(`ins`), 속도·이동 시간을 계산하고, `buildRoute` 끝에서 시각표(`c0` 출발, `c1` 도착, `c2` 다음 출발)를 채운다.
- 단일 rAF 루프 `loop()` → `step()`(진행) → `updateCamera()` → `draw()`·`drawMinimap()`·`updateHUD()`. 도착하면 `phase='dwell'`로 잠시 머문 뒤 다음 구간으로 간다. `S.hold`가 참이면 머무름이 멈춘다.
- `SlowApp` API: `cardHTML`, `drawCardMaps`, `refresh`, `state`, `load`, `guideData`, `routeImage(w, h, local)`, `holdDwell`, `releaseDwell`.

## 도착지 티켓 제안 (`js/explore.js`)

티켓(`TICKETS`)이 있는 중간 목적지에 도착하면 `holdDwell()`로 멈추고 도착 카드에 티켓을 제안한다. 「구매 안 하고 다음 목적지로」, 10초 카운트다운 종료, 구매창을 결제 없이 닫음 → `releaseDwell()`로 다음 목적지로 진행한다. 일시정지 중에는 카운트다운도 멈추고, 결제를 시작했으면 넘어가지 않는다. 구매창 닫힘은 `close` 이벤트가 늦게 올 수 있어 `open` 속성을 MutationObserver로 감지한다.

## 리뷰 분석 → 코스 자동 생성

리뷰 작성 시 코스 기본값이 `__auto__`다. `SlowAnalyzer.analyze()`가 글에서 장소(2곳 이상)·이동 조건·걷기 강도·편의 태그를 찾고, 기존 코스 정류지와 0.8km 안에서 60% 이상 겹치면 그 코스의 리뷰로, 아니면 `gen-` 코스를 만들어 `slowmap.courses`에 저장한다. 생성 코스는 연령 패널에는 넣지 않고 리뷰 화면의 「리뷰에서 태어난 코스」에 보이며, 무장애 생성 코스는 무장애 필터에도 나온다. 마지막 리뷰를 지우면 코스도 지워진다.

## 결제 (퍼블리싱 범위)

`explore.js`의 `TOSS.CLIENT_KEY`는 토스 문서용 공개 테스트 키다. 주문번호·금액을 프런트에서 만들어 `sessionStorage`의 `slowmap.pendingOrder`에 두고, `pay/success.html`이 리다이렉트 금액과 대조한 뒤 티켓을 `slowmap.tickets`에 저장한다. 시크릿 키가 필요한 **결제 승인 API는 호출하지 않는다**(상태는 「결제 인증 완료」). 실제 승인은 서버 연동이 필요하며, 시크릿 키를 클라이언트 코드에 넣지 않는다. SDK 사용법(v2 결제창형: `widgets` → `setAmount` → `renderPaymentWindow` → `paymentRequest` 이벤트에서 `requestPayment`)은 토스페이먼츠 연동 문서 MCP(`@tosspayments/integration-guide-mcp`)로 확인한다.

## 가이드 출력 (`js/guide.js`)

`SlowApp.guideData()`와 `routeImage()`로 현재 코스·출발지·이동 수단을 A4 문서로 엮어 `#printView`(`<dialog class="pv">`)에 미리 보여주고 `window.print()`로 인쇄한다. 출발지에서 먼 이동이 있으면 전체 경로와 목적지 주변 확대 지도 두 장을 넣는다. 인쇄 CSS는 `body.is-printing`일 때 `#printView`만 출력한다.

## 저장소 키

`localStorage`: `slowmap.users`(비밀번호는 PBKDF2 해시+솔트), `slowmap.session`, `slowmap.reviews`, `slowmap.courses`, `slowmap.tickets`, `slowmap-big`(글자 크게). `sessionStorage`: `slowmap.pendingOrder`, `slowmap.photos`(위키백과 사진 캐시).

## CSS (`css/style.css`)

- 토큰은 `:root`(`--paper`, `--ink`, `--signal` 주황, `--sky` 무장애 파랑, `--sun`). 라이트 디자인.
- 브레이크포인트 1180px / 900px(햄버거 메뉴, 단일 컬럼) / 640px.
- `[hidden] { display: none !important; }`가 전역이라 `display`를 지정한 요소도 `hidden`으로 숨겨진다.
- 대화상자는 `<dialog class="dlg">` + `showModal()`.
- 커서는 CSS `cursor: url(assets/cursor.svg)`(기본 화살표)와 `cursor-hover.svg`(누를 수 있는 곳, 주황)다. 시스템 커서를 숨기는 커스텀 커서는 쓰지 않는다(OS 확대 커서 사용자 배려).
- 밝은 바탕 위 주황 글자는 `--signal-ink`(대비 4.5:1 이상)를 쓰고, `--signal`은 면·선·어두운 바탕에만 쓴다. 보조 글자 크기는 .78rem 아래로 내리지 않는다.

## SEO · AEO · GEO

- 배포 주소는 `https://specialtourguide.vercel.app/`(Vercel). canonical·OG·sitemap·robots·JSON-LD가 이 절대 주소를 쓴다. 주소가 바뀌면 `index.html`, `robots.txt`, `sitemap.xml`, `tools/gen-seo.js`의 `SITE`를 함께 바꾼다.
- `index.html`의 `<!-- seo:jsonld -->`(Organization·WebSite·WebApplication·코스 ItemList·FAQPage), `<!-- seo:faq -->`(홈 화면 FAQ 섹션 `#faq`), `<!-- seo:courses -->`(`<noscript>` 코스 요약)와 `llms.txt`는 **생성된 블록**이다. 손으로 고치지 말고 `js/data.js`나 `tools/gen-seo.js`의 `FAQ`를 고친 뒤 `node tools/gen-seo.js`로 다시 만든다(Node는 이 작업에만 쓰고 사이트는 Node에 의존하지 않는다). 화면 FAQ와 FAQPage 구조화 데이터는 같은 문구여야 한다.
- `robots.txt`는 생성형 AI 검색 봇을 허용하고 `/pay/`만 막는다. 결제 결과 페이지는 `noindex`.
- `google68425b399eea28fe.html`은 Google Search Console(URL 접두어 속성) 소유권 확인 파일이다. 지우면 인증이 풀리므로 남겨 둔다. 기존 속성은 오타 주소로 등록되어 있어 정식 주소 속성을 새로 추가해야 한다(같은 파일로 인증).
- Search Console 사이트맵 입력란은 자동 완성 값이 미리 들어갈 수 있다. 제출 전에 입력값을 확인한다(잘못 제출된 `/sitemap.htmlsitemap.xml` 항목이 남아 있음).
- 공유 이미지 `assets/og-image.png`(1200×630), 로고 `assets/logo.png`, `assets/apple-touch-icon.png`, 파비콘 `favicon.svg`.

## 콘텐츠 원칙

- 좌표·소요 시간·지도·경로는 시뮬레이션용 근사치다. 화면과 푸터의 고지를 유지한다.
- 시설 정보(엘리베이터, 대여, 운영 시간)는 「방문 전 확인」 표현을 쓰고 단정하지 않는다. 입장권·체험 요금은 **예시**로 표기한다.
- 예시 리뷰는 「예시」 배지로 실제 후기가 아님을 밝힌다. 위키백과 사진에는 출처를 표기한다.
