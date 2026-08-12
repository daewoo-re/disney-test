// ══════════════════════════════════════════════
// /api/preview.js
// 파이프라인:
// PHASE 1: 고객 사진 → NB Pro → 캐릭터 보드 생성
// PHASE 2: 캐릭터 보드 → NB Pro × 2 → 씬1·씬2 이미지
// PHASE 3: 씬 이미지 × 2 → Kling 3.0 Turbo → 씬1·씬2 영상
//
// 브라우저 폴링 구조:
// - PHASE 1,2: 브라우저가 /api/preview/{jobId} 폴링 (이미지 완료 감지)
// - PHASE 3: 브라우저가 /api/preview/{jobId1,jobId2} 폴링 (영상 완료 감지)
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

  const { phase, concept, scenes, photo, charBoardUrl, sceneImageUrls } = req.body || {};

  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, phase: 'video', jobId: 'dummy-' + Date.now() });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';

  try {

    // ══════════════════════════════════════════
    // PHASE 3: 씬 이미지 → Kling 영상 생성
    // ══════════════════════════════════════════
    if (phase === 'video' && sceneImageUrls && sceneImageUrls.length >= 2) {
      const prompts = await generateVideoPrompts(ANTHROPIC, concept, scenes);
      const jobIds = [];

      for (let i = 0; i < 2; i++) {
        let jobId = null;

        // Kling 3.0 Turbo 시도
        const klingBody = {
          prompt: prompts[i],
          start_image: sceneImageUrls[i],
          duration: 5,
          mode: 'pro',
          sound: 'off'
        };

        const rKling = await fetch(BASE + '/kling3_0_turbo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
          body: JSON.stringify(klingBody)
        });
        const txtKling = await rKling.text();
        console.log('Kling 씬' + (i+1) + ' (' + rKling.status + '):', txtKling.slice(0, 200));

        if (rKling.ok) {
          const d = JSON.parse(txtKling);
          jobId = d.request_id || d.id || d.job_id;
        }

        // Kling 실패 → DoP Lite 폴백
        if (!jobId) {
          console.warn('Kling 실패, DoP Lite 폴백');
          const rDop = await fetch(BASE + '/higgsfield-ai/dop/lite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
            body: JSON.stringify({ image_url: sceneImageUrls[i], prompt: prompts[i] })
          });
          const txtDop = await rDop.text();
          console.log('DoP 폴백 씬' + (i+1) + ' (' + rDop.status + '):', txtDop.slice(0, 200));
          if (!rDop.ok) throw new Error('씬' + (i+1) + ' 영상 생성 실패');
          const d = JSON.parse(txtDop);
          jobId = d.request_id || d.id;
        }

        if (!jobId) throw new Error('씬' + (i+1) + ' jobId 없음');
        jobIds.push(jobId);
        console.log('영상 씬' + (i+1) + ' 시작:', jobId);
      }

      return res.status(200).json({ ok: true, phase: 'video', jobId: jobIds.join(',') });
    }

    // ══════════════════════════════════════════
    // PHASE 2: 캐릭터 보드 → 씬별 이미지 생성
    // ══════════════════════════════════════════
    if (phase === 'sceneImage' && charBoardUrl && scenes) {
      const imagePrompts = await generateImagePrompts(ANTHROPIC, concept, scenes);
      const sceneJobs = [];

      for (let i = 0; i < 2; i++) {
        // 캐릭터 보드를 reference로 사용하여 씬 이미지 생성
        const body = {
          prompt: imagePrompts[i],
          aspect_ratio: '16:9',
          resolution: '1k',
          reference_image_url: charBoardUrl   // 캐릭터 보드 reference
        };

        const r = await fetch(BASE + '/nano_banana_2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
          body: JSON.stringify(body)
        });
        const txt = await r.text();
        console.log('씬이미지' + (i+1) + ' (' + r.status + '):', txt.slice(0, 200));

        if (r.ok) {
          const d = JSON.parse(txt);
          const imgUrl = d.url || d.image_url || (d.images && d.images[0] && d.images[0].url) || (d.data && d.data.url);
          if (imgUrl) { sceneJobs.push({ done: true, url: imgUrl }); continue; }
          const jid = d.request_id || d.id;
          if (jid) { sceneJobs.push({ done: false, jobId: jid }); continue; }
        }

        // 실패 → 캐릭터 보드 자체를 폴백
        console.warn('씬이미지' + (i+1) + ' 실패 → 캐릭터 보드 폴백');
        sceneJobs.push({ done: true, url: charBoardUrl });
      }

      return res.status(200).json({ ok: true, phase: 'sceneImage', sceneJobs });
    }

    // ══════════════════════════════════════════
    // PHASE 1: 고객 사진 → 캐릭터 보드 생성
    // ══════════════════════════════════════════
    if (!photo) return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });
    if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터 없음' });

    // 1. 고객 사진 imgbb 업로드
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) return res.status(400).json({ ok: false, message: '사진 업로드 실패' });
    console.log('사진 URL:', rawPhotoUrl.slice(0, 80));

    // 2. NB Pro로 캐릭터 보드 생성
    // 고객 얼굴 기반 디즈니 픽사 스타일 캐릭터 시트
    const charBoardPrompt =
      'Transform this couple photo into Disney Pixar 3D animated style characters, ' +
      'character reference sheet showing the same two characters from multiple angles, ' +
      'front view and 3/4 view, full body portrait, ' +
      'warm expressive eyes, smooth skin, romantic couple aesthetic, ' +
      'clean white background, masterpiece, ultra detailed, ' +
      'consistent character design, same faces same proportions';

    const rChar = await fetch(BASE + '/nano_banana_2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': auth, 'User-Agent': 'higgsfield-server-js/2.0' },
      body: JSON.stringify({
        prompt: charBoardPrompt,
        aspect_ratio: '16:9',
        resolution: '1k',
        reference_image_url: rawPhotoUrl
      })
    });

    const txtChar = await rChar.text();
    console.log('캐릭터 보드 (' + rChar.status + '):', txtChar.slice(0, 250));

    if (rChar.ok) {
      const d = JSON.parse(txtChar);
      // 즉시 완료
      const imgUrl = d.url || d.image_url || (d.images && d.images[0] && d.images[0].url) || (d.data && d.data.url);
      if (imgUrl) {
        console.log('캐릭터 보드 즉시 완료:', imgUrl.slice(0, 80));
        return res.status(200).json({ ok: true, phase: 'charBoard', done: true, charBoardUrl: imgUrl, rawPhotoUrl });
      }
      // 비동기
      const jid = d.request_id || d.id;
      if (jid) {
        console.log('캐릭터 보드 비동기:', jid);
        return res.status(200).json({ ok: true, phase: 'charBoard', done: false, charBoardJobId: jid, rawPhotoUrl });
      }
    }

    // 캐릭터 보드 실패 → 원본 사진으로 진행
    console.warn('캐릭터 보드 실패, 원본 사진으로 진행');
    return res.status(200).json({ ok: true, phase: 'charBoard', done: true, charBoardUrl: rawPhotoUrl, rawPhotoUrl });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── NB Pro 씬 이미지 프롬프트 생성
async function generateImagePrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  const BASE_STYLE = 'Disney Pixar 3D animated style, same characters from the reference, warm cinematic lighting, romantic mood';

  const SCENE_CONFIGS = [
    { scene: 'cozy cafe interior, couple meeting for the first time, eyes meeting across the room, warm golden sunlight, soft bokeh', no: 'NO ring, NO proposal' },
    { scene: 'cinema interior, first date, couple sitting side by side gently holding hands, soft warm cinema glow', no: 'NO ring, NO proposal' },
    { scene: 'narrow alley at night, warm street lamp, couple standing very close, first kiss moment, night bokeh', no: 'NO ring, NO proposal' },
    { scene: 'beautiful travel destination, couple walking together joyfully, golden hour lighting', no: 'NO ring, NO proposal' },
    { scene: 'indoor home setting, couple sitting apart with sulky expressions, bittersweet moment', no: 'NO ring, NO proposal' },
    { scene: 'couple reconciling with warm apologetic smiles, soft lighting', no: 'NO ring, NO proposal' },
    { scene: 'cozy everyday moment together, comfortable and happy, warm home atmosphere', no: 'NO ring, NO proposal' },
    { scene: 'romantic setting at sunset, man looking nervous, woman smiling unaware', no: 'ring hidden in pocket' },
    { scene: 'magical proposal on beach at sunset, man on one knee with sparkling ring, woman with tears of joy', no: '' },
    { scene: 'couple embracing joyfully after proposal, golden light, fairytale ending', no: '' },
  ];

  function buildPrompt(sceneInput, idx) {
    const cfg = SCENE_CONFIGS[Math.min(idx, SCENE_CONFIGS.length - 1)];
    const userCtx = sceneInput ? sceneInput + ', ' : '';
    return BASE_STYLE + ', ' + userCtx + cfg.scene + (cfg.no ? ', ' + cfg.no : '');
  }

  const defaults = [buildPrompt(s.s1, 0), buildPrompt(s.s2, 1)];
  if (!apiKey) return defaults;

  let storyCtx = '';
  for (let i = 1; i <= 10; i++) {
    if (s['s'+i]) storyCtx += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 800,
        system: 'Nano Banana Pro 이미지 프롬프트 전문가.\n패턴: "Disney Pixar 3D animated style, same characters from the reference, warm cinematic lighting, romantic mood, [고객 입력 내용], [씬 상황], NO ring NO proposal"\n규칙: 1)패턴으로 시작 2)고객 입력 내용 반영 3)씬 상황 구체적으로 4)순수 JSON만',
        messages: [{ role: 'user', content:
          '전체 스토리:\n' + (storyCtx || '씬1: 카페 첫 만남\n씬2: 첫 데이트\n') +
          '\n씬1("' + (s.s1||'카페 첫 만남') + '")과 씬2("' + (s.s2||'첫 데이트') + '") 이미지 프롬프트:\n{"prompts":["씬1","씬2"]}'
        }]
      })
    });
    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(b => b.text||'').join('').replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('씬1 프롬프트:', p.prompts[0].slice(0, 80));
      console.log('씬2 프롬프트:', p.prompts[1].slice(0, 80));
      return p.prompts;
    }
    return defaults;
  } catch(e) { return defaults; }
}

// ── Kling 영상 움직임 프롬프트
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  const defaults = [
    'Gentle cinematic push-in, subtle romantic motion, the couple gazing warmly, soft glowing light particles floating, tender heartwarming atmosphere',
    'Slow cinematic pan, warm golden light, the couple sharing a tender moment, soft bokeh, emotional romantic atmosphere'
  ];

  if (!apiKey) return defaults;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: 'Kling 영상 프롬프트 전문가. 패턴: "Gentle cinematic [움직임], [씬 분위기], soft glowing light particles floating, tender heartwarming atmosphere" 40단어 이내. 순수 JSON만.',
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
