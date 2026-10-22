// 모두의 여행길 Q&A 챗봇 색인 생성: node tools/gen-chat-index.js
// js/data.js·FAQ·화면 소개 문구를 청크(앞 청크와 15~20% 겹침)로 나누고 Upstage Solar 임베딩(문서용 embedding-passage)을 미리 계산한다.
//  - api/_chat-index.json : 청크 + 임베딩 (서버리스 함수 /api/chat이 질문용 embedding-query로 비교)
//  - assets/chat-docs.json: 청크 글만 (API를 못 쓸 때 브라우저 키워드 검색용)
// 키는 .env의 UPSTAGE_API_KEY에서 읽는다. --dry 를 붙이면 임베딩 없이 청크만 출력한다.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
global.window = global;
require(path.join(root, 'js/data.js'));
const T = global.TRIP;
const FAQ = require('./faq.js')(T);
const env = require('./env.js')(root);

// Upstage는 문서용·질문용 모델이 따로 있다. 둘은 같은 벡터 공간(4096차원)이라 서로 비교할 수 있다.
const PASSAGE_MODEL = 'embedding-passage';
const QUERY_MODEL = 'embedding-query';
const MAX = 520;        // 청크 최대 글자 수
const OVERLAP = 0.18;   // 앞 청크 끝부분을 다음 청크 앞에 다시 넣는 비율

const groupLabel = Object.fromEntries(T.GROUPS.map(g => [g.id, g.label]));
const needLabel = Object.fromEntries(T.NEEDS.map(n => [n.id, n.title]));
const MODE = { car: '자동차', train: '열차', flight: '항공', walk: '도보', wheel: '휠체어·유모차', boat: '배' };
const won = n => n.toLocaleString('ko-KR') + '원';

// 줄 단위로 MAX 글자까지 채우고, 다음 청크는 앞 청크 본문 끝 약 OVERLAP 비율(문장 경계에서 자름)로 시작한다.
// head(제목 줄)는 모든 청크 앞에 붙여 청크만 봐도 무엇에 대한 글인지 알 수 있게 한다.
function tail(text) {
  const want = Math.round(text.length * OVERLAP);
  let t = text.slice(-want);
  const cut = t.search(/(?<=[.!?。] |\n| \/ )/); // 문장 시작에서 이어 붙이고, 없으면 낱말 시작에서
  if (cut > 0 && cut < want * 0.6) t = t.slice(cut);
  else t = t.slice(t.indexOf(' ') + 1);
  return '… ' + t.trim();
}
function chunk(head, lines) {
  const out = [];
  let cur = [];
  const body = a => a.join('\n');
  for (const line of lines) {
    if (cur.length && body(cur).length + line.length > MAX - head.length && !(cur.length === 1 && out.length && cur[0].startsWith('… '))) {
      out.push(cur);
      cur = [tail(body(cur.filter(l => !l.startsWith('… '))))];
    }
    cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out.map(ls => head + '\n' + body(ls));
}

const docs = [];
function add(id, title, url, head, lines, extra) {
  chunk(head, lines).forEach((text, i, all) => {
    docs.push(Object.assign({ id: all.length > 1 ? id + '#' + (i + 1) : id, title, url, text }, extra || {}));
  });
}

// 화면 소개
add('page-top', '홈 · 모두의 여행길 소개', '#top', '모두의 여행길(Route for All) 소개', [
  '빠른 길 말고 맞는 길로, 누구나 떠나는 여행.',
  '연령대와 몸의 조건에 맞춰 걷는 양, 쉬는 간격, 이동 수단까지 다시 그린 여행 코스예요. 출발부터 도착까지 2D 내비게이션으로 미리 달려볼 수 있어요.',
  '나이가 들면 걸음이 느려지고, 몸이 불편하면 계단 하나가 벽이 돼요. 모두의 여행길은 빠른 길 대신 맞는 길을 찾아요.',
  '여행 코스 ' + T.COURSES.length + '개, 연령대 ' + T.GROUPS.length + '개, 무장애 유형 ' + T.NEEDS.length + '개를 다뤄요.',
  '메뉴: 홈, 연령별 코스, 무장애 여행, 내비 시뮬레이터, 여행 리뷰, Q&A 챗봇.',
  '이 사이트는 비공식 여행 코스 쇼케이스예요. 지도·경로는 시뮬레이션이며 실제 도로 안내가 아니에요.'
]);
add('page-ages', '연령별 코스', '#ages', '연령별 가이드 — 나이마다 다른 여행의 속도', [
  '걷는 양, 이동 간격, 쉬는 시간을 연령대에 맞춰 조절했어요. 코스를 고르면 내비게이션으로 바로 달려볼 수 있어요.',
  '연령대: ' + T.GROUPS.map(g => g.label + '(' + g.title + ')').join(', ') + '.'
]);
T.GROUPS.forEach(g => add('group-' + g.id, '연령별 코스 · ' + g.label, '#ages', g.label + ' 여행 가이드: ' + g.title,
  [g.lead, '준비 팁: ' + g.tips.join(' / '),
   g.label + ' 코스: ' + T.COURSES.filter(c => c.group === g.id).map(c => c.title).join(', ')]));
add('page-access', '무장애 여행', '#access', '무장애 여행 가이드 — 계단 하나가 벽이 되지 않도록', [
  '휠체어 이용자, 보행이 불편한 분, 유모차·임산부와 함께하는 여행을 위해 계단과 오르막을 줄이고 쉬는 지점을 일정에 넣었어요.',
  '무장애 유형으로 코스를 거를 수 있어요: ' + T.NEEDS.map(n => n.title).join(', ') + '.',
  '시설 정보(대여, 엘리베이터, 화장실, 운영 시간)는 바뀔 수 있어요. 출발 전 각 시설에 꼭 확인하세요.'
]);
T.NEEDS.forEach(n => add('need-' + n.id, '무장애 여행 · ' + n.title, '#access', n.title + ' 여행 준비 팁',
  n.points.concat([n.title + ' 코스: ' + T.COURSES.filter(c => c.need === n.id).map(c => c.title).join(', ')])));
add('help', '무장애 여행 · 도움이 필요할 때', '#access', '여행 중 문의처(도움이 필요할 때 전화)',
  T.HELP.map(h => h.label + ' ' + h.value + ': ' + h.note + '.'));
add('page-sim', '내비 시뮬레이터', '#sim', '2D 내비게이션 시뮬레이터 — 출발부터 도착까지 미리 달려보기', [
  '출발지를 고르고 재생을 누르면 경로를 따라 이동하며 길 안내, 도착 예정 시각, 휴식 권장 지점을 보여줘요.',
  '출발 지역은 직접 입력해요. 주요 역(' + Object.values(T.ORIGINS).map(o => o.name).join(', ') + ')과 전국 시·군 ' + T.PLACES.length + '곳을 찾을 수 있고, 출발지에서 가까운 코스 3개를 추천해요.',
  '이동 수단: 코스 추천, 자동차, 대중교통(고속버스·시내버스·지하철·도보), 기차를 고를 수 있어요. 도보·휠체어·배·관광열차 구간은 어떤 수단이든 유지돼요.',
  '목적지에 도착하면 입장권·체험 티켓을 제안해요. 결제는 토스페이먼츠 테스트 환경의 시연 기능이고 요금은 예시예요. 10초 안에 고르지 않으면 다음 목적지로 넘어가요.',
  '현재 코스·출발지·이동 수단을 A4 여행 가이드로 미리 보고 인쇄하거나 PDF로 저장할 수 있어요. 큰 글씨 옵션도 있어요.',
  '화면 오른쪽 위 「가+」 버튼으로 사이트 글자를 크게 볼 수 있어요.'
]);
add('page-reviews', '여행 리뷰', '#reviews', '여행 리뷰 — 다녀온 사람들의 느린 후기', [
  '계단은 많았는지, 쉴 곳은 있었는지. 같은 나이대, 같은 이동 조건을 가진 사람의 후기가 가장 정확한 안내가 돼요.',
  '로그인하면 리뷰를 쓸 수 있어요. 코스별 평점, 정렬(최신순·평점순·도움돼요순), 내 리뷰만 보기를 지원해요.',
  '리뷰를 자동 분석으로 쓰면 글 속 장소·이동 조건·걷기 강도를 찾아 기존 코스와 비교하고, 같은 코스가 없으면 「리뷰에서 태어난 코스」로 새 코스를 만들어요.',
  '계정·리뷰·티켓은 이 브라우저(localStorage)에만 저장되는 데모 기능이에요. 예시 리뷰에는 「예시」 배지가 붙어 있어요.'
]);

// 자주 묻는 질문 (질문·답 한 쌍이 한 청크)
FAQ.forEach(([q, a], i) => docs.push({ id: 'faq-' + (i + 1), title: '자주 묻는 질문 · ' + q, url: '#top', text: 'Q. ' + q + '\nA. ' + a }));

// 코스: 개요 청크 + 정류지 상세 청크
T.COURSES.forEach(c => {
  const who = c.group === 'access' ? '무장애 · ' + needLabel[c.need] : groupLabel[c.group];
  const url = c.group === 'access' ? '#access' : '#ages';
  const head = '[' + who + ' 코스] ' + c.title + ' (' + c.region + ', ' + c.days + ')';
  const acc = c.access || {};
  const lines = [
    c.summary,
    '추천 대상: ' + who + '. 지역: ' + c.region + '. 일정: ' + c.days + '.' + (c.tags ? ' 키워드: ' + c.tags.join(', ') + '.' : ''),
    '가는 방법: ' + (MODE[acc.mode] || '자동차') + (acc.line ? '(' + acc.line + ')' : '') + (acc.hub ? ', ' + acc.hub.name + ' 도착' : '') + '. 현지 이동: ' + (MODE[c.localMode] || c.localMode || '자동차') + '.',
    '경로: ' + c.stops.map(s => s.name).join(' → ')
  ];
  if (typeof c.gentle === 'string') lines.push('휴식 안내: ' + c.gentle);
  if (typeof c.a11y === 'string') lines.push('이동 지원: ' + c.a11y);
  add('course-' + c.id, c.title, url, head, lines, { go: c.id });

  const stopLines = c.stops.map((s, i) => {
    let t = (i + 1) + '. ' + s.name + ' (머무는 시간 약 ' + s.stay + '분' + (s.night ? ', 이후 숙박' : '') + '): ' + s.desc;
    if (s.a11y && s.a11y.length) t += ' 무장애 안내: ' + s.a11y.join(' / ') + '.';
    const tk = T.TICKETS[s.name];
    if (tk) t += ' 티켓(예시 요금): ' + tk.map(k => k.name + ' ' + won(k.price)).join(', ') + '.';
    const pk = T.PERKS && T.PERKS[s.name];
    if (pk) t += ' 우대: ' + pk.text;
    return t;
  });
  add('stops-' + c.id, c.title + ' · 방문지', url, head + ' 방문지 상세', stopLines, { go: c.id });
});

async function embed(texts) {
  const key = env.UPSTAGE_API_KEY;
  if (!key) throw new Error('.env에 UPSTAGE_API_KEY가 없어요');
  const res = await fetch('https://api.upstage.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: PASSAGE_MODEL, input: texts })
  });
  if (!res.ok) throw new Error('Upstage 임베딩 실패 ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  return j.data.sort((a, b) => a.index - b.index).map(d => {
    const v = d.embedding;
    const n = Math.hypot(...v) || 1;
    return v.map(x => Math.round(x / n * 1e5) / 1e5); // 정규화해 두면 내적이 곧 코사인 유사도
  });
}

(async () => {
  if (process.argv.includes('--dry')) {
    docs.forEach(d => console.log('──', d.id, d.text.length + '자\n' + d.text));
    console.log(docs.length, 'chunks');
    return;
  }
  fs.writeFileSync(path.join(root, 'assets/chat-docs.json'), JSON.stringify(docs));
  const vecs = [];
  for (let i = 0; i < docs.length; i += 32) vecs.push(...await embed(docs.slice(i, i + 32).map(d => d.text)));
  const index = { provider: 'upstage', model: PASSAGE_MODEL, queryModel: QUERY_MODEL, dims: vecs[0].length,
    built: new Date().toISOString().slice(0, 10), docs: docs.map((d, i) => Object.assign({}, d, { v: vecs[i] })) };
  fs.writeFileSync(path.join(root, 'api/_chat-index.json'), JSON.stringify(index));
  console.log('ok', docs.length, 'chunks,', PASSAGE_MODEL, index.dims + 'd');
})().catch(e => { console.error(e.message); process.exit(1); });
