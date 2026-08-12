// ══════════════════════════════════════════════
// /api/preview.js
// PHASE 1: Nano Banana Pro → 디즈니 픽사 스타일 이미지 변환
// PHASE 2: DoP Lite → 이미지를 영상으로 변환
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
    // ── PHASE 2: 씬 이미지 완성 → DoP 영상 생성
    if (phase === 'video' && sceneImageUrls && sceneImageUrls.length >= 2) {
      const prompts = await generateVideoPrompts(ANTHROPIC, concept, scenes);
      const jobIds = [];

      for (let i = 0; i < 2; i++) {
        const r = await fetch(BASE + '/higgsfield-ai/dop/lite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': auth,
            'User-Agent': 'higgsfield-server-js/2.0'
          },
          body: JSON.stringify({
            image_url: sceneImageUrls[i],
            prompt: prompts[i]
          })
        });
        const txt = await r.text();
        console.log('DoP 씬' + (i+1) + ' (' + r.status + '):', txt.slice(0, 150));
        if (!r.ok) throw new Error('DoP 씬' + (i+1) + ' 실패: ' + txt.slice(0, 100));
        const d = JSON.parse(txt);
        const jid = d.request_id || d.id;
        if (!jid) throw new Error('씬' + (i+1) + ' jobId 없음');
        jobIds.push(jid);
      }

      return res.status(200).json({ ok: true, phase: 'video', jobId: jobIds.join(',') });
    }

    // ── PHASE 1: 사진 업로드 → Nano Banana Pro 디즈니화 → jobIds 반환
    if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터 없음' });
    if (!photo)  return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });

    // 1. 사진 imgbb 업로드
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) return res.status(400).json({ ok: false, message: '사진 업로드 실패' });
    console.log('사진 URL:', rawPhotoUrl.slice(0, 80));

    // 2. 씬별 이미지 프롬프트 생성
    const imagePrompts = await generateImagePrompts(ANTHROPIC, concept, scenes);

    // 3. Nano Banana Pro로 씬별 디즈니 이미지 생성 (2개)
    const nbJobs = [];
    for (let i = 0; i < 2; i++) {
      const body = {
        prompt: imagePrompts[i],
        // 고객 사진을 reference로 사용 (얼굴 참조)
        reference_image_url: rawPhotoUrl,
        aspect_ratio: '16:9',
        resolution: '1k'
      };

      // Nano Banana Pro 슬러그 시도 순서
      const slugs = [
        'nano-banana-pro',
        'nano_banana_pro',
        'higgsfield-ai/nano-banana/pro',
        'higgsfield-ai/nano/banana/pro',
      ];

      let jobDone = false;
      for (const slug of slugs) {
        const r = await fetch(BASE + '/' + slug, {
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
        console.log('NB Pro 씬' + (i+1) + ' [' + slug + '] (' + r.status + '):', txt.slice(0, 200));

        if (r.ok) {
          const d = JSON.parse(txt);
          // 즉시 완료
          const imgUrl = d.url || d.image_url ||
            (d.images && d.images[0] && d.images[0].url) ||
            (d.data && d.data.url);
          if (imgUrl) {
            nbJobs.push({ done: true, url: imgUrl });
            console.log('NB Pro 씬' + (i+1) + ' 즉시 완료:', imgUrl.slice(0, 60));
            jobDone = true; break;
          }
          // 비동기
          const jid = d.request_id || d.id || d.job_id;
          if (jid) {
            nbJobs.push({ done: false, jobId: jid });
            console.log('NB Pro 씬' + (i+1) + ' 비동기:', jid);
            jobDone = true; break;
          }
        }

        if (r.status !== 404) break; // 404가 아닌 오류면 다음 슬러그 시도 안 함
      }

      if (!jobDone) {
        // 모든 슬러그 실패 → 실사 사진으로 폴백
        console.warn('NB Pro 씬' + (i+1) + ' 실패 → 실사 폴백');
        nbJobs.push({ done: true, url: rawPhotoUrl });
      }
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

// ── Nano Banana Pro 이미지 프롬프트 (웹 UI 성공 프롬프트 기반)
async function generateImagePrompts(apiKey, concept, scenes) {
  const s = {};
  for (var i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  // 웹 UI에서 성공한 프롬프트 구조 기반
  const BASE_STYLE = 'Transform this couple photo into 3D animated Pixar-style characters, warm cinematic lighting, romantic mood, keep the same people and poses';

  const SCENE_CONFIGS = [
    { scene: 'cozy cafe, first meeting, eyes meeting across the room, nervous excitement, golden afternoon sunlight, soft bokeh', no: 'NO ring, NO proposal' },
    { scene: 'cinema interior, first date, couple sitting side by side, gently holding hands, soft warm cinema glow', no: 'NO ring, NO proposal' },
    { scene: 'narrow alley at night, warm street lamp, couple standing close, first kiss moment, night bokeh', no: 'NO ring, NO proposal' },
    { scene: 'beautiful travel destination, couple walking together, golden hour lighting, joyful and excited', no: 'NO ring, NO proposal' },
    { scene: 'indoor setting, couple sitting apart, sulky expressions, bittersweet moment', no: 'NO ring, NO proposal' },
    { scene: 'couple reconciling, warm smiles, apologetic expressions, soft lighting', no: 'NO ring, NO proposal' },
    { scene: 'cozy everyday moment together, comfortable and happy, warm atmosphere', no: 'NO ring, NO proposal' },
    { scene: 'romantic setting at sunset, man looking nervous, woman smiling unaware', no: 'NO ring visible' },
    { scene: 'proposal moment, man on one knee with sparkling ring, woman with tears of joy, magical sunset', no: '' },
    { scene: 'couple embracing joyfully after proposal, golden light, fairytale ending', no: '' },
  ];

  function buildPrompt(sceneInput, configIdx) {
    var cfg = SCENE_CONFIGS[Math.min(configIdx, SCENE_CONFIGS.length - 1)];
    var userCtx = sceneInput ? sceneInput + ', ' : '';
    return BASE_STYLE + ', ' + userCtx + cfg.scene + (cfg.no ? ', ' + cfg.no : '');
  }

  const defaults = [buildPrompt(s.s1, 0), buildPrompt(s.s2, 1)];

  if (!apiKey) return defaults;

  var storyContext = '';
  for (var i = 1; i <= 10; i++) {
    if (s['s'+i]) storyContext += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: 'Nano Banana Pro 이미지 프롬프트 전문가.\n' +
          '성공한 프롬프트 패턴: "Transform this couple photo into 3D animated Pixar-style characters, warm cinematic lighting, romantic mood, keep the same people and poses, [씬 상황]"\n' +
          '규칙: 1) 위 패턴으로 시작 2) 씬 상황 구체적으로 묘사 3) NO ring NO proposal 포함(씬9 제외) 4) 순수 JSON만',
        messages: [{
          role: 'user',
          content: '전체 스토리:\n' + (storyContext || '씬1: 카페 첫 만남\n씬2: 첫 데이트\n') +
            '\n씬1("' + (s.s1||'카페 첫 만남') + '")과 씬2("' + (s.s2||'첫 데이트') + '") 이미지 프롬프트:\n' +
            '{"prompts":["씬1","씬2"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(b => b.text||'').join('').replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('NB 프롬프트 씬1:', p.prompts[0].slice(0,80));
      console.log('NB 프롬프트 씬2:', p.prompts[1].slice(0,80));
      return p.prompts;
    }
    return defaults;
  } catch(e) { return defaults; }
}

// ── DoP 영상 움직임 프롬프트
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s = {};
  for (var i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  const defaults = [
    'slow cinematic zoom in, soft bokeh, romantic atmosphere, warm golden light',
    'gentle camera pan, warm lighting, emotional moment, cinematic motion'
  ];

  if (!apiKey) return defaults;

  var storyContext = '';
  for (var i = 1; i <= 10; i++) {
    if (s['s'+i]) storyContext += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: 'DoP 영상 프롬프트 전문가. 카메라 움직임과 분위기만 30단어 이내. 순수 JSON만.',
        messages: [{
          role: 'user',
          content: '씬1: "' + (s.s1||'카페 첫 만남') + '"\n씬2: "' + (s.s2||'첫 데이트') + '"\n{"prompts":["씬1","씬2"]}'
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
