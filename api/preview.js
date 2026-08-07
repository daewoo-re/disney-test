// ══════════════════════════════════════════════
// /api/preview.js
// base64 사진 → imgbb 무료 호스팅 → URL 획득
// → Higgsfield DoP POST /{slug} 호출
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  const IMGBB_KEY = process.env.IMGBB_API_KEY;

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ ok: false, message: 'Higgsfield API 키가 없습니다.' });
  }

  const { concept, scenes, photo } = req.body || {};
  if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터가 없습니다.' });

  // 더미 모드
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, jobId: 'dummy-' + Date.now() });
  }

  if (!photo) {
    return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE  = 'https://platform.higgsfield.ai';

  try {
    // 1. 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // 2. base64 → 외부 URL 변환 (imgbb 무료 API 사용)
    const photoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!photoUrl) {
      return res.status(400).json({ ok: false, message: '사진 업로드에 실패했습니다. 다른 사진으로 시도해주세요.' });
    }
    console.log('imgbb 업로드 성공:', photoUrl.slice(0, 80));

    // 3. 씬별 영상 생성 — POST /{slug} (확인된 엔드포인트)
    const jobIds = [];
    const modelPriority = [
      'higgsfield-ai/dop/lite',     // 2 크레딧
      'higgsfield-ai/dop/turbo',    // 6.5 크레딧
      'higgsfield-ai/dop/standard', // 9 크레딧
    ];

    for (let i = 0; i < 2; i++) {
      let jobId = null;

      for (const model of modelPriority) {
        const body = { image_url: photoUrl, prompt: prompts[i] };
        console.log('씬' + (i+1) + ' 시도:', model);

        const r = await fetch(BASE + '/' + model, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': auth,
            'User-Agent': 'higgsfield-server-js/2.0'
          },
          body: JSON.stringify(body)
        });

        const txt = await r.text();
        console.log('씬' + (i+1) + ' ' + model + ' (' + r.status + '):', txt.slice(0, 300));

        if (r.ok) {
          let d;
          try { d = JSON.parse(txt); } catch(_) { continue; }
          const jid = d.request_id || d.id || d.job_id || d.requestId;
          if (jid) { jobId = jid; console.log('씬' + (i+1) + ' 성공:', model, jid); break; }
        }
      }

      if (!jobId) throw new Error('씬' + (i+1) + ' 영상 생성 실패.');
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── imgbb 무료 이미지 호스팅 업로드
// IMGBB_API_KEY 없으면 fallback으로 freeimage.host 시도
async function uploadToImgbb(base64DataUrl, imgbbKey) {
  try {
    // base64에서 순수 데이터만 추출
    const base64Data = base64DataUrl.includes(',')
      ? base64DataUrl.split(',')[1]
      : base64DataUrl;

    // imgbb API (무료, 가입 필요)
    if (imgbbKey) {
      const form = new URLSearchParams();
      form.append('image', base64Data);
      form.append('expiration', '600'); // 10분 후 삭제

      const r = await fetch('https://api.imgbb.com/1/upload?key=' + imgbbKey, {
        method: 'POST',
        body: form
      });
      const d = await r.json();
      console.log('imgbb 응답:', r.status, JSON.stringify(d).slice(0, 200));
      if (r.ok && d.data && d.data.url) return d.data.url;
    }

    // fallback: freeimage.host (API 키 불필요)
    const form2 = new URLSearchParams();
    form2.append('source', base64Data);
    form2.append('type', 'base64');
    form2.append('action', 'upload');
    form2.append('format', 'json');

    const r2 = await fetch('https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', {
      method: 'POST',
      body: form2
    });
    const d2 = await r2.json();
    console.log('freeimage.host 응답:', r2.status, JSON.stringify(d2).slice(0, 200));
    if (r2.ok && d2.image && d2.image.url) return d2.image.url;

    return null;
  } catch(e) {
    console.warn('이미지 업로드 오류:', e.message);
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: '디즈니/픽사 스타일 영상 프롬프트 전문가. 순수 JSON만 응답.',
        messages: [{
          role: 'user',
          content: '씬1:' + s1 + ' 씬2:' + s2 + ' 컨셉:' + (concept||'propose') +
            '\n{"prompts":["씬1 80단어 영어 영상 프롬프트(Disney Pixar animated style 시작)","씬2 프롬프트"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(function(b){ return b.text||''; }).join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) return p.prompts;
    return defaults;
  } catch(e) { return defaults; }
}
