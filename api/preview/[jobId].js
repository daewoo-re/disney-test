// ══════════════════════════════════════════════
// /api/preview/[jobId].js
// GET: 각 jobId 상태 1회 조회 후 즉시 반환
// 폴링 루프는 브라우저(index.html)에서 처리
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

  const DONE_STATUSES   = ['completed', 'success', 'done', 'finished'];
  const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'nsfw'];

  function getStatus(r) { return r.status || r.state || ''; }

  // 확인된 응답 형식: { status, video: { url } }
  function extractVideoUrl(r) {
    if (r.video && r.video.url) return r.video.url;  // ← 확인된 실제 형식
    if (r.video && typeof r.video === 'string') return r.video;
    if (r.url) return r.url;
    if (r.video_url) return r.video_url;
    if (r.output && r.output.url) return r.output.url;
    if (r.output && typeof r.output === 'string') return r.output;
    if (Array.isArray(r.outputs) && r.outputs[0]) {
      return typeof r.outputs[0] === 'string' ? r.outputs[0] : r.outputs[0].url;
    }
    if (r.result && r.result.url) return r.result.url;
    if (r.data && r.data.url) return r.data.url;
    // 전체에서 .mp4 URL 탐색 (최후 수단)
    const m = JSON.stringify(r).match(/"(https:\/\/[^"]*\.mp4[^"]*)"/);
    if (m) return m[1];
    console.warn('URL 추출 실패:', JSON.stringify(r).slice(0, 200));
    return null;
  }

  try {
    // 각 jobId 상태 병렬 조회 (1회만, 타임아웃 없음)
    const results = await Promise.all(jobIds.map(async function(jid) {
      try {
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
          console.warn('폴링 HTTP 오류:', resp.status, jid);
          return { status: 'processing' };
        }
        const data = await resp.json();
        if (DONE_STATUSES.includes(data.status)) {
          console.log('완료:', jid, '→', extractVideoUrl(data));
        } else {
          console.log('상태:', data.status, jid);
        }
        return data;
      } catch(e) {
        console.warn('폴링 오류:', jid, e.message);
        return { status: 'processing' };
      }
    }));

    // 실패 확인
    const anyFailed = results.some(function(r) {
      return FAILED_STATUSES.includes(getStatus(r));
    });
    if (anyFailed) {
      return res.status(200).json({ status: 'failed' });
    }

    // 전체 완료 확인
    const allDone = results.every(function(r) {
      return DONE_STATUSES.includes(getStatus(r));
    });

    if (allDone) {
      const videos = results.map(extractVideoUrl);
      console.log('전체 완료 URLs:', JSON.stringify(videos));
      return res.status(200).json({ status: 'completed', result: { videos: videos } });
    }

    // 일부만 완료된 경우 → processing 반환 (브라우저가 2초 후 재시도)
    const doneCount = results.filter(function(r) {
      return DONE_STATUSES.includes(getStatus(r));
    }).length;
    console.log('진행 중: ' + doneCount + '/' + jobIds.length + ' 완료');
    return res.status(200).json({ status: 'processing', done: doneCount, total: jobIds.length });

  } catch (e) {
    console.error('폴링 핸들러 오류:', e.message);
    return res.status(200).json({ status: 'processing' });
  }
}
