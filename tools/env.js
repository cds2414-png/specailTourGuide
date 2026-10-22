// .env 읽기 (도구·로컬 개발 서버 전용). "이름 = 값"처럼 = 앞뒤 공백이 있어도 읽는다.
// 이미 설정된 process.env 값이 우선한다.
const fs = require('fs');
const path = require('path');

module.exports = function (root) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(path.join(root, '.env'), 'utf8'); } catch (e) { /* .env 없음 */ }
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) return;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
  return Object.assign(out, Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(OPEN|UPSTAGE)/.test(k))));
};
