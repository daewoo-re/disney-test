// /api/debug-hf.js — 전체 모델 목록 조회 (최신)
export default async function handler(req, res) {
  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  if (!HF_KEY || !HF_SECRET) return res.status(500).json({ error: 'API 키 없음' });

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';

  // 전체 모델 목록 조회
  const r = await fetch(BASE + '/models', {
    headers: { 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' }
  });
  const data = await r.json();

  // 슬러그만 추출
  const slugs = (data.items || []).map(m => ({
    slug: m.slug,
    title: m.title,
    type: m.operation_type,
    credits: m.base_credits
  }));

  // 비디오 모델만 필터
  const videoModels = slugs.filter(m => m.type === 'image2video' || m.type === 'text2video');
  const imageModels = slugs.filter(m => m.type === 'text2image' || m.type === 'image2image');

  return res.status(200).json({
    total: data.total,
    videoModels,
    imageModels,
    allSlugs: slugs
  });
}
