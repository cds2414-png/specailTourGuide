/* 느린지도 — 리뷰 분석기
   리뷰 글에서 장소·이동 조건·편의 태그를 찾아내고, 기존 코스와 비교해
   같은 코스인지, 새 코스로 만들지 판단한다. 서버 없이 장소 사전과 키워드 규칙으로 동작한다.
   장소 좌표는 시뮬레이션용 근사치다. */
window.SlowAnalyzer = (function () {
  'use strict';

  var T = window.TRIP;

  /* ───────── 장소 사전 ───────── */
  // [이름, 지역, 위도, 경도, 별칭, 한 줄 설명]
  var EXTRA = [
    ['창덕궁', '서울', 37.5794, 126.9910, [], '후원이 아름다운 조선 궁궐이에요.'],
    ['창경궁', '서울', 37.5788, 126.9950, [], '대온실이 있는 조선 궁궐이에요.'],
    ['북촌한옥마을', '서울', 37.5826, 126.9836, ['북촌'], '한옥 골목이 모인 마을이에요. 오르막 골목이 있어요.'],
    ['인사동', '서울', 37.5740, 126.9850, ['인사동길'], '전통 공예품 가게와 찻집이 모인 거리예요.'],
    ['명동', '서울', 37.5636, 126.9827, ['명동거리'], '쇼핑과 길거리 음식으로 붐비는 거리예요.'],
    ['남대문시장', '서울', 37.5592, 126.9776, [], '오래된 대형 전통시장이에요.'],
    ['광장시장', '서울', 37.5701, 127.0000, [], '빈대떡과 육회로 알려진 시장이에요.'],
    ['청계천', '서울', 37.5690, 126.9780, [], '도심을 가로지르는 하천 산책로예요.'],
    ['동대문디자인플라자', '서울', 37.5665, 127.0092, ['DDP'], '곡선 건축으로 유명한 전시·디자인 공간이에요.'],
    ['롯데월드타워', '서울', 37.5126, 127.1025, ['서울스카이', '롯데타워'], '초고층 전망대가 있는 타워예요.'],
    ['석촌호수', '서울', 37.5096, 127.1040, [], '호수를 둘러싼 평지 산책로가 있어요.'],
    ['서울숲', '서울', 37.5444, 127.0374, [], '넓은 평지 숲 공원이에요.'],
    ['여의도한강공원', '서울', 37.5284, 126.9340, ['여의도'], '한강을 따라 넓은 잔디밭이 있는 공원이에요.'],
    ['홍대거리', '서울', 37.5563, 126.9220, ['홍대'], '공연과 카페가 많은 거리예요.'],
    ['수원화성', '수원', 37.2871, 127.0119, ['화성행궁'], '성곽을 따라 걷는 세계유산이에요.'],
    ['에버랜드', '용인', 37.2939, 127.2025, [], '대형 테마파크예요.'],
    ['한국민속촌', '용인', 37.2588, 127.1180, ['민속촌'], '조선 시대 마을을 재현한 곳이에요.'],
    ['두물머리', '양평', 37.5340, 127.3180, [], '두 강이 만나는 강변 풍경 명소예요.'],
    ['헤이리마을', '파주', 37.7880, 126.6990, ['헤이리'], '갤러리와 카페가 모인 예술 마을이에요.'],
    ['임진각', '파주', 37.8890, 126.7400, [], '분단의 역사를 돌아보는 평화 관광지예요.'],
    ['인천차이나타운', '인천', 37.4757, 126.6173, ['차이나타운'], '짜장면 거리로 알려진 동네예요. 오르막이 있어요.'],
    ['송도센트럴파크', '인천', 37.3925, 126.6390, ['센트럴파크'], '바닷물 수로가 있는 평지 도심 공원이에요.'],
    ['을왕리해수욕장', '인천', 37.4470, 126.3730, ['을왕리'], '노을이 아름다운 해변이에요.'],
    ['속초해수욕장', '속초', 38.1910, 128.6010, [], '시내와 가까운 넓은 해변이에요.'],
    ['설악산 소공원', '속초', 38.1730, 128.4880, ['설악산', '권금성'], '설악산 입구 공원이에요. 케이블카로 전망대에 오를 수 있어요.'],
    ['주문진항', '강릉', 37.8930, 128.8290, ['주문진'], '수산시장이 있는 항구예요.'],
    ['정동진', '강릉', 37.6910, 129.0340, [], '해돋이 명소로 알려진 바닷가예요.'],
    ['경포해변', '강릉', 37.8055, 128.9080, ['경포대', '경포해수욕장'], '호수와 바다가 맞닿은 해변이에요.'],
    ['대관령 양떼목장', '평창', 37.6880, 128.7520, ['양떼목장'], '초원 언덕에서 양을 볼 수 있는 목장이에요. 오르막이 있어요.'],
    ['공산성', '공주', 36.4630, 127.1250, [], '금강을 내려다보는 백제 성곽이에요.'],
    ['궁남지', '부여', 36.2700, 126.9110, [], '연꽃 연못이 있는 백제 정원이에요.'],
    ['대천해수욕장', '보령', 36.3160, 126.5130, ['대천해변'], '넓은 모래사장의 서해 해변이에요.'],
    ['청남대', '청주', 36.4620, 127.4890, [], '대청호 옆 옛 대통령 별장이에요.'],
    ['꽃지해수욕장', '태안', 36.4970, 126.3360, ['꽃지', '안면도'], '할미·할아비 바위 노을 명소예요.'],
    ['목포 해상케이블카', '목포', 34.7860, 126.3780, ['목포케이블카'], '바다 위를 건너는 케이블카예요.'],
    ['보성 녹차밭', '보성', 34.7320, 127.0830, ['대한다원', '녹차밭'], '계단식 차밭이 펼쳐진 곳이에요. 경사가 있어요.'],
    ['양림동', '광주', 35.1390, 126.9150, ['양림동역사문화마을'], '근대 건축과 골목이 남은 마을이에요.'],
    ['여수 해상케이블카', '여수', 34.7470, 127.7560, ['여수케이블카'], '돌산과 시내를 잇는 바다 케이블카예요.'],
    ['태종대', '부산', 35.0530, 129.0870, [], '절벽과 바다를 보는 공원이에요. 순환 열차가 다녀요.'],
    ['자갈치시장', '부산', 35.0966, 129.0306, ['자갈치'], '바다 옆 대형 수산시장이에요.'],
    ['국제시장', '부산', 35.1012, 129.0280, [], '오래된 골목 상가 시장이에요.'],
    ['해동용궁사', '부산', 35.1883, 129.2233, ['용궁사'], '바닷가 바위 위 사찰이에요. 계단이 많아요.'],
    ['석굴암', '경주', 35.7948, 129.3490, [], '토함산 중턱의 석굴 사원이에요. 오르막이 있어요.'],
    ['보문호', '경주', 35.8430, 129.2830, ['보문관광단지', '보문단지'], '호숫가 산책로가 있는 관광단지예요.'],
    ['대릉원', '경주', 35.8380, 129.2120, [], '신라 고분이 모인 평지 공원이에요.'],
    ['동피랑마을', '통영', 34.8450, 128.4270, ['동피랑'], '언덕 위 벽화 마을이에요. 오르막이 있어요.'],
    ['통영 케이블카', '통영', 34.8260, 128.4260, ['미륵산'], '미륵산에 오르는 케이블카예요.'],
    ['바람의 언덕', '거제', 34.7420, 128.6630, [], '바다를 보는 언덕 풍차 명소예요.'],
    ['외도 보타니아', '거제', 34.7690, 128.7140, ['외도'], '배로 들어가는 섬 정원이에요.'],
    ['남해 독일마을', '남해', 34.8000, 128.0400, ['독일마을'], '바다를 내려다보는 언덕 마을이에요.'],
    ['호미곶', '포항', 36.0770, 129.5690, ['상생의손'], '바다 위 손 조형물로 알려진 해돋이 명소예요.'],
    ['이월드', '대구', 35.8530, 128.5660, ['83타워'], '놀이공원과 전망 타워가 있는 곳이에요.'],
    ['동성로', '대구', 35.8690, 128.5960, [], '대구 도심 번화가예요.'],
    ['대왕암공원', '울산', 35.4920, 129.4410, ['대왕암'], '해송 숲길과 바위 해안이 있는 공원이에요.'],
    ['진주성', '진주', 35.1900, 128.0800, [], '남강을 끼고 있는 성곽 공원이에요.'],
    ['우도', '제주', 33.5060, 126.9540, [], '배로 들어가는 작은 섬이에요.'],
    ['천지연폭포', '제주', 33.2470, 126.5600, [], '산책로 끝에 있는 폭포예요.'],
    ['주상절리대', '제주', 33.2380, 126.4250, ['중문주상절리'], '육각 기둥 바위 해안이에요.'],
    ['오설록 티뮤지엄', '제주', 33.3060, 126.2890, ['오설록'], '녹차밭 옆 차 박물관이에요.'],
    ['사려니숲길', '제주', 33.4170, 126.6440, ['사려니숲'], '삼나무 숲 산책길이에요.'],
    ['용두암', '제주', 33.5160, 126.5120, [], '용 머리 모양 바위가 있는 해안이에요.'],
    ['카멜리아힐', '제주', 33.2900, 126.3700, [], '동백 수목원이에요.'],
    ['애월 한담해안', '제주', 33.4630, 126.3100, ['애월', '한담해안산책로'], '카페가 모인 해안 산책로예요.']
  ];
  // 기존 코스 정류지의 흔한 별칭
  var ALIAS = {
    'N서울타워': ['남산타워', '남산서울타워', '서울타워'],
    '해운대해수욕장': ['해운대'],
    '동궁과 월지': ['안압지'],
    '블루라인파크 미포정거장': ['미포정거장'],
    '해운대 블루라인파크': ['블루라인파크', '해변열차'],
    '국립중앙박물관': ['중앙박물관'],
    '양양 서피비치': ['서피비치'],
    '메타세쿼이아 가로수길': ['메타세쿼이아길'],
    '김광석다시그리기길': ['김광석길'],
    '동문재래시장': ['동문시장'],
    '속초관광수산시장': ['속초중앙시장', '속초시장'],
    '서울로7017': ['서울로']
  };
  var METRO = ['서울', '부산', '대구', '인천', '대전', '광주', '울산', '세종', '제주'];
  var STRIP = ['문화마을', '해수욕장', '민속마을', '한옥마을', '재래시장', '해변', '공원', '시장'];

  function norm(s) { return String(s || '').toLowerCase().replace(/[\s·.,!?~'"()[\]{}\-_/]/g, ''); }
  function regionOf(course) {
    var r = course.region.split('·')[0].trim().split(' ');
    return METRO.indexOf(r[0]) >= 0 ? r[0] : r[r.length - 1];
  }
  function addKeys(entry, list) {
    list.forEach(function (k) { k = norm(k); if (k.length >= 2 && entry.keys.indexOf(k) < 0) entry.keys.push(k); });
  }

  var GAZ = [], byName = {};
  function addPlace(name, region, lat, lng, aliases, desc) {
    if (byName[name]) return;
    var e = { id: 'p' + GAZ.length, name: name, region: region, lat: lat, lng: lng, desc: desc, keys: [] };
    addKeys(e, [name].concat(aliases || []));
    // 지명 뒤 흔한 꼬리말을 뗀 짧은 이름도 키로 사용 (예: 광안리 해변 → 광안리)
    STRIP.forEach(function (s) {
      var n = norm(name);
      if (n.length > s.length + 1 && n.slice(-s.length) === s) addKeys(e, [n.slice(0, -s.length)]);
    });
    GAZ.push(e); byName[name] = e;
  }
  // 기본 코스의 정류지 (사용자 생성 코스는 제외)
  T.COURSES.forEach(function (c) {
    if (c.generated) return;
    c.stops.forEach(function (s) { addPlace(s.name, regionOf(c), s.lat, s.lng, ALIAS[s.name], s.desc); });
  });
  EXTRA.forEach(function (p) { addPlace(p[0], p[1], p[2], p[3], p[4], p[5]); });

  /* ───────── 거리 ───────── */
  function km(a, b) {
    var R = 6371, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ───────── 장소 찾기 ───────── */
  function findPlaces(text) {
    var t = norm(text), hits = [];
    GAZ.forEach(function (g) {
      g.keys.forEach(function (k) {
        var i = t.indexOf(k);
        while (i >= 0) { hits.push({ g: g, s: i, e: i + k.length }); i = t.indexOf(k, i + 1); }
      });
    });
    // 긴 이름 우선, 겹치는 짧은 이름은 버림 (예: 해운대 블루라인파크 > 해운대)
    hits.sort(function (a, b) { return (b.e - b.s) - (a.e - a.s) || a.s - b.s; });
    var taken = [];
    hits = hits.filter(function (h) {
      if (taken.some(function (x) { return h.s < x.e && x.s < h.e; })) return false;
      taken.push(h); return true;
    });
    hits.sort(function (a, b) { return a.s - b.s; });
    var seen = {}, out = [];
    hits.forEach(function (h) {
      if (seen[h.g.id]) return;
      // 300m 안의 사실상 같은 장소는 하나로
      if (out.some(function (p) { return km(p, h.g) < 0.3; })) return;
      seen[h.g.id] = 1; out.push(h.g);
    });
    // 한 코스로 묶기 어려운 먼 장소(첫 장소에서 120km 초과)는 제외
    if (out.length > 1) {
      var first = out[0];
      out = out.filter(function (p) { return km(first, p) <= 120; });
    }
    return out.slice(0, 5);
  }

  /* ───────── 키워드 규칙 ───────── */
  var TAG_RULES = [
    ['stairs', /계단(이|은)?\s*(없|적|거의\s*없)/],
    ['rest', /(벤치|쉴\s*곳|쉼터|쉬어\s*가기\s*좋|쉬기\s*좋|앉을\s*곳)/],
    ['toilet', /화장실.{0,8}(깨끗|편|넓|많|있)/],
    ['lift', /(엘리베이터|승강기)/],
    ['drop', /(바로\s*앞|입구\s*앞|앞에\s*내|가까이\s*내|하차\s*(지점|위치)?.{0,4}가까)/],
    ['flat', /(평지|평탄|완만|길이\s*평평)/],
    ['crowd', /(붐비|붐볐|붐벼|사람이\s*(너무\s*)?많|복잡했|대기\s*줄|줄이\s*길)/],
    ['slope', /(오르막|경사|언덕|계단이\s*많|가파)/]
  ];
  function detectTags(text) {
    var out = [];
    TAG_RULES.forEach(function (r) { if (r[1].test(text)) out.push(r[0]); });
    return out;
  }
  function detectNeed(text) {
    if (/휠체어/.test(text)) return 'wheel';
    if (/(유모차|임산부|임신|아기|영아)/.test(text)) return 'family';
    if (/(지팡이|보행기|무릎|다리가\s*불편|거동|관절|걷기\s*(가\s*)?힘들|걷는\s*게\s*힘)/.test(text)) return 'walk';
    return '';
  }
  function detectWalk(text, need) {
    if (need) return 1;
    var w = 3;
    if (/(많이\s*걸|만\s*보|오래\s*걸|등산|트레킹|하루\s*종일\s*걸)/.test(text)) w++;
    if (/(조금\s*걸|짧게|택시로|차로\s*이동|거의\s*안\s*걸|걷기\s*편)/.test(text)) w--;
    return Math.max(1, Math.min(5, w));
  }
  function detectDays(text) {
    if (/(2박|이박|사흘)/.test(text)) return '2박 3일';
    if (/(1박|하룻밤|이틀|숙소|자고)/.test(text)) return '1박 2일';
    return '당일';
  }

  /* ───────── 기존 코스와 비교 ───────── */
  function matchCourse(places) {
    var best = null;
    T.COURSES.forEach(function (c) {
      var hit = places.filter(function (p) { return c.stops.some(function (s) { return km(p, s) < 0.8; }); }).length;
      var score = hit / places.length;
      if (hit >= 2 && score >= 0.6 && (!best || score > best.score)) best = { course: c, score: score, hit: hit };
    });
    return best;
  }

  /* ───────── 새 코스 만들기 ───────── */
  var HUBS = T.STATIONS;
  function chooseAccess(places) {
    if (places.some(function (p) { return p.region === '제주'; })) return { mode: 'flight', hub: { name: '제주공항', lat: 33.5070, lng: 126.4930 } };
    var first = places[0], best = null;
    HUBS.forEach(function (h) { var d = km(first, h); if (d < 30 && (!best || d < best.d)) best = { h: h, d: d }; });
    if (best) return { mode: 'train', hub: { name: best.h.name, lat: best.h.lat, lng: best.h.lng }, line: best.h.line };
    return { mode: 'car' };
  }
  function topRegion(places) {
    var cnt = {};
    places.forEach(function (p) { cnt[p.region] = (cnt[p.region] || 0) + 1; });
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
  }

  function buildCourse(an, review, user, tagLabel) {
    var places = an.places, n = places.length;
    var region = topRegion(places);
    var group = an.need ? 'access' : (user.age || 'general');
    var notes = (review.tags || []).map(function (t) { return '후기: ' + tagLabel(t); });
    var stops = places.map(function (p, i) {
      var s = { name: p.name, lat: p.lat, lng: p.lng, stay: 60, desc: p.desc || '리뷰에서 찾은 장소예요.' };
      if (an.need && notes.length) s.a11y = notes;
      if (an.days !== '당일' && n >= 3 && i === Math.floor((n - 1) / 2)) s.night = true;
      return s;
    });
    var first = places[0].name, last = places[n - 1].name;
    var title = (first.indexOf(region) === 0 ? '' : region + ' ') + first + '·' + last + ' 코스';
    var goodTags = (review.tags || []).filter(function (t) { return ['crowd', 'slope'].indexOf(t) < 0; }).slice(0, 2).map(tagLabel);
    return {
      id: 'gen-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      generated: true, sourceReview: review.id, createdBy: user.nick, createdAt: Date.now(),
      group: group, need: an.need || undefined,
      title: title, region: region, days: an.days, walk: an.walk,
      tags: ['리뷰로 생성'].concat(goodTags), color: '#7a5af0',
      summary: user.nick + '님의 후기에서 찾은 ' + n + '곳을 글에 나온 순서대로 이은 코스예요. 걷기 강도와 일정은 후기 내용으로 추정했어요.',
      access: chooseAccess(places), localMode: 'car',
      gentle: !!an.need || user.age === 'g60' || user.age === 'o70', a11y: !!an.need,
      stops: stops
    };
  }

  /* ───────── 분석 ───────── */
  function analyze(text, profile) {
    text = String(text || '');
    var places = findPlaces(text);
    var need = detectNeed(text) || (profile && profile.need) || '';
    var res = {
      places: places, tags: detectTags(text), need: need,
      walk: detectWalk(text, need), days: detectDays(text), match: null, status: 'few'
    };
    if (places.length >= 2) {
      res.match = matchCourse(places);
      res.status = res.match ? 'match' : 'new';
    }
    return res;
  }

  return { analyze: analyze, buildCourse: buildCourse, places: GAZ, km: km };
})();
