// ══════════════════════════════════════════════
// /api/debug-hf.js
// GET: Higgsfield API 인증 및 계정 상태 확인
// 배포 후 /api/debug-hf 접속
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;

  // 환경변수 존재 여부 (실제 값은 노출 안 함)
  const keyInfo = {
    HF_KEY_exists:    !!HF_KEY,
    HF_SECRET_exists: !!HF_SECRET,
    HF_KEY_length:    HF_KEY    ? HF_KEY.length    : 0,
    HF_SECRET_length: HF_SECRET ? HF_SECRET.length : 0,
    HF_KEY_prefix:    HF_KEY    ? HF_KEY.slice(0,8)+'...' : 'MISSING',
    HF_SECRET_prefix: HF_SECRET ? HF_SECRET.slice(0,8)+'...' : 'MISSING',
  };

  if (!HF_KEY || !HF_SECRET) {
    return res.status(200).json({ keyInfo, error: 'API 키 없음' });
  }

  const BASE = 'https://platform.higgsfield.ai';
  const results = {};

  // 인증 방식 4가지 테스트
  const authVariants = [
    { name: 'Key ID:SECRET',        auth: 'Key ' + HF_KEY + ':' + HF_SECRET },
    { name: 'Bearer ID:SECRET',     auth: 'Bearer ' + HF_KEY + ':' + HF_SECRET },
    { name: 'Key ID_only',          auth: 'Key ' + HF_KEY },
    { name: 'Bearer ID_only',       auth: 'Bearer ' + HF_KEY },
  ];

  // 가장 간단한 엔드포인트로 인증 테스트
  const testEndpoints = [
    '/account',
    '/me',
    '/user',
    '/v1/me',
    '/credits',
    '/balance',
    '/requests',
    '/models',
  ];

  results.authTests = {};
  for (const av of authVariants) {
    for (const ep of testEndpoints) {
      try {
        const r = await fetch(BASE + ep, {
          headers: { 'Authorization': av.auth, 'User-Agent': 'higgsfield-server-js/2.0' }
        });
        const txt = await r.text();
        const key = av.name + ' → ' + ep;
        results.authTests[key] = { status: r.status, body: txt.slice(0, 150) };
        // 200 이거나 model_not_found 가 아닌 응답이면 강조
        if (r.status === 200) {
          results.FOUND = { auth: av.name, endpoint: ep, status: r.status, body: txt.slice(0, 300) };
        }
      } catch(e) {
        results.authTests[av.name + ' → ' + ep] = { error: e.message };
      }
    }
  }

  return res.status(200).json({ keyInfo, results });
}
