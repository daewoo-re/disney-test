// ══════════════════════════════════════════════
// /api/merge.js
// 영상 이어붙이기 — 서버에서만 실행
// 더미 모드: 첫 번째 영상 URL을 결과물로 반환
// 실제 모드: FFmpeg 처리 (별도 서버 또는 외부 서비스 필요)
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { videos } = req.body;
  if (!videos || videos.length === 0) {
    return res.status(400).json({ error: '영상 URL이 없습니다.' });
  }

  // 더미 모드 또는 영상이 1개면 바로 반환
  if (process.env.DUMMY_MODE === 'true' || videos.length === 1) {
    return res.status(200).json({ url: videos[0] });
  }

  // ── 실제 FFmpeg 이어붙이기
  // Vercel 서버리스는 FFmpeg 바이너리를 직접 실행할 수 없으므로
  // 아래 두 가지 방법 중 하나를 선택하세요:
  //
  // [방법 A] Creatomate API (외부 서비스, 영상 이어붙이기 특화)
  //   → process.env.CREATOMATE_API_KEY 설정 후 아래 코드 활성화
  //
  // [방법 B] AWS Lambda + FFmpeg (직접 서버 구성)
  //
  // 현재는 임시로 첫 번째 영상을 결과물로 반환합니다.
  // 정식 버전에서 FFmpeg 연동이 필요하면 알려주세요.

  // Creatomate 연동 예시 (주석 처리 — 활성화하려면 uncomment)
  /*
  const cmKey = process.env.CREATOMATE_API_KEY;
  if (cmKey) {
    const resp = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cmKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: process.env.CREATOMATE_TEMPLATE_ID,
        modifications: videos.reduce((acc, url, i) => {
          acc[`Video-${i + 1}`] = url;
          return acc;
        }, {})
      })
    });
    const data = await resp.json();
    const renderUrl = Array.isArray(data) ? data[0]?.url : data?.url;
    if (renderUrl) return res.status(200).json({ url: renderUrl });
  }
  */

  // 임시: 첫 번째 영상 반환
  return res.status(200).json({ url: videos[0] });
}
