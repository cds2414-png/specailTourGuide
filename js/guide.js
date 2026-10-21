/* 모두의 여행길 — 여행 가이드 출력 (A4 미리보기 → 인쇄 · PDF 저장)
   현재 시뮬레이터에 불러온 코스·출발지·이동 수단을 그대로 한 권의 가이드로 엮는다.
   인쇄는 브라우저 인쇄 기능(window.print)을 쓰며, 'PDF로 저장'을 고르면 PDF 파일이 된다. */
(function () {
  'use strict';

  var T = window.TRIP, A = window.SlowApp;
  if (!A || !A.guideData) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

  var dlg = $('#printView'), paper = $('#printGuide'), lastFocus = null, buildSeq = 0;

  function opts() {
    var o = {};
    $$('[data-opt]', dlg).forEach(function (cb) { o[cb.getAttribute('data-opt')] = cb.checked; });
    return o;
  }

  // 사진 불러오기 (explore.js의 위키백과 사진 캐시 재사용, 최대 4초)
  function photos(stops) {
    var get = window.SlowExplore && window.SlowExplore.getPhoto;
    if (!get) return Promise.resolve(stops.map(function () { return null; }));
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, 4000); });
    return Promise.all(stops.map(function (s) { return Promise.race([get(s.name), timeout]); }));
  }

  var CHECK_BASE = ['신분증', '복용 중인 약 (하루치 더)', '휴대폰 보조배터리', '편한 신발', '물·간식', '우산 또는 우비', '비상 연락처 메모'];
  var CHECK_NEED = {
    wheel: ['휠체어 충전기·공기 주입기', '장애인콜택시 예약 확인', '열차 휠체어석 예매 확인'],
    walk: ['지팡이·보행 보조기', '휴대용 방석', '무릎 보호대'],
    family: ['기저귀·물티슈', '유모차 레인커버', '수유 용품']
  };

  function build() {
    var seq = ++buildSeq, d = A.guideData(), c = d.course, o = opts();
    var secNo = 0;
    function sec() { secNo++; return '<span>' + (secNo < 10 ? '0' : '') + secNo + '</span>'; }
    if (!c) return;
    var legs = d.legs, last = legs[legs.length - 1];
    var group = T.GROUPS.filter(function (g) { return g.id === c.group; })[0];
    var need = T.NEEDS.filter(function (n) { return n.id === c.need; })[0];
    var totalKm = legs.reduce(function (s, L) { return s + L.len; }, 0);
    var walkDots = ''; for (var i = 1; i <= 5; i++) walkDots += '<i class="' + (i <= c.walk ? 'on' : '') + '"></i>';
    var today = new Date(), printed = today.getFullYear() + '.' + ('0' + (today.getMonth() + 1)).slice(-2) + '.' + ('0' + today.getDate()).slice(-2);

    // ── 표지 ──
    var html = '<article class="pg' + (o.big ? ' is-big' : '') + '">' +
      '<header class="pg__head">' +
        '<p class="pg__brand"><b>모두의 여행길</b> ROUTE FOR ALL · 여행 가이드<span>' + printed + ' 출력</span></p>' +
        '<h1>' + esc(c.title) + '</h1>' +
        '<p class="pg__sum">' + esc(c.summary) + '</p>' +
        '<dl class="pg__facts">' +
          '<div><dt>지역</dt><dd>' + esc(c.region) + '</dd></div>' +
          '<div><dt>일정</dt><dd>' + esc(c.days) + '</dd></div>' +
          '<div><dt>출발</dt><dd>' + esc(d.origin.name) + '</dd></div>' +
          '<div><dt>이동 수단</dt><dd>' + esc(d.plan ? d.plan.label : '추천') + '</dd></div>' +
          '<div><dt>총 이동</dt><dd>' + d.fmtDist(totalKm) + ' · ' + d.fmtDur(d.moveMin) + '</dd></div>' +
          '<div><dt>걷기 강도</dt><dd><span class="pg__walk">' + walkDots + '</span></dd></div>' +
        '</dl>' +
        '<p class="pg__tags">' + c.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') +
          (group ? '<span class="is-group">' + esc(group.label) + ' 추천</span>' : '') + (need ? '<span class="is-need">무장애 · ' + esc(need.title) + '</span>' : '') + '</p>' +
      '</header>';

    // ── 경로 지도 ──
    if (o.map) {
      var modesUsed = [];
      legs.forEach(function (L) { var lab = d.modeLabel(L); if (!modesUsed.some(function (m) { return m[0] === lab; })) modesUsed.push([lab, d.modeColor(L)]); });
      // 출발지에서 여행 지역까지 먼 이동이 있으면 '전체 경로' + '목적지 주변 확대' 두 장
      var farTrip = !legs[0].stop;
      html += '<section class="pg__sec pg__map"><h2>' + sec() + '경로 지도</h2>' +
        (farTrip
          ? '<div class="pg__maps"><figure><img src="' + A.routeImage(560, 520) + '" alt="' + esc(c.title) + ' 전체 경로 지도"><figcaption>전체 경로 · ' + esc(d.origin.name) + ' 출발</figcaption></figure>' +
            '<figure><img src="' + A.routeImage(560, 520, true) + '" alt="' + esc(c.title) + ' 목적지 주변 지도"><figcaption>목적지 주변 확대</figcaption></figure></div>'
          : '<img src="' + A.routeImage(1000, 560) + '" alt="' + esc(c.title) + ' 경로 지도">') +
        '<p class="pg__legend">' + modesUsed.map(function (m) { return '<span><i style="background:' + m[1] + '"></i>' + esc(m[0]) + '</span>'; }).join('') +
        '<span class="pg__note">지도와 경로는 이해를 돕기 위한 그림이에요.</span></p></section>';
    }

    // ── 일정표 ──
    var rows = '<tr class="is-start"><td class="mono">' + d.fmtClock(legs[0].c0 - (legs[0].call || 0)) + '</td><td><b>' + esc(legs[0].from.name) + '</b> 출발</td><td></td></tr>';
    legs.forEach(function (L) {
      rows += '<tr class="is-move"><td class="mono">' + d.fmtClock(L.c0) + '</td><td><span class="pg__mode" style="--m:' + d.modeColor(L) + '">' + esc(d.modeLabel(L)) + '</span> ' +
        esc(L.from.name) + ' → ' + esc(L.to.name) + '</td><td>' + (L.call ? '콜택시 대기 ' + d.fmtDur(L.call) + '<br>' : '') + d.fmtDist(L.len) + ' · ' + d.fmtDur(L.travelMin) + '</td></tr>';
      if (L.stop) {
        var s = L.stop;
        rows += '<tr class="is-stop"><td class="mono">' + d.fmtClock(L.c1) + '</td><td><b><i class="pg__no">' + L.stopNo + '</i>' + esc(s.name) + '</b>' +
          '<p>' + esc(s.desc || '') + '</p>' +
          (s.a11y && s.a11y.length ? '<ul class="pg__a11y">' + s.a11y.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
          '</td><td>머묾 ' + d.fmtDur(s.stay) + (s.night && L !== last ? '<br><b>숙박</b>' : '') + '</td></tr>';
      }
    });
    rows += '<tr class="is-end"><td class="mono">' + d.fmtClock(last.c2) + '</td><td><b>일정 종료</b></td><td></td></tr>';
    html += '<section class="pg__sec"><h2>' + sec() + '일정표</h2>' +
      '<table class="pg__table"><thead><tr><th>시각</th><th>일정</th><th>이동 · 머묾</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="pg__note">시각은 평균 속도로 계산한 예상이에요. 교통 상황과 운영 시간에 따라 달라질 수 있어요.</p></section>';

    // ── 목적지 (사진은 아래에서 채움) ──
    var stops = c.stops;
    html += '<section class="pg__sec pg__spots"><h2>' + sec() + '목적지</h2><div class="pg__grid">' +
      stops.map(function (s, k) {
        var tk = (T.TICKETS && T.TICKETS[s.name]) || [];
        return '<div class="pg__spot">' +
          (o.photos ? '<figure class="pg__photo" data-pg-photo="' + k + '"><div class="pg__ph">' + esc(s.name) + '</div></figure>' : '') +
          '<div class="pg__spotbody"><p class="mono">STOP ' + ('0' + (k + 1)).slice(-2) + '</p><h3>' + esc(s.name) + '</h3><p>' + esc(s.desc || '') + '</p>' +
          (o.tickets ? (tk.length
            ? '<ul class="pg__tk">' + tk.map(function (t) { return '<li><span>' + esc(t.kind) + '</span>' + esc(t.name) + '<b>' + won(t.price) + ' / ' + esc(t.unit || '1인') + '</b></li>'; }).join('') + '</ul>' + (T.PERKS && T.PERKS[s.name] ? '<p class="pg__perk">' + esc(T.PERKS[s.name].text) + '</p>' : '')
            : '<p class="pg__free">별도 티켓 없이 둘러볼 수 있어요.</p>') : '') +
          '</div></div>';
      }).join('') + '</div>' +
      (o.tickets ? '<p class="pg__note">입장권·체험 요금은 시연용 예시예요. 실제 요금과 운영 시간은 각 시설에 확인하세요.</p>' : '') + '</section>';

    // ── 길 안내 ──
    if (o.directions) {
      html += '<section class="pg__sec pg__dir"><h2>' + sec() + '길 안내</h2>' + legs.map(function (L, li) {
        return '<div class="pg__leg"><h3>' + (li + 1) + '구간 · ' + esc(d.modeLabel(L)) + ' · ' + esc(L.from.name) + ' → ' + esc(L.to.name) + '</h3><ol>' +
          L.ins.map(function (ins, k) { return '<li><span>' + esc(ins.text) + '</span><em>' + (k ? d.fmtDist(ins.at - L.ins[k - 1].at) + ' 후' : '') + '</em></li>'; }).join('') +
          '</ol></div>';
      }).join('') + '</section>';
    }

    // ── 체크리스트 ──
    if (o.checklist) {
      var items = CHECK_BASE.concat(c.need && CHECK_NEED[c.need] ? CHECK_NEED[c.need] : []);
      var tips = (group ? group.tips : []).concat(need ? need.points : []);
      html += '<section class="pg__sec pg__check"><h2>' + sec() + '떠나기 전에</h2><div class="pg__cols">' +
        '<div><h3>준비물</h3><ul class="pg__boxes">' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
        '<div><h3>이 코스를 위한 팁</h3><ul class="pg__tips">' + tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' +
        '</div></section>';
    }

    // ── 문의처 ──
    if (T.HELP) html += '<section class="pg__sec"><h2>' + sec() + '도움이 필요할 때</h2><ul class="pg__help">' +
      T.HELP.map(function (h) { return '<li><b>' + esc(h.label) + '</b> ' + esc(h.value) + ' <span>' + esc(h.note) + '</span></li>'; }).join('') + '</ul></section>';

    html += '<footer class="pg__foot"><p><b>모두의 여행길</b> · 연령별·무장애 여행 코스</p>' +
      '<p>지도·경로·시각은 시뮬레이션 결과로 실제 도로 안내가 아니에요. 운영 시간과 편의시설은 방문 전 각 시설에 확인하세요.' +
      (o.photos ? ' 사진 출처: 위키백과(각 사진 아래 표기).' : '') + '</p></footer></article>';

    paper.innerHTML = html;
    $('#pvTitle').textContent = c.title + ' · 가이드 미리보기';

    // 사진 채우기
    if (o.photos) {
      photos(stops).then(function (ps) {
        if (seq !== buildSeq) return; // 그사이 다시 만들었으면 무시
        ps.forEach(function (p, k) {
          var fig = $('[data-pg-photo="' + k + '"]', paper);
          if (!fig || !p) return;
          fig.innerHTML = '<img src="' + esc(p.src) + '" alt="' + esc(stops[k].name) + ' 사진"><figcaption>위키백과 「' + esc(p.title) + '」</figcaption>';
        });
      });
    }
  }

  // 인쇄 전에 사진이 다 뜰 때까지 기다림 (최대 5초)
  function imagesReady() {
    var imgs = $$('img', paper).filter(function (im) { return !im.complete; });
    if (!imgs.length) return Promise.resolve();
    var all = Promise.all(imgs.map(function (im) { return new Promise(function (r) { im.onload = im.onerror = r; }); }));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 5000); })]);
  }

  function open(courseId) {
    if (courseId) A.load(courseId);
    lastFocus = document.activeElement;
    build();
    document.body.classList.add('is-printing', 'dlg-open');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#pvPrint').focus();
  }
  function close() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', function () {
    document.body.classList.remove('is-printing', 'dlg-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  });
  $('#pvClose').addEventListener('click', close);
  $$('[data-opt]', dlg).forEach(function (cb) { cb.addEventListener('change', build); });
  $('#pvPrint').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = '사진 준비 중…';
    imagesReady().then(function () {
      btn.disabled = false; btn.textContent = '인쇄 · PDF 저장';
      window.print();
    });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-print-course]');
    if (b) { open(b.getAttribute('data-print-course')); return; }
    if (e.target.closest('[data-print-guide]')) open();
  });

  window.SlowGuide = { open: open };
})();
