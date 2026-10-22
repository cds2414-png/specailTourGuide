/* 모두의 여행길 — Q&A 챗봇
   질문을 서버리스 함수(api/chat)로 보내면, 미리 임베딩해 둔 사이트 청크와 코사인 유사도를 비교해
   상위 5개를 근거로 AI가 답한다. 답 아래에 근거 페이지 링크와 유사도(%)를 보여준다.
   API를 쓸 수 없으면(키 없음·한도 초과·오프라인) 브라우저에서 글자 2-gram 벡터로
   같은 청크(assets/chat-docs.json)를 코사인 유사도 검색해 가장 비슷한 안내 문구를 보여준다. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var log = $('#chatLog'), form = $('#chatForm'), input = $('#chatInput'), sendBtn = $('#chatSend');
  if (!log || !form) return;

  var TOP_K = 5, busy = false;

  /* ── 브라우저 대체 검색: 글자 2-gram TF 벡터 + 코사인 유사도 ── */
  var docsP = null;
  // 질문에 자주 쓰는 말을 사이트 표현으로 바꾸고, 뜻 없는 어미·낱말은 뺀다 (임베딩 없이 찾을 때만 쓴다)
  var SYN = [[/([2-3]0)대/g, '40세 이하'], [/([7-9]0)대|노인|어르신/g, '70세 이상'], [/부모님/g, '60대 70세 이상'],
    [/아이|자녀|아기/g, '아이 가족 유모차'], [/임신|임산부/g, '임산부 유모차'], [/장애인/g, '장애인 휠체어 무장애'],
    [/연락|전화|문의/g, '문의처 전화'], [/내비|네비/g, '내비 시뮬레이터'], [/가격|비용|얼마/g, '요금 티켓']];
  var STOP = /^(있나요|있어요|알려주세요|알려줘|어떻게|어디|어디로|무엇|뭐|좋은|가기|가고|싶어요|하나요|되나요|수|코스가|코스를|추천|해주세요|주세요|좀|나요)$/;
  function expand(q) {
    SYN.forEach(function (r) { q = q.replace(r[0], function (m) { return m + ' ' + r[1]; }); });
    return q;
  }
  function grams(text) {
    var v = {};
    String(text).toLowerCase().split(/[^0-9a-z가-힣]+/).forEach(function (w) {
      if (!w || STOP.test(w)) return;
      if (w.length === 1) { v[w] = (v[w] || 0) + 1; return; }
      for (var i = 0; i < w.length - 1; i++) { var g = w.substr(i, 2); v[g] = (v[g] || 0) + 1; }
    });
    var n = 0, k;
    for (k in v) n += v[k] * v[k];
    n = Math.sqrt(n) || 1;
    for (k in v) v[k] /= n;
    return v;
  }
  function loadDocs() {
    if (!docsP) docsP = fetch('assets/chat-docs.json').then(function (r) {
      if (!r.ok) throw new Error('docs ' + r.status);
      return r.json();
    }).then(function (docs) {
      docs.forEach(function (d) { d.g = grams(d.title + ' ' + d.text); });
      return docs;
    });
    return docsP;
  }
  function localSearch(q) {
    return loadDocs().then(function (docs) {
      var qv = grams(expand(q));
      var top = docs.map(function (d) {
        var s = 0;
        for (var k in qv) if (d.g[k]) s += qv[k] * d.g[k];
        return { d: d, score: s };
      }).sort(function (a, b) { return b.score - a.score; }).slice(0, TOP_K);
      var best = top[0];
      var body = best && best.score > 0.08
        ? best.d.text.split('\n').slice(1).filter(function (l) { return l.indexOf('… ') !== 0; }).join('\n').replace(/^A\. /, '')
        : '사이트에서 비슷한 내용을 찾지 못했어요. 코스 이름이나 지역, 「휠체어」 「70대」 같은 낱말을 넣어 다시 물어봐 주세요.';
      return {
        mode: 'local',
        answer: body,
        sources: top.filter(function (t) { return t.score > 0; }).map(function (t) {
          return { id: t.d.id, title: t.d.title, url: t.d.url, go: t.d.go || null, score: t.score };
        })
      };
    });
  }

  /* ── 서버 질의 (실패하면 대체 검색) ── */
  function ask(q) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 30000);
    return fetch('api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('api ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.answer) throw new Error('api empty');
      return j;
    }).catch(function (e) {
      if (window.console) console.warn('[chat] AI 답변 대신 사이트 검색 결과를 보여줘요:', e.message);
      return localSearch(q);
    }).then(function (j) { if (timer) clearTimeout(timer); return j; });
  }

  /* ── 화면 ── */
  function paras(text) {
    return String(text).split(/\n+/).filter(Boolean).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  }
  function pct(s) { return (Math.max(0, s) * 100).toFixed(1) + '%'; }

  function sourcesHTML(list) {
    if (!list || !list.length) return '';
    return '<div class="msg__src"><p class="mono">SOURCES · 근거 페이지 (코사인 유사도 상위 ' + list.length + '개)</p><ol>' +
      list.map(function (s) {
        var w = Math.round(Math.max(0, Math.min(1, s.score)) * 100);
        return '<li>' +
          '<a href="' + esc(s.url) + '">' + esc(s.title) + '</a>' +
          '<span class="msg__score mono" title="질문과 이 페이지 문구의 코사인 유사도"><i style="--w:' + w + '%"></i>' + pct(s.score) + '</span>' +
          (s.go ? '<button type="button" class="msg__go" data-go="' + esc(s.go) + '">내비로 달려보기 <span aria-hidden="true">→</span></button>' : '') +
          '</li>';
      }).join('') + '</ol></div>';
  }

  function addMsg(who, html) {
    var li = document.createElement('li');
    li.className = 'msg msg--' + who;
    li.innerHTML = html;
    log.appendChild(li);
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return li;
  }

  function submit(q) {
    q = String(q || '').trim().slice(0, 300);
    if (!q || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    fit();
    addMsg('me', '<p class="msg__who mono">나</p><div class="msg__body">' + paras(q) + '</div>');
    var wait = addMsg('bot', '<p class="msg__who mono">ROUTE FOR ALL · 안내</p><div class="msg__body"><p class="msg__wait">사이트에서 관련 내용을 찾는 중이에요<span aria-hidden="true">…</span></p></div>');
    wait.setAttribute('aria-busy', 'true');
    ask(q).then(function (j) {
      var local = j.mode === 'local';
      wait.removeAttribute('aria-busy');
      wait.innerHTML = '<p class="msg__who mono">ROUTE FOR ALL · ' + (local ? '사이트 검색' : 'AI 답변') + '</p>' +
        '<div class="msg__body">' +
        (local ? '<p class="msg__mode">AI 답변을 지금 쓸 수 없어 가장 비슷한 안내 문구를 보여드려요.</p>' : '') +
        paras(j.answer) + '</div>' + sourcesHTML(j.sources);
    }).catch(function () {
      wait.removeAttribute('aria-busy');
      wait.querySelector('.msg__body').innerHTML = '<p>지금은 답을 불러오지 못했어요. 잠시 뒤 다시 물어봐 주세요.</p>';
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      wait.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  // 입력창 높이를 내용에 맞춤 (최대 6줄)
  function fit() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); submit(input.value); });
  input.addEventListener('input', fit);
  input.addEventListener('keydown', function (e) {
    // Enter는 보내기, Shift+Enter는 줄바꿈 (한글 조합 중 Enter는 무시)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
  });
  $$('[data-ask]').forEach(function (b) {
    b.addEventListener('click', function () { submit(b.textContent); });
  });

  window.SlowChat = { ask: ask, search: localSearch, submit: submit };
})();
