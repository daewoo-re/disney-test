// ══════════════════════════════════════════════
// /api/preview.js
// 1. Soul Cinema로 실사 → 디즈니 스타일 이미지 변환
// 2. 변환된 이미지로 DoP 영상 생성
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
    // 1. imgbb 업로드 (실사 사진 URL 획득)
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) {
      return res.status(400).json({ ok: false, message: '사진 업로드에 실패했습니다.' });
    }
    console.log('실사 사진 URL:', rawPhotoUrl.slice(0, 80));

    // 2. Soul Cinema로 디즈니 스타일 변환 (0 크레딧, 무료!)
    const disneyImageUrl = await convertToDisneyStyle(rawPhotoUrl, auth, BASE);
    console.log('디즈니 변환 결과:', disneyImageUrl ? disneyImageUrl.slice(0, 80) : '실패 → 실사 사용');

    // 변환 실패 시 실사 사진으로 폴백
    const finalImageUrl = disneyImageUrl || rawPhotoUrl;

    // 3. 영상 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // 4. 씬 1·2 영상 생성 (DoP Lite)
    const jobIds = [];
    for (let i = 0; i < 2; i++) {
      const body = {
        image_url: finalImageUrl,
        prompt: prompts[i]
      };

      console.log('씬' + (i+1) + ' 영상 생성 시작');
      const r = await fetch(BASE + '/higgsfield-ai/dop/lite', {
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
      console.log('씬' + (i+1) + ' 응답 (' + r.status + '):', txt.slice(0, 200));

      if (!r.ok) throw new Error('씬' + (i+1) + ' 생성 실패 (' + r.status + '): ' + txt.slice(0, 100));

      const d = JSON.parse(txt);
      const jid = d.request_id || d.id || d.job_id;
      if (!jid) throw new Error('씬' + (i+1) + ' jobId 없음');
      jobIds.push(jid);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── Soul Cinema: 실사 → 디즈니/애니 스타일 변환 (무료 0크레딧)
async function convertToDisneyStyle(photoUrl, auth, BASE) {
  try {
    const stylePrompt = 'Disney Pixar 3D animated style, high quality CG animation, soft rounded facial features, large expressive eyes, warm cinematic lighting, vibrant colors, professional animated film character design, Korean young adult, charming and romantic atmosphere';

    // 방법 A: Soul Cinema (text2image + reference)
    const bodyA = {
      prompt: stylePrompt,
      reference_image_url: photoUrl,
      reference_strength: 0.85
    };

    const rA = await fetch(BASE + '/higgsfield-ai/soul/cinema', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': auth,
        'User-Agent': 'higgsfield-server-js/2.0'
      },
      body: JSON.stringify(bodyA)
    });

    const txtA = await rA.text();
    console.log('Soul Cinema 응답 (' + rA.status + '):', txtA.slice(0, 300));

    if (rA.ok) {
      const dA = JSON.parse(txtA);
      // Soul 이미지 모델은 즉시 이미지 URL 반환
      const imgUrl = dA.url || dA.image_url ||
        (dA.images && dA.images[0] && dA.images[0].url) ||
        (dA.result && dA.result.url) ||
        (dA.data && dA.data.url);

      if (imgUrl) {
        console.log('Soul Cinema 이미지:', imgUrl.slice(0, 80));
        return imgUrl;
      }

      // request_id가 있으면 비동기 처리 → 폴링
      const reqId = dA.request_id || dA.id;
      if (reqId) {
        console.log('Soul Cinema 비동기 처리, 폴링 시작:', reqId);
        return await pollImageJob(reqId, auth, BASE);
      }
    }

    // 방법 B: Soul Reference
    const bodyB = {
      prompt: stylePrompt,
      image_url: photoUrl,
    };

    const rB = await fetch(BASE + '/higgsfield-ai/soul/reference', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': auth,
        'User-Agent': 'higgsfield-server-js/2.0'
      },
      body: JSON.stringify(bodyB)
    });

    const txtB = await rB.text();
    console.log('Soul Reference 응답 (' + rB.status + '):', txtB.slice(0, 300));

    if (rB.ok) {
      const dB = JSON.parse(txtB);
      const imgUrl = dB.url || dB.image_url ||
        (dB.images && dB.images[0] && dB.images[0].url) ||
        (dB.result && dB.result.url);
      if (imgUrl) return imgUrl;

      const reqId = dB.request_id || dB.id;
      if (reqId) return await pollImageJob(reqId, auth, BASE);
    }

    return null;
  } catch(e) {
    console.warn('Soul 변환 오류:', e.message);
    return null;
  }
}

// ── Soul 이미지 생성 완료 폴링 (최대 30초)
async function pollImageJob(reqId, auth, BASE) {
  const DONE = ['completed','success','done','finished'];
  for (let i = 0; i < 15; i++) {
    await new Promise(function(r){ setTimeout(r, 2000); });
    try {
      const r = await fetch(BASE + '/requests/' + encodeURIComponent(reqId) + '/status', {
        headers: { 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' }
      });
      if (!r.ok) continue;
      const d = await r.json();
      console.log('Soul 폴링:', d.status, reqId.slice(0,8));
      if (DONE.includes(d.status)) {
        return d.url || d.image_url ||
          (d.images && d.images[0] && d.images[0].url) ||
          (d.result && d.result.url) ||
          (d.video && d.video.url) || null;
      }
      if (['failed','error','cancelled'].includes(d.status)) return null;
    } catch(e) { console.warn('Soul 폴링 오류:', e.message); }
  }
  console.warn('Soul 폴링 타임아웃');
  return null;
}

// ── imgbb 업로드
async function uploadToImgbb(base64DataUrl, imgbbKey) {
  try {
    const base64Data = base64DataUrl.includes(',')
      ? base64DataUrl.split(',')[1]
      : base64DataUrl;

    if (imgbbKey) {
      const form = new URLSearchParams();
      form.append('image', base64Data);
      form.append('expiration', '600');
      const r = await fetch('https://api.imgbb.com/1/upload?key=' + imgbbKey, {
        method: 'POST', body: form
      });
      const d = await r.json();
      if (r.ok && d.data && d.data.url) return d.data.url;
    }

    // fallback
    const form2 = new URLSearchParams();
    form2.append('source', base64Data);
    form2.append('type', 'base64');
    form2.append('action', 'upload');
    form2.append('format', 'json');
    const r2 = await fetch('https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', {
      method: 'POST', body: form2
    });
    const d2 = await r2.json();
    if (r2.ok && d2.image && d2.image.url) return d2.image.url;
    return null;
  } catch(e) {
    console.warn('imgbb 업로드 오류:', e.message);
    return null;
  }
}

// ── Claude 프롬프트 생성
async function generatePrompts(apiKey, concept, scenes) {
  const STYLE = 'high-quality 3D animated film, Disney Pixar style, Korean young adult couple, large expressive eyes, smooth facial features, natural hair, warm cinematic lighting, romantic bokeh background, emotionally rich scene';

  const defaults = [
    STYLE + '. Animated couple at a cozy cafe, golden sunlight streaming through windows, steam rising from coffee cups, nervous excitement as eyes meet for the first time. Slow cinematic zoom in, soft bokeh lights.',
    STYLE + '. Animated couple sitting across each other at cafe table during golden sunset, warm string lights glowing, both smiling shyly. Cinematic medium shot, vibrant sunset colors through window, magical romantic atmosphere.'
  ];

  if (!apiKey) return defaults;
  try {
    const s1 = (scenes && scenes.s1) || '';
    const s2 = (scenes && scenes.s2) || '';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: 'Higgsfield DoP 모델용 영상 프롬프트 전문가. 반드시 순수 JSON만 응답.',
        messages: [{
          role: 'user',
          content: '씬1: "' + s1 + '"\n씬2: "' + s2 + '"\n컨셉: ' + (concept||'propose') + '\n\n스타일: ' + STYLE + '\n\n각 씬을 위 스타일로 100단어 이내 영어 프롬프트 생성:\n{"prompts":["씬1 프롬프트","씬2 프롬프트"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(function(b){ return b.text||''; }).join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('프롬프트 생성 완료:', p.prompts[0].slice(0,60) + '...');
      return p.prompts;
    }
    return defaults;
  } catch(e) {
    console.warn('Claude 실패:', e.message);
    return defaults;
  }
}
