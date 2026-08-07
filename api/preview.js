// ══════════════════════════════════════════════
// /api/preview.js  — Higgsfield 공식 문서 기반
// POST https://platform.higgsfield.ai/{model_id}
// 파라미터를 직접 body에 넣음 (params/arguments 래핑 없음)
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
  const BASE = 'https://platform.higgsfield.ai';

  try {
    // 1. 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // 2. 사진 업로드 (Higgsfield 업로드 엔드포인트 시도)
    let photoUrl = null;
    if (photo && photo.startsWith('data:')) {
      photoUrl = await uploadImage(photo, auth);
      console.log('사진 업로드:', photoUrl ? '성공' : '실패 → text-to-video 사용');
    }

    // 3. 씬별 영상 생성 — 공식 문서 정확한 형식
    const jobIds = [];

    for (let i = 0; i < 2; i++) {
      let model, body;

      if (photoUrl) {
        // 이미지→영상: higgsfield-ai/dop/preview (공식 문서 첫 번째 예시)
        model = 'higgsfield-ai/dop/preview';
        body = {
          image_url: photoUrl,
          prompt: prompts[i],
          duration: 5
        };
      } else {
        // 텍스트→영상: Kling v2.1 Pro (공식 문서 예시)
        model = 'kling-video/v2.1/pro/text-to-video';
        body = {
          prompt: prompts[i],
          duration: 5,
          aspect_ratio: '9:16'
        };
      }

      console.log('씬' + (i+1) + ' 요청:', model, JSON.stringify(body).slice(0, 150));

      const resp = await fetch(BASE + '/' + model, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': auth,
          'User-Agent': 'higgsfield-server-js/2.0'
        },
        body: JSON.stringify(body)
      });

      const respText = await resp.text();
      console.log('씬' + (i+1) + ' 응답 (' + resp.status + '):', respText.slice(0, 400));

      if (!resp.ok) {
        // 대체 모델로 재시도
        const fallbackId = await tryFallback(prompts[i], photoUrl, auth, BASE, i);
        if (fallbackId) { jobIds.push(fallbackId); continue; }
        throw new Error('씬' + (i+1) + ' 실패 (' + resp.status + '): ' + respText.slice(0, 200));
      }

      let data;
      try { data = JSON.parse(respText); } catch(_) { throw new Error('응답 파싱 실패: ' + respText.slice(0,100)); }

      const jobId = data.request_id || data.id || data.job_id || data.requestId;
      if (!jobId) throw new Error('씬' + (i+1) + ' jobId 없음: ' + respText.slice(0, 200));
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── 대체 모델 시도 (순서대로)
async function tryFallback(prompt, photoUrl, auth, BASE, sceneIdx) {
  const fallbacks = photoUrl
    ? [
        { model: 'kling-video/v2.1/pro/image-to-video', body: { image_url: photoUrl, prompt, duration: 5 } },
        { model: 'bytedance/seedance/v1/pro/image-to-video', body: { image_url: photoUrl, prompt } },
        { model: 'kling-video/v2.1/pro/text-to-video', body: { prompt, duration: 5, aspect_ratio: '9:16' } },
      ]
    : [
        { model: 'bytedance/seedance/v1/pro/text-to-video', body: { prompt, duration: 5, aspect_ratio: '9:16' } },
        { model: 'kling-video/v1.6/pro/text-to-video', body: { prompt, duration: 5, aspect_ratio: '9:16' } },
        { model: 'higgsfield-ai/soul/standard', body: { prompt, aspect_ratio: '9:16', resolution: '720p' } },
      ];

  for (const fb of fallbacks) {
    try {
      console.log('대체 시도:', fb.model);
      const r = await fetch(BASE + '/' + fb.model, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
        body: JSON.stringify(fb.body)
      });
      const txt = await r.text();
      console.log('대체 응답 (' + r.status + '):', txt.slice(0, 200));
      if (r.ok) {
        const d = JSON.parse(txt);
        const jid = d.request_id || d.id || d.job_id;
        if (jid) { console.log('대체 성공:', fb.model, jid); return jid; }
      }
    } catch(e) { console.warn('대체 오류:', fb.model, e.message); }
  }
  return null;
}

// ── 이미지 업로드 (공식 Python SDK의 upload 엔드포인트 역추적)
async function uploadImage(base64DataUrl, auth) {
  try {
    const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];
    const buffer   = Buffer.from(match[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) { console.warn('사진 8MB 초과'); return null; }

    // 공식 Python SDK 내부 엔드포인트 (higgsfield-client 소스 기반)
    const uploadEndpoints = [
      'https://platform.higgsfield.ai/uploads',
      'https://platform.higgsfield.ai/upload',
      'https://platform.higgsfield.ai/v1/uploads',
      'https://platform.higgsfield.ai/files',
    ];

    for (const url of uploadEndpoints) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0', 'Content-Type': mimeType },
          body: buffer
        });
        const txt = await r.text();
        console.log('업로드 시도', url, '→', r.status, txt.slice(0, 150));
        if (r.ok) {
          const d = JSON.parse(txt);
          const u = d.url || d.cdn_url || d.file_url || d.image_url;
          if (u) return u;
        }
      } catch(e) { console.warn('업로드 실패:', url, e.message); }
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
