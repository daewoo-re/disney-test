// ══════════════════════════════════════════════
// /api/preview/[jobId].js
// GET: 영상 생성 상태 폴링
// jobId = "jobId1,jobId2" (씬 2개 복합 ID)
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ status: 'error' });

  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
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

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ status: 'error', message: 'API 키 없음' });
  }

  const credentials = HF_KEY + ':' + HF_SECRET;
  const jobIds = String(jobId).split(',').filter(Boolean);

  try {
    const results = await Promise.all(jobIds.map(async function(jid) {
      const resp = await fetch(
        'https://platform.higgsfield.ai/requests/' + encodeURIComponent(jid) + '/status',
        {
          headers: {
            'Authorization': 'Key ' + credentials,
            'User-Agent': 'higgsfield-server-js/2.0'
          }
        }
      );
      if (!resp.ok) {
        console.warn('폴링 응답 오류:', resp.status, jid);
        return { status: 'processing' };
      }
      const data = await resp.json();
      console.log('폴링 응답:', JSON.stringify(data).slice(0, 200));
      return data;
    }));

    const DONE_STATUSES   = ['completed', 'success', 'done', 'finished'];
    const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'nsfw'];

    function getStatus(r) { return r.status || r.state || ''; }
    function extractVideoUrl(r) {
      // Higgsfield v2 SDK 응답 형식 대응
      if (r.video && r.video.url) return r.video.url;
      if (r.images && r.images[0] && r.images[0].url) return r.images[0].url;
      if (r.url) return r.url;
      if (r.video_url) return r.video_url;
      if (r.output && r.output.url) return r.output.url;
      if (Array.isArray(r.outputs) && r.outputs[0]) return r.outputs[0];
      if (r.results && r.results.raw && r.results.raw.url) return r.results.raw.url;
      return null;
    }

    const anyFailed = results.some(function(r) {
      return FAILED_STATUSES.includes(getStatus(r));
    });
    if (anyFailed) {
      const failedR = results.find(function(r){ return FAILED_STATUSES.includes(getStatus(r)); });
      return res.status(200).json({ status: 'failed', message: getStatus(failedR) });
    }

    const allDone = results.every(function(r) {
      return DONE_STATUSES.includes(getStatus(r));
    });

    if (allDone) {
      const videos = results.map(extractVideoUrl);
      console.log('완성 영상 URLs:', videos);
      return res.status(200).json({ status: 'completed', result: { videos: videos } });
    }

    return res.status(200).json({ status: 'processing' });

  } catch (e) {
    console.error('폴링 오류:', e.message);
    return res.status(200).json({ status: 'processing' });
  }
}
