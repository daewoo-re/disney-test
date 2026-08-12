// ══════════════════════════════════════════════
// /api/preview.js
// PHASE 1: Nano Banana Pro (nano_banana_2) → 디즈니 픽사 이미지
// PHASE 2: Kling 3.0 Turbo (kling3_0_turbo) → 영상 생성
// CLI 공식 슬러그 기반: github.com/higgsfield-ai/cli
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  const IMGBB_KEY = process.env.IMGBB_API_KEY;

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ ok: false, message: 'Higgsfield API 키 없음' });
  }

  const { concept, scenes, photo, phase, sceneImageUrls } = req.body || {};

  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, phase: 'video', jobId: 'dummy-' + Date.now() });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';

  try {
    // ── PHASE 2: 디즈니 이미지 → Kling 3.0 Turbo 영상 생성
    if (phase === 'video' && sceneImageUrls && sceneImageUrls.length >= 2) {
      const prompts = await generateVideoPrompts(ANTHROPIC, concept, scenes);
      const jobIds = [];

      for (let i = 0; i < 2; i++) {
        // Kling 3.0 Turbo: image-to-video
        // CLI: higgsfield generate create kling3_0 --start-image ./first.png --duration 5 --mode pro
        const body = {
          prompt: prompts[i],
          start_image: sceneImageUrls[i],  // Kling 파라미터
          duration: 5,
          mode: 'pro',
          sound: 'off'
        };

        const r = await fetch(BASE + '/kling3_0_turbo', {
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
        console.log('Kling 씬' + (i+1) + ' (' + r.status + '):', txt.slice(0, 200));

        // Kling 실패 시 DoP Lite 폴백
        if (!r.ok) {
          console.warn('Kling 실패, DoP Lite 폴백');
          const r2 = await fetch(BASE + '/higgsfield-ai/dop/lite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
            body: JSON.stringify({ image_url: sceneImageUrls[i], prompt: prompts[i] })
          });
          const txt2 = await r2.text();
          console.log('DoP 폴백 씬' + (i+1) + ' (' + r2.status + '):', txt2.slice(0, 200));
          if (!r2.ok) throw new Error('씬' + (i+1) + ' 영상 생성 실패');
          const d2 = JSON.parse(txt2);
          const jid2 = d2.request_id || d2.id;
          if (!jid2) throw new Error('씬' + (i+1) + ' jobId 없음');
          jobIds.push(jid2);
          continue;
        }

        const d = JSON.parse(txt);
        const jid = d.request_id || d.id || d.job_id;
        if (!jid) throw new Error('씬' + (i+1) + ' jobId 없음');
        jobIds.push(jid);
        console.log('Kling 씬' + (i+1) + ' 시작:', jid);
      }

      return res.status(200).json({ ok: true, phase: 'video', jobId: jobIds.join(',') });
    }

    // ── PHASE 1: 사진 업로드 → Nano Banana Pro 디즈니화
    if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터 없음' });
    if (!photo)  return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });

    // 1. imgbb 업로드
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) return res.status(400).json({ ok: false, message: '사진 업로드 실패' });
    console.log('사진 URL:', rawPhotoUrl.slice(0, 80));

    // 2. 씬별 이미지 프롬프트 생성
    const imagePrompts = await generateImagePrompts(ANTHROPIC, concept, scenes);

    // 3. Nano Banana Pro (nano_banana_2) 로 씬별 디즈니 이미지 생성
    // CLI: higgsfield generate create nano_banana_2 --prompt "..." --aspect_ratio 16:9 --resolution 2k
    const nbJobs = [];

    for (let i = 0; i < 2; i++) {
      const body = {
        prompt: imagePrompts[i],
        aspect_ratio: '16:9',
        resolution: '1k',
        // 고객 사진을 reference로 (얼굴 참조)
        reference_image_url: rawPhotoUrl
      };

      const r = await fetch(BASE + '/nano_banana_2', {
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
      console.log('NB Pro 씬' + (i+1) + ' (' + r.status + '):', txt.slice(0, 250));

      if (r.ok) {
        const d = JSON.parse(txt);
        // 즉시 완료 (이미지 URL 바로 반환)
        const imgUrl = d.url || d.image_url ||
          (d.images && d.images[0] && d.images[0].url) ||
          (d.result && d.result.url) ||
          (d.data && d.data.url);

        if (imgUrl) {
          nbJobs.push({ done: true, url: imgUrl });
          console.log('NB Pro 씬' + (i+1) + ' 즉시 완료:', imgUrl.slice(0, 80));
          continue;
        }

        // 비동기 (jobId 반환)
        const jid = d.request_id || d.id || d.job_id;
        if (jid) {
          nbJobs.push({ done: false, jobId: jid });
          console.log('NB Pro 씬' + (i+1) + ' 비동기:', jid);
          continue;
        }
      }

      // 실패 → 실사 폴백
      console.warn('NB Pro 씬' + (i+1) + ' 실패 (status:' + r.status + ') → 실사 폴백');
      nbJobs.push({ done: true, url: rawPhotoUrl });
    }

    return res.status(200).json({
      ok: true,
      phase: 'nanoBanana',
      nbJobs: nbJobs,
      rawPhotoUrl: rawPhotoUrl
    });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── Nano Banana Pro 이미지 프롬프트 (웹 UI 성공 패턴 기반)
async function generateImagePrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  // 웹 UI 성공 프롬프트: "Transform this couple photo into 3D animated Pixar-style characters..."
  const BASE_STYLE = 'Transform this couple photo into 3D animated Pixar-style characters, warm cinematic lighting, romantic mood, keep the same people and poses';

  const SCENE_CONFIGS = [
    { scene: 'cozy cafe interior, couple meeting for the first time, eyes meeting across the room, warm golden afternoon sunlight', no: 'NO ring, NO proposal' },
    { scene: 'cinema interior, couple on first date sitting side by side, gently holding hands, soft warm cinema glow', no: 'NO ring, NO proposal' },
    { scene: 'narrow alley at night near apartment, warm street lamp glowing, couple standing close, first kiss moment', no: 'NO ring, NO proposal' },
    { scene: 'beautiful travel destination, couple walking together joyfully, golden hour lighting', no: 'NO ring, NO proposal' },
    { scene: 'indoor home setting, couple sitting apart, sulky expressions, bittersweet moment', no: 'NO ring, NO proposal' },
    { scene: 'couple reconciling with warm apologetic smiles, soft lighting', no: 'NO ring, NO proposal' },
    { scene: 'cozy everyday moment together, comfortable and happy atmosphere', no: 'NO ring, NO proposal' },
    { scene: 'romantic setting at sunset, man looking nervous with hidden ring, woman smiling unaware', no: 'ring hidden in pocket' },
    { scene: 'magical proposal moment on beach at sunset, man on one knee with sparkling ring, woman with tears of joy', no: '' },
    { scene: 'couple embracing joyfully after proposal, golden light, fairytale ending', no: '' },
  ];

  function buildPrompt(sceneInput, idx) {
    const cfg = SCENE_CONFIGS[Math.min(idx, SCENE_CONFIGS.length - 1)];
    const userCtx = sceneInput ? sceneInput + ', ' : '';
    return BASE_STYLE + ', ' + userCtx + cfg.scene + (cfg.no ? ', ' + cfg.no : '');
  }

  const defaults = [buildPrompt(s.s1, 0), buildPrompt(s.s2, 1)];
  if (!apiKey) return defaults;

  let storyContext = '';
  for (let i = 1; i <= 10; i++) {
    if (s['s'+i]) storyContext += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        system: 'Nano Banana Pro 이미지 프롬프트 전문가.\n성공 패턴: "Transform this couple photo into 3D animated Pixar-style characters, warm cinematic lighting, romantic mood, keep the same people and poses, [씬 상황]"\n규칙: 1)위 패턴으로 시작 2)고객 입력 씬 내용을 장소/행동에 반영 3)NO ring NO proposal 포함(씬9 제외) 4)순수 JSON만',
        messages: [{ role: 'user', content:
          '전체 스토리:\n' + (storyContext || '씬1: 카페 첫 만남\n씬2: 첫 데이트\n') +
          '\n씬1("' + (s.s1||'카페 첫 만남') + '")과 씬2("' + (s.s2||'첫 데이트') + '") 이미지 프롬프트:\n{"prompts":["씬1","씬2"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(b => b.text||'').join('').replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('NB 프롬프트 씬1:', p.prompts[0].slice(0, 80));
      console.log('NB 프롬프트 씬2:', p.prompts[1].slice(0, 80));
      return p.prompts;
    }
    return defaults;
  } catch(e) { return defaults; }
}

// ── Kling 영상 움직임 프롬프트 (웹 UI 성공 프롬프트 기반)
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  // 웹 UI 성공 프롬프트 패턴
  const defaults = [
    'Gentle cinematic push-in, subtle romantic motion, the couple gazing warmly, soft glowing light particles floating, tender heartwarming atmosphere',
    'Slow cinematic pan, warm golden light, the couple sharing a tender moment, soft bokeh, emotional romantic atmosphere'
  ];

  if (!apiKey) return defaults;

  let storyContext = '';
  for (let i = 1; i <= 10; i++) {
    if (s['s'+i]) storyContext += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: 'Kling 3.0 Turbo 영상 프롬프트 전문가. 성공 패턴: "Gentle cinematic push-in, subtle romantic motion, [씬 분위기], soft glowing light particles floating, tender heartwarming atmosphere" 카메라 움직임과 분위기 위주, 40단어 이내. 순수 JSON만.',
        messages: [{ role: 'user', content:
          '씬1: "' + (s.s1||'카페 첫 만남') + '"\n씬2: "' + (s.s2||'첫 데이트') + '"\n{"prompts":["씬1","씬2"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(b => b.text||'').join('').replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) return p.prompts;
    return defaults;
  } catch(e) { return defaults; }
}

// ── imgbb 업로드
async function uploadToImgbb(base64DataUrl, imgbbKey) {
  try {
    const base64Data = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
    if (imgbbKey) {
      const form = new URLSearchParams();
      form.append('image', base64Data);
      form.append('expiration', '600');
      const r = await fetch('https://api.imgbb.com/1/upload?key=' + imgbbKey, { method: 'POST', body: form });
      const d = await r.json();
      if (r.ok && d.data && d.data.url) return d.data.url;
    }
    const form2 = new URLSearchParams();
    form2.append('source', base64Data);
    form2.append('type', 'base64');
    form2.append('action', 'upload');
    form2.append('format', 'json');
    const r2 = await fetch('https://freeimage.host/api/1/upload?key=6d207e02198a847aa98d0a2a901485a5', { method: 'POST', body: form2 });
    const d2 = await r2.json();
    if (r2.ok && d2.image && d2.image.url) return d2.image.url;
    return null;
  } catch(e) { console.warn('업로드 오류:', e.message); return null; }
}
