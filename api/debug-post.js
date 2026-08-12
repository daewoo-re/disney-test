// /api/debug-post.js
// POST 방식으로 실제 슬러그 테스트 (최소 파라미터로 422/400 유도)
// 404 = 슬러그 없음, 422/400 = 슬러그 있음(파라미터 오류), 200 = 성공

export default async function handler(req, res) {
  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'API 키 없음' });

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';

  // 테스트할 슬러그 목록
  const slugs = [
    // NB Pro 후보
    'nano_banana_2',
    'nano-banana-2',
    'nano_banana_pro',
    'nano-banana-pro',
    'higgsfield-ai/nano_banana_2',
    'higgsfield-ai/nano-banana-2',
    // Kling 후보
    'kling3_0_turbo',
    'kling-3-0-turbo',
    'kling3_0',
    'kling-3-0',
    'kling2_6',
    'kling-2-6',
    // Seedance 후보
    'seedance_2_0',
    'seedance-2-0',
  ];

  const results = {};

  for (const slug of slugs) {
    try {
      const r = await fetch(BASE + '/' + slug, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': auth,
          'User-Agent': 'higgsfield-server-js/2.0'
        },
        body: JSON.stringify({ prompt: 'test' }) // 최소 파라미터
      });
      const txt = await r.text();
      results[slug] = { status: r.status, body: txt.slice(0, 120) };
    } catch(e) {
      results[slug] = { error: e.message };
    }
  }

  // 404가 아닌 것 = 슬러그 존재
  const found    = Object.entries(results).filter(([k,v]) => v.status && v.status !== 404).map(([k,v]) => ({ slug: k, status: v.status, body: v.body }));
  const notFound = Object.entries(results).filter(([k,v]) => v.status === 404).map(([k]) => k);

  return res.status(200).json({ found, notFound, all: results });
}
