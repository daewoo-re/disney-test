// ══════════════════════════════════════════════
// /api/preview.js  — Higgsfield 공식 CLI 모델 목록 기반
// 엔드포인트: POST https://platform.higgsfield.ai/{job_set_type}
// job_set_type: CLI MODELS.md 기준 (kling3_0, seedance_2_0 등)
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ ok: false, message: 'Higgsfield API 키가 없습니다.' });
  }

  const { concept, scenes, photo } = req.body || {};
  if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터가 없습니다.' });

  // 더미 모드
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, jobId: 'dummy-' + Date.now() });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE  = 'https://platform.higgsfield.ai';

  try {
    // 1. 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // 2. 사진 업로드 시도
    let photoUrl = null;
    if (photo && photo.startsWith('data:')) {
      photoUrl = await uploadImage(photo, auth, BASE);
      console.log('사진 업로드:', photoUrl ? '성공' : '실패 → text-to-video 사용');
    }

    // 3. 씬별 영상 생성
    // 공식 CLI 모델 목록 기준 job_set_type 사용
    const jobIds = [];

    for (let i = 0; i < 2; i++) {
      // 우선순위 모델 목록 (image 있으면 i2v, 없으면 t2v)
      const candidates = photoUrl
        ? [
            // image-to-video 모델들 (CLI 목록 기준)
            { type: 'kling3_0',      body: { prompt: prompts[i], start_image: photoUrl, duration: 5, mode: 'pro', sound: 'off' } },
            { type: 'kling2_6',      body: { prompt: prompts[i], start_image: photoUrl, duration: 5 } },
            { type: 'seedance_2_0',  body: { prompt: prompts[i], image: photoUrl, duration: 5, aspect_ratio: '9:16' } },
            { type: 'wan2_7',        body: { prompt: prompts[i], image: photoUrl, duration: 5 } },
          ]
        : [
            // text-to-video 모델들 (CLI 목록 기준)
            { type: 'kling3_0',      body: { prompt: prompts[i], duration: 5, mode: 'pro', sound: 'off', aspect_ratio: '9:16' } },
            { type: 'seedance_2_0',  body: { prompt: prompts[i], duration: 5, aspect_ratio: '9:16' } },
            { type: 'kling2_6',      body: { prompt: prompts[i], duration: 5, aspect_ratio: '9:16' } },
            { type: 'wan2_7',        body: { prompt: prompts[i], duration: 5, aspect_ratio: '9:16' } },
            { type: 'minimax_hailuo',body: { prompt: prompts[i], duration: 5, aspect_ratio: '9:16' } },
          ];

      let jobId = null;
      for (const c of candidates) {
        console.log('씬' + (i+1) + ' 시도:', c.type);
        const r = await fetch(BASE + '/' + c.type, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': auth,
            'User-Agent': 'higgsfield-server-js/2.0'
          },
          body: JSON.stringify(c.body)
        });
        const txt = await r.text();
        console.log('씬' + (i+1) + ' ' + c.type + ' (' + r.status + '):', txt.slice(0, 200));

        if (r.ok) {
          let d;
          try { d = JSON.parse(txt); } catch(_) { continue; }
          const jid = d.request_id || d.id || d.job_id || d.requestId;
          if (jid) { jobId = jid; console.log('씬' + (i+1) + ' 성공:', c.type, jid); break; }
        }
        // 404 model_not_found → 다음 후보 시도
        // 그 외 오류는 중단하지 않고 다음 후보
      }

      if (!jobId) {
        throw new Error('씬' + (i+1) + '에 사용 가능한 모델이 없습니다. 로그를 확인해주세요.');
      }
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 최종 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── 사진 업로드 (CLI `higgsfield upload` 엔드포인트 역추적)
async function uploadImage(base64DataUrl, auth, BASE) {
  try {
    const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1];
    const buffer   = Buffer.from(match[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) { console.warn('사진 8MB 초과'); return null; }

    // CLI `higgsfield upload` 가 사용하는 엔드포인트 후보
    const candidates = [
      BASE + '/uploads/image',
      BASE + '/upload/image',
      BASE + '/uploads',
      BASE + '/files/upload',
      BASE + '/upload',
    ];

    for (const url of candidates) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0', 'Content-Type': mimeType },
        body: buffer
      });
      const txt = await r.text();
      console.log('업로드 시도', url.replace(BASE,''), '→', r.status, txt.slice(0, 100));
      if (r.ok) {
        try {
          const d = JSON.parse(txt);
          const u = d.url || d.cdn_url || d.file_url || d.image_url || d.media_url;
          if (u) return u;
        } catch(_) {}
      }
    }
    return null;
  } catch(e) {
    console.warn('업로드 오류:', e.message);
    return null;
  }
}

// ── Claude 프롬프트 생성
async function generatePrompts(apiKey, concept, scenes) {
  const defaults = [
    'Disney Pixar animated style. Two young Korean people meet for the first time, eyes lock in a magical moment. Soft golden light, romantic sparkles, slow zoom in. Cinematic, 8k quality, heartwarming atmosphere.',
    'Disney Pixar animated style. A young couple on their first date, gently holding hands at a riverside cafe. Warm golden hour light, joyful expressions, smooth cinematic dolly shot. 8k quality, romantic mood.'
  ];
  if (!apiKey) return defaults;
  try {
    const s1 = (scenes && scenes.s1) || '';
    const s2 = (scenes && scenes.s2) || '';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 600,
        system: '디즈니/픽사 스타일 영상 프롬프트 전문가. 순수 JSON만 응답.',
        messages: [{ role: 'user', content: '씬1:' + s1 + ' 씬2:' + s2 + ' 컨셉:' + (concept||'propose') + '\n{"prompts":["씬1 80단어 영어 영상 프롬프트(Disney Pixar animated style 시작)","씬2 프롬프트"]}' }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(function(b){ return b.text||''; }).join('').replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) return p.prompts;
    return defaults;
  } catch(e) { return defaults; }
}
