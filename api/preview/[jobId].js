// ══════════════════════════════════════════════
// /api/preview/[jobId].js
// GET: 영상 생성 상태 폴링
// jobId = "jobId1,jobId2" (씬 2개 복합 ID)
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ status: 'error' });

  const HF_API_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_API_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const { jobId } = req.query;

  if (!jobId) return res.status(400).json({ status: 'error' });

  // 더미 모드
  if (process.env.DUMMY_MODE === 'true' || String(jobId).startsWith('dummy-')) {
    return res.status(200).json({
      status: 'completed',
      result: {
        videos: [
          'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
        ]
      }
    });
  }

  if (!HF_API_KEY || !HF_API_SECRET) {
    return res.status(500).json({ status: 'error', message: 'API 키 없음' });
  }

  const credentials = `${HF_API_KEY}:${HF_API_SECRET}`;
  const jobIds = String(jobId).split(',').filter(Boolean);

  try {
    const results = await Promise.all(jobIds.map(async (jid) => {
      const resp = await fetch(`https://platform.higgsfield.ai/requests/${encodeURIComponent(jid)}/status`, {
        headers: {
          'Authorization': `Key ${credentials}`,
          'User-Agent': 'higgsfield-server-js/2.0'
        }
      });
      if (!resp.ok) return { status: 'processing' };
      return resp.json();
    }));

    const isDone  = s => ['completed','success','done','finished'].includes(s);
    const isFail  = s => ['failed','error','cancelled'].includes(s);

    const allDone   = results.every(r => isDone(r.status || r.state || ''));
    const anyFailed = results.some(r  => isFail(r.status || r.state || ''));

    if (anyFailed) return res.status(200).json({ status: 'failed' });

    if (allDone) {
      const videos = results.map(r =>
        r.video?.url || r.url || r.video_url ||
        (Array.isArray(r.outputs) ? r.outputs[0] : null) || null
      );
      return res.status(200).json({ status: 'completed', result: { videos } });
    }

    return res.status(200).json({ status: 'processing' });

  } catch (e) {
    console.error('폴링 오류:', e.message);
    return res.status(200).json({ status: 'processing' });
  }
}
