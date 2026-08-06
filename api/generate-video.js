// ══════════════════════════════════════════════
// /api/generate-video.js
// Higgsfield 영상 생성 API — 서버에서만 실행
// API 키는 Vercel 환경변수(HIGGSFIELD_API_KEY)에서 로드
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const { imageUrl, prompt, sceneIdx } = req.body;
  if (!prompt) return res.status(400).json({ error: '프롬프트가 없습니다.' });

  // 더미 모드: 즉시 jobId 반환 (video-status에서 처리)
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ jobId: `dummy-job-${sceneIdx}-${Date.now()}` });
  }

  try {
    const body = {
      prompt,
      duration: 5,
      model: 'kling-3.0'
    };
    if (imageUrl) body.image_url = imageUrl;

    const response = await fetch('https://api.higgsfield.ai/v1/videos/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.message || 'Higgsfield 영상 API 오류' });
    }

    const data = await response.json();
    const jobId = data.id || data.job_id || data.task_id;
    if (!jobId) return res.status(502).json({ error: '작업 ID를 받지 못했습니다.' });

    return res.status(200).json({ jobId });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
