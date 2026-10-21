/* 모두의 여행길 — 결제 결과 페이지 (pay/success.html, pay/fail.html) · 퍼블리싱 전용
   success: 리다이렉트 쿼리(paymentKey·orderId·amount)를 요청 때 보관한 주문과 대조하고 티켓을 저장한다.
   결제 승인 API는 시크릿 키가 필요해 서버에서만 호출할 수 있으므로 '결제 인증 완료'까지 처리한다. */
(function () {
  'use strict';

  var KEY_TICKETS = 'slowmap.tickets', KEY_PENDING = 'slowmap.pendingOrder';
  var box = document.getElementById('payState');
  var q = new URLSearchParams(location.search);
  var page = document.body.getAttribute('data-page');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
  function pending() { try { return JSON.parse(sessionStorage.getItem(KEY_PENDING) || 'null'); } catch (e) { return null; } }
  function clearPending() { try { sessionStorage.removeItem(KEY_PENDING); } catch (e) { /* 무시 */ } }
  function loadTickets() { try { return JSON.parse(localStorage.getItem(KEY_TICKETS) || '[]'); } catch (e) { return []; } }

  var ACTIONS_OK = '<div class="payres__actions"><a class="btn btn--play" href="../index.html?open=tickets#sim">내 티켓 보기</a><a class="btn" href="../index.html#sim">시뮬레이터로</a></div>';
  var ACTIONS_RETRY = '<div class="payres__actions"><a class="btn btn--play" href="../index.html#sim">다시 시도하기</a><a class="btn" href="../index.html">처음으로</a></div>';

  function showError(title, message, code) {
    box.innerHTML = '<p class="dlg__eyebrow mono">TOSS PAYMENTS</p><div class="payres__icon is-fail" aria-hidden="true">!</div>' +
      '<h1>' + esc(title) + '</h1><p>' + esc(message) + '</p>' + (code ? '<p class="payres__code mono">' + esc(code) + '</p>' : '') + ACTIONS_RETRY;
  }

  if (page === 'fail') {
    clearPending();
    var code = q.get('code') || '', msg = q.get('message') || '결제를 완료하지 못했어요.';
    if (code === 'PAY_PROCESS_CANCELED') showError('결제를 취소했어요', '결제 과정에서 취소했어요. 티켓은 구매되지 않았어요.', code);
    else showError('결제에 실패했어요', msg, code);
    return;
  }

  var paymentKey = q.get('paymentKey'), orderId = q.get('orderId'), amount = Number(q.get('amount'));
  var paymentType = q.get('paymentType') || 'NORMAL';
  if (!paymentKey || !orderId || !amount) { showError('결제 정보가 없어요', '결제 결과 정보가 올바르지 않아요.', 'INVALID_REDIRECT'); return; }

  // 새로고침으로 다시 들어오면 저장된 티켓을 그대로 보여준다
  var saved = loadTickets().filter(function (t) { return t.orderId === orderId; })[0];
  var p = pending();
  var order = saved || (p && p.order && p.order.orderId === orderId ? Object.assign({}, p.order, { email: p.email }) : null);
  if (!order) { showError('주문 정보를 찾을 수 없어요', '결제를 요청한 브라우저 창에서 다시 시도해주세요.', 'ORDER_NOT_FOUND'); return; }

  // 리다이렉트 금액과 요청 금액 대조 (금액 조작 방지의 첫 단계, 최종 검증은 서버 승인 단계에서)
  if (Number(order.amount) !== amount) {
    clearPending();
    showError('결제 금액이 달라요', '요청한 금액과 결제 금액이 달라 티켓을 발급하지 않았어요.', 'AMOUNT_MISMATCH');
    return;
  }

  if (!saved) {
    saved = {
      orderId: orderId, email: order.email || '', courseId: order.courseId, courseTitle: order.courseTitle,
      place: order.place, date: order.date, lines: order.lines, amount: amount, orderName: order.orderName,
      status: 'AUTHORIZED', paymentType: paymentType, paymentKey: paymentKey, paidAt: new Date().toISOString()
    };
    try { var list = loadTickets(); list.push(saved); localStorage.setItem(KEY_TICKETS, JSON.stringify(list)); } catch (e) { /* 무시 */ }
    clearPending();
  }

  box.innerHTML = '<p class="dlg__eyebrow mono">TOSS PAYMENTS · AUTHORIZED</p>' +
    '<div class="payres__icon" aria-hidden="true">✓</div>' +
    '<h1>티켓 결제 인증이 완료됐어요</h1><p>' + esc(saved.place) + ' · ' + esc(saved.date) + ' 방문</p>' +
    '<dl class="payres__rows">' +
      (saved.lines || []).map(function (l) { return '<div><dt>' + esc(l.name) + ' × ' + l.qty + '</dt><dd>' + won(l.price * l.qty) + '</dd></div>'; }).join('') +
      '<div><dt>결제 금액</dt><dd><b>' + won(saved.amount) + '</b></dd></div>' +
      '<div><dt>주문 번호</dt><dd class="mono">' + esc(saved.orderId) + '</dd></div>' +
    '</dl>' +
    '<p class="payres__note">퍼블리싱 화면이라 결제 <b>인증</b>까지만 진행했어요. 실제 결제 완료는 서버에서 시크릿 키로 결제 승인 API를 호출해야 해요. 요금은 시연용 예시예요.</p>' +
    ACTIONS_OK;
  document.title = '티켓 결제 인증 완료 — 모두의 여행길';
})();
