// /api/debug-slugs.js
// GET: 크레딧 0으로 슬러그 존재 여부만 확인
// OPTIONS 요청은 실제 생성 안 함

export default async function handler(req, res) {
  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'API 키 없음' });

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';

  const slugsToCheck = [
    // 이미지 모델 후보
    'nano_banana_2',
    'nano_banana_2_lite',
    'nano_banana_flash',
    'nano_banana',
    'gpt_image_2',
    'text2image_soul_v2',
    'flux_2',
    // 영상 모델 후보
    'kling3_0_turbo',
    'kling3_0',
    'kling2_6',
    'seedance_2_0',
    'seedance_2_0_mini',
    'wan2_7',
    'minimax_hailuo',
  ];

  const results = {};

  for (const slug of slugsToCheck) {
    try {
      // OPTIONS 요청 - 실제 생성 없음, 크레딧 0
      const r = await fetch(BASE + '/' + slug, {
        method: 'OPTIONS',
        headers: {
          'Authorization': auth,
          'User-Agent': 'higgsfield-server-js/2.0'
        }
      });
      results[slug] = { status: r.status, exists: r.status !== 404 };
    } catch(e) {
      results[slug] = { error: e.message };
    }
  }

  // 존재하는 슬러그만 강조
  const working = Object.entries(results)
    .filter(([k,v]) => v.exists)
    .map(([k]) => k);

  const notFound = Object.entries(results)
    .filter(([k,v]) => !v.exists && !v.error)
    .map(([k]) => k);

  return res.status(200).json({ working, notFound, details: results });
}
