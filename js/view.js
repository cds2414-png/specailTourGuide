/* 모두의 여행길 — 화면 전환
   메뉴를 누른 화면([data-view])만 보이고 나머지는 숨긴다. 주소의 #해시와 뒤로 가기를 따른다.
   다른 화면의 요소로 이동하는 동작(내비 달려보기, 평점 배지 등)은 클릭 캡처 단계에서 먼저 화면을 바꿔
   이후 스크롤 계산이 보이는 상태에서 이뤄지게 한다. */
(function () {
  'use strict';

  var VIEWS = ['top', 'ages', 'access', 'sim', 'reviews', 'chat'];
  var current = null;

  function viewFor(hash) {
    var id = String(hash || '').replace(/^#/, '');
    return VIEWS.indexOf(id) >= 0 ? id : null;
  }

  function show(v, opt) {
    opt = opt || {};
    if (VIEWS.indexOf(v) < 0) v = 'top';
    var changed = v !== current;
    if (changed) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (el) {
        el.hidden = el.getAttribute('data-view') !== v;
      });
      current = v;
      document.body.setAttribute('data-current-view', v);
      Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
        var on = a.getAttribute('data-nav') === v;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      // 숨겨져 있던 화면의 크기·캔버스를 다시 계산하도록 알림 (동기 실행)
      window.dispatchEvent(new Event('slowmap:layout'));
      window.dispatchEvent(new CustomEvent('slowmap:view', { detail: v }));
    }
    // 주소 갱신
    var hash = '#' + v;
    if (!opt.fromHistory && location.hash !== hash) {
      if (opt.push) history.pushState({ view: v }, '', hash);
      else history.replaceState({ view: v }, '', hash);
    }
    if (!opt.noScroll && (changed || opt.toTop)) window.scrollTo(0, 0);
    // 키보드·스크린리더 사용자를 새 화면 제목으로 이동
    if (changed && opt.focus) {
      var first = document.querySelector('[data-view="' + v + '"]:not([hidden])');
      var h = first && first.querySelector('h1, h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  // 메뉴·#링크
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var v = viewFor(a.getAttribute('href'));
    if (!v) return; // #main 같은 일반 앵커는 그대로
    e.preventDefault();
    show(v, { push: true, focus: true, toTop: true });
  });

  // 다른 화면으로 이어지는 동작: 해당 화면을 먼저 보이게 한다
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    if (t.closest('[data-go]')) show('sim', { noScroll: true, push: true });
    else if (t.closest('[data-rating], [data-born], [data-my-reviews]')) show('reviews', { noScroll: true, push: true });
    else if (t.closest('[data-hero-group]')) show('ages', { noScroll: true, push: true });
  }, true);

  window.addEventListener('popstate', function () { show(viewFor(location.hash) || 'top', { fromHistory: true }); });

  // 첫 화면: 주소의 #해시 또는 홈
  show(viewFor(location.hash) || 'top', { noScroll: true });

  window.SlowView = { show: show, current: function () { return current; } };
})();
