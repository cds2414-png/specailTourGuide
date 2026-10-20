/* 느린지도 — 회원가입 · 로그인 · 여행 리뷰
   서버가 없는 정적 사이트이므로 모든 데이터는 이 브라우저의 localStorage에만 저장되는 데모 기능이다.
   비밀번호는 평문으로 저장하지 않고 PBKDF2(SHA-256) 해시와 솔트만 보관한다. */
(function () {
  'use strict';

  var T = window.TRIP;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────── 저장소 ───────── */
  var KEY = { users: 'slowmap.users', session: 'slowmap.session', reviews: 'slowmap.reviews', courses: 'slowmap.courses' };
  var storageOK = (function () {
    try { localStorage.setItem('slowmap.t', '1'); localStorage.removeItem('slowmap.t'); return true; } catch (e) { return false; }
  })();
  function load(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ───────── 리뷰로 만든 코스 ─────────
     app.js가 목록을 그리기 전에 T.COURSES에 합쳐 둔다. */
  function generatedCourses() { return load(KEY.courses, []); }
  function syncGenerated() {
    for (var i = T.COURSES.length - 1; i >= 0; i--) if (T.COURSES[i].generated) T.COURSES.splice(i, 1);
    generatedCourses().forEach(function (c) { T.COURSES.push(c); });
  }
  syncGenerated();

  // 다른 탭에서 로그인·리뷰·코스가 바뀌면 반영
  window.addEventListener('storage', function (e) {
    if (e.key && e.key.indexOf('slowmap.') === 0) {
      if (e.key === KEY.courses) { syncGenerated(); refreshCourses(); }
      syncAuthUI(); renderReviews(); paintRatings();
    }
  });

  /* ───────── 비밀번호 해시 ───────── */
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function newSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return hex(a);
  }
  function hashPassword(pw, salt) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
        .then(function (key) { return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256); })
        .then(function (bits) { return 'pbkdf2$' + hex(bits); });
    }
    // 보안 컨텍스트가 아닌 환경(file:// 일부 브라우저)용 대체 해시 — 데모 전용
    var h1 = 0x811c9dc5, h2 = 0x01000193, s = salt + ':' + pw;
    for (var r = 0; r < 2000; r++) for (var i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761); }
    return Promise.resolve('fnv$' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16));
  }

  /* ───────── 라벨 ───────── */
  var AGE_LABEL = {}; T.GROUPS.forEach(function (g) { AGE_LABEL[g.id] = g.label; });
  var NEED_SHORT = { wheel: '휠체어', walk: '보행 불편', family: '유모차·임산부' };
  var TAGS = [
    { id: 'stairs', label: '계단이 적어요', good: true },
    { id: 'rest', label: '쉴 곳이 많아요', good: true },
    { id: 'toilet', label: '화장실이 편해요', good: true },
    { id: 'lift', label: '엘리베이터가 있어요', good: true },
    { id: 'drop', label: '하차 지점이 가까워요', good: true },
    { id: 'flat', label: '길이 평탄해요', good: true },
    { id: 'crowd', label: '많이 붐볐어요', good: false },
    { id: 'slope', label: '오르막이 있었어요', good: false }
  ];
  var TAG_LABEL = {}; TAGS.forEach(function (t) { TAG_LABEL[t.id] = t; });
  function courseById(id) { for (var i = 0; i < T.COURSES.length; i++) if (T.COURSES[i].id === id) return T.COURSES[i]; return null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function starsText(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= Math.round(n) ? '★' : '☆'; return s; }
  function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2); }
  function fmtMonth(v) { if (!v) return ''; var p = v.split('-'); return p[0] + '년 ' + (+p[1]) + '월 방문'; }

  /* ───────── 전역 알림 ───────── */
  var gtoast = $('#gtoast'), gtTimer = 0;
  function notify(msg) {
    gtoast.textContent = msg; gtoast.hidden = false;
    gtoast.classList.remove('is-in'); void gtoast.offsetWidth; gtoast.classList.add('is-in');
    clearTimeout(gtTimer); gtTimer = setTimeout(function () { gtoast.hidden = true; }, 3200);
  }

  /* ───────── 사용자 · 세션 ───────── */
  function users() { return load(KEY.users, {}); }
  function currentUser() {
    var s = load(KEY.session, null);
    if (!s || !s.email) return null;
    var u = users()[s.email];
    return u ? Object.assign({ email: s.email }, u) : null;
  }
  function normEmail(v) { return String(v || '').trim().toLowerCase(); }

  /* ───────── 대화상자 공통 ───────── */
  var lastFocus = null;
  function openDlg(d) {
    lastFocus = document.activeElement;
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    document.body.classList.add('dlg-open');
    var first = $('input:not([type=hidden]):not([type=radio]), select, textarea', $('form:not([hidden])', d) || d);
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeDlg(d) {
    if (typeof d.close === 'function' && d.open) d.close(); else d.removeAttribute('open');
  }
  $$('dialog.dlg').forEach(function (d) {
    d.addEventListener('close', function () {
      document.body.classList.remove('dlg-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeDlg(d);
      // 배경(::backdrop) 클릭으로 닫기
      if (e.target === d) {
        var r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDlg(d);
      }
    });
  });

  function setErr(input, msg) {
    var fld = input.closest('.fld');
    var el = fld ? $('.fld__err', fld) : null;
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (el) el.textContent = msg || '';
  }
  function clearForm(f) {
    $$('[aria-invalid]', f).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    $$('.fld__err', f).forEach(function (e) { e.textContent = ''; });
    var m = $('.form-msg', f); if (m) m.textContent = '';
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '처리 중…'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }

  /* ───────── 로그인 · 회원가입 ───────── */
  var authDlg = $('#authDlg'), formLogin = $('#formLogin'), formSignup = $('#formSignup');
  var afterAuth = null; // 로그인 후 이어서 할 일

  $('#signupAge').innerHTML = '<option value="">선택 안 함</option>' + T.GROUPS.map(function (g) { return '<option value="' + g.id + '">' + g.label + '</option>'; }).join('');
  $('#signupNeed').innerHTML = '<option value="">해당 없음</option>' + T.NEEDS.map(function (n) { return '<option value="' + n.id + '">' + esc(n.title) + '</option>'; }).join('');

  function setAuthTab(tab) {
    var login = tab === 'login';
    $('#tabLogin').setAttribute('aria-selected', String(login)); $('#tabLogin').tabIndex = login ? 0 : -1;
    $('#tabSignup').setAttribute('aria-selected', String(!login)); $('#tabSignup').tabIndex = login ? -1 : 0;
    formLogin.hidden = !login; formSignup.hidden = login;
    $('#authTitle').textContent = login ? '로그인' : '회원가입';
    clearForm(formLogin); clearForm(formSignup);
    var first = $('input', login ? formLogin : formSignup);
    if (authDlg.open && first) first.focus();
  }
  function openAuth(tab, then) {
    if (!storageOK) { notify('이 브라우저에서는 저장소를 쓸 수 없어 계정 기능을 사용할 수 없어요.'); return; }
    afterAuth = then || null;
    setAuthTab(tab || 'login');
    openDlg(authDlg);
  }
  authDlg.addEventListener('click', function (e) {
    var t = e.target.closest('[data-auth-tab]');
    if (t) setAuthTab(t.getAttribute('data-auth-tab'));
  });
  $('.dlg__tabs', authDlg).addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var toSignup = !$('#formLogin').hidden;
    setAuthTab(toSignup ? 'signup' : 'login');
    (toSignup ? $('#tabSignup') : $('#tabLogin')).focus();
  });

  formSignup.addEventListener('submit', function (e) {
    e.preventDefault();
    clearForm(formSignup);
    var f = formSignup, ok = true, all = users();
    var nick = f.nick.value.trim(), email = normEmail(f.email.value), pw = f.password.value, pw2 = f.password2.value;
    if (nick.length < 2 || nick.length > 12) { setErr(f.nick, '닉네임은 2~12자로 정해주세요.'); ok = false; }
    else if (Object.keys(all).some(function (k) { return all[k].nick === nick; })) { setErr(f.nick, '이미 쓰고 있는 닉네임이에요.'); ok = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr(f.email, '이메일 형식을 확인해주세요.'); ok = false; }
    else if (all[email]) { setErr(f.email, '이미 가입된 이메일이에요. 로그인해주세요.'); ok = false; }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { setErr(f.password, '8자 이상, 영문과 숫자를 함께 넣어주세요.'); ok = false; }
    if (pw2 !== pw) { setErr(f.password2, '비밀번호가 서로 달라요.'); ok = false; }
    $('#agreeErr').textContent = f.agree.checked ? '' : '안내를 확인하고 체크해주세요.';
    if (!f.agree.checked) ok = false;
    if (!ok) { var bad = $('[aria-invalid="true"]', f) || f.agree; bad.focus(); return; }

    var btn = $('.dlg__submit', f), salt = newSalt();
    busy(btn, true, '가입 중…');
    hashPassword(pw, salt).then(function (hash) {
      all = users();
      all[email] = { nick: nick, salt: salt, hash: hash, age: f.age.value, need: f.need.value, createdAt: Date.now() };
      if (!save(KEY.users, all) || !save(KEY.session, { email: email, at: Date.now() })) throw new Error('save');
      busy(btn, false); f.reset();
      closeDlg(authDlg);
      syncAuthUI(); renderReviews();
      notify(nick + '님, 가입을 환영해요!');
      runAfterAuth();
    }).catch(function () {
      busy(btn, false);
      $('.form-msg', f).textContent = '저장 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.';
    });
  });

  formLogin.addEventListener('submit', function (e) {
    e.preventDefault();
    clearForm(formLogin);
    var f = formLogin, email = normEmail(f.email.value), pw = f.password.value;
    if (!email) { setErr(f.email, '이메일을 입력해주세요.'); f.email.focus(); return; }
    if (!pw) { setErr(f.password, '비밀번호를 입력해주세요.'); f.password.focus(); return; }
    var u = users()[email], btn = $('.dlg__submit', f);
    busy(btn, true, '확인 중…');
    // 계정 존재 여부를 드러내지 않도록 같은 메시지 사용
    var fail = function () { busy(btn, false); $('.form-msg', f).textContent = '이메일 또는 비밀번호가 맞지 않아요.'; f.password.select(); };
    if (!u) { hashPassword(pw, 'x').then(fail); return; }
    hashPassword(pw, u.salt).then(function (hash) {
      if (hash !== u.hash) return fail();
      save(KEY.session, { email: email, at: Date.now() });
      busy(btn, false); f.reset();
      closeDlg(authDlg);
      syncAuthUI(); renderReviews();
      notify(u.nick + '님, 다시 오신 걸 환영해요.');
      runAfterAuth();
    }).catch(fail);
  });

  function runAfterAuth() { var fn = afterAuth; afterAuth = null; if (fn) setTimeout(fn, 120); }
  function logout() {
    try { localStorage.removeItem(KEY.session); } catch (e) { /* 무시 */ }
    closeUmenu(); syncAuthUI(); renderReviews();
    notify('로그아웃했어요.');
  }

  /* ───────── 내비 계정 메뉴 ───────── */
  var navLogin = $('#navLogin'), umenu = $('#umenu'), umenuBtn = $('#umenuBtn'), umenuList = $('#umenuList'), mnavAuth = $('#mnavAuth');
  function closeUmenu() { umenuList.hidden = true; umenuBtn.setAttribute('aria-expanded', 'false'); }
  umenuBtn.addEventListener('click', function () {
    var open = umenuList.hidden;
    umenuList.hidden = !open; umenuBtn.setAttribute('aria-expanded', String(open));
    if (open) { var f = $('button', umenuList); if (f) f.focus(); }
  });
  document.addEventListener('click', function (e) { if (!umenu.contains(e.target)) closeUmenu(); });
  umenu.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeUmenu(); umenuBtn.focus(); } });

  function syncAuthUI() {
    var u = currentUser();
    navLogin.hidden = !!u; umenu.hidden = !u;
    if (u) {
      $('#umenuAva').textContent = u.nick.charAt(0);
      $('#umenuName').textContent = u.nick;
      $('#umenuMeta').textContent = [AGE_LABEL[u.age], NEED_SHORT[u.need]].filter(Boolean).join(' · ') || u.email;
      mnavAuth.innerHTML = '<p class="mono">' + esc(u.nick) + '님</p><button type="button" data-my-tickets>내 티켓</button><button type="button" data-write-review>리뷰 쓰기</button><button type="button" data-logout>로그아웃</button>';
    } else {
      mnavAuth.innerHTML = '<button type="button" data-auth="login">로그인</button><button type="button" data-auth="signup">회원가입</button>';
    }
    $('#rvHint').textContent = u ? u.nick + '님의 경험을 들려주세요.' : '로그인하면 리뷰를 남길 수 있어요.';
    $('.rv__mine').hidden = !u;
    if (!u) $('#rvMine').checked = false;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-auth]');
    if (a) { closeMobileMenu(); openAuth(a.getAttribute('data-auth')); return; }
    if (e.target.closest('[data-logout]')) { closeMobileMenu(); logout(); return; }
    if (e.target.closest('[data-write-review]')) { closeMobileMenu(); closeUmenu(); writeReview(); return; }
    if (e.target.closest('[data-my-reviews]')) {
      closeUmenu();
      $('#rvMine').checked = true; rvCourse.value = 'all'; shown = PAGE; renderReviews();
      scrollToReviews();
    }
  });
  function closeMobileMenu() {
    var b = $('#burger');
    if (b && b.getAttribute('aria-expanded') === 'true') b.click();
  }

  /* ───────── 리뷰 데이터 ───────── */
  // 실제 이용 후기가 아님을 화면에 '예시'로 표시하는 견본 리뷰
  var SAMPLES = [
    { id: 'sample-1', sample: true, course: 'a-walk-busan', nick: '느린지도 예시', age: 'o70', need: 'walk', rating: 5, tags: ['rest', 'drop'], visit: '', helpful: [],
      text: '예시 리뷰예요. 이런 식으로 "열차에 앉아서 바다를 봐서 무릎이 덜 아팠다", "정거장 승강 동선은 미리 물어보는 게 좋았다"처럼 직접 겪은 이동 정보를 남겨주세요.', createdAt: Date.UTC(2026, 9, 12) },
    { id: 'sample-2', sample: true, course: 'g40-gyeongju', nick: '느린지도 예시', age: 'g40', need: '', rating: 4, tags: ['flat', 'crowd'], visit: '', helpful: [],
      text: '예시 리뷰예요. 아이와 함께였다면 "주말 오전에 붐볐다", "잔디밭에서 쉬기 좋았다"처럼 가족 여행에 도움이 되는 내용을 적어주세요.', createdAt: Date.UTC(2026, 9, 5) },
    { id: 'sample-3', sample: true, course: 'a-wheel', nick: '느린지도 예시', age: 'g50', need: 'wheel', rating: 4, tags: ['lift', 'toilet'], visit: '', helpful: [],
      text: '예시 리뷰예요. 휠체어로 다녀왔다면 엘리베이터 위치, 장애인 화장실, 콜택시 하차 지점처럼 다음 사람이 꼭 알아야 할 정보를 남겨주세요.', createdAt: Date.UTC(2026, 8, 28) }
  ];
  function userReviews() { return load(KEY.reviews, []); }
  function allReviews() { return userReviews().concat(SAMPLES); }
  function statsFor(courseId) {
    var list = allReviews().filter(function (r) { return !courseId || courseId === 'all' || r.course === courseId; });
    var sum = 0, dist = [0, 0, 0, 0, 0], tags = {};
    list.forEach(function (r) {
      sum += r.rating; dist[r.rating - 1]++;
      (r.tags || []).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
    });
    return { n: list.length, avg: list.length ? sum / list.length : 0, dist: dist, tags: tags, list: list };
  }

  /* ───────── 리뷰 목록 ───────── */
  var rvCourse = $('#rvCourse'), rvSort = $('#rvSort'), rvMine = $('#rvMine'), rvList = $('#rvList'), rvMore = $('#rvMore');
  var PAGE = 6, shown = PAGE;
  function courseOptions(withAll) {
    var html = withAll ? '<option value="all">전체 코스</option>'
      : '<option value="__auto__">✨ 자동 분석 — 글에 적은 장소로 코스 찾기·만들기</option>';
    T.GROUPS.forEach(function (g) {
      html += '<optgroup label="' + esc(g.label) + '">' + T.COURSES.filter(function (c) { return !c.generated && c.group === g.id; })
        .map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') + '</optgroup>';
    });
    T.NEEDS.forEach(function (n) {
      html += '<optgroup label="무장애 · ' + esc(n.title) + '">' + T.COURSES.filter(function (c) { return !c.generated && c.group === 'access' && c.need === n.id; })
        .map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') + '</optgroup>';
    });
    var gen = T.COURSES.filter(function (c) { return c.generated; });
    if (gen.length) {
      html += '<optgroup label="리뷰로 만든 코스">' + gen.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') + '</optgroup>';
    }
    return html;
  }
  function fillCourseSelects() {
    var a = rvCourse.value, b = $('#reviewCourse').value;
    rvCourse.innerHTML = courseOptions(true);
    $('#reviewCourse').innerHTML = courseOptions(false);
    rvCourse.value = courseById(a) ? a : 'all';
    $('#reviewCourse').value = courseById(b) ? b : '__auto__';
  }
  fillCourseSelects();
  rvCourse.addEventListener('change', function () { shown = PAGE; renderReviews(); });
  rvSort.addEventListener('change', function () { shown = PAGE; renderReviews(); });
  rvMine.addEventListener('change', function () { shown = PAGE; renderReviews(); });
  rvMore.addEventListener('click', function () { shown += PAGE; renderReviews(); });

  function renderSummary(cid) {
    var st = statsFor(cid);
    var c = courseById(cid);
    $('#rvScope').textContent = c ? c.title : '전체 코스';
    $('#rvAvg').textContent = st.avg.toFixed(1);
    $('#rvStars').textContent = starsText(st.avg);
    $('#rvCount').textContent = '리뷰 ' + st.n + '개';
    var max = Math.max.apply(null, st.dist.concat([1]));
    $('#rvDist').innerHTML = [5, 4, 3, 2, 1].map(function (k) {
      var n = st.dist[k - 1];
      return '<li><span class="mono">' + k + '점</span><i><b style="width:' + (n / max * 100).toFixed(1) + '%"></b></i><span class="mono">' + n + '</span></li>';
    }).join('');
    var top = Object.keys(st.tags).sort(function (a, b) { return st.tags[b] - st.tags[a]; }).slice(0, 4);
    $('#rvTagSum').innerHTML = top.map(function (t) {
      return '<li class="' + (TAG_LABEL[t].good ? '' : 'is-bad') + '">' + esc(TAG_LABEL[t].label) + ' <b class="mono">' + st.tags[t] + '</b></li>';
    }).join('');
  }

  function renderReviews() {
    var u = currentUser(), cid = rvCourse.value;
    renderSummary(cid);
    var list = allReviews().filter(function (r) {
      if (cid !== 'all' && r.course !== cid) return false;
      if (rvMine.checked) return u && r.email === u.email;
      return true;
    });
    var sort = rvSort.value;
    list.sort(function (a, b) {
      if (sort === 'high') return b.rating - a.rating || b.createdAt - a.createdAt;
      if (sort === 'low') return a.rating - b.rating || b.createdAt - a.createdAt;
      if (sort === 'help') return (b.helpful || []).length - (a.helpful || []).length || b.createdAt - a.createdAt;
      return b.createdAt - a.createdAt;
    });
    if (!list.length) {
      rvList.innerHTML = '<li class="rv__empty"><p>' + (rvMine.checked ? '아직 쓴 리뷰가 없어요.' : '이 코스의 첫 리뷰를 남겨주세요.') + '</p>' +
        '<button type="button" class="btn" data-write-review>리뷰 쓰기</button></li>';
      rvMore.hidden = true;
      return;
    }
    rvList.innerHTML = list.slice(0, shown).map(function (r) { return reviewHTML(r, u); }).join('');
    rvMore.hidden = list.length <= shown;
  }

  function reviewHTML(r, u) {
    var c = courseById(r.course), mine = u && r.email === u.email;
    var helped = u && (r.helpful || []).indexOf(u.email) >= 0;
    var badges = '';
    if (AGE_LABEL[r.age]) badges += '<span class="pill">' + esc(AGE_LABEL[r.age]) + '</span>';
    if (NEED_SHORT[r.need]) badges += '<span class="pill pill--blue">' + esc(NEED_SHORT[r.need]) + '</span>';
    if (r.sample) badges += '<span class="pill pill--sample" title="실제 이용 후기가 아닌 작성 예시예요">예시</span>';
    if (mine) badges += '<span class="pill pill--mine">내 리뷰</span>';
    var meta = [fmtMonth(r.visit), fmtDate(r.createdAt) + (r.updatedAt ? ' 수정' : ' 작성')].filter(Boolean).join(' · ');
    return '<li class="rvi' + (r.sample ? ' rvi--sample' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="rvi__head">' +
        '<span class="ava" aria-hidden="true">' + esc(r.nick.charAt(0)) + '</span>' +
        '<div class="rvi__who"><p><b>' + esc(r.nick) + '</b>' + badges + '</p><small class="mono">' + esc(meta) + '</small></div>' +
        '<p class="rvi__stars" role="img" aria-label="5점 만점에 ' + r.rating + '점">' + starsText(r.rating) + '</p>' +
      '</div>' +
      (c ? '<button type="button" class="rvi__course" data-go="' + c.id + '" data-cursor="GO">' + esc(c.title) + ' <span aria-hidden="true">→</span><span class="sr"> 내비로 달려보기</span></button>' : '') +
      ((r.tags && r.tags.length) ? '<ul class="rvi__tags">' + r.tags.map(function (t) { return TAG_LABEL[t] ? '<li class="' + (TAG_LABEL[t].good ? '' : 'is-bad') + '">' + esc(TAG_LABEL[t].label) + '</li>' : ''; }).join('') + '</ul>' : '') +
      '<p class="rvi__text">' + esc(r.text).replace(/\n/g, '<br>') + '</p>' +
      '<div class="rvi__foot">' +
        (r.sample ? '<span class="rvi__note">작성 예시 · 실제 후기가 아니에요</span>' :
          '<button type="button" class="rvi__help" data-help aria-pressed="' + !!helped + '"' + (mine ? ' disabled title="내 리뷰에는 누를 수 없어요"' : '') + '>도움돼요 <b class="mono">' + (r.helpful || []).length + '</b></button>') +
        (mine ? '<span class="rvi__own"><button type="button" data-edit>수정</button><button type="button" data-del>삭제</button></span>' : '') +
      '</div></li>';
  }

  rvList.addEventListener('click', function (e) {
    var li = e.target.closest('.rvi'); if (!li) return;
    var id = li.getAttribute('data-id'), u = currentUser();
    if (e.target.closest('[data-help]')) {
      if (!u) { openAuth('login', function () { toggleHelp(id); }); return; }
      toggleHelp(id);
    } else if (e.target.closest('[data-edit]')) {
      writeReview(id);
    } else if (e.target.closest('[data-del]')) {
      if (!window.confirm('이 리뷰를 삭제할까요? 삭제하면 되돌릴 수 없어요.')) return;
      var list = userReviews().filter(function (r) { return !(r.id === id && u && r.email === u.email); });
      save(KEY.reviews, list);
      var removed = cleanupOrphans();
      if (removed) { syncGenerated(); refreshCourses(); } else { renderReviews(); paintRatings(); }
      notify(removed ? '리뷰를 삭제했어요. 이 리뷰로 만든 코스도 함께 정리했어요.' : '리뷰를 삭제했어요.');
    }
  });
  function toggleHelp(id) {
    var u = currentUser(); if (!u) return;
    var list = userReviews(), r = list.filter(function (x) { return x.id === id; })[0];
    if (!r || r.email === u.email) return;
    r.helpful = r.helpful || [];
    var i = r.helpful.indexOf(u.email);
    if (i >= 0) r.helpful.splice(i, 1); else r.helpful.push(u.email);
    save(KEY.reviews, list); renderReviews();
  }

  /* ───────── 리뷰 쓰기 · 수정 ───────── */
  var A = window.SlowAnalyzer;
  var reviewDlg = $('#reviewDlg'), formReview = $('#formReview'), editing = null;
  $('#reviewTags').innerHTML = TAGS.map(function (t) {
    return '<label class="chip' + (t.good ? '' : ' chip--bad') + '"><input type="checkbox" name="tags" value="' + t.id + '"><span>' + esc(t.label) + '</span></label>';
  }).join('');
  var now = new Date();
  $('#reviewVisit').max = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  $$('input[name="rating"]', formReview).forEach(function (r) {
    r.addEventListener('change', function () { $('#ratingVal').textContent = r.value + '점 · ' + ['', '별로였어요', '아쉬웠어요', '보통이에요', '좋았어요', '최고였어요'][+r.value]; });
  });
  function tagLabel(t) { return TAG_LABEL[t] ? TAG_LABEL[t].label : t; }

  /* 실시간 분석 패널 */
  var anaPlaces = $('#anaPlaces'), anaResult = $('#anaResult'), anaMeta = $('#anaMeta');
  var touched = {}, autoTagged = {}, anaTimer = 0;
  $('#reviewTags').addEventListener('change', function (e) {
    if (e.target.name !== 'tags') return;
    touched[e.target.value] = true; delete autoTagged[e.target.value];
    e.target.closest('.chip').classList.remove('is-auto');
  });
  function runAnalysis() {
    var an = A.analyze(formReview.text.value, currentUser() || {});
    // 사용자가 직접 건드리지 않은 태그만 자동으로 켜고 끈다
    $$('input[name="tags"]', formReview).forEach(function (cb) {
      if (touched[cb.value]) return;
      var on = an.tags.indexOf(cb.value) >= 0;
      if (on && !cb.checked) { cb.checked = true; autoTagged[cb.value] = true; }
      else if (!on && autoTagged[cb.value]) { cb.checked = false; delete autoTagged[cb.value]; }
      cb.closest('.chip').classList.toggle('is-auto', !!autoTagged[cb.value]);
    });
    var auto = formReview.course.value === '__auto__';
    anaPlaces.innerHTML = an.places.length
      ? an.places.map(function (p, i) { return '<li><i class="mono">' + (i + 1) + '</i>' + esc(p.name) + ' <small>' + esc(p.region) + '</small></li>'; }).join('')
      : '<li class="is-empty">아직 글에서 찾은 장소가 없어요</li>';
    var msg, st = auto ? an.status : 'fixed';
    var chosen = courseById(formReview.course.value);
    var differs = !auto && chosen && an.places.length >= 2 && !an.places.some(function (p) {
      return chosen.stops.some(function (s) { return A.km(p, s) < 0.8; });
    });
    if (differs) { msg = '글에 적은 장소가 선택한 코스와 달라요. 코스를 「✨ 자동 분석」으로 바꾸면 맞는 코스를 찾거나 새로 만들어요.'; st = 'warn'; }
    else if (!auto) msg = '선택한 코스의 리뷰로 등록돼요.';
    else if (an.status === 'few') msg = '장소 이름을 2곳 이상 적으면 기존 코스를 찾거나 새 코스를 만들어요.' + (an.places.length === 1 ? ' (지금 1곳)' : '');
    else if (an.status === 'match') msg = '기존 코스 「' + an.match.course.title + '」와 같은 여행이에요. 그 코스의 리뷰로 등록돼요.';
    else msg = '기존에 없는 코스예요. 등록하면 새 코스 「' + A.buildCourse(an, { tags: [] }, { nick: '', age: '' }, tagLabel).title + '」가 자동으로 추가돼요.';
    anaResult.textContent = msg;
    anaResult.className = 'ana__result is-' + st;
    var meta = [];
    if (an.places.length || an.tags.length) {
      if (an.need) meta.push('이동 조건 ' + NEED_SHORT[an.need]);
      meta.push('걷기 ' + an.walk + '/5', an.days);
      var na = Object.keys(autoTagged).length;
      if (na) meta.push('편의 태그 ' + na + '개 자동 선택');
    }
    anaMeta.textContent = meta.join(' · ');
    return an;
  }
  formReview.text.addEventListener('input', function () {
    $('#reviewCount').textContent = formReview.text.value.length + ' / 1000';
    clearTimeout(anaTimer); anaTimer = setTimeout(runAnalysis, 200);
  });
  formReview.course.addEventListener('change', runAnalysis);

  function writeReview(id, courseId) {
    var u = currentUser();
    if (!u) { openAuth('login', function () { writeReview(id, courseId); }); notify('리뷰를 쓰려면 먼저 로그인해주세요.'); return; }
    clearForm(formReview); formReview.reset();
    touched = {}; autoTagged = {};
    $('#ratingErr').textContent = '';
    $('#ratingVal').textContent = '점수를 골라주세요';
    editing = null;
    var r = id ? userReviews().filter(function (x) { return x.id === id && x.email === u.email; })[0] : null;
    if (r) {
      editing = r.id;
      formReview.course.value = courseById(r.course) ? r.course : '__auto__';
      var radio = $('#rt' + r.rating); if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
      $$('input[name="tags"]', formReview).forEach(function (cb) { cb.checked = (r.tags || []).indexOf(cb.value) >= 0; touched[cb.value] = true; });
      formReview.visit.value = r.visit || '';
      formReview.text.value = r.text;
    } else {
      // 새 리뷰는 기본으로 자동 분석. 특정 코스에서 '리뷰 쓰기'를 누른 경우만 그 코스를 미리 선택
      formReview.course.value = courseById(courseId) ? courseId : '__auto__';
    }
    $('#reviewCount').textContent = formReview.text.value.length + ' / 1000';
    $('#reviewTitle').textContent = r ? '리뷰 수정' : '여행 리뷰 쓰기';
    $('#reviewSubmit').textContent = r ? '수정 완료' : '리뷰 등록';
    runAnalysis();
    openDlg(reviewDlg);
  }

  formReview.addEventListener('submit', function (e) {
    e.preventDefault();
    clearForm(formReview);
    var u = currentUser();
    if (!u) { closeDlg(reviewDlg); openAuth('login'); return; }
    var f = formReview, ok = true;
    var rating = +((($('input[name="rating"]:checked', f)) || {}).value || 0);
    var text = f.text.value.trim();
    var cid = f.course.value, an = runAnalysis();
    if (cid === '__auto__' && an.status === 'few') {
      setErr(f.course, '글에서 장소를 2곳 이상 찾지 못했어요. 장소 이름을 적거나 목록에서 코스를 골라주세요.'); ok = false;
    } else if (cid !== '__auto__' && !courseById(cid)) { setErr(f.course, '다녀온 코스를 골라주세요.'); ok = false; }
    $('#ratingErr').textContent = rating ? '' : '별점을 골라주세요.';
    if (!rating) ok = false;
    if (text.length < 10) { setErr(f.text, '10자 이상 적어주세요.'); ok = false; }
    if (f.visit.value && f.visit.value > f.visit.max) { setErr(f.visit, '미래 날짜는 고를 수 없어요.'); ok = false; }
    if (!ok) { var bad = $('[aria-invalid="true"]', f) || $('input[name="rating"]', f); bad.focus(); return; }

    var tags = $$('input[name="tags"]:checked', f).map(function (c) { return c.value; });
    var reviewId = editing || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var created = null, matched = null;
    if (cid === '__auto__') {
      if (an.status === 'match') { matched = an.match.course; cid = matched.id; }
      else {
        created = A.buildCourse(an, { id: reviewId, tags: tags }, u, tagLabel);
        cid = created.id;
        var gl = generatedCourses(); gl.push(created);
        if (!save(KEY.courses, gl)) { $('.form-msg', f).textContent = '저장 공간이 부족해 코스를 만들지 못했어요.'; return; }
      }
    }

    var list = userReviews();
    if (editing) {
      list.forEach(function (r) {
        if (r.id === editing && r.email === u.email) {
          r.course = cid; r.rating = rating; r.tags = tags; r.visit = f.visit.value; r.text = text; r.updatedAt = Date.now();
        }
      });
    } else {
      list.push({
        id: reviewId, course: cid, email: u.email, nick: u.nick, age: u.age || '', need: u.need || '',
        rating: rating, tags: tags, visit: f.visit.value, text: text, helpful: [], createdAt: Date.now()
      });
    }
    if (!save(KEY.reviews, list)) { $('.form-msg', f).textContent = '저장 공간이 부족해 등록하지 못했어요.'; return; }
    var wasEdit = !!editing;
    closeDlg(reviewDlg);
    cleanupOrphans();
    syncGenerated();
    rvCourse.value = cid; rvSort.value = 'new'; rvMine.checked = false; shown = PAGE;
    refreshCourses();
    rvCourse.value = cid; renderReviews();
    if (created) {
      notify('기존에 없던 코스예요. 새 코스 「' + created.title + '」를 추가했어요.');
      flashBorn(created.id);
    } else if (matched) {
      notify('기존 코스 「' + matched.title + '」와 같은 여행이라 그 코스의 리뷰로 등록했어요.');
      scrollToReviews();
    } else {
      notify(wasEdit ? '리뷰를 수정했어요.' : '리뷰를 등록했어요. 고마워요!');
      scrollToReviews();
    }
  });

  // 리뷰가 하나도 남지 않은 생성 코스는 정리
  function cleanupOrphans() {
    var used = {};
    userReviews().forEach(function (r) { used[r.course] = true; });
    var gl = generatedCourses(), kept = gl.filter(function (c) { return used[c.id]; });
    if (kept.length !== gl.length) { save(KEY.courses, kept); return gl.length - kept.length; }
    return 0;
  }

  function scrollToReviews() {
    var el = $('#reviews .rv');
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: reduce ? 'auto' : 'smooth' });
  }

  /* ───────── 리뷰에서 태어난 코스 ───────── */
  var app = null, bornEl = $('#born'), bornCards = $('#bornCards');
  var GROUP_LABEL = { access: '무장애', general: '모든 연령' };
  T.GROUPS.forEach(function (g) { GROUP_LABEL[g.id] = g.label; });
  function renderBorn() {
    var gen = T.COURSES.filter(function (c) { return c.generated; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    bornEl.hidden = !gen.length;
    $('#bornCount').textContent = gen.length ? gen.length + '개' : '';
    if (!app || !gen.length) { bornCards.innerHTML = ''; return; }
    bornCards.innerHTML = gen.map(function (c) {
      var meta = '<p class="born__meta mono">' + esc(c.createdBy) + '님의 후기로 생성 · ' + fmtDate(c.createdAt) + ' · ' +
        esc(c.need ? '무장애 · ' + NEED_SHORT[c.need] : GROUP_LABEL[c.group] || '') + '</p>';
      return app.cardHTML(c).replace('<div class="card__body">', '<div class="card__body">' + meta);
    }).join('');
    app.drawCardMaps();
  }
  function flashBorn(id) {
    var card = $('#bornCards [data-go="' + id + '"]');
    card = card && card.closest('.card');
    if (!card) { scrollToReviews(); return; }
    window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 120, behavior: reduce ? 'auto' : 'smooth' });
    card.classList.add('is-new');
    setTimeout(function () { card.classList.remove('is-new'); }, 2600);
  }
  function refreshCourses() {
    fillCourseSelects();
    renderBorn();
    if (app) app.refresh();
    renderReviews(); paintRatings();
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-born]')) return;
    var el = bornEl.hidden ? $('#reviews') : bornEl;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ───────── 코스 카드 평점 ───────── */
  function paintRatings() {
    $$('[data-rating]').forEach(function (el) {
      var st = statsFor(el.getAttribute('data-rating'));
      el.hidden = !st.n;
      el.innerHTML = st.n ? '<span aria-hidden="true">★</span> ' + st.avg.toFixed(1) + ' <small>리뷰 ' + st.n + '</small>' : '';
      el.setAttribute('aria-label', st.n ? '평점 ' + st.avg.toFixed(1) + '점, 리뷰 ' + st.n + '개 보기' : '');
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rating]'); if (!b) return;
    rvCourse.value = b.getAttribute('data-rating'); rvMine.checked = false; shown = PAGE;
    renderReviews(); scrollToReviews();
  });

  /* ───────── 시작 ───────── */
  syncAuthUI();
  renderReviews();
  window.SlowCommunity = {
    paintRatings: paintRatings, writeReview: writeReview,
    // explore.js(티켓 결제)에서 쓰는 계정·대화상자 도구
    currentUser: currentUser, openAuth: openAuth, notify: notify, openDlg: openDlg, closeDlg: closeDlg, esc: esc,
    // 토스페이먼츠 customerKey: 사용자별 무작위 값 (이메일 등 유추 가능한 값은 쓰지 않음)
    ensureCustomerKey: function () {
      var u = currentUser(); if (!u) return null;
      var all = users();
      if (!all[u.email].customerKey) {
        var a = new Uint8Array(16); crypto.getRandomValues(a);
        all[u.email].customerKey = 'cus_' + hex(a);
        save(KEY.users, all);
      }
      return all[u.email].customerKey;
    },
    // app.js 초기화가 끝나면 호출: 카드 렌더러를 받아 생성 코스를 그린다
    onAppReady: function (api) { app = api; renderBorn(); }
  };
})();
