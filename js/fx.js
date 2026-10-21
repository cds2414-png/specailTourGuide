/* 느린지도 — 연출 (프리로더 · 등고선 히어로 · 스크롤 장면) */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var body = document.body;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var vw = window.innerWidth, vh = window.innerHeight;

  /* ───────── 프리로더 ───────── */
  var loader = $('#loader'), loaderNum = $('#loaderNum');
  var fontsReady = false, t0 = performance.now(), minDur = reduce ? 200 : 700;
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fontsReady = true; });
  else fontsReady = true;
  setTimeout(function () { fontsReady = true; }, 3500);
  function loadTick(now) {
    var p = clamp((now - t0) / minDur, 0, 1);
    var e = 1 - Math.pow(1 - p, 3);
    if (!fontsReady) e = Math.min(e, 0.92);
    loaderNum.textContent = String(Math.round(e * 100)).padStart(3, '0');
    loader.style.setProperty('--p', e.toFixed(3));
    if (p < 1 || !fontsReady) return requestAnimationFrame(loadTick);
    finishLoad();
  }
  var loaded = false;
  function finishLoad() {
    if (loaded) return;
    loaded = true;
    loaderNum.textContent = '100';
    loader.style.setProperty('--p', '1');
    setTimeout(function () {
      body.classList.remove('is-loading');
      body.classList.add('is-ready');
      measure();
      setTimeout(function () { loader.hidden = true; }, 1400);
    }, reduce ? 0 : 220);
  }
  requestAnimationFrame(loadTick);
  // 백그라운드 탭 등으로 rAF가 멈춰도 로딩 화면에 갇히지 않도록
  setTimeout(finishLoad, 4200);

  /* ───────── 메뉴 ───────── */
  var nav = $('#nav'), burger = $('#burger'), mnav = $('#mnav');
  function setMenu(open) {
    burger.setAttribute('aria-expanded', String(open));
    mnav.hidden = !open;
    body.classList.toggle('menu-open', open);
  }
  burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
  mnav.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !mnav.hidden) { setMenu(false); burger.focus(); } });

  /* ───────── 단어 스크럽 준비 ───────── */
  var scrubs = $$('[data-scrub]').map(function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.setAttribute('aria-label', el.textContent.trim());
    el.innerHTML = words.map(function (w) { return '<span class="w" aria-hidden="true">' + w + '</span>'; }).join(' ');
    return { el: el, words: $$('.w', el), on: -1 };
  });

  /* ───────── 리빌 · 카운터 ───────── */
  if ('IntersectionObserver' in window) {
    var revIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var sib = el.parentElement ? $$(':scope > .reveal', el.parentElement) : [];
        var idx = Math.max(0, sib.indexOf(el));
        el.style.transitionDelay = (idx % 4) * 0.08 + 's';
        el.classList.add('is-in');
        revIO.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    $$('.reveal').forEach(function (el) { revIO.observe(el); });

    var cntIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, to = +el.getAttribute('data-count'), st = performance.now();
        cntIO.unobserve(el);
        (function tick(now) {
          var p = clamp((now - st) / 1400, 0, 1);
          el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4)))).padStart(2, '0');
          if (p < 1) requestAnimationFrame(tick);
        })(st);
      });
    }, { threshold: 0.6 });
    $$('[data-count]').forEach(function (el) { cntIO.observe(el); });
  } else {
    $$('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ───────── 등고선 히어로 ───────── */
  var topo = $('#topo'), tctx = topo.getContext('2d'), hero = $('.hero');
  var heroVisible = true, TW = 0, TH = 0;
  var perm = new Uint8Array(512);
  (function () {
    var p = [], s = 7;
    for (var i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; var j = s % (i + 1), t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  function fade(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var X = xi & 255, Y = yi & 255;
    var a = perm[perm[X] + Y] / 255, b = perm[perm[X + 1] + Y] / 255;
    var c = perm[perm[X] + Y + 1] / 255, d = perm[perm[X + 1] + Y + 1] / 255;
    var u = fade(xf), v = fade(yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.03, y * 2.03) * 0.3 + vnoise(x * 4.1, y * 4.1) * 0.15; }

  var CELL = 16, gx = 0, gy = 0, field = null;
  var hm = { x: -9999, y: -9999, s: 0 };
  function sizeTopo() {
    var r = topo.getBoundingClientRect();
    TW = Math.max(1, Math.round(r.width)); TH = Math.max(1, Math.round(r.height));
    topo.width = TW * DPR; topo.height = TH * DPR;
    CELL = TW < 640 ? 18 : 16;
    gx = Math.ceil(TW / CELL) + 1; gy = Math.ceil(TH / CELL) + 1;
    field = new Float32Array(gx * gy);
    var ht = document.getElementById('heroTitle'), hf = document.querySelector('.hero__foot');
    band.y0 = ht.offsetTop + ht.offsetHeight + 24; band.y1 = hf.offsetTop - 24;
  }
  hero.addEventListener('pointermove', function (e) {
    var r = topo.getBoundingClientRect();
    hm.x = e.clientX - r.left; hm.y = e.clientY - r.top;
  });
  hero.addEventListener('pointerleave', function () { hm.tx = 0; });

  // 히어로 위 데모 경로
  var ROUTE_D = [[0.50, 0.18], [0.60, 0.30], [0.56, 0.46], [0.70, 0.55], [0.74, 0.72], [0.88, 0.80]];
  var ROUTE_M = [[0.08, 0.15], [0.26, 0.55], [0.16, 0.85], [0.42, 0.92], [0.5, 0.4], [0.7, 0.62]];
  var band = { y0: 0, y1: 1 };
  var routeNames = ['감천문화마을', '블루라인파크', '광안리 해변', '흰여울문화마을'];
  function catmull(pts, n) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (var k = 0; k < n; k++) {
        var t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function drawTopo(t) {
    if (!field) return;
    var ctx = tctx;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, TW, TH);
    hm.s = lerp(hm.s, hm.x > -999 ? 1 : 0, 0.05);
    var sc = 0.0021, tx = t * 0.018, ty = -t * 0.012, R2 = 2 * 170 * 170;
    for (var j = 0; j < gy; j++) {
      for (var i = 0; i < gx; i++) {
        var x = i * CELL, y = j * CELL;
        var v = fbm(x * sc + tx, y * sc + ty);
        var dx = x - hm.x, dy = y - hm.y;
        v += Math.exp(-(dx * dx + dy * dy) / R2) * 0.22 * hm.s;
        field[j * gx + i] = v;
      }
    }
    var levels = [];
    for (var L = 0.16; L < 0.95; L += 0.042) levels.push(L);
    var thin = new Path2D(), bold = new Path2D();
    for (var li = 0; li < levels.length; li++) {
      var lv = levels[li], path = li % 5 === 0 ? bold : thin;
      for (j = 0; j < gy - 1; j++) {
        for (i = 0; i < gx - 1; i++) {
          var a = field[j * gx + i], b = field[j * gx + i + 1], c = field[(j + 1) * gx + i + 1], d = field[(j + 1) * gx + i];
          var idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          var x0 = i * CELL, y0 = j * CELL;
          var top = [x0 + CELL * (lv - a) / (b - a), y0];
          var right = [x0 + CELL, y0 + CELL * (lv - b) / (c - b)];
          var bottom = [x0 + CELL * (lv - d) / (c - d), y0 + CELL];
          var left = [x0, y0 + CELL * (lv - a) / (d - a)];
          var segs;
          switch (idx) {
            case 1: case 14: segs = [left, bottom]; break;
            case 2: case 13: segs = [bottom, right]; break;
            case 3: case 12: segs = [left, right]; break;
            case 4: case 11: segs = [top, right]; break;
            case 5: segs = [left, top, bottom, right]; break;
            case 6: case 9: segs = [top, bottom]; break;
            case 7: case 8: segs = [left, top]; break;
            case 10: segs = [left, bottom, top, right]; break;
          }
          for (var s = 0; s < segs.length; s += 2) { path.moveTo(segs[s][0], segs[s][1]); path.lineTo(segs[s + 1][0], segs[s + 1][1]); }
        }
      }
    }
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(15,28,24,.11)'; ctx.stroke(thin);
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(15,28,24,.22)'; ctx.stroke(bold);

    // 데모 경로
    var mob = TW < 900;
    var base = mob
      ? ROUTE_M.map(function (p) { return [p[0] * TW, band.y0 + p[1] * Math.max(60, band.y1 - band.y0)]; })
      : ROUTE_D.map(function (p) { return [p[0] * TW, p[1] * TH]; });
    var pts = catmull(base, 24);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(function (p, k) { k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = 'rgba(236,231,220,.95)'; ctx.lineWidth = 10; ctx.stroke();
    ctx.setLineDash([2, 12]); ctx.lineDashOffset = -t * 18;
    ctx.strokeStyle = '#ff4f1a'; ctx.lineWidth = 4; ctx.stroke();
    ctx.setLineDash([]);

    // 진행 위치
    var cum = [0];
    for (var k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    var total = cum[cum.length - 1], prog = reduce ? 0.42 : (t * 0.045) % 1, sd = prog * total;
    var q = 1; while (q < cum.length - 1 && cum[q] < sd) q++;
    var f = (sd - cum[q - 1]) / ((cum[q] - cum[q - 1]) || 1);
    var px = lerp(pts[q - 1][0], pts[q][0], f), py = lerp(pts[q - 1][1], pts[q][1], f);
    var ang = Math.atan2(pts[q][1] - pts[q - 1][1], pts[q][0] - pts[q - 1][0]);
    // 지난 구간
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (k = 1; k < q; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.lineTo(px, py); ctx.strokeStyle = '#0f1c18'; ctx.lineWidth = 4; ctx.stroke();

    // 핀
    base.forEach(function (p, k) {
      if (k === 0 || k === base.length - 1 || k % 1 === 0) {
        var end = k === base.length - 1, start = k === 0;
        ctx.beginPath(); ctx.arc(p[0], p[1], start || end ? 13 : 7, 0, Math.PI * 2);
        ctx.fillStyle = end ? '#ff4f1a' : start ? '#0f1c18' : '#ece7dc'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = start || end ? '#ece7dc' : '#0f1c18'; ctx.stroke();
        if (start || end) {
          ctx.fillStyle = '#fff'; ctx.font = '700 10px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(start ? '출' : '도', p[0], p[1] + 0.5);
        }
      }
    });
    // 차량
    var pulse = (Math.sin(t * 4) + 1) / 2;
    ctx.beginPath(); ctx.arc(px, py, 20 + pulse * 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,79,26,.16)'; ctx.fill();
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10); ctx.closePath();
    ctx.fillStyle = '#ff4f1a'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
    // 안내 칩
    var seg = Math.min(routeNames.length - 1, Math.floor(prog * routeNames.length));
    var remain = ((1 - (prog * routeNames.length - seg)) * 3.4).toFixed(1) + ' km';
    var label = routeNames[seg] + ' 방면';
    ctx.font = '400 22px "Instrument Serif", serif';
    var w1 = ctx.measureText(remain).width;
    ctx.font = '500 12px "Noto Sans KR", sans-serif';
    var w2 = ctx.measureText(label).width;
    var cw = Math.max(w1, w2) + 30, chx = px + 26, chy = py - 66;
    if (chx + cw > TW - 12) chx = px - 26 - cw;
    ctx.fillStyle = '#0f1c18'; roundRect(ctx, chx, chy, cw, 54, 12); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ece7dc'; ctx.font = '400 22px "Instrument Serif", serif'; ctx.fillText(remain, chx + 15, chy + 25);
    ctx.fillStyle = 'rgba(236,231,220,.62)'; ctx.font = '500 12px "Noto Sans KR", sans-serif'; ctx.fillText(label, chx + 15, chy + 43);
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; }).observe(hero);

  /* ───────── 연령별 (세로 배치) ───────── */
  var ages = $('#ages'), track = $('#agesTrack'), panels = $$('.age', track), dots = $$('#agesDots li');
  var activeAge = -1;
  function measure() {
    vw = window.innerWidth; vh = window.innerHeight;
    sizeTopo();
  }
  function scrollToGroup(id) {
    var panel = document.getElementById('age-' + id);
    if (!panel) return;
    var top = panel.getBoundingClientRect().top + window.scrollY - (vw <= 900 ? 72 : 140); // 상단 메뉴 + 연령 바로가기 높이
    window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
  }
  $('#heroChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-hero-group]');
    if (b) scrollToGroup(b.getAttribute('data-hero-group'));
  });
  // 연령 바로가기 (#age-xxx)
  $('#agesDots').addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#age-"]'); if (!a) return;
    e.preventDefault();
    scrollToGroup(a.getAttribute('href').slice(5));
  });

  /* ───────── 마키 ───────── */
  var mq = $('#marquee'), mqX = 0, mqDir = -1, lastY = window.scrollY, vel = 0;

  /* ───────── 스크롤 장면 루프 ───────── */
  var progress = $('#progress'), heroTitle = $('#heroTitle');
  var footer = $('.footer');
  var navHidden = false, lastT = performance.now(), tSec = 0;

  function frame(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; tSec += dt;
    var y = window.scrollY, dy = y - lastY; lastY = y;
    vel = lerp(vel, dy, 0.1);

    // 진행바
    var max = document.documentElement.scrollHeight - vh;
    progress.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';

    // 상단 메뉴: 데스크톱은 항상 보이고, 모바일은 아래로 스크롤하면 숨김
    var mobile = vw <= 900;
    if (!mobile && navHidden) { navHidden = false; nav.classList.remove('is-hidden'); }
    if (mobile && !body.classList.contains('menu-open')) {
      if (dy > 4 && y > 200 && !navHidden) { navHidden = true; nav.classList.add('is-hidden'); }
      else if ((dy < -4 || y < 200) && navHidden) { navHidden = false; nav.classList.remove('is-hidden'); }
    }
    nav.classList.toggle('is-solid', y > 40);
    var navY = 40;
    var fr = footer.getBoundingClientRect();
    nav.classList.toggle('is-dark', fr.top < navY);

    // 히어로 패럴랙스
    if (y < vh * 1.2) {
      heroTitle.style.transform = 'translate3d(0,' + (y * 0.22).toFixed(1) + 'px,0)';
      heroTitle.style.opacity = String(clamp(1 - y / (vh * 0.9), 0, 1));
    }
    if (heroVisible && !reduce) drawTopo(tSec);

    // 단어 스크럽
    scrubs.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      var p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.25), 0, 1);
      var on = Math.round(p * s.words.length);
      if (on !== s.on) { s.words.forEach(function (w, i) { w.classList.toggle('on', i < on); }); s.on = on; }
    });

    // 연령 패널: 화면 가운데를 지나는 패널을 강조하고 바로가기에 표시
    if (!ages.hidden) {
      var best = -1, mid = vh * 0.45;
      panels.forEach(function (p, i) {
        var r = p.getBoundingClientRect();
        if (r.top < mid && r.bottom > mid) best = i;
      });
      if (best !== activeAge) {
        activeAge = best;
        panels.forEach(function (p, i) { p.classList.toggle('is-active', i === best); });
        dots.forEach(function (d, i) { d.classList.toggle('is-on', i === best); });
      }
    }

    // 마키
    if (!reduce) {
      if (Math.abs(dy) > 0.5) mqDir = dy > 0 ? -1 : 1;
      var speed = 36 + Math.min(Math.abs(vel) * 3, 90);
      mqX += mqDir * speed * dt;
      var half = mq.scrollWidth / 2;
      if (half > 0) { if (mqX <= -half) mqX += half; if (mqX > 0) mqX -= half; }
      mq.style.transform = 'translate3d(' + mqX.toFixed(1) + 'px,0,0)';
    }

    requestAnimationFrame(frame);
  }

  var rt = 0;
  function onResize() { clearTimeout(rt); rt = setTimeout(function () { measure(); if (reduce) drawTopo(0); }, 120); }
  window.addEventListener('resize', onResize);
  window.addEventListener('slowmap:layout', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measure(); if (reduce) drawTopo(0); });

  measure();
  if (reduce) drawTopo(0);
  requestAnimationFrame(frame);
})();
