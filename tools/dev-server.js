// 로컬 개발 서버: node tools/dev-server.js [포트]  → http://localhost:5600/
// 정적 파일과 Vercel 함수(api/*.js)를 함께 띄워 챗봇까지 시험한다. 배포에는 쓰지 않는다(tools/는 .vercelignore).
// .env의 OPENAI_*·UPSTAGE_* 값을 process.env로 넘긴다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const env = require('./env.js')(root);
Object.keys(env).forEach(k => { if (/^(OPEN|UPSTAGE)/.test(k) && !process.env[k]) process.env[k] = env[k]; });

const PORT = Number(process.argv[2]) || 5600;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const m = url.match(/^\/api\/([a-z0-9-]+)$/);
  if (m) {
    const file = path.join(root, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    delete require.cache[require.resolve(file)]; // 고친 함수를 바로 반영
    return Promise.resolve(require(file)(req, res)).catch(e => { console.error(e); res.statusCode = 500; res.end('error'); });
  }
  // 점으로 시작하는 경로(.env, .git)와 api/의 _파일은 내보내지 않는다
  if (/(^|\/)\./.test(url) || /^\/api\//.test(url)) { res.statusCode = 404; return res.end('not found'); }
  let file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  });
}).listen(PORT, () => console.log('모두의 여행길 dev server → http://localhost:' + PORT + '/'));
