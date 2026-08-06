// ══════════════════════════════════════════════
// /api/generate-image.js
// Higgsfield 이미지 생성 API — 서버에서만 실행
// API 키는 Vercel 환경변수(HIGGSFIELD_API_KEY)에서 로드
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: '프롬프트가 없습니다.' });

  // 더미 모드: 플레이스홀더 이미지 URL 반환
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({
      url: 'https://placehold.co/1024x1024/FFE4E8/FF5B6E?text=Disney+Character'
    });
  }

  try {
    const response = await fetch('https://api.higgsfield.ai/v1/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        prompt,
        model: 'nano-banana-pro',
        width: 1024,
        height: 1024
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.message || 'Higgsfield 이미지 API 오류' });
    }

    const data = await response.json();
    const url = data.url || data.image_url || (data.images?.[0]?.url) || null;
    return res.status(200).json({ url });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
