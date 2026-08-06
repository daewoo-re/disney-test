// ══════════════════════════════════════════════
// /api/video-status.js
// Higgsfield 영상 완료 상태 조회 — 서버에서만 실행
// API 키는 Vercel 환경변수(HIGGSFIELD_API_KEY)에서 로드
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId가 없습니다.' });

  // 더미 모드: 3초 후 완료로 응답 (플레이스홀더 영상 URL)
  if (process.env.DUMMY_MODE === 'true' || jobId.startsWith('dummy-job-')) {
    // 더미: 항상 완료 상태 반환
    return res.status(200).json({
      status: 'done',
      url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
    });
  }

  try {
    const response = await fetch(`https://api.higgsfield.ai/v1/videos/${encodeURIComponent(jobId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) {
      return res.status(502).json({ status: 'error', error: 'Higgsfield 상태 조회 실패' });
    }

    const data = await response.json();
    const rawStatus = data.status || data.state || '';

    let status = 'pending';
    if (['completed','success','done','finished'].includes(rawStatus)) status = 'done';
    else if (['failed','error','cancelled'].includes(rawStatus)) status = 'error';

    const url = status === 'done'
      ? (data.url || data.video_url || (Array.isArray(data.outputs) ? data.outputs[0] : null))
      : null;

    return res.status(200).json({ status, url });

  } catch (e) {
    return res.status(500).json({ status: 'error', error: e.message });
  }
}
