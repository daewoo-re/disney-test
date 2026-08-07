// ══════════════════════════════════════════════
// /api/debug-hf.js  v2 — 전체 모델 목록 + POST 엔드포인트 탐색
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'API 키 없음' });

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';
  const results = {};

  // 1. 전체 모델 목록 조회
  try {
    const r = await fetch(BASE + '/models', {
      headers: { 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' }
    });
    const data = await r.json();
    results.models = data;
    results.modelSlugs = (data.items || []).map(function(m) {
      return { slug: m.slug, title: m.title, type: m.operation_type };
    });
  } catch(e) { results.models_error = e.message; }

  // 2. 첫 번째 video 모델로 POST 엔드포인트 탐색
  const videoSlug = (results.modelSlugs || []).find(function(m) {
    return m.type === 'text2video' || m.type === 'video';
  });
  const testSlug = videoSlug ? videoSlug.slug : 'higgsfield-ai/dop/lite';
  const testPrompt = 'Disney Pixar animated style. A couple walking in a park, romantic atmosphere.';

  const postEndpoints = [
    '/generate/' + testSlug,
    '/inference/' + testSlug,
    '/run/' + testSlug,
    '/v1/generate/' + testSlug,
    '/v1/' + testSlug,
    '/' + testSlug,
    '/subscribe/' + testSlug,
    '/jobs',
    '/v1/jobs',
    '/v2/requests',
    '/requests',
  ];

  results.postTests = {};
  for (const ep of postEndpoints) {
    try {
      const r = await fetch(BASE + ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': auth,
          'User-Agent': 'higgsfield-server-js/2.0'
        },
        body: JSON.stringify({ prompt: testPrompt })
      });
      const txt = await r.text();
      results.postTests[ep] = { status: r.status, body: txt.slice(0, 200) };
      if (r.status !== 404 && r.status !== 405) {
        results.PROMISING = { endpoint: ep, status: r.status, body: txt.slice(0, 300) };
      }
    } catch(e) {
      results.postTests[ep] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
