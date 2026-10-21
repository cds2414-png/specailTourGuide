/* 느린지도 — 코스 렌더링 + 2D 내비게이션 시뮬레이터 */
(function () {
  'use strict';

  var T = window.TRIP;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* ───────── 좌표 투영 (km 단위 평면) ───────── */
  var LAT0 = 36, LNG0 = 127.5;
  var KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.57;
  function proj(lat, lng) { return { x: (lng - LNG0) * KX, y: -(lat - LAT0) * KY }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function angDiff(a, b) { var d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  var LAND_P = T.LAND.map(function (p) { return proj(p[0], p[1]); });
  var JEJU_P = T.JEJU.map(function (p) { return proj(p[0], p[1]); });
  var CITY = {};
  T.CITIES.forEach(function (c) { CITY[c[0]] = proj(c[1], c[2]); });
  var HW = T.HIGHWAYS.map(function (line) { return line.map(function (n) { return CITY[n]; }); });

  /* 결정적 난수 */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ───────── 이동 수단 ───────── */
  var MODES = {
    car:    { label: '자동차', color: '#ff4f1a' },
    walk:   { label: '도보', color: '#2e5e4e' },
    wheel:  { label: '휠체어·유모차', color: '#3d6bf2' },
    train:  { label: '열차', color: '#0f1c18' },
    flight: { label: '항공', color: '#7a5af0' },
    boat:   { label: '배', color: '#1e9bb0' },
    bus:    { label: '버스', color: '#1f9d55' },
    subway: { label: '지하철', color: '#8a3ffc' }
  };
  function kmh(mode, len) {
    switch (mode) {
      case 'walk': return 4;
      case 'wheel': return 3;
      case 'boat': return 12;
      case 'bus': return len > 40 ? 78 : 18;   // 고속버스 / 시내버스
      case 'subway': return 32;
      case 'train': return len < 15 ? 25 : len > 100 ? 190 : 120; // 15km 미만은 관광열차
      case 'flight': return 470;
      default: return len > 40 ? 88 : len > 8 ? 42 : 24;
    }
  }

  /* ───────── 경로 생성 ───────── */
  function dedupe(pts) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) if (dist(pts[i], out[out.length - 1]) > 1e-4) out.push(pts[i]);
    return out;
  }
  function snap(v, g) { return Math.round(v / g) * g; }

  // 도심: 격자 도로를 따라 꺾이는 경로
  function manhattan(a, b, g, r) {
    var t1 = 0.25 + r() * 0.5, t2 = 0.3 + r() * 0.4;
    if (r() < 0.5) {
      var y1 = snap(lerp(a.y, b.y, t1), g), x2 = snap(lerp(a.x, b.x, t2), g);
      return dedupe([a, { x: a.x, y: y1 }, { x: x2, y: y1 }, { x: x2, y: b.y }, b]);
    }
    var x1 = snap(lerp(a.x, b.x, t1), g), y2 = snap(lerp(a.y, b.y, t2), g);
    return dedupe([a, { x: x1, y: a.y }, { x: x1, y: y2 }, { x: b.x, y: y2 }, b]);
  }
  // 장거리: 출발·도착부의 진출입 + 완만한 굴곡
  function wiggle(a, b, r, mode) {
    var d = dist(a, b), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, px = -uy, py = ux;
    var n = clamp(Math.round(d / (mode === 'train' ? 45 : 22)), 2, 10);
    var amp = mode === 'train' ? Math.min(d * 0.05, 9) : Math.min(d * 0.07, 14);
    var pts = [a];
    if (mode === 'car') {
      var ex = Math.min(1.4, d * 0.04), side = r() < 0.5 ? 1 : -1;
      pts.push({ x: a.x + (ux * 0.4 + px * side) * ex, y: a.y + (uy * 0.4 + py * side) * ex });
    }
    var off = 0;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      off = off * 0.45 + (r() * 2 - 1) * amp * 0.75;
      pts.push({ x: lerp(a.x, b.x, t) + px * off, y: lerp(a.y, b.y, t) + py * off });
    }
    if (mode === 'car') {
      var ex2 = Math.min(1.4, d * 0.04), side2 = r() < 0.5 ? 1 : -1;
      pts.push({ x: b.x - (ux * 0.4 - px * side2) * ex2, y: b.y - (uy * 0.4 - py * side2) * ex2 });
    }
    pts.push(b);
    return dedupe(pts);
  }
  function arc(a, b, k, n) {
    var d = dist(a, b), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var cx = mx - (b.y - a.y) / d * d * k, cy = my + (b.x - a.x) / d * d * k;
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, mt = 1 - t;
      out.push({ x: mt * mt * a.x + 2 * mt * t * cx + t * t * b.x, y: mt * mt * a.y + 2 * mt * t * cy + t * t * b.y });
    }
    return out;
  }
  // 꺾인 지점을 2차 베지어로 둥글게
  function roundCorners(c, R, steps) {
    if (c.length < 3) return c.slice();
    var out = [c[0]];
    for (var i = 1; i < c.length - 1; i++) {
      var p0 = c[i - 1], p = c[i], p1 = c[i + 1];
      var l0 = dist(p0, p), l1 = dist(p, p1);
      var rr = Math.min(R, l0 * 0.5, l1 * 0.5);
      var s = { x: p.x + (p0.x - p.x) / l0 * rr, y: p.y + (p0.y - p.y) / l0 * rr };
      var e = { x: p.x + (p1.x - p.x) / l1 * rr, y: p.y + (p1.y - p.y) / l1 * rr };
      for (var k = 0; k <= steps; k++) {
        var t = k / steps, mt = 1 - t;
        out.push({ x: mt * mt * s.x + 2 * mt * t * p.x + t * t * e.x, y: mt * mt * s.y + 2 * mt * t * p.y + t * t * e.y });
      }
    }
    out.push(c[c.length - 1]);
    return dedupe(out);
  }
  function turnAngle(a, b, c) {
    var v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
    return Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y) * 180 / Math.PI; // +: 오른쪽
  }

  var CAR_DIR = { 'slight-left': '왼쪽 방향', 'slight-right': '오른쪽 방향', left: '좌회전', right: '우회전', uturn: '유턴' };
  var WALK_DIR = { 'slight-left': '비스듬히 왼쪽', 'slight-right': '비스듬히 오른쪽', left: '왼쪽으로', right: '오른쪽으로', uturn: '되돌아서' };

  function makeLeg(from, to, mode, opt) {
    opt = opt || {};
    var a = proj(from.lat, from.lng), b = proj(to.lat, to.lng);
    var r = rng(hash(from.name + '>' + to.name + mode));
    var d = dist(a, b), ctrl, pts;
    var city = (mode === 'car' || mode === 'bus') && d < 9;
    if (mode === 'flight') { ctrl = [a, b]; pts = arc(a, b, 0.2, 64); }
    else if (mode === 'subway') {
      ctrl = wiggle(a, b, r, 'train');
      pts = roundCorners(ctrl, d * 0.15, 12);
    }
    else if (mode === 'walk' || mode === 'wheel' || city) {
      ctrl = manhattan(a, b, city ? 0.5 : 0.1, r);
      pts = roundCorners(ctrl, city ? 0.07 : 0.014, 8);
    } else if (mode === 'boat') {
      var mx = (a.x + b.x) / 2 + (r() - 0.5) * d * 0.4, my = (a.y + b.y) / 2;
      ctrl = [a, b]; pts = roundCorners([a, { x: mx, y: my }, b], d, 16);
    } else {
      ctrl = wiggle(a, b, r, mode === 'bus' ? 'car' : mode);
      pts = roundCorners(ctrl, mode === 'train' ? d * 0.12 : d * 0.06, 12);
    }

    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    var len = cum[cum.length - 1];
    var leg = {
      from: from, to: to, mode: mode, road: opt.road || '', line: opt.line || '',
      stop: opt.stop || null, stopNo: opt.stopNo || 0, course: opt.course,
      pts: pts, cum: cum, len: len, kmh: kmh(mode, len), city: city,
      minor: !!opt.minor, wait: opt.wait
    };
    leg.travelMin = len / leg.kmh * 60 + (mode === 'car' ? 4 : 0);
    // 무장애 코스의 차량 구간은 교통약자 콜택시를 불러 기다리는 시간을 넣는다 (실제 평균 대기 20~40분, 지역에 따라 1시간 이상)
    if (mode === 'car' && opt.course && opt.course.a11y) leg.call = opt.course.need === 'wheel' ? 40 : 25;
    leg.dur = clamp(4.5 + Math.sqrt(len) * 1.15, 5, 18); // 1배속 실제 재생 초
    leg.ins = buildInstr(leg, ctrl);
    leg.note = legNote(leg);
    return leg;
  }

  function buildInstr(L, ctrl) {
    var ins = [], c = L.course, gentle = c.gentle || c.a11y;
    var walkish = L.mode === 'walk' || L.mode === 'wheel';
    var fromN = L.from.name, toN = L.to.name;
    var dep = {
      car: fromN + '에서 출발', walk: fromN + '에서 걸어서 출발', wheel: fromN + '에서 출발 · 평지 보행로',
      train: fromN + '에서 ' + (L.line || '열차') + ' 승차', flight: fromN + '에서 이륙', boat: fromN + '에서 승선',
      bus: fromN + '에서 ' + (L.line || '버스') + ' 승차', subway: fromN + '에서 ' + (L.line || '지하철') + ' 승차'
    }[L.mode];
    var arr = { train: toN + ' 하차', flight: toN + ' 착륙', boat: toN + ' 하선', bus: toN + ' 하차', subway: toN + ' 하차' }[L.mode] || toN + ' 도착';
    var depType = { train: 'train', flight: 'flight', boat: 'boat', bus: 'bus', subway: 'subway' }[L.mode] || 'depart';
    ins.push({ type: depType, at: 0, text: dep });

    if (L.mode === 'car' || walkish) {
      var cc = [0];
      for (var i = 1; i < ctrl.length; i++) cc.push(cc[i - 1] + dist(ctrl[i - 1], ctrl[i]));
      var ratio = L.len / cc[cc.length - 1], turns = [];
      for (var j = 1; j < ctrl.length - 1; j++) {
        var ang = turnAngle(ctrl[j - 1], ctrl[j], ctrl[j + 1]), ab = Math.abs(ang);
        if (ab < 18) continue;
        var side = ang > 0 ? 'right' : 'left';
        var type = ab > 140 ? 'uturn' : ab > 50 ? side : 'slight-' + side;
        turns.push({ type: type, at: cc[j] * ratio });
      }
      turns.forEach(function (t, k) {
        var dir = (walkish ? WALK_DIR : CAR_DIR)[t.type];
        if (walkish) t.text = dir + ' 이동' + (L.mode === 'wheel' ? ' · 턱 없는 보도' : '');
        else if (k === 0 && L.road) t.text = dir + ' 후 ' + L.road + ' 진입';
        else if (k === turns.length - 1) t.text = dir + ' 후 ' + toN + ' 방면';
        else if (t.type.indexOf('slight') === 0) t.text = (L.road || '도로') + ' 따라 ' + dir;
        else t.text = dir;
        ins.push(t);
      });
      if (L.mode === 'car' && L.len > 60) ins.push({ type: 'straight', at: L.len * 0.3, text: (L.road || '고속도로') + ' 따라 계속 직진' });
      if (L.mode === 'car' && (L.len > 150 || (gentle && L.len > 60))) ins.push({ type: 'rest', at: L.len * 0.52, text: '휴게소에서 쉬어가기', rest: '휴게소에 들러 15분 쉬어가세요. 스트레칭과 수분 보충을 권해요.' });
      if (walkish && gentle && L.len > 0.2) ins.push({ type: 'rest', at: L.len * 0.55, text: '권장 휴식 지점', rest: '그늘진 벤치에서 5분 쉬어가세요.' });
    } else if (L.mode === 'train') {
      ins.push({ type: 'straight', at: L.len * 0.5, text: '열차 이동 중 · ' + toN + '에서 하차 준비' });
    } else if (L.mode === 'flight') {
      ins.push({ type: 'straight', at: L.len * 0.45, text: '순항 중 · 안전벨트를 착용하세요' });
    } else if (L.mode === 'bus' || L.mode === 'subway') {
      // 정류장(역) 수는 거리로 추정
      var gap = L.mode === 'subway' ? 1.3 : (L.len > 40 ? 0 : 0.6);
      if (gap) {
        var n = Math.max(1, Math.round(L.len / gap));
        ins.push({ type: 'straight', at: L.len * 0.5, text: '약 ' + n + '개 ' + (L.mode === 'subway' ? '역' : '정류장') + ' 이동 · ' + toN + '에서 하차' });
        if (n > 2) ins.push({ type: 'straight', at: Math.max(L.len - gap * 1.05, L.len * 0.75), text: '다음 ' + (L.mode === 'subway' ? '역' : '정류장') + '에서 내려요 · 하차 준비' });
      } else {
        ins.push({ type: 'straight', at: L.len * 0.5, text: (L.line || '고속버스') + ' 이동 중 · 휴게소 정차 시 쉬어가기' });
      }
    }
    ins.push({ type: 'arrive', at: L.len, text: arr });
    ins.sort(function (x, y) { return x.at - y.at; });
    return ins;
  }

  function legNote(L) {
    var c = L.course;
    if (L.mode === 'train') return (L.line || '열차') + ' 승차 · ' + L.to.name + '까지 약 ' + fmtDur(L.travelMin);
    if (L.mode === 'flight') return L.from.name + ' → ' + L.to.name + ' 항공편 · 약 ' + fmtDur(L.travelMin);
    if (L.mode === 'boat') return '배에 오릅니다 · 약 ' + fmtDur(L.travelMin);
    if (L.mode === 'bus' && L.len > 40) return (L.line || '고속버스') + ' 승차 · ' + L.to.name + '까지 약 ' + fmtDur(L.travelMin) + (c.a11y ? ' · 휠체어 탑승 가능 차량은 예매 시 확인' : '');
    if (L.mode === 'bus') return (L.line || '시내버스') + ' 승차 · 약 ' + fmtDur(L.travelMin) + (c.a11y || c.gentle ? ' · 저상버스 여부를 정류장 안내판에서 확인하세요' : '');
    if (L.mode === 'subway') return '지하철 승차 · 약 ' + fmtDur(L.travelMin) + (c.a11y || c.gentle ? ' · 역 엘리베이터 위치를 안내도에서 확인하세요' : '');
    if (L.mode === 'wheel') return '휠체어·유모차 평지 이동 · 경사로와 턱 없는 길로 안내해요';
    if (c.a11y && L.mode === 'car') return '교통약자 콜택시·택시로 이동 · 배차 대기 약 ' + fmtDur(L.call) + '을 넣었어요. 미리 예약하고 하차 위치를 출입구 가까이로 요청하세요';
    if (c.gentle && L.mode === 'car' && L.len > 40) return '1시간마다 쉬어가도록 휴게소 휴식을 넣었어요';
    return '';
  }

  /* 이동 수단 계획
     auto: 코스 추천 · car: 자동차 · transit: 대중교통(고속버스·시내버스·지하철) · train: 기차+택시 */
  var PLANS = [
    { id: 'auto', label: '추천', icon: 'depart', note: '코스에 맞춰 추천한 이동 수단이에요.' },
    { id: 'car', label: '자동차', icon: 'car', note: '출발지에서 자동차로 바로 가요. 장거리는 2시간마다 쉬어가세요.' },
    { id: 'transit', label: '대중교통', icon: 'bus', note: '고속버스와 시내버스·지하철, 정류장까지 걷는 구간이 포함돼요. 터미널·정류장 위치는 근사치예요.' },
    { id: 'train', label: '기차', icon: 'train', note: '코스와 가장 가까운 역까지 기차로 가고, 역부터는 택시로 이동해요.' }
  ];
  // 지하철이 있는 도시 (중심, 반경 km)
  var METROS = [[37.5665, 126.9780, 20], [35.1600, 129.0600, 16], [35.8714, 128.6014, 12], [37.4563, 126.7052, 12], [36.3504, 127.3845, 10], [35.1595, 126.8526, 10]];
  function inMetro(p) {
    return METROS.some(function (m) { return dist(proj(p.lat, p.lng), proj(m[0], m[1])) < m[2]; });
  }
  function kmBetween(p, q) { return dist(proj(p.lat, p.lng), proj(q.lat, q.lng)); }
  // p에서 q 쪽으로 along km, 옆으로 side km 떨어진 지점 (정류장 위치 근사)
  function offsetPoint(p, q, along, side, name) {
    var a = proj(p.lat, p.lng), b = proj(q.lat, q.lng), d = dist(a, b) || 1;
    var ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    var x = a.x + ux * along - uy * side, y = a.y + uy * along + ux * side;
    return { name: name, lat: LAT0 - y / KY, lng: LNG0 + x / KX };
  }
  function regionName(course) {
    var r = course.region.split('·')[0].trim().split(' ');
    return ['서울', '부산', '대구', '인천', '대전', '광주', '울산', '세종', '제주'].indexOf(r[0]) >= 0 ? r[0] : r[r.length - 1];
  }
  function nearestStation(p) {
    var best = null;
    (T.STATIONS || []).forEach(function (s) { var d = kmBetween(p, s); if (!best || d < best.d) best = { s: s, d: d }; });
    return best ? best.s : null;
  }

  function buildRoute(course, originKey, plan) {
    plan = plan || 'auto';
    var o = T.ORIGINS[originKey], legs = [], cur = o, acc = course.access;
    var base = { course: course }, first = course.stops[0];
    var walkMode = course.need === 'wheel' || course.need === 'family' ? 'wheel' : 'walk';
    function push(to, mode, extra) {
      var opt = Object.assign({}, base, extra || {});
      legs.push(makeLeg(cur, to, mode, opt));
      cur = to;
    }
    // 시내 대중교통: 정류장까지 걷기 → 버스·지하철 → 목적지까지 걷기
    function pushTransit(to, extra) {
      var d = kmBetween(cur, to);
      if (d < 0.9) { push(to, walkMode, extra); return; }
      var sub = d >= 2.5 && inMetro(cur) && inMetro(to);
      var kind = sub ? 'subway' : 'bus';
      var s1 = offsetPoint(cur, to, Math.min(0.18, d * 0.1), 0.12, (sub ? cur.name + ' 인근 역' : cur.name + ' 인근 정류장'));
      var s2 = offsetPoint(to, cur, Math.min(0.18, d * 0.1), -0.1, (sub ? to.name + ' 인근 역' : to.name + ' 인근 정류장'));
      push(s1, walkMode, { minor: true, wait: sub ? 4 : 7 });
      push(s2, kind, { minor: true, wait: 0, line: sub ? '지하철' : '시내버스' });
      push(to, walkMode, extra);
    }
    function local(to, extra) {
      if (plan === 'transit') pushTransit(to, extra);
      else push(to, 'car', extra);
    }

    var near = kmBetween(o, first) < 40;
    // ── 출발지에서 여행 지역까지 ──
    if (acc.mode === 'flight') {
      // 제주 등 섬: 어떤 수단이든 항공 이용
      if (plan === 'transit') pushTransit(o.airport, { minor: true, wait: 30 });
      else push(o.airport, 'car', { road: '공항 진입로' });
      push(acc.hub, 'flight', { line: '항공편' });
    } else if (plan === 'auto') {
      if (acc.mode === 'train' && kmBetween(cur, acc.hub) > 3) push(acc.hub, 'train', { line: acc.line });
    } else if (plan === 'train' && !near) {
      var st = acc.mode === 'train' ? { name: acc.hub.name, lat: acc.hub.lat, lng: acc.hub.lng, line: acc.line } : nearestStation(first);
      if (st && kmBetween(cur, st) > 3) push({ name: st.name, lat: st.lat, lng: st.lng }, 'train', { line: st.line || 'KTX' });
    } else if (plan === 'transit' && !near) {
      var t1 = o.terminal || o;
      pushTransit(t1, { minor: true, wait: 20 });
      var toward = kmBetween(cur, first) > 8 ? 3 : 1.2;
      var t2 = offsetPoint(first, cur, toward, 0.4, regionName(course) + ' 버스터미널');
      push(t2, 'bus', { line: '고속버스', road: '고속도로', minor: true, wait: 10 });
    }

    // ── 코스 안 이동 ──
    course.stops.forEach(function (st, i) {
      var m = st.mode || course.localMode;
      var extra = { road: st.road, line: st.line, stop: st, stopNo: i + 1 };
      // 도보·휠체어·배·관광열차 구간은 수단과 관계없이 유지
      var keep = m === 'walk' || m === 'wheel' || m === 'boat' || (m === 'train' && st.line);
      if (plan === 'auto' || keep) push(st, m, extra);
      else local(st, extra);
    });

    // 시각표
    var c = 9 * 60;
    legs.forEach(function (L, i) {
      if (L.mode === 'flight') c += 40;
      c += L.call || 0; // 콜택시 배차 대기
      L.c0 = c; c += L.travelMin; L.c1 = c;
      if (L.stop) { c += L.stop.stay; if (L.stop.night && i < legs.length - 1) c = (Math.floor(c / 1440) + 1) * 1440 + 9 * 60; }
      else c += L.wait != null ? L.wait : 15;
      L.c2 = c;
    });
    return legs;
  }
  // 이동 시간 합계 (머무는 시간 제외, 환승 대기 포함)
  function moveMinutes(legs) {
    return legs.reduce(function (s, L) { return s + L.travelMin + (L.call || 0) + (L.stop ? 0 : (L.wait != null ? L.wait : 15)) + (L.mode === 'flight' ? 40 : 0); }, 0);
  }

  /* ───────── 형식 ───────── */
  function fmtDur(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(c) {
    c = Math.floor(c);
    var day = Math.floor(c / 1440) + 1, m = c % 1440;
    return (day > 1 ? day + '일차 ' : '') + pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function fmtDist(km) {
    if (km < 1) return Math.max(0, Math.round(km * 100) * 10) + ' m';
    return km < 100 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
  }

  /* ───────── 아이콘 ───────── */
  var IC = {
    straight: '<path d="M12 20V5M6 11l6-6 6 6"/>',
    left: '<path d="M17 20v-7a3 3 0 0 0-3-3H6M10 6l-4 4 4 4"/>',
    right: '<path d="M7 20v-7a3 3 0 0 1 3-3h8M14 6l4 4-4 4"/>',
    'slight-left': '<path d="M15 21v-6L8 8M8 14V8h6"/>',
    'slight-right': '<path d="M9 21v-6l7-7M16 14V8h-6"/>',
    uturn: '<path d="M16 21V9a4 4 0 0 0-8 0v7M4 13l4 4 4-4"/>',
    depart: '<circle cx="12" cy="18" r="3"/><path d="M12 15V4M8 8l4-4 4 4"/>',
    arrive: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
    rest: '<path d="M5 10h12v3a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM17 11h1.5a2.5 2.5 0 0 1 0 5H17M9 3v4M13 3v4"/>',
    train: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 13h.01M15 13h.01M8 21l2-3M16 21l-2-3"/>',
    flight: '<path d="M10.5 21l1.5-1 1.5 1v-2l-1.5-1v-4.5l8 2.5v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V18l-1.5 1z" transform="translate(1.5 0)"/>',
    boat: '<path d="M3 16l2 4h14l2-4zM6 16v-5h12v5M12 11V4l5 4h-5"/>',
    car: '<path d="M5 16v-5l2-5h10l2 5v5M4 16h16M6 16v3M18 16v3"/><circle cx="8.5" cy="13" r="1"/><circle cx="15.5" cy="13" r="1"/>',
    bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21v-3M16 21v-3M9 14.5h.01M15 14.5h.01"/>',
    subway: '<rect x="6" y="3" width="12" height="14" rx="4"/><path d="M6 10h12M9 13.5h.01M15 13.5h.01M8 21l2-4M16 21l-2-4"/>'
  };
  function icon(type, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 24) + '" height="' + (size || 24) + '" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[type] || IC.straight) + '</svg>';
  }

  /* ───────── 글자 크기 ───────── */
  var sizeBtn = $('#textSize');
  try { if (localStorage.getItem('slowmap-big') === '1') { document.documentElement.classList.add('big-text'); sizeBtn.setAttribute('aria-pressed', 'true'); } } catch (e) { /* 저장소 없음 */ }
  sizeBtn.addEventListener('click', function () {
    var on = document.documentElement.classList.toggle('big-text');
    sizeBtn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('slowmap-big', on ? '1' : '0'); } catch (e) { /* 무시 */ }
    setTimeout(function () { drawCardMaps(); resize(); window.dispatchEvent(new Event('slowmap:layout')); }, 60);
  });

  /* ───────── 코스 카드 ───────── */
  function courseById(id) { for (var i = 0; i < T.COURSES.length; i++) if (T.COURSES[i].id === id) return T.COURSES[i]; return null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var VIA = { car: 'BY CAR', train: 'BY TRAIN', flight: 'BY AIR' };
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var PRINT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7z"/></svg>';

  function cardHTML(c, extra) {
    var walk = '';
    for (var i = 1; i <= 5; i++) walk += '<i class="' + (i <= c.walk ? 'on' : '') + '"></i>';
    return '<article class="card' + (extra ? ' ' + extra : '') + '">' +
      '<div class="card__map"><canvas data-mini="' + c.id + '" aria-hidden="true"></canvas>' +
        '<span class="card__days mono">' + esc(c.days) + '</span><span class="card__via mono">' + (c.generated ? 'FROM REVIEW' : VIA[c.access.mode]) + '</span>' +
        '<button type="button" class="card__rating" data-rating="' + c.id + '" hidden></button></div>' +
      '<div class="card__body">' +
        '<p class="card__region mono"><span>' + esc(c.region) + '</span><span class="card__walk" role="img" aria-label="걷기 강도 5단계 중 ' + c.walk + '">' + walk + '</span></p>' +
        '<h4>' + esc(c.title) + '</h4>' +
        '<p class="card__sum">' + esc(c.summary) + '</p>' +
        '<ol class="card__route">' + c.stops.map(function (s, k) { return '<li><i>' + (k + 1) + '</i>' + esc(s.name) + '</li>'; }).join('') + '</ol>' +
        '<div class="card__actions"><button type="button" class="card__go" data-go="' + c.id + '" data-cursor="GO"><span>내비로 달려보기</span>' + ARROW + '</button>' +
        '<button type="button" class="card__print" data-print-course="' + c.id + '" title="가이드 출력" aria-label="' + esc(c.title) + ' 가이드 출력">' + PRINT_ICON + '</button></div>' +
      '</div></article>';
  }

  // 카드 상단 미니 지도: 등고선 + 경로
  function drawMini(cv, c) {
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * DPR; cv.height = h * DPR;
    var x = cv.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    var dark = !!cv.closest('.access');
    var ink = dark ? '236,231,220' : '15,28,24', accent = dark ? '#3d6bf2' : '#ff4f1a';
    var r = rng(hash(c.id));
    // 등고선
    var cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4), ph = r() * 6;
    x.lineWidth = 1;
    for (var k = 1; k <= 14; k++) {
      x.beginPath();
      for (var a = 0; a <= 64; a++) {
        var t = a / 64 * Math.PI * 2;
        var rr = k * 15 * (1 + 0.16 * Math.sin(t * 3 + ph + k * 0.2) + 0.08 * Math.sin(t * 5 - ph));
        var X = cx + Math.cos(t) * rr * 1.5, Y = cy + Math.sin(t) * rr;
        a ? x.lineTo(X, Y) : x.moveTo(X, Y);
      }
      x.strokeStyle = 'rgba(' + ink + ',' + (k % 4 === 0 ? 0.16 : 0.08) + ')';
      x.stroke();
    }
    var pts = c.stops.map(function (s) { return proj(s.lat, s.lng); });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    var bw = Math.max(maxX - minX, 0.3), bh = Math.max(maxY - minY, 0.3);
    var sc = Math.min((w - 110) / bw, (h - 92) / bh);
    var ox = w / 2 - (minX + maxX) / 2 * sc, oy = h / 2 + 16 - (minY + maxY) / 2 * sc;
    var legs = [];
    for (var i = 1; i < c.stops.length; i++) legs.push(makeLeg(c.stops[i - 1], c.stops[i], c.stops[i].mode || c.localMode, { course: c }));
    x.lineCap = 'round'; x.lineJoin = 'round';
    [[dark ? '#1d3028' : '#e2dbcb', 8], [accent, 3]].forEach(function (st) {
      x.strokeStyle = st[0]; x.lineWidth = st[1];
      legs.forEach(function (L) {
        x.beginPath();
        L.pts.forEach(function (p, k) { var X = ox + p.x * sc, Y = oy + p.y * sc; k ? x.lineTo(X, Y) : x.moveTo(X, Y); });
        x.stroke();
      });
    });
    pts.forEach(function (p, k) {
      var X = ox + p.x * sc, Y = oy + p.y * sc, end = k === pts.length - 1;
      x.beginPath(); x.arc(X, Y, 9, 0, Math.PI * 2);
      x.fillStyle = end ? accent : 'rgb(' + ink + ')'; x.fill();
      x.fillStyle = end ? '#fff' : (dark ? '#0f1c18' : '#f5f1e8');
      x.font = '700 9.5px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(k + 1), X, Y + 0.5);
    });
  }
  function drawCardMaps() {
    $$('canvas[data-mini]').forEach(function (cv) { drawMini(cv, courseById(cv.getAttribute('data-mini'))); });
    if (window.SlowCommunity) window.SlowCommunity.paintRatings();
  }

  /* 연령 패널 (가로 스크롤 트랙) */
  $('#agesTrack').insertAdjacentHTML('beforeend', T.GROUPS.map(function (g, i) {
    return '<article class="age" id="age-' + g.id + '" data-group="' + g.id + '" aria-labelledby="age-' + g.id + '-t">' +
      '<div class="age__num" aria-hidden="true">' + g.num + '</div>' +
      '<div class="age__info">' +
        '<p class="age__range mono">' + g.range + ' · 0' + (i + 1) + '/0' + T.GROUPS.length + '</p>' +
        '<h3 id="age-' + g.id + '-t">' + esc(g.title) + '</h3>' +
        '<p class="age__lead">' + esc(g.lead) + '</p>' +
        '<ul class="age__tips">' + g.tips.map(function (t, k) { return '<li><span>0' + (k + 1) + '</span>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        '<button type="button" class="age__born" data-born="' + g.id + '" hidden></button>' +
      '</div>' +
      '<div class="age__cards">' + T.COURSES.filter(function (c) { return !c.generated && c.group === g.id; }).map(function (c) { return cardHTML(c); }).join('') + '</div>' +
      '</article>';
  }).join(''));
  $('#agesDots').innerHTML = T.GROUPS.map(function (g) { return '<li><a href="#age-' + g.id + '">' + g.num + ' — ' + g.label + '</a></li>'; }).join('');
  $('#heroChips').innerHTML = T.GROUPS.map(function (g) {
    return '<button type="button" data-hero-group="' + g.id + '" aria-label="' + g.label + ' 코스 보기" data-cursor="' + g.short.toUpperCase() + '">' + g.num + '</button>';
  }).join('');

  /* 무장애 */
  var NEED_IC = {
    wheel: '<circle cx="24" cy="8" r="3.5"/><path d="M22 14v13h12l4 12"/><path d="M22 20h10"/><circle cx="20" cy="32" r="10"/>',
    walk: '<circle cx="22" cy="7" r="3.5"/><path d="M21 14l-4 12 5 5v11"/><path d="M21 14l6 7 6 1"/><path d="M17 26l-4 16"/><path d="M33 22v20"/><path d="M33 22a3 3 0 0 0-3-3"/>',
    family: '<path d="M6 12h5l4 16h21l4-12H13"/><path d="M27 16a12 12 0 0 0-12-12"/><circle cx="18" cy="36" r="4"/><circle cx="33" cy="36" r="4"/>'
  };
  // 리뷰로 만든 무장애 코스도 함께 보이도록 매번 T.COURSES에서 계산
  function accessCourses() { return T.COURSES.filter(function (c) { return c.group === 'access'; }); }
  function countNeed(id) { return accessCourses().filter(function (c) { return c.need === id; }).length; }
  $('#needs').innerHTML = T.NEEDS.map(function (n, i) {
    return '<article class="need reveal"><div class="need__top"><span class="need__no mono">' + String.fromCharCode(65 + i) + ' — 0' + (i + 1) + '</span>' +
      '<svg class="need__icon" viewBox="0 0 48 48" aria-hidden="true">' + NEED_IC[n.id] + '</svg></div>' +
      '<h3>' + esc(n.title) + '</h3><ul>' + n.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<button type="button" class="need__more" data-filter="' + n.id + '">코스 ' + countNeed(n.id) + '개 보기 <span aria-hidden="true">↓</span></button></article>';
  }).join('');

  // 무장애 유형 필터
  var filterEl = $('#accessFilter'), accessCardsEl = $('#accessCards');
  var FILTERS = [{ id: 'all', title: '전체' }].concat(T.NEEDS);
  var accessFilterId = 'walk';
  function renderFilterButtons() {
    filterEl.innerHTML = FILTERS.map(function (f) {
      var n = f.id === 'all' ? accessCourses().length : countNeed(f.id);
      return '<button type="button" data-filter="' + f.id + '" aria-pressed="' + (f.id === accessFilterId) + '">' + esc(f.title) + ' <span class="mono">' + n + '</span></button>';
    }).join('');
    $$('.need__more').forEach(function (b) { b.firstChild.nodeValue = '코스 ' + countNeed(b.getAttribute('data-filter')) + '개 보기 '; });
  }
  renderFilterButtons();
  function setAccessFilter(id, initial) {
    accessFilterId = id;
    $$('button', filterEl).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === id)); });
    accessCardsEl.innerHTML = accessCourses()
      .filter(function (c) { return id === 'all' || c.need === id; })
      .map(function (c, i) { return cardHTML(c, initial ? 'reveal' : 'card--in').replace('<article class="card', '<article style="--d:' + (i % 3) * 0.06 + 's" class="card'); })
      .join('');
    if (!initial) drawCardMaps();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]'); if (!b) return;
    var id = b.getAttribute('data-filter');
    setAccessFilter(id);
    if (b.classList.contains('need__more')) {
      window.scrollTo({ top: filterEl.getBoundingClientRect().top + window.scrollY - 96, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });
  setAccessFilter('walk', true);

  // 통계 숫자
  var statCourses = $('[data-count-courses]');
  if (statCourses) statCourses.setAttribute('data-count', String(T.COURSES.length));

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (!b) return;
    loadCourse(b.getAttribute('data-go'));
    var top = mapBox.getBoundingClientRect().top + window.scrollY - (window.innerWidth <= 900 ? 72 : 84);
    window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
    setTimeout(function () { play(true); }, reduceMotion ? 50 : 800);
  });

  /* ───────── 시뮬레이터 ───────── */
  var cv = $('#map'), ctx = cv.getContext('2d'), mapBox = $('#simMap');
  var mm = $('#minimap'), mctx = mm.getContext('2d');
  var selCourse = $('#selCourse'), selOrigin = $('#selOrigin');
  var W = 0, H = 0;

  var S = {
    course: null, originKey: 'seoul', legs: [], li: 0, s: 0,
    phase: 'idle', dwell: 0, dwellMax: 0, hold: false, playing: false, speed: 1,
    view: 'overview', northUp: false, zoomMul: 1,
    cam: { x: 0, y: 0, z: 10, rot: 0 }, heading: 0, gi: -1, bounds: null, visible: true
  };

  // 셀렉트 채우기
  function opts(list) { return list.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join(''); }
  function fillCourseSelect() {
    var html = '', keep = selCourse.value;
    T.GROUPS.forEach(function (g) {
      html += '<optgroup label="' + g.label + '">' + opts(T.COURSES.filter(function (c) { return !c.generated && c.group === g.id; })) + '</optgroup>';
    });
    T.NEEDS.forEach(function (n) {
      html += '<optgroup label="무장애 · ' + esc(n.title) + '">' + opts(T.COURSES.filter(function (c) { return !c.generated && c.group === 'access' && c.need === n.id; })) + '</optgroup>';
    });
    var gen = T.COURSES.filter(function (c) { return c.generated; });
    if (gen.length) html += '<optgroup label="리뷰로 만든 코스">' + opts(gen) + '</optgroup>';
    selCourse.innerHTML = html;
    if (keep && courseById(keep)) selCourse.value = keep;
  }
  fillCourseSelect();
  selOrigin.innerHTML = Object.keys(T.ORIGINS).map(function (k) { return '<option value="' + k + '">' + T.ORIGINS[k].name + '</option>'; }).join('');

  // 연령 패널의 '리뷰로 만든 코스' 바로가기
  function updateBornLinks() {
    $$('[data-born]').forEach(function (b) {
      var g = b.getAttribute('data-born');
      var n = T.COURSES.filter(function (c) { return c.generated && !c.need && c.group === g; }).length;
      b.hidden = !n;
      b.textContent = '리뷰로 만든 코스 ' + n + '개 보기 →';
    });
  }
  selCourse.addEventListener('change', function () { loadCourse(selCourse.value); });
  selOrigin.addEventListener('change', function () { S.originKey = selOrigin.value; loadCourse(S.course.id); });

  /* 이동 수단 선택 */
  S.plan = 'auto';
  var planPick = $('#planPick'), planNote = $('#planNote');
  planPick.innerHTML = PLANS.map(function (p) {
    return '<button type="button" role="radio" data-plan="' + p.id + '" aria-checked="false" tabindex="-1">' +
      icon(p.icon, 22) + '<b>' + p.label + '</b><small class="mono" data-plan-time></small><em class="mono" data-plan-best hidden>최단</em></button>';
  }).join('');
  function renderPlans() {
    var c = S.course, times = {};
    PLANS.forEach(function (p) { times[p.id] = moveMinutes(p.id === S.plan ? S.legs : buildRoute(c, S.originKey, p.id)); });
    var fastest = PLANS.reduce(function (a, p) { return times[p.id] < times[a] ? p.id : a; }, 'auto');
    $$('button', planPick).forEach(function (b) {
      var id = b.getAttribute('data-plan'), on = id === S.plan;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
      $('[data-plan-time]', b).textContent = fmtDur(times[id]);
      $('[data-plan-best]', b).hidden = id !== fastest;
      b.setAttribute('aria-label', b.querySelector('b').textContent + ', 이동 약 ' + fmtDur(times[id]) + (id === fastest ? ', 가장 빠름' : ''));
    });
    var p = PLANS.filter(function (x) { return x.id === S.plan; })[0];
    var note = p.note;
    if (c.access.mode === 'flight' && S.plan !== 'auto') note += ' 제주는 항공편으로 건너간 뒤 선택한 수단이 적용돼요.';
    if (S.plan !== 'auto' && kmBetween(T.ORIGINS[S.originKey], c.stops[0]) < 40) note += ' 출발지와 가까워 시내 이동만 바뀌어요.';
    planNote.textContent = note;
  }
  function setPlan(id) {
    if (id === S.plan) return;
    S.plan = id;
    loadCourse(S.course.id);
    toast(PLANS.filter(function (x) { return x.id === id; })[0].label + ' 경로로 바꿨어요 · 이동 약 ' + fmtDur(moveMinutes(S.legs)), 2400);
  }
  planPick.addEventListener('click', function (e) { var b = e.target.closest('[data-plan]'); if (b) setPlan(b.getAttribute('data-plan')); });
  planPick.addEventListener('keydown', function (e) {
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!keys[e.key]) return;
    e.preventDefault();
    var ids = PLANS.map(function (p) { return p.id; });
    var next = ids[(ids.indexOf(S.plan) + keys[e.key] + ids.length) % ids.length];
    setPlan(next);
    $('[data-plan="' + next + '"]', planPick).focus();
  });

  function loadCourse(id) {
    var c = courseById(id);
    S.course = c; selCourse.value = id; selOrigin.value = S.originKey;
    S.legs = buildRoute(c, S.originKey, S.plan);
    var gi = 0;
    S.flat = [];
    S.legs.forEach(function (L, li) {
      L.gStart = gi;
      L.ins.forEach(function (ins, k) { ins.gi = gi++; ins.li = li; S.flat.push(ins); });
    });
    // 경계
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    S.legs.forEach(function (L) { L.pts.forEach(function (p) { b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x); b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y); }); });
    S.bounds = b;
    stop(); reset(true);
    renderSidebar();
    renderPlans();
    window.dispatchEvent(new CustomEvent("slowmap:course", { detail: { course: c, legs: S.legs } }));
  }

  function reset(snapCam) {
    S.li = 0; S.s = 0; S.phase = 'idle'; S.gi = -1; S.dwell = 0; S.hold = false;
    hideArrive(); hideToast();
    S.view = 'overview'; syncViewBtns();
    var L = S.legs[0];
    S.heading = headingAt(L, 0);
    if (snapCam) { var f = fitOverview(); S.cam.x = f.x; S.cam.y = f.y; S.cam.z = f.z; S.cam.rot = 0; }
    updateHUD(true);
  }

  function renderSidebar() {
    var tot = 0, tmin = 0;
    S.legs.forEach(function (L) { tot += L.len; tmin += L.travelMin; });
    var last = S.legs[S.legs.length - 1];
    $('#summary').innerHTML =
      '<div><dt>총 이동 거리</dt><dd>' + fmtDist(tot) + '</dd></div>' +
      '<div><dt>이동·환승</dt><dd>' + fmtDur(moveMinutes(S.legs)) + '</dd></div>' +
      '<div><dt>일정 종료</dt><dd>' + fmtClock(last.c2) + '</dd></div>';

    var items = ['<li data-k="0"><i></i><b>' + esc(S.legs[0].from.name) + '</b><small>출발 · ' + fmtClock(S.legs[0].c0 - (S.legs[0].call || 0)) + '</small></li>'];
    S.legs.forEach(function (L, k) {
      var m = (L.mode === 'bus' || L.mode === 'subway' || L.mode === 'train') && L.line ? L.line : MODES[L.mode].label;
      var after = L.stop ? ' · ' + fmtDur(L.stop.stay) + ' 머묾'
        : L.wait ? ' · ' + (L.minor ? '대기 ' : '환승 ') + fmtDur(L.wait) : L.wait === 0 ? '' : ' · 환승';
      items.push('<li data-k="' + (k + 1) + '" class="' + (L.stop ? '' : L.minor ? 'is-hub is-minor' : 'is-hub') + '"><i></i><b>' + (L.stop ? L.stopNo + '. ' : '') + esc(L.to.name) + '</b>' +
        '<small>' + (L.call ? '콜택시 대기 ' + fmtDur(L.call) + ' · ' : '') + esc(m) + ' ' + fmtDist(L.len) + ' · ' + fmtClock(L.c1) + ' 도착' + after + (L.stop && L.stop.night && k < S.legs.length - 1 ? ' · 숙박' : '') + '</small></li>');
    });
    $('#stops').innerHTML = items.join('');

    var steps = [];
    S.legs.forEach(function (L, li) {
      steps.push('<li class="is-leg">' + (li + 1) + '구간 · ' + esc(L.line && L.mode !== 'car' ? L.line : MODES[L.mode].label) + ' · ' + esc(L.from.name) + ' → ' + esc(L.to.name) + '</li>');
      L.ins.forEach(function (ins, k) {
        var gap = k ? fmtDist(ins.at - L.ins[k - 1].at) + ' 후' : '';
        steps.push('<li data-gi="' + ins.gi + '">' + icon(ins.type === 'arrive' ? 'arrive' : ins.type) + '<span>' + esc(ins.text) + '</span><em>' + gap + '</em></li>');
      });
    });
    $('#steps').innerHTML = steps.join('');
    updateSidebarState(true);
  }

  $('#steps').addEventListener('click', function (e) {
    var li = e.target.closest('[data-gi]'); if (!li) return;
    var ins = S.flat[+li.getAttribute('data-gi')];
    seek(ins.li, Math.max(0, ins.at - Math.min(S.legs[ins.li].len * 0.04, 0.4)));
  });

  function seek(li, s) {
    S.li = li; S.s = s; S.phase = 'move'; S.dwell = 0; S.hold = false;
    hideArrive();
    if (S.view === 'overview' || S.view === 'free') { S.view = 'follow'; syncViewBtns(); }
    S.heading = headingAt(S.legs[li], s);
  }

  /* 재생 제어 */
  var btnPlay = $('#btnPlay');
  function play(fromCard) {
    if (!S.course) return;
    if (S.phase === 'done') reset(false);
    if (S.phase === 'idle') { S.phase = 'move'; S.view = 'follow'; syncViewBtns(); announceLeg(); }
    if (fromCard) { S.view = 'follow'; syncViewBtns(); }
    S.playing = true; syncPlay();
  }
  function stop() { S.playing = false; syncPlay(); if (window.speechSynthesis) speechSynthesis.cancel(); }
  function syncPlay() {
    btnPlay.classList.toggle('is-playing', S.playing);
    $('#playIcon').textContent = S.playing ? '❚❚' : '▶';
    $('#playLabel').textContent = S.playing ? '일시정지' : (S.phase === 'idle' || S.phase === 'done' ? '재생' : '계속');
  }
  btnPlay.addEventListener('click', function () { S.playing ? stop() : play(); });
  $('#btnReset').addEventListener('click', function () { stop(); reset(false); updateSidebarState(true); });
  $$('.speeds button').forEach(function (b) {
    b.addEventListener('click', function () {
      S.speed = +b.getAttribute('data-speed');
      $$('.speeds button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
    });
  });

  var btnView = $('#btnView'), btnNorth = $('#btnNorth');
  function syncViewBtns() {
    btnView.textContent = S.view === 'follow' ? '전체' : '따라가기';
    btnView.title = S.view === 'follow' ? '전체 경로 보기' : '현재 위치 따라가기';
    btnView.setAttribute('aria-pressed', String(S.view === 'overview'));
    btnNorth.textContent = S.northUp ? '북쪽↑' : '진행↑';
    btnNorth.title = S.northUp ? '진행 방향을 위로' : '북쪽을 위로 고정';
    btnNorth.setAttribute('aria-pressed', String(S.northUp));
    mm.classList.toggle('is-hidden', S.view === 'overview');
  }
  btnView.addEventListener('click', function () { S.view = S.view === 'follow' ? 'overview' : 'follow'; syncViewBtns(); });
  btnNorth.addEventListener('click', function () { S.northUp = !S.northUp; syncViewBtns(); });
  function zoomBy(f) {
    if (S.view === 'follow') S.zoomMul = clamp(S.zoomMul * f, 0.2, 6);
    else { S.view = 'free'; S.freeZ = clamp((S.freeZ || S.cam.z) * f, 0.5, 4000); syncViewBtns(); }
  }
  $('#btnZoomIn').addEventListener('click', function () { zoomBy(1.6); });
  $('#btnZoomOut').addEventListener('click', function () { zoomBy(1 / 1.6); });

  // 드래그로 지도 이동
  var drag = null;
  cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved < 4) return;
    if (S.view !== 'free') { S.view = 'free'; S.freeZ = S.cam.z; syncViewBtns(); }
    var r = S.cam.rot, z = S.cam.z;
    S.cam.x -= (dx * Math.cos(r) - dy * Math.sin(r)) / z;
    S.cam.y -= (dx * Math.sin(r) + dy * Math.cos(r)) / z;
  });
  cv.addEventListener('pointerup', function () { drag = null; });
  cv.addEventListener('pointercancel', function () { drag = null; });
  cv.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) { if (!S.wheelHint) { S.wheelHint = 1; toast('Ctrl + 휠로 지도를 확대·축소할 수 있어요', 2200); } return; }
    e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8);
  }, { passive: false });

  /* 음성 */
  var chkVoice = $('#chkVoice');
  function speak(t) {
    if (!chkVoice.checked || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t); u.lang = 'ko-KR'; u.rate = 1.05;
    speechSynthesis.speak(u);
  }
  chkVoice.addEventListener('change', function () { if (chkVoice.checked) speak('음성 안내를 시작합니다'); else if (window.speechSynthesis) speechSynthesis.cancel(); });

  /* 토스트·도착 카드 */
  var toastEl = $('#toast'), toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg; toastEl.hidden = false;
    toastEl.style.animation = 'none'; void toastEl.offsetWidth; toastEl.style.animation = '';
    clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms || 3200);
  }
  function hideToast() { toastEl.hidden = true; }
  var arriveEl = $('#arrive');
  function showArrive(L, final) {
    var st = L.stop, total = S.course.stops.length;
    $('#arriveStep').textContent = final ? '여정 완료 · ' + total + '곳 모두 둘러봤어요' : '도착 ' + L.stopNo + ' / ' + total + ' · ' + fmtClock(L.c1);
    $('#arriveName').textContent = st.name;
    $('#arriveDesc').textContent = st.desc;
    $('#arriveA11y').innerHTML = (st.a11y || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('#arriveStay').textContent = final ? '다시 보려면 재생을 누르세요' : '머무는 시간 ' + fmtDur(st.stay) + (st.night ? ' · 이곳 근처에서 하룻밤 묵어요' : '');
    arriveEl.hidden = false;
    arriveEl.style.animation = 'none'; void arriveEl.offsetWidth; arriveEl.style.animation = '';
  }
  function hideArrive() { arriveEl.hidden = true; }
  function announceLeg() {
    var L = S.legs[S.li];
    if (L && L.note) toast(L.note, 3600);
  }

  /* 경로 위치 계산 */
  function posAt(L, s) {
    s = clamp(s, 0, L.len);
    var lo = 0, hi = L.cum.length - 1;
    while (lo < hi - 1) { var mid = (lo + hi) >> 1; if (L.cum[mid] <= s) lo = mid; else hi = mid; }
    var seg = L.cum[hi] - L.cum[lo] || 1, t = (s - L.cum[lo]) / seg;
    return { x: lerp(L.pts[lo].x, L.pts[hi].x, t), y: lerp(L.pts[lo].y, L.pts[hi].y, t) };
  }
  function lookDelta(L) {
    if (L.mode === 'train' && L.len < 15) return 0.05;
    if (L.mode === 'subway') return 0.1;
    if (L.mode === 'bus') return L.len > 40 ? 0.6 : 0.05;
    return { walk: 0.012, wheel: 0.012, boat: 0.05, train: 1.5, flight: 4 }[L.mode] || (L.city ? 0.05 : 0.6);
  }
  function headingAt(L, s) {
    var d = Math.min(lookDelta(L), L.len / 4);
    var a = posAt(L, s - d), b = posAt(L, s + d);
    if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 1e-9) return S.heading;
    return Math.atan2(b.x - a.x, -(b.y - a.y)); // 북쪽 기준 시계 방향
  }
  function followZoom(L) {
    var z = { walk: 1500, wheel: 1500, boat: 420, train: L.len < 15 ? 260 : 9, flight: 2.4, subway: 160 }[L.mode] || (L.city ? 240 : 30);
    var minDim = Math.min(W, H) || 600;
    return z * S.zoomMul * clamp(minDim / 640, 0.6, 1.4);
  }
  function fitOverview() {
    var b = S.bounds, bw = Math.max(b.maxX - b.minX, 0.4), bh = Math.max(b.maxY - b.minY, 0.4);
    var padTop = W < 640 ? 100 : 130, padBot = W < 640 ? 150 : 110;
    var z = Math.min((W - 80) / bw, (H - padTop - padBot) / bh);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 - ((padTop - padBot) / 2) / z, z: z };
  }

  /* 사이드바 상태 */
  var lastSideKey = '';
  function updateSidebarState(force) {
    var key = S.li + '|' + S.phase + '|' + S.gi;
    if (!force && key === lastSideKey) return;
    lastSideKey = key;
    // explore.js(목적지 둘러보기)가 현재 향하는 정류지를 따라가도록 알림
    var L0 = S.legs[S.li];
    window.dispatchEvent(new CustomEvent("slowmap:progress", { detail: { li: S.li, phase: S.phase, stop: L0 ? L0.stop : null, stopNo: L0 ? L0.stopNo : 0 } }));
    $$('#stops li').forEach(function (li) {
      var k = +li.getAttribute('data-k');
      var arrived = S.phase === 'done' || k < S.li + 1 || (k === S.li + 1 && S.phase === 'dwell') || (k === 0 && S.phase !== 'idle');
      li.classList.toggle('is-done', arrived);
      li.classList.toggle('is-now', !arrived && k === S.li + 1 && S.phase === 'move');
    });
    var list = $('#steps');
    $$('li[data-gi]', list).forEach(function (li) {
      var g = +li.getAttribute('data-gi');
      li.classList.toggle('is-done', S.phase === 'done' || g < S.gi);
      li.classList.toggle('is-now', g === S.gi && S.phase !== 'done');
      if (g === S.gi && S.phase !== 'idle') {
        var top = li.offsetTop - list.offsetTop - list.clientHeight / 2 + li.clientHeight / 2;
        list.scrollTop = top;
      }
    });
  }

  /* HUD */
  var hud = {
    turn: $('#hudTurn'), icon: $('#turnIcon'), dist: $('#turnDist'), text: $('#turnText'), next: $('#turnNext'),
    mode: $('#hudMode'), speed: $('#hudSpeed'), left: $('#hudLeft'), eta: $('#hudEta'), clock: $('#hudClock')
  };
  var hudCache = {};
  function setT(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
  function setH(el, key, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.innerHTML = v; } }

  function upcoming(L, s) {
    for (var i = 0; i < L.ins.length; i++) if (L.ins[i].at > s + 1e-6) return L.ins[i];
    return L.ins[L.ins.length - 1];
  }

  var t0 = performance.now();
  function updateHUD(force) {
    var L = S.legs[S.li]; if (!L) return;
    var ins, d, nextIns;
    if (S.phase === 'idle') {
      ins = L.ins[0]; d = 0;
      setH(hud.icon, 'icon', icon(ins.type, 40));
      setT(hud.dist, 'dist', '출발 준비');
      setT(hud.text, 'text', S.legs[0].from.name + ' → ' + S.course.stops[S.course.stops.length - 1].name);
      setT(hud.next, 'next', '재생을 누르면 ' + S.legs.length + '개 구간을 차례로 안내해요');
      hud.turn.className = 'hud-turn';
    } else if (S.phase === 'dwell' || S.phase === 'done') {
      setH(hud.icon, 'icon', icon('arrive', 40));
      setT(hud.dist, 'dist', S.phase === 'done' ? '여정 완료' : '도착');
      setT(hud.text, 'text', L.to.name + (S.phase === 'done' ? '' : L.stop ? ' · 둘러보는 중' : ' · 환승 중'));
      var nl = S.legs[S.li + 1];
      setT(hud.next, 'next', nl ? '다음: ' + MODES[nl.mode].label + '로 ' + nl.to.name + ' (' + fmtDist(nl.len) + ')' : '모든 일정을 마쳤어요');
      hud.turn.className = 'hud-turn is-arrive';
    } else {
      ins = upcoming(L, S.s); d = ins.at - S.s;
      if (ins.gi !== S.gi) {
        var prev = S.flat[S.gi];
        if (prev && prev.type === 'rest' && prev.li === S.li) toast(prev.rest, 3800);
        S.gi = ins.gi;
        if (ins.type !== 'arrive' || d < L.len) speak(fmtDist(d).replace('km', '킬로미터').replace(' m', '미터') + ' 앞, ' + ins.text);
      }
      nextIns = S.flat[ins.gi + 1];
      setH(hud.icon, 'icon', icon(ins.type, 40));
      setT(hud.dist, 'dist', fmtDist(d));
      setT(hud.text, 'text', ins.text);
      setT(hud.next, 'next', nextIns && nextIns.li === S.li ? '그다음: ' + nextIns.text : (S.legs[S.li + 1] ? '이 구간 끝나면 ' + MODES[S.legs[S.li + 1].mode].label + ' 이동' : '마지막 구간이에요'));
      hud.turn.className = 'hud-turn' + (ins.type === 'rest' ? ' is-rest' : ins.type === 'arrive' ? ' is-arrive' : '');
    }

    var modeLabel = MODES[L.mode].label;
    if (L.mode === 'car' && S.course.a11y) modeLabel = '콜택시·택시';
    else if (L.mode === 'car' && L.city) modeLabel = '택시·시내 도로';
    else if ((L.mode === 'bus' || L.mode === 'flight') && L.line) modeLabel = L.line;
    setT(hud.mode, 'mode', (S.li + 1) + '/' + S.legs.length + ' 구간 · ' + modeLabel);

    // 속도
    var v = 0;
    if (S.phase === 'move') {
      var edge = Math.max(L.len * 0.06, 0.01);
      var ramp = clamp(Math.min(S.s / edge, (L.len - S.s) / edge), 0.25, 1);
      var tt = (performance.now() - t0) / 1000;
      v = L.kmh * ramp * (0.93 + 0.07 * Math.sin(tt * 0.9) * Math.sin(tt * 0.37 + 1));
      if (!S.playing) v = 0;
    }
    setT(hud.speed, 'speed', String(Math.round(v)));

    var clock;
    if (S.phase === 'idle') clock = L.c0;
    else if (S.phase === 'move') clock = L.c0 + (S.s / L.len) * (L.c1 - L.c0);
    else if (S.phase === 'dwell') clock = L.c1 + (L.c2 - L.c1) * clamp(S.dwell / S.dwellMax, 0, 1);
    else clock = L.c1;
    var rem = S.phase === 'move' || S.phase === 'idle' ? L.len - S.s : 0;
    setT(hud.left, 'left', S.phase === 'done' ? '도착 완료' : fmtDist(rem) + ' · ' + L.to.name);
    setT(hud.eta, 'eta', fmtClock(L.c1));
    setT(hud.clock, 'clock', fmtClock(clock));
    updateSidebarState(force);
  }

  /* 진행 */
  function step(dt) {
    if (!S.playing || !S.course) return;
    var L = S.legs[S.li];
    if (S.phase === 'move') {
      S.s += L.len / L.dur * dt * S.speed;
      if (S.s >= L.len) {
        S.s = L.len; S.phase = 'dwell'; S.dwell = 0;
        var final = S.li === S.legs.length - 1;
        S.dwellMax = L.stop ? 3.4 : 1.6;
        if (L.stop) { showArrive(L, final); speak(L.to.name + '에 도착했습니다'); }
        else toast(L.to.name + ' 도착 · 환승합니다', 2000);
        if (final) { S.phase = 'done'; stop(); }
      }
    } else if (S.phase === 'dwell') {
      if (S.hold) return; // 티켓 제안 중: explore.js가 releaseDwell()을 부를 때까지 머문다
      S.dwell += dt * S.speed;
      if (S.dwell >= S.dwellMax) {
        hideArrive();
        S.li++; S.s = 0; S.phase = 'move';
        S.heading = headingAt(S.legs[S.li], 0);
        announceLeg();
      }
    }
  }

  /* 카메라 */
  function updateCamera(dt) {
    var L = S.legs[S.li]; if (!L) return;
    var P = posAt(L, S.s);
    var h = headingAt(L, S.s);
    S.heading += angDiff(S.heading, h) * Math.min(1, dt * 5);
    S.vpos = P;
    var cam = S.cam, tx, ty, tz, tr;
    if (S.view === 'overview') { var f = fitOverview(); tx = f.x; ty = f.y; tz = f.z; tr = 0; }
    else if (S.view === 'free') { tx = cam.x; ty = cam.y; tz = S.freeZ || cam.z; tr = cam.rot; }
    else { tx = P.x; ty = P.y; tz = followZoom(L); tr = S.northUp ? 0 : S.heading; }
    var kz = Math.min(1, dt * 2.6), kp = S.view === 'follow' ? Math.min(1, dt * 9) : Math.min(1, dt * 3.5);
    var zFast = Math.abs(Math.log(tz / cam.z)) > 2.5; // 큰 줌 변화 중에는 위치를 바로 맞춤
    cam.z = Math.exp(lerp(Math.log(cam.z), Math.log(tz), kz));
    cam.x = lerp(cam.x, tx, zFast ? 1 : kp); cam.y = lerp(cam.y, ty, zFast ? 1 : kp);
    cam.rot += angDiff(cam.rot, tr) * Math.min(1, dt * 3.2);
  }
  function anchor() {
    if (S.view === 'follow') return { x: W / 2, y: S.northUp ? H * 0.55 : H * 0.64 };
    return { x: W / 2, y: H / 2 };
  }
  function toScreen(p, A) {
    var c = S.cam, dx = (p.x - c.x) * c.z, dy = (p.y - c.y) * c.z, co = Math.cos(c.rot), si = Math.sin(c.rot);
    return { x: A.x + dx * co + dy * si, y: A.y - dx * si + dy * co };
  }

  /* 그리기 */
  function polyPath(c, pts) { c.beginPath(); pts.forEach(function (p, i) { i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); }
  function landPath(c) { polyPath(c, LAND_P); c.closePath(); JEJU_P.forEach(function (p, i) { i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }); c.closePath(); }
  function partial(L, s0, s1) {
    var out = [posAt(L, s0)];
    for (var i = 0; i < L.pts.length; i++) if (L.cum[i] > s0 && L.cum[i] < s1) out.push(L.pts[i]);
    out.push(posAt(L, s1));
    return out;
  }
  function strokeLeg(c, pts, color, w, z, dash) {
    polyPath(c, pts);
    c.setLineDash(dash ? dash.map(function (v) { return v / z; }) : []);
    c.strokeStyle = color; c.lineWidth = w / z; c.stroke();
  }

  function draw() {
    var z = S.cam.z, A = anchor();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#c9d6d3'; ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(A.x, A.y); ctx.rotate(-S.cam.rot); ctx.scale(z, z); ctx.translate(-S.cam.x, -S.cam.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // 육지
    landPath(ctx);
    ctx.fillStyle = '#efeae0'; ctx.fill();
    ctx.strokeStyle = '#a3b4ae'; ctx.lineWidth = 1.6 / z; ctx.stroke();

    // 확대 시 거리 블록
    if (z > 70) {
      ctx.save(); landPath(ctx); ctx.clip();
      var g = z > 600 ? 0.1 : 0.5, R = Math.hypot(W, H) / z;
      var x0 = Math.floor((S.cam.x - R) / g) * g, x1 = S.cam.x + R, y0 = Math.floor((S.cam.y - R) / g) * g, y1 = S.cam.y + R;
      var al = clamp((z - 70) / 160, 0, 1);
      ctx.globalAlpha = al;
      ctx.fillStyle = '#e6dfd0'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      for (var gx = x0; gx < x1; gx += g) for (var gy = y0; gy < y1; gy += g) {
        var hv = hash(Math.round(gx / g) + ',' + Math.round(gy / g)) % 23;
        if (hv === 0) { ctx.fillStyle = '#d3dcc4'; ctx.fillRect(gx, gy, g, g); }
        else if (hv === 1) { ctx.fillStyle = '#cbd8d6'; ctx.fillRect(gx, gy, g, g); }
        else if (hv < 6) { ctx.fillStyle = '#ddd4c1'; ctx.fillRect(gx + g * 0.18, gy + g * 0.18, g * 0.64, g * 0.64); }
      }
      ctx.strokeStyle = '#f8f5ee'; ctx.lineWidth = clamp(g * z * 0.16, 3, 18) / z;
      ctx.beginPath();
      for (gx = x0; gx < x1; gx += g) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
      for (gy = y0; gy < y1; gy += g) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // 고속도로(배경)
    if (z < 140) {
      ctx.setLineDash([]);
      ctx.globalAlpha = clamp((140 - z) / 80, 0, 1);
      HW.forEach(function (line) { polyPath(ctx, line); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 / z; ctx.stroke(); ctx.strokeStyle = '#e9b75c'; ctx.lineWidth = 2.4 / z; ctx.stroke(); });
      ctx.globalAlpha = 1;
    }

    // 뱃길 아래 강폭
    S.legs.forEach(function (L) {
      if (L.mode !== 'boat') return;
      strokeLeg(ctx, L.pts, '#c9d6d3', Math.max(0.45 * z, 6), z, null);
    });

    // 경로
    S.legs.forEach(function (L, i) {
      var col = MODES[L.mode].color;
      var dash = L.mode === 'flight' ? [10, 9] : L.mode === 'boat' ? [6, 8] : (L.mode === 'walk' || L.mode === 'wheel') ? [1, 11] : null;
      var w = L.mode === 'walk' || L.mode === 'wheel' ? 7 : 7;
      strokeLeg(ctx, L.pts, 'rgba(255,255,255,.95)', w + 5, z, null);
      if (L.mode === 'train') { strokeLeg(ctx, L.pts, '#0f1c18', w, z, null); strokeLeg(ctx, L.pts, '#ffffff', 2.2, z, [8, 8]); }
      else if (L.mode === 'subway') { strokeLeg(ctx, L.pts, col, w, z, null); strokeLeg(ctx, L.pts, '#ffffff', 2, z, [3, 9]); }
      else strokeLeg(ctx, L.pts, col, w, z, dash);
      var done = i < S.li ? L.len : i === S.li ? S.s : 0;
      if (done > 0) strokeLeg(ctx, partial(L, 0, done), '#a7b0aa', w + 0.5, z, L.mode === 'flight' ? [10, 9] : null);
    });
    ctx.setLineDash([]);
    ctx.restore();

    // ── 화면 좌표 오버레이 ──
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (z < 60) {
      ctx.font = '500 12px "Noto Sans KR", sans-serif';
      T.CITIES.forEach(function (c) {
        var p = toScreen(CITY[c[0]], A);
        if (p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) return;
        ctx.fillStyle = '#7d8c87'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(23,48,42,.55)'; ctx.fillText(c[0], p.x, p.y - 11);
      });
    }

    // 휴식 지점
    S.legs.forEach(function (L) {
      L.ins.forEach(function (ins) {
        if (ins.type !== 'rest') return;
        var p = toScreen(posAt(L, ins.at), A);
        if (p.x < -20 || p.y < -20 || p.x > W + 20 || p.y > H + 20) return;
        ctx.fillStyle = '#3d6bf2'; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '700 10px "Noto Sans KR", sans-serif'; ctx.fillText('휴', p.x, p.y + 0.5);
      });
    });

    // 핀
    var pins = [{ p: S.legs[0].from, kind: 'origin', k: -1 }];
    S.legs.forEach(function (L, i) { pins.push({ p: L.to, kind: L.stop ? 'stop' : L.minor ? 'minor' : 'hub', no: L.stopNo, k: i }); });
    pins.forEach(function (pin) {
      var sp = toScreen(proj(pin.p.lat, pin.p.lng), A);
      if (sp.x < -80 || sp.y < -40 || sp.x > W + 80 || sp.y > H + 40) return;
      var reached = pin.k < S.li || (pin.k === S.li && (S.phase === 'dwell' || S.phase === 'done')) || (pin.kind === 'origin' && S.phase !== 'idle');
      var col = S.course.a11y ? '#3d6bf2' : '#ff4f1a';
      ctx.font = '700 12px "Noto Sans KR", sans-serif';
      if (pin.kind === 'minor') {
        // 정류장·역·터미널: 작은 점, 확대했거나 지금 향하는 곳일 때만 이름 표시
        var nextLeg = S.legs[pin.k + 1], mc = nextLeg ? MODES[nextLeg.mode].color : '#0f1c18';
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = mc; ctx.lineWidth = 3; ctx.stroke();
        if (!(z > 150 || pin.k === S.li)) return;
      } else if (pin.kind === 'origin') {
        ctx.fillStyle = '#0f1c18'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText('출', sp.x, sp.y + 0.5);
      } else if (pin.kind === 'hub') {
        ctx.fillStyle = '#fff'; roundRect(ctx, sp.x - 10, sp.y - 10, 20, 20, 6); ctx.fill();
        ctx.strokeStyle = '#0f1c18'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.fillStyle = '#0f1c18'; ctx.font = '700 10px "Noto Sans KR", sans-serif'; ctx.fillText('환', sp.x, sp.y + 0.5);
      } else {
        ctx.fillStyle = reached ? col : '#fff'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = reached ? '#fff' : col; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = reached ? '#fff' : '#0f1c18'; ctx.fillText(String(pin.no), sp.x, sp.y + 0.5);
      }
      // 이름표
      ctx.font = '700 12.5px "Noto Sans KR", sans-serif';
      var tw = ctx.measureText(pin.p.name).width + 16, lx = sp.x + 18, ly = sp.y - 12;
      ctx.fillStyle = 'rgba(245,241,232,.96)'; roundRect(ctx, lx, ly, tw, 24, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(23,48,42,.12)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#0f1c18'; ctx.textAlign = 'left'; ctx.fillText(pin.p.name, lx + 8, ly + 12.5); ctx.textAlign = 'center';
    });

    // 현재 위치
    if (S.vpos) {
      var vp = toScreen(S.vpos, A), L = S.legs[S.li];
      var col2 = MODES[L.mode].color;
      var pulse = S.playing ? (Math.sin(performance.now() / 260) + 1) / 2 : 0.5;
      ctx.fillStyle = hexA(col2, 0.16); ctx.beginPath(); ctx.arc(vp.x, vp.y, 22 + pulse * 8, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(vp.x, vp.y); ctx.rotate(S.heading - S.cam.rot);
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(12, 12); ctx.lineTo(0, 6); ctx.lineTo(-12, 12); ctx.closePath();
      ctx.fillStyle = col2; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
    }

    // 축척
    var km = niceScale(90 / z);
    var px = km * z;
    ctx.fillStyle = 'rgba(23,48,42,.7)'; ctx.font = '500 11px "Noto Sans KR", sans-serif'; ctx.textAlign = 'left';
    var sy = W < 640 ? H - 128 : H - 96;
    ctx.fillRect(18, sy, px, 3); ctx.fillRect(18, sy - 5, 2, 8); ctx.fillRect(18 + px - 2, sy - 5, 2, 8);
    ctx.fillText(km < 1 ? Math.round(km * 1000) + ' m' : km + ' km', 18, sy - 12);
    ctx.textAlign = 'center';
  }
  function niceScale(v) {
    var steps = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= v) return steps[i];
    return 200;
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // 인쇄용 경로 지도: 현재 코스 전체를 한 장의 이미지(PNG data URL)로 그린다
  function exportRouteImage(w, h, local) {
    if (!S.bounds || !S.legs.length) return '';
    // local: 코스 정류지 구간만(출발지→여행 지역 이동 제외) 확대
    var useLegs = S.legs, firstStop = -1;
    S.legs.forEach(function (L, i) { if (firstStop < 0 && L.stop) firstStop = i; });
    if (local && firstStop >= 0) useLegs = S.legs.slice(firstStop);
    var lb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    useLegs.forEach(function (L) { L.pts.forEach(function (p) { lb.minX = Math.min(lb.minX, p.x); lb.maxX = Math.max(lb.maxX, p.x); lb.minY = Math.min(lb.minY, p.y); lb.maxY = Math.max(lb.maxY, p.y); }); });
    var c = document.createElement('canvas'), sc = 2;
    c.width = w * sc; c.height = h * sc;
    var x = c.getContext('2d');
    x.setTransform(sc, 0, 0, sc, 0, 0);
    var b = local ? lb : S.bounds, pad = 64;
    var bw = Math.max(b.maxX - b.minX, 0.4), bh = Math.max(b.maxY - b.minY, 0.4);
    var z = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    function sp(p) { return { x: w / 2 + (p.x - cx) * z, y: h / 2 + (p.y - cy) * z }; }
    x.fillStyle = '#dde7e4'; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.scale(z, z); x.translate(-cx, -cy);
    landPath(x); x.fillStyle = '#f6f3ec'; x.fill(); x.strokeStyle = '#9fb1ab'; x.lineWidth = 1.4 / z; x.stroke();
    if (z < 140) {
      x.globalAlpha = 0.5;
      HW.forEach(function (line) { polyPath(x, line); x.strokeStyle = '#e9b75c'; x.lineWidth = 2 / z; x.stroke(); });
      x.globalAlpha = 1;
    }
    x.lineCap = 'round'; x.lineJoin = 'round';
    S.legs.forEach(function (L) {
      polyPath(x, L.pts); x.setLineDash([]); x.strokeStyle = '#fff'; x.lineWidth = 9 / z; x.stroke();
      polyPath(x, L.pts);
      x.setLineDash(L.mode === 'flight' ? [10 / z, 8 / z] : (L.mode === 'walk' || L.mode === 'wheel') ? [2 / z, 7 / z] : []);
      x.strokeStyle = MODES[L.mode].color; x.lineWidth = 4.5 / z; x.stroke();
    });
    x.setLineDash([]);
    x.restore();
    if (z < 60) {
      x.font = '500 12px "Noto Sans KR", sans-serif'; x.fillStyle = 'rgba(15,28,24,.45)'; x.textAlign = 'center';
      T.CITIES.forEach(function (ct) { var p = sp(CITY[ct[0]]); if (p.x > 0 && p.y > 0 && p.x < w && p.y < h) x.fillText(ct[0], p.x, p.y - 8); });
    }
    var pins = [{ p: S.legs[0].from, kind: 'origin' }];
    S.legs.forEach(function (L) { if (!L.minor) pins.push({ p: L.to, kind: L.stop ? 'stop' : 'hub', no: L.stopNo }); });
    pins.forEach(function (pin) {
      var q = sp(proj(pin.p.lat, pin.p.lng));
      x.textAlign = 'center'; x.textBaseline = 'middle';
      if (pin.kind === 'origin') { x.fillStyle = '#0f1c18'; x.beginPath(); x.arc(q.x, q.y, 12, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff'; x.font = '700 11px "Noto Sans KR", sans-serif'; x.fillText('출', q.x, q.y + 0.5); }
      else if (pin.kind === 'hub') { x.fillStyle = '#fff'; roundRect(x, q.x - 9, q.y - 9, 18, 18, 5); x.fill(); x.strokeStyle = '#0f1c18'; x.lineWidth = 2; x.stroke(); }
      else { x.fillStyle = '#ff4f1a'; x.beginPath(); x.arc(q.x, q.y, 13, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke(); x.fillStyle = '#fff'; x.font = '700 12px "JetBrains Mono", monospace'; x.fillText(String(pin.no), q.x, q.y + 0.5); }
      x.font = '700 12px "Noto Sans KR", sans-serif';
      var tw = x.measureText(pin.p.name).width + 14;
      x.fillStyle = 'rgba(255,255,255,.94)'; roundRect(x, q.x + 16, q.y - 11, tw, 22, 6); x.fill();
      x.strokeStyle = 'rgba(15,28,24,.15)'; x.lineWidth = 1; x.stroke();
      x.fillStyle = '#0f1c18'; x.textAlign = 'left'; x.fillText(pin.p.name, q.x + 23, q.y + 0.5);
    });
    // 축척
    var km = niceScale(110 / z);
    x.fillStyle = '#0f1c18'; x.fillRect(20, h - 24, km * z, 3);
    x.font = '500 11px "Noto Sans KR", sans-serif'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    x.fillText(km < 1 ? Math.round(km * 1000) + ' m' : km + ' km', 20, h - 32);
    return c.toDataURL('image/png');
  }

  function drawMinimap() {
    if (S.view === 'overview' || !S.bounds) return;
    var w = 160, h = 120, b = S.bounds;
    if (mm.width !== w * DPR) { mm.width = w * DPR; mm.height = h * DPR; }
    mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    mctx.fillStyle = '#c9d6d3'; mctx.fillRect(0, 0, w, h);
    var bw = Math.max(b.maxX - b.minX, 0.4), bh = Math.max(b.maxY - b.minY, 0.4);
    var z = Math.min((w - 24) / bw, (h - 24) / bh), cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    mctx.save(); mctx.translate(w / 2, h / 2); mctx.scale(z, z); mctx.translate(-cx, -cy);
    landPath(mctx); mctx.fillStyle = '#efeae0'; mctx.fill();
    mctx.lineCap = 'round'; mctx.lineJoin = 'round';
    S.legs.forEach(function (L, i) {
      polyPath(mctx, L.pts); mctx.strokeStyle = i < S.li ? '#a7b0aa' : MODES[L.mode].color; mctx.lineWidth = 2.5 / z; mctx.stroke();
    });
    mctx.restore();
    if (S.vpos) {
      var x = w / 2 + (S.vpos.x - cx) * z, y = h / 2 + (S.vpos.y - cy) * z;
      mctx.fillStyle = '#ff4f1a'; mctx.beginPath(); mctx.arc(x, y, 4.5, 0, Math.PI * 2); mctx.fill();
      mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.stroke();
    }
  }

  function resize() {
    var r = mapBox.getBoundingClientRect();
    W = Math.round(r.width); H = Math.round(r.height);
    cv.width = W * DPR; cv.height = H * DPR;
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(mapBox);
  window.addEventListener('resize', function () { resize(); clearTimeout(S.rt); S.rt = setTimeout(drawCardMaps, 150); });
  // 화면(메뉴) 전환: 숨겨져 있던 캔버스 크기를 다시 잡고, 시뮬레이터가 대기 중이면 전체 경로에 맞춘다
  window.addEventListener('slowmap:view', function (e) {
    resize();
    drawCardMaps();
    if (e.detail === 'sim' && S.course && S.phase === 'idle' && W && H) {
      var f = fitOverview(); S.cam.x = f.x; S.cam.y = f.y; S.cam.z = f.z; S.cam.rot = 0;
    }
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { S.visible = es[0].isIntersecting; }).observe(mapBox);
  }

  var last = performance.now();
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.course) {
      step(dt);
      if (S.visible) {
        updateCamera(dt);
        draw();
        drawMinimap();
        updateHUD(false);
      }
    }
    requestAnimationFrame(loop);
  }

  /* 시작 */
  drawCardMaps();
  resize();
  loadCourse(T.COURSES[0].id);
  syncViewBtns();
  updateBornLinks();
  requestAnimationFrame(loop);

  // 리뷰로 코스가 추가·삭제되면 community.js가 호출
  window.SlowApp = {
    cardHTML: cardHTML,
    state: function () { return { course: S.course, legs: S.legs, li: S.li, phase: S.phase, playing: S.playing, hold: S.hold }; },
    // 도착지에서 티켓 제안 동안 머물기 / 구매하지 않으면 바로 다음 목적지로
    holdDwell: function () { if (S.phase === 'dwell') S.hold = true; },
    releaseDwell: function () {
      if (!S.hold) return;
      S.hold = false; S.dwell = S.dwellMax;
      if (!S.playing) play(); // 일시정지 중에 '다음 목적지로'를 눌러도 바로 진행
    },
    // guide.js(가이드 출력)용
    load: function (id) { if (courseById(id)) loadCourse(id); },
    guideData: function () {
      return {
        course: S.course, legs: S.legs, origin: T.ORIGINS[S.originKey],
        plan: PLANS.filter(function (p) { return p.id === S.plan; })[0], moveMin: moveMinutes(S.legs),
        modeLabel: function (L) {
          if ((L.mode === 'bus' || L.mode === 'subway' || L.mode === 'train' || L.mode === 'flight') && L.line) return L.line;
          if (L.mode === 'car' && S.course.a11y) return '콜택시·택시';
          if (L.mode === 'car' && L.city) return '택시';
          return MODES[L.mode].label;
        },
        modeColor: function (L) { return MODES[L.mode].color; },
        fmtClock: fmtClock, fmtDur: fmtDur, fmtDist: fmtDist
      };
    },
    routeImage: exportRouteImage,
    drawCardMaps: drawCardMaps,
    refresh: function () {
      fillCourseSelect();
      renderFilterButtons();
      setAccessFilter(accessFilterId);
      updateBornLinks();
      if (statCourses) statCourses.textContent = String(T.COURSES.length);
      if (S.course && !courseById(S.course.id)) loadCourse(T.COURSES[0].id);
      window.dispatchEvent(new Event('slowmap:layout'));
    }
  };
  if (window.SlowCommunity) window.SlowCommunity.onAppReady(window.SlowApp);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawCardMaps);
})();
