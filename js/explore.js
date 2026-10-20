/* 느린지도 — 목적지 둘러보기 (사진 · 즐길거리) + 입장권·체험 결제 · 퍼블리싱 전용
   - 사진: 위키백과 REST API(page/summary)의 대표 이미지. 출처를 함께 표시하고, 없으면 그림으로 대신한다.
   - 결제: 토스페이먼츠 결제창형 결제 SDK v2 (연동 문서는 토스페이먼츠 MCP로 확인).
     정적 사이트라 시크릿 키가 필요한 '결제 승인 API'는 호출하지 않고 결제 인증 단계까지 처리한다. */
(function () {
  'use strict';

  var T = window.TRIP, C = window.SlowCommunity, A = window.SlowApp;
  if (!C || !A) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = C.esc;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var TOSS = {
    SDK_URL: 'https://js.tosspayments.com/v2/standard',
    // 공개용 클라이언트 키(결제창형 연동 키). 문서용 공개 테스트 키라 실제 청구가 없다. 내 상점 키로 바꿔 쓰면 된다.
    CLIENT_KEY: 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm'
  };
  var KEY_TICKETS = 'slowmap.tickets', KEY_PENDING = 'slowmap.pendingOrder';
  var MAX_QTY = 10;

  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
  function loadTickets() { try { return JSON.parse(localStorage.getItem(KEY_TICKETS) || '[]'); } catch (e) { return []; } }
  function saveTickets(l) { try { localStorage.setItem(KEY_TICKETS, JSON.stringify(l)); } catch (e) { /* 무시 */ } }
  function ticketsFor(stop) { return (T.TICKETS && T.TICKETS[stop.name]) || []; }

  /* ───────── 사진 (위키백과) ───────── */
  var photoCache = {};
  try { photoCache = JSON.parse(sessionStorage.getItem('slowmap.photos') || '{}'); } catch (e) { /* 무시 */ }
  function wikiTitle(name) {
    if (T.WIKI && Object.prototype.hasOwnProperty.call(T.WIKI, name)) return T.WIKI[name];
    return name;
  }
  function getPhoto(name) {
    var title = wikiTitle(name);
    if (!title) return Promise.resolve(null);
    if (photoCache[title] !== undefined) return Promise.resolve(photoCache[title]);
    var url = 'https://ko.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'));
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var p = j && j.type === 'standard' && j.thumbnail ? {
        src: j.thumbnail.source, title: j.title,
        page: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : 'https://ko.wikipedia.org/wiki/' + encodeURIComponent(j.title)
      } : null;
      photoCache[title] = p;
      try { sessionStorage.setItem('slowmap.photos', JSON.stringify(photoCache)); } catch (e) { /* 무시 */ }
      return p;
    }).catch(function () { return null; }); // 오프라인 등: 그림으로 대신
  }
  function photoHTML(stop, p) {
    if (!p) return '<div class="spot__ph" aria-hidden="true"><span>' + esc(stop.name.charAt(0)) + '</span><small>' + esc(stop.name) + '</small></div>';
    return '<img src="' + esc(p.src) + '" alt="' + esc(stop.name) + ' 사진" loading="lazy" decoding="async">' +
      '<figcaption>사진: <a href="' + esc(p.page) + '" target="_blank" rel="noopener">위키백과 「' + esc(p.title) + '」</a></figcaption>';
  }
  function fillPhoto(fig, stop) {
    fig.innerHTML = '<div class="spot__ph is-loading" aria-hidden="true"></div>';
    getPhoto(stop.name).then(function (p) {
      fig.innerHTML = photoHTML(stop, p);
      var img = $('img', fig);
      if (img) img.addEventListener('error', function () { fig.innerHTML = photoHTML(stop, null); });
    });
  }

  /* ───────── 목적지 목록 ───────── */
  var listEl = $('#exploreList'), course = null, nowNo = 0;
  function renderList(c) {
    course = c;
    $('#exploreTitle').textContent = c.title + ' · 목적지 ' + c.stops.length + '곳';
    listEl.innerHTML = c.stops.map(function (s, i) {
      var tk = ticketsFor(s);
      return '<li class="spot" id="spot-' + (i + 1) + '" data-no="' + (i + 1) + '">' +
        '<figure class="spot__photo" data-photo="' + i + '"></figure>' +
        '<div class="spot__body">' +
          '<p class="spot__no mono">STOP ' + ('0' + (i + 1)).slice(-2) + '<span class="spot__now">지금 향하는 곳</span></p>' +
          '<h4>' + esc(s.name) + '</h4>' +
          '<p class="spot__desc">' + esc(s.desc || '') + '</p>' +
          (tk.length
            ? '<ul class="spot__tickets">' + tk.map(function (t) {
                return '<li><span class="spot__kind is-' + (t.kind === '체험' ? 'exp' : t.kind === '교통' ? 'ride' : 'in') + '">' + esc(t.kind) + '</span>' +
                  '<b>' + esc(t.name) + '</b><em class="mono">' + won(t.price) + ' / ' + esc(t.unit || '1인') + '</em></li>';
              }).join('') + '</ul>' +
              '<button type="button" class="btn spot__buy" data-buy="' + i + '">티켓 구매하기 <span aria-hidden="true">→</span></button>'
            : '<p class="spot__free">별도 티켓 없이 둘러볼 수 있어요. 운영 시간은 현장에서 확인하세요.</p>') +
        '</div></li>';
    }).join('');
    $$('[data-photo]', listEl).forEach(function (fig) { fillPhoto(fig, c.stops[+fig.getAttribute('data-photo')]); });
    nowNo = 0;
  }
  function markNow(no) {
    if (no === nowNo) return;
    nowNo = no;
    $$('.spot', listEl).forEach(function (li) { li.classList.toggle('is-now', +li.getAttribute('data-no') === no); });
  }

  // 도착 카드에 사진과 '즐길거리 보기' 버튼
  var arrivePhoto = $('#arrivePhoto'), arriveMore = $('#arriveMore'), offerEl = $('#arriveOffer'), lastArrive = null;
  function showArrivePhoto(stop, no, phase) {
    var key = (course ? course.id : '') + ':' + no;
    if (key === lastArrive) return;
    lastArrive = key;
    arrivePhoto.hidden = false;
    arrivePhoto.innerHTML = '<div class="spot__ph is-loading" aria-hidden="true"></div>';
    getPhoto(stop.name).then(function (p) { if (lastArrive === key) arrivePhoto.innerHTML = photoHTML(stop, p); });
    var n = ticketsFor(stop).length;
    // 티켓이 있는 중간 목적지: 멈춰서 구매를 제안하고, 사지 않으면 다음 목적지로
    if (n && phase === 'dwell') { arriveMore.hidden = true; startOffer(stop, no); return; }
    arriveMore.hidden = false;
    arriveMore.textContent = n ? '입장권·체험 ' + n + '개 보기 ↓' : '사진·즐길거리 보기 ↓';
    arriveMore.setAttribute('data-goto-spot', String(no));
  }
  arriveMore.addEventListener('click', function () {
    var li = document.getElementById('spot-' + arriveMore.getAttribute('data-goto-spot'));
    if (li) window.scrollTo({ top: li.getBoundingClientRect().top + window.scrollY - 100, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ───────── 도착지 티켓 제안 ─────────
     티켓을 사지 않으면(건너뛰기 · 시간 초과 · 구매창을 그냥 닫음) 다음 목적지로 넘어간다. */
  var OFFER_SEC = 10;
  var offer = { active: false, no: 0, left: 0, paying: false, timer: 0, last: 0 };
  var offerSubmitted = false; // 구매창에서 결제를 시작했는지
  function startOffer(stop, no) {
    endOffer();
    A.holdDwell();
    offer = { active: true, no: no, left: OFFER_SEC, paying: false, timer: 0, last: performance.now() };
    var tk = ticketsFor(stop);
    offerEl.hidden = false;
    offerEl.innerHTML =
      '<p class="offer__title">이곳의 입장권 · 체험 <small>요금은 예시</small></p>' +
      '<ul class="offer__list">' + tk.map(function (t) {
        return '<li><span class="spot__kind is-' + (t.kind === '체험' ? 'exp' : t.kind === '교통' ? 'ride' : 'in') + '">' + esc(t.kind) + '</span>' +
          esc(t.name) + '<b class="mono">' + won(t.price) + '</b></li>';
      }).join('') + '</ul>' +
      '<div class="offer__btns">' +
        '<button type="button" class="offer__buy" data-offer="buy">티켓 구매하기</button>' +
        '<button type="button" class="offer__skip" data-offer="skip">구매 안 하고 다음 목적지로 →</button>' +
      '</div>' +
      '<div class="offer__count" aria-live="polite"><i><b></b></i><span></span></div>';
    paintOffer();
    offer.timer = setInterval(tickOffer, 100);
  }
  function paintOffer() {
    var bar = $('.offer__count b', offerEl), txt = $('.offer__count span', offerEl);
    if (!bar) return;
    if (offer.paying) {
      bar.style.width = '0%';
      txt.textContent = '티켓을 고르는 중이에요. 구매하지 않으면 다음 목적지로 넘어가요.';
      return;
    }
    bar.style.width = (offer.left / OFFER_SEC * 100).toFixed(1) + '%';
    var paused = !A.state().playing;
    txt.textContent = paused ? '일시정지 중 · 재생하면 ' + Math.ceil(offer.left) + '초 뒤 다음 목적지로 넘어가요'
      : Math.ceil(offer.left) + '초 뒤 다음 목적지로 넘어가요';
  }
  function tickOffer() {
    var now = performance.now(), dt = (now - offer.last) / 1000;
    offer.last = now;
    if (!offer.active) return;
    if (!offer.paying && A.state().playing) offer.left = Math.max(0, offer.left - dt);
    paintOffer();
    if (offer.left <= 0) skipOffer('auto');
  }
  function endOffer() {
    if (offer.timer) clearInterval(offer.timer);
    offer.active = false; offer.timer = 0;
    offerEl.hidden = true; offerEl.innerHTML = '';
  }
  function skipOffer(reason) {
    if (!offer.active) return;
    endOffer();
    A.releaseDwell();
    C.notify(reason === 'auto' ? '티켓을 구매하지 않아 다음 목적지로 이동해요.'
      : reason === 'closed' ? '구매하지 않고 다음 목적지로 이동해요.' : '다음 목적지로 이동해요.');
  }
  offerEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-offer]'); if (!b || !offer.active) return;
    if (b.getAttribute('data-offer') === 'skip') { skipOffer('skip'); return; }
    offer.paying = true; paintOffer();
    openBuy(offer.no - 1);
  });

  window.addEventListener('slowmap:course', function (e) { endOffer(); renderList(e.detail.course); lastArrive = null; arrivePhoto.hidden = true; arriveMore.hidden = true; });
  window.addEventListener('slowmap:progress', function (e) {
    var d = e.detail;
    if (!course) return;
    markNow(d.phase === 'idle' ? 0 : d.stopNo);
    if (d.phase !== 'dwell' && offer.active) endOffer(); // 다시 출발했거나 처음부터·다른 지점으로 이동
    if ((d.phase === 'dwell' || d.phase === 'done') && d.stop) showArrivePhoto(d.stop, d.stopNo, d.phase);
    else if (d.phase === 'move' || d.phase === 'idle') { lastArrive = null; }
  });
  // app.js가 먼저 첫 코스를 불러온 상태
  var st = A.state();
  if (st.course) renderList(st.course);

  /* ───────── 티켓 구매 ───────── */
  var dlg = $('#ticketDlg'), form = $('#formTicket'), itemsEl = $('#tkItems'), sumEl = $('#tkSum'), msgEl = $('.form-msg', form), payBtn = $('#tkPay');
  var buyStop = null, qty = {};
  function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  function maxDate() { var d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); }

  function renderItems() {
    var list = ticketsFor(buyStop);
    itemsEl.innerHTML = list.map(function (t) {
      var q = qty[t.id] || 0;
      return '<li class="tk__item' + (q ? ' is-on' : '') + '"><div><span class="spot__kind is-' + (t.kind === '체험' ? 'exp' : t.kind === '교통' ? 'ride' : 'in') + '">' + esc(t.kind) + '</span>' +
        '<b>' + esc(t.name) + '</b><small>' + won(t.price) + ' / ' + esc(t.unit || '1인') + (t.note ? ' · ' + esc(t.note) : '') + '</small></div>' +
        '<div class="tk__qty" role="group" aria-label="' + esc(t.name) + ' 수량">' +
          '<button type="button" data-qty="-1" data-id="' + t.id + '" aria-label="한 개 빼기"' + (q <= 0 ? ' disabled' : '') + '>−</button>' +
          '<output class="mono" aria-live="polite">' + q + '</output>' +
          '<button type="button" data-qty="1" data-id="' + t.id + '" aria-label="한 개 더하기"' + (q >= MAX_QTY ? ' disabled' : '') + '>+</button>' +
        '</div></li>';
    }).join('');
    calc();
  }
  function lines() {
    return ticketsFor(buyStop).filter(function (t) { return qty[t.id] > 0; })
      .map(function (t) { return { id: t.id, kind: t.kind, name: t.name, price: t.price, unit: t.unit || '1인', qty: qty[t.id] }; });
  }
  function calc() {
    var ls = lines(), total = ls.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    sumEl.innerHTML = ls.length
      ? ls.map(function (l) { return '<div><dt>' + esc(l.name) + ' × ' + l.qty + '</dt><dd>' + won(l.price * l.qty) + '</dd></div>'; }).join('') +
        '<div class="is-total"><dt>결제 금액</dt><dd>' + won(total) + '</dd></div>'
      : '<div class="is-empty"><dt>수량을 골라주세요</dt><dd></dd></div>';
    payBtn.disabled = !ls.length || location.protocol === 'file:';
    payBtn.textContent = ls.length ? won(total) + ' 토스페이먼츠로 결제하기' : '토스페이먼츠로 결제하기';
    return total;
  }
  itemsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-qty]'); if (!b) return;
    var id = b.getAttribute('data-id');
    qty[id] = Math.max(0, Math.min(MAX_QTY, (qty[id] || 0) + Number(b.getAttribute('data-qty'))));
    renderItems();
    var again = $('[data-id="' + id + '"][data-qty="' + b.getAttribute('data-qty') + '"]', itemsEl);
    if (again && !again.disabled) again.focus();
  });

  function openBuy(stopIndex) {
    var s = course && course.stops[stopIndex];
    if (!s || !ticketsFor(s).length) return;
    if (!C.currentUser()) {
      C.notify('티켓을 구매하려면 먼저 로그인해주세요.');
      C.openAuth('login', function () { openBuy(stopIndex); });
      return;
    }
    buyStop = s; qty = {};
    // 입장권이 있으면 1매를 기본 선택
    var first = ticketsFor(s)[0]; qty[first.id] = 1;
    form.reset(); msgEl.textContent = '';
    form.date.min = tomorrow(); form.date.max = maxDate(); form.date.value = tomorrow();
    var spot = $('#tkSpot');
    spot.innerHTML = '<figure class="tk__photo"></figure><div><span class="mono">' + esc(course.title) + '</span><b>' + esc(s.name) + '</b></div>';
    getPhoto(s.name).then(function (p) { $('.tk__photo', spot).innerHTML = photoHTML(s, p); });
    renderItems();
    if (location.protocol === 'file:') msgEl.textContent = '파일로 직접 연 페이지에서는 결제 후 돌아올 주소를 만들 수 없어요. 로컬 서버(http://)로 열어주세요.';
    offerSubmitted = false;
    C.openDlg(dlg);
  }
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-buy]'); if (b) openBuy(+b.getAttribute('data-buy'));
  });

  /* 토스페이먼츠 SDK */
  var sdkPromise = null;
  function loadSdk() {
    if (window.TossPayments) return Promise.resolve(window.TossPayments);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TOSS.SDK_URL; s.async = true;
      s.onload = function () { window.TossPayments ? resolve(window.TossPayments) : reject(new Error('SDK')); };
      s.onerror = function () { sdkPromise = null; reject(new Error('SDK')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }
  function newOrderId() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var a = new Uint8Array(6); crypto.getRandomValues(a);
    var rnd = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return 'TKT-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + rnd;
  }

  var paymentWindow = null;
  // 구매창을 결제 없이 닫으면 '사지 않음'으로 보고 다음 목적지로
  // close 이벤트는 비동기로 늦게 올 수 있어 open 속성이 사라지는 순간을 직접 감지한다
  new MutationObserver(function () {
    if (!dlg.open && offer.active && offer.paying && !offerSubmitted) skipOffer('closed');
  }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msgEl.textContent = '';
    var dateErr = $('.fld__err', form.date.closest('.fld'));
    dateErr.textContent = '';
    if (!form.date.value || form.date.value < form.date.min || form.date.value > form.date.max) {
      dateErr.textContent = '내일부터 6개월 안의 날짜를 골라주세요.'; form.date.focus(); return;
    }
    var ls = lines(); if (!ls.length) return;
    offerSubmitted = true;
    var u = C.currentUser(); if (!u) { C.closeDlg(dlg); C.openAuth('login'); return; }
    var amount = calc();
    var count = ls.reduce(function (s, l) { return s + l.qty; }, 0);
    var orderName = (ls[0].name + (ls.length > 1 ? ' 외 ' + (ls.length - 1) + '건' : '') + ' (' + count + '매)').slice(0, 100);
    var order = {
      orderId: newOrderId(), orderName: orderName, amount: amount, date: form.date.value,
      courseId: course.id, courseTitle: course.title, place: buyStop.name, lines: ls
    };
    payBtn.disabled = true; payBtn.textContent = '결제창을 여는 중…';

    loadSdk().then(function (TossPayments) {
      sessionStorage.setItem(KEY_PENDING, JSON.stringify({ type: 'ticket', order: order, email: u.email, at: Date.now() }));
      var widgets = TossPayments(TOSS.CLIENT_KEY).widgets({ customerKey: C.ensureCustomerKey() });
      C.closeDlg(dlg); // 결제창 오버레이가 대화상자 아래에 깔리지 않도록
      var cleanup = paymentWindow ? paymentWindow.destroy().catch(function () {}) : Promise.resolve();
      return cleanup.then(function () {
        paymentWindow = null;
        return widgets.setAmount({ currency: 'KRW', value: order.amount });
      }).then(function () {
        return widgets.renderPaymentWindow({ orderName: order.orderName, variantKey: { paymentMethod: 'DEFAULT', agreement: 'AGREEMENT' } });
      }).then(function (pw) {
        paymentWindow = pw;
        pw.on('paymentRequest', function () {
          var base = new URL('pay/', location.href);
          return widgets.requestPayment({
            orderId: order.orderId,
            orderName: order.orderName,
            successUrl: new URL('success.html', base).href,
            failUrl: new URL('fail.html', base).href,
            customerName: u.nick,
            metadata: { place: order.place.slice(0, 100), visitDate: order.date, courseId: order.courseId }
          }).catch(function (err) {
            C.notify('결제를 진행하지 못했어요: ' + (err && err.message ? err.message : '알 수 없는 오류'));
          });
        });
      });
    }).catch(function (err) {
      calc();
      if (!dlg.open) C.openDlg(dlg);
      msgEl.textContent = err && err.message === 'SDK'
        ? '토스페이먼츠 결제 SDK를 불러오지 못했어요. 인터넷 연결을 확인해주세요.'
        : '결제를 시작하지 못했어요. ' + (err && err.message ? '(' + err.message + ')' : '');
    });
  });

  /* ───────── 내 티켓 ───────── */
  var tListDlg = $('#ticketsDlg'), tListEl = $('#ticketsList');
  function renderMyTickets() {
    var u = C.currentUser();
    var list = loadTickets().filter(function (t) { return u && t.email === u.email; })
      .sort(function (a, b) { return (b.paidAt || '') < (a.paidAt || '') ? -1 : 1; });
    if (!list.length) {
      tListEl.innerHTML = '<li class="tickets__empty"><p>아직 구매한 티켓이 없어요.</p><p>내비 시뮬레이터 아래 <b>목적지 둘러보기</b>에서 입장권·체험을 고를 수 있어요.</p></li>';
      return;
    }
    tListEl.innerHTML = list.map(function (t) {
      return '<li class="tkt" data-order="' + esc(t.orderId) + '">' +
        '<div class="tkt__main">' +
          '<p class="tkt__top"><span class="tkt__status">결제 인증 완료</span><span class="mono">' + esc(t.date) + ' 방문</span></p>' +
          '<h3>' + esc(t.place) + '</h3>' +
          '<p class="tkt__course">' + esc(t.courseTitle) + '</p>' +
          '<ul class="tkt__lines">' + (t.lines || []).map(function (l) { return '<li><span>' + esc(l.name) + '</span><b class="mono">× ' + l.qty + '</b></li>'; }).join('') + '</ul>' +
        '</div>' +
        '<div class="tkt__stub">' +
          '<span class="mono">TICKET</span><b class="mono">' + esc(t.orderId.slice(-6).toUpperCase()) + '</b>' +
          '<em>' + won(t.amount) + '</em>' +
          '<button type="button" class="tkt__rm" data-remove-ticket>목록에서 지우기</button>' +
        '</div></li>';
    }).join('');
  }
  function openMyTickets() {
    if (!C.currentUser()) { C.openAuth('login', openMyTickets); return; }
    renderMyTickets();
    C.openDlg(tListDlg);
  }
  tListEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-remove-ticket]'); if (!b) return;
    var id = b.closest('.tkt').getAttribute('data-order');
    if (!window.confirm('이 티켓을 목록에서 지울까요?')) return;
    saveTickets(loadTickets().filter(function (t) { return t.orderId !== id; }));
    renderMyTickets();
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-my-tickets]')) return;
    var menu = $('#umenuList'); if (menu) menu.hidden = true;
    var burger = $('#burger'); if (burger && burger.getAttribute('aria-expanded') === 'true') burger.click();
    openMyTickets();
  });
  // 결제 결과 페이지에서 돌아오면(?open=tickets) 내 티켓을 연다
  if (new URLSearchParams(location.search).get('open') === 'tickets') {
    history.replaceState(history.state, '', location.pathname + location.hash);
    setTimeout(openMyTickets, 600);
  }
  // guide.js(가이드 출력)가 같은 사진 캐시를 쓰도록 공개
  window.SlowExplore = { getPhoto: getPhoto };
})();
