// 모두의 여행길 Q&A 챗봇 — Vercel 서버리스 함수 (POST /api/chat)
// 질문을 Upstage Solar 임베딩(질문용 embedding-query)으로 바꿔 미리 계산한 사이트 청크(_chat-index.json, 문서용
// embedding-passage)와 코사인 유사도를 비교하고, 상위 5개 청크만 근거로 OpenAI 모델이 답한다. 응답에 출처 청크와 유사도를 함께 돌려준다.
// 질문 임베딩은 색인을 만든 제공자를 따른다(provider가 없는 예전 색인은 OpenAI text-embedding-3-small).
// 환경 변수: UPSTAGE_API_KEY(Upstage 색인일 때 필수), OPENAI_API_KEY(필수, 답변. 예전 이름 OPEN_AI_API도 읽음), OPENAI_MODEL(선택)
let INDEX = null;
try { INDEX = require('./_chat-index.json'); } catch (e) { /* 색인을 아직 만들지 않음: .venv/Scripts/python tools/build_chat_index.py */ }

const TOP_K = 5;
const MAX_Q = 300;
const CHAT_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const USE_UPSTAGE = !!(INDEX && INDEX.provider === 'upstage');
const QUERY_MODEL = USE_UPSTAGE ? (INDEX.queryModel || 'embedding-query') : ((INDEX && INDEX.model) || 'text-embedding-3-small');

const SYSTEM = [
  '너는 한국어 여행 가이드 웹사이트 「모두의 여행길 Route for All」의 안내 도우미야.',
  '반드시 아래 [자료]에 있는 내용만 근거로 답해. 자료에 없는 장소·요금·운영 정보는 지어내지 말고, 사이트에 없는 정보라고 말한 뒤 관광안내 전화 1330이나 해당 시설에 확인하라고 안내해.',
  '해요체로 3~6문장 안에서 짧게 답하고, 필요하면 코스 이름과 메뉴(연령별 코스, 무장애 여행, 내비 시뮬레이터, 여행 리뷰)를 알려줘.',
  '요금은 예시 요금, 결제는 테스트 시연, 지도·경로·소요 시간은 시뮬레이션용 근사치라는 점을 관련 있을 때만 덧붙여.',
  '마크다운 표나 제목은 쓰지 말고 평문으로 답해.'
].join('\n');

// 같은 인스턴스 안에서만 지키는 간단한 요청 제한 (IP당 1분 20회)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 20;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body !== undefined) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 4096) { reject(new Error('too_large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// OpenAI 호환 API 호출 (Upstage 임베딩과 OpenAI 답변이 같은 형식을 쓴다)
async function api(base, key, endpoint, payload) {
  const res = await fetch(base + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(base + endpoint + ' ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}
const UPSTAGE = 'https://api.upstage.ai/v1/';
const OPENAI = 'https://api.openai.com/v1/';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const key = (process.env.OPENAI_API_KEY || process.env.OPEN_AI_API || '').trim();
  const upKey = (process.env.UPSTAGE_API_KEY || '').trim();
  if (!key || (USE_UPSTAGE && !upKey)) return send(res, 503, { error: 'no_key' });
  if (!INDEX) return send(res, 503, { error: 'no_index' });
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'rate_limited' });

  let question;
  try { question = String((await readBody(req)).question || '').trim(); } catch (e) { return send(res, 400, { error: 'bad_request' }); }
  if (!question) return send(res, 400, { error: 'empty_question' });
  question = question.slice(0, MAX_Q);

  try {
    // 1) 질문 임베딩 → 정규화
    const emb = USE_UPSTAGE
      ? await api(UPSTAGE, upKey, 'embeddings', { model: QUERY_MODEL, input: question })
      : await api(OPENAI, key, 'embeddings', { model: QUERY_MODEL, input: question, dimensions: INDEX.dims });
    const q = emb.data[0].embedding;
    if (q.length !== INDEX.dims) return send(res, 503, { error: 'index_mismatch' }); // 색인을 다른 모델로 만들었음 → 다시 생성
    const qn = Math.hypot(...q) || 1;
    // 2) 코사인 유사도 상위 5개 (색인 벡터는 이미 정규화됨)
    const top = INDEX.docs
      .map(d => { let s = 0; for (let i = 0; i < q.length; i++) s += q[i] * d.v[i]; return { d, score: s / qn }; })
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
    // 3) 상위 청크만 근거로 답변
    const context = top.map((t, i) => '[자료 ' + (i + 1) + '] ' + t.d.title + '\n' + t.d.text).join('\n\n');
    const payload = {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: '[자료]\n' + context + '\n\n[질문]\n' + question }
      ],
      max_completion_tokens: 1500
    };
    // 추론형 모델(gpt-5·o 계열)은 추론 토큰도 한도에서 쓰므로, 추론을 짧게 하고 한도를 늘려 본문이 비지 않게 한다
    if (/^(gpt-5|o\d)/.test(CHAT_MODEL)) { payload.reasoning_effort = 'low'; payload.max_completion_tokens = 4000; }
    const chat = await api(OPENAI, key, 'chat/completions', payload);
    const answer = ((chat.choices && chat.choices[0] && chat.choices[0].message.content) || '').trim();
    return send(res, 200, {
      mode: 'ai',
      answer: answer || '답변을 만들지 못했어요. 질문을 조금 바꿔 다시 물어봐 주세요.',
      sources: top.map(t => ({ id: t.d.id, title: t.d.title, url: t.d.url, go: t.d.go || null, score: Math.round(t.score * 1000) / 1000 }))
    });
  } catch (e) {
    console.error('[chat]', e.message);
    return send(res, 502, { error: 'upstream' });
  }
};
