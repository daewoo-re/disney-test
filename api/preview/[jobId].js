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
      // completed 시 전체 응답 로깅 (URL 위치 파악용)
      if (data.status === 'completed') {
        console.log('완료 전체 응답:', JSON.stringify(data));
      } else {
        console.log('폴링 응답:', JSON.stringify(data).slice(0, 200));
      }
      return data;
    }));

    const DONE_STATUSES   = ['completed', 'success', 'done', 'finished'];
    const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'nsfw'];

    function getStatus(r) { return r.status || r.state || ''; }

    function extractVideoUrl(r) {
      // 직접 URL 필드
      if (r.url) return r.url;
      if (r.video_url) return r.video_url;
      // video 객체
      if (r.video && r.video.url) return r.video.url;
      if (r.video && typeof r.video === 'string') return r.video;
      // output 객체
      if (r.output && r.output.url) return r.output.url;
      if (r.output && typeof r.output === 'string') return r.output;
      // outputs 배열
      if (Array.isArray(r.outputs) && r.outputs[0]) {
        return typeof r.outputs[0] === 'string' ? r.outputs[0] : r.outputs[0].url;
      }
      // result 객체
      if (r.result && r.result.url) return r.result.url;
      if (r.result && r.result.video_url) return r.result.video_url;
      if (r.result && Array.isArray(r.result.videos)) return r.result.videos[0];
      // images 배열
      if (r.images && r.images[0] && r.images[0].url) return r.images[0].url;
      // results 중첩
      if (r.results && r.results.raw && r.results.raw.url) return r.results.raw.url;
      if (r.results && r.results.url) return r.results.url;
      // media 필드
      if (r.media && r.media.url) return r.media.url;
      if (r.media_url) return r.media_url;
      // data 중첩
      if (r.data && r.data.url) return r.data.url;
      if (r.data && r.data.video_url) return r.data.video_url;
      // 전체 객체에서 URL 패턴 탐색
      const str = JSON.stringify(r);
      const match = str.match(/"(https:\/\/[^"]*\.mp4[^"]*)"/);
      if (match) return match[1];
      const match2 = str.match(/"(https:\/\/[^"]*video[^"]*\.mp4[^"]*)"/i);
      if (match2) return match2[1];
      console.warn('URL 추출 실패. 전체 응답:', str.slice(0, 500));
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
      console.log('완성 영상 URLs:', JSON.stringify(videos));
      return res.status(200).json({ status: 'completed', result: { videos: videos } });
    }

    return res.status(200).json({ status: 'processing' });

  } catch (e) {
    console.error('폴링 오류:', e.message);
    return res.status(200).json({ status: 'processing' });
  }
}
