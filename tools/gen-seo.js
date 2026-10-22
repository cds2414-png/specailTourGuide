// 모두의 여행길 SEO/AEO/GEO 정적 블록 생성: node tools/gen-seo.js
// js/data.js 코스·FAQ로 index.html의 seo:jsonld·seo:faq·seo:courses 블록과 llms.txt를 다시 쓴다. 사이트 실행에는 필요 없다.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, "..");
global.window = global;
require(path.join(root, 'js/data.js'));
const T = global.TRIP;
const SITE = 'https://specialtourguide.vercel.app/';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const groupLabel = Object.fromEntries(T.GROUPS.map(g => [g.id, g.label]));
const needLabel = Object.fromEntries(T.NEEDS.map(n => [n.id, n.title]));
const origins = Object.values(T.ORIGINS).map(o => o.name);
const courses = T.COURSES;
const audience = c => c.group === 'access' ? needLabel[c.need] : groupLabel[c.group];

const FAQ = require('./faq.js')(T);

const org = { '@type': 'Organization', '@id': SITE + '#org', name: '모두의 여행길 Route for All', alternateName: ['모두의 여행길', 'Route for All'], url: SITE, logo: SITE + 'assets/logo.png' };
const graph = [
  org,
  { '@type': 'WebSite', '@id': SITE + '#website', url: SITE, name: '모두의 여행길 Route for All', alternateName: '모두의 여행길', inLanguage: 'ko-KR', publisher: { '@id': SITE + '#org' },
    description: '연령대별·무장애 국내 여행 코스를 출발부터 도착까지 2D 내비게이션으로 미리 달려보는 여행 가이드' },
  { '@type': 'WebApplication', '@id': SITE + '#app', name: '모두의 여행길 2D 내비게이션 시뮬레이터', url: SITE + '#sim', applicationCategory: 'TravelApplication', operatingSystem: 'Web', inLanguage: 'ko-KR',
    isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' }, publisher: { '@id': SITE + '#org' },
    featureList: ['연령대별 여행 코스 추천', '휠체어·보행 불편·유모차 동반 무장애 코스', '출발지별 자동차·대중교통·기차 경로 시뮬레이션', 'A4 여행 가이드 인쇄·PDF 저장', '글자 크게 보기'] },
  { '@type': 'ItemList', '@id': SITE + '#courses', name: '모두의 여행길 코스', numberOfItems: courses.length,
    itemListElement: courses.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: {
      '@type': 'TouristTrip', name: c.title, description: c.summary, touristType: audience(c),
      keywords: [c.region, c.days].concat(c.tags || []).join(', '), provider: { '@id': SITE + '#org' },
      itinerary: { '@type': 'ItemList', itemListElement: c.stops.map((s, j) => ({ '@type': 'ListItem', position: j + 1, item: { '@type': 'TouristAttraction', name: s.name, description: s.desc } })) }
    } })) },
  { '@type': 'FAQPage', '@id': SITE + '#faq', inLanguage: 'ko-KR',
    mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
];
const jsonld = '<script type="application/ld+json">\n' + JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }) + '\n  </script>';

const faqHTML = FAQ.map(([q, a]) => '        <details class="faq__item">\n          <summary><h3>' + esc(q) + '</h3></summary>\n          <p>' + esc(a) + '</p>\n        </details>').join('\n');

const sections = [['연령별 코스', courses.filter(c => c.group !== 'access')], ['무장애 코스', courses.filter(c => c.group === 'access')]];
const nsHTML = sections.map(([h, list]) => '      <h3>' + h + '</h3>\n      <ul>\n' + list.map(c =>
  '        <li><b>' + esc(c.title) + '</b> (' + esc(audience(c)) + ' · ' + esc(c.region) + ' · ' + esc(c.days) + ') — ' + esc(c.summary) + ' 코스: ' + esc(c.stops.map(s => s.name).join(' → ')) + '</li>').join('\n') + '\n      </ul>').join('\n');

const llms = [
  '# 모두의 여행길 Route for All',
  '',
  '> 연령대(' + T.GROUPS.map(g => g.label).join('·') + ')와 몸의 조건(' + T.NEEDS.map(n => n.title).join('·') + ')에 맞춘 국내 여행 코스를 출발부터 도착까지 2D 내비게이션 시뮬레이터로 미리 달려보는 한국어 여행 가이드 웹사이트예요.',
  '',
  '- 사이트: ' + SITE,
  '- 언어: 한국어',
  '- 코스 수: ' + courses.length + '개, 출발지: 직접 입력(주요 역 ' + origins.join(', ') + ' + 전국 시·군 ' + T.PLACES.length + '곳)',
  '- 지도·경로·소요 시간은 시뮬레이션용 근사치이며 실제 도로 안내가 아니에요. 시설 운영 정보는 방문 전 확인이 필요해요.',
  '- 티켓 결제는 토스페이먼츠 테스트 환경의 시연 기능이고, 요금은 예시예요.',
  '',
  '## 화면',
  '',
  '- [홈](' + SITE + '#top): 서비스 소개와 자주 묻는 질문',
  '- [연령별 코스](' + SITE + '#ages): 연령대마다 걷는 양·쉬는 간격을 조절한 코스',
  '- [무장애 여행](' + SITE + '#access): 휠체어·보행 불편·유모차 동반 코스와 준비 팁',
  '- [내비 시뮬레이터](' + SITE + '#sim): 출발지·이동 수단을 고르고 경로를 미리 달려보기, A4 가이드 인쇄',
  '- [여행 리뷰](' + SITE + '#reviews): 후기와 리뷰에서 만들어진 코스',
  '- [Q&A 챗봇](' + SITE + '#chat): 사이트 내용을 근거로 코스·무장애 준비·사용법을 답하는 챗봇 (근거 페이지와 유사도 표시)',
  '',
  '## 연령별 준비 팁',
  ''
].concat(T.GROUPS.map(g => '- ' + g.label + ': ' + g.title + '. ' + g.tips.join(' / ')))
 .concat(['', '## 무장애 준비 팁', ''])
 .concat(T.NEEDS.map(n => '- ' + n.title + ': ' + n.points.join(' / ')))
 .concat(['', '## 여행 코스', ''])
 .concat(courses.map(c => '- ' + c.title + ' (' + audience(c) + ', ' + c.region + ', ' + c.days + '): ' + c.summary + ' 경로: ' + c.stops.map(s => s.name).join(' → ')))
 .concat(['', '## 자주 묻는 질문', ''])
 .concat(FAQ.flatMap(([q, a]) => ['### ' + q, '', a, '']))
 .join('\n');

// index.html 표식 사이 교체
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8');
const put = (name, body) => {
  const re = new RegExp('(<!-- seo:' + name + ' -->)[\\s\\S]*?(<!-- /seo:' + name + ' -->)');
  if (!re.test(html)) throw new Error('marker missing: ' + name);
  html = html.replace(re, (m, a, b) => a + '\n' + body + '\n  ' + b);
};
put('jsonld', '  ' + jsonld);
put('faq', faqHTML);
put('courses', nsHTML);
fs.writeFileSync(file, html);
fs.writeFileSync(path.join(root, 'llms.txt'), llms + '\n');
console.log('ok', courses.length, 'courses,', FAQ.length, 'faq');
