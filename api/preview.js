// ══════════════════════════════════════════════
// /api/preview.js
// PHASE 1: 고객 사진 → GPT Image 2 → 캐릭터 보드 (디즈니 픽사 스타일)
// PHASE 2: 캐릭터 보드 → GPT Image 2 × 2 → 씬별 이미지
// PHASE 3: 씬 이미지 × 2 → DoP Lite → 영상
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  const HF_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  const IMGBB_KEY = process.env.IMGBB_API_KEY;

  if (!HF_KEY || !HF_SECRET) {
    return res.status(500).json({ ok: false, message: 'Higgsfield API 키 없음' });
  }
  if (!OPENAI_KEY) {
    return res.status(500).json({ ok: false, message: 'OpenAI API 키 없음' });
  }

  const { phase, concept, scenes, photo, charBoardUrl, sceneImageUrls } = req.body || {};

  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, phase: 'video', jobId: 'dummy-' + Date.now() });
  }

  const hfAuth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE   = 'https://platform.higgsfield.ai';

  try {

    // ══════════════════════════════════════════
    // PHASE 3: 씬 이미지 → DoP Lite 영상 생성
    // ══════════════════════════════════════════
    if (phase === 'video' && sceneImageUrls && sceneImageUrls.length >= 2) {
      const prompts = await generateVideoPrompts(ANTHROPIC, concept, scenes);
      const jobIds  = [];

      for (let i = 0; i < 2; i++) {
        const r = await fetch(BASE + '/higgsfield-ai/dop/lite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': hfAuth, 'User-Agent': 'higgsfield-server-js/2.0' },
          body: JSON.stringify({ image_url: sceneImageUrls[i], prompt: prompts[i] })
        });
        const txt = await r.text();
        console.log('DoP 씬' + (i+1) + ' (' + r.status + '):', txt.slice(0, 150));
        if (!r.ok) throw new Error('DoP 씬' + (i+1) + ' 실패: ' + txt.slice(0, 100));
        const d   = JSON.parse(txt);
        const jid = d.request_id || d.id;
        if (!jid) throw new Error('씬' + (i+1) + ' jobId 없음');
        jobIds.push(jid);
        console.log('영상 씬' + (i+1) + ' 시작:', jid);
      }

      return res.status(200).json({ ok: true, phase: 'video', jobId: jobIds.join(',') });
    }

    // ══════════════════════════════════════════
    // PHASE 2: 캐릭터 보드 → 씬별 이미지 생성
    // ══════════════════════════════════════════
    if (phase === 'sceneImage' && charBoardUrl && scenes) {
      const imagePrompts = await generateImagePrompts(ANTHROPIC, concept, scenes);
      const sceneJobs    = [];

      for (let i = 0; i < 2; i++) {
        // 캐릭터 보드를 reference로 씬 이미지 생성
        const imageUrl = await generateGPTImage(OPENAI_KEY, imagePrompts[i], charBoardUrl);
        if (imageUrl) {
          sceneJobs.push({ done: true, url: imageUrl });
          console.log('씬이미지' + (i+1) + ' 완료:', imageUrl.slice(0, 80));
        } else {
          // 실패 시 캐릭터 보드 폴백
          console.warn('씬이미지' + (i+1) + ' 실패 → 캐릭터 보드 폴백');
          sceneJobs.push({ done: true, url: charBoardUrl });
        }
      }

      return res.status(200).json({ ok: true, phase: 'sceneImage', sceneJobs });
    }

    // ══════════════════════════════════════════
    // PHASE 1: 고객 사진 → 캐릭터 보드 생성
    // ══════════════════════════════════════════
    if (!photo)  return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });
    if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터 없음' });

    // 1. 고객 사진 imgbb 업로드
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) return res.status(400).json({ ok: false, message: '사진 업로드 실패' });
    console.log('사진 URL:', rawPhotoUrl.slice(0, 80));

    // 2. GPT Image 2로 캐릭터 보드 생성
    const charPrompt =
      'Transform this couple photo into Disney Pixar 3D animated style characters. ' +
      'Create a character reference sheet with the same two people rendered as Disney Pixar animated characters. ' +
      'Show both characters: front view full body portrait. ' +
      'Style: large expressive eyes, smooth skin, warm and charming Disney prince and princess aesthetic. ' +
      'Keep the same faces and likenesses as the photo. Clean white background. ' +
      'Masterpiece quality, ultra detailed 3D CG animation style.';

    const charBoardImageUrl = await generateGPTImage(OPENAI_KEY, charPrompt, rawPhotoUrl);

    if (charBoardImageUrl) {
      console.log('캐릭터 보드 완료:', charBoardImageUrl.slice(0, 80));
      return res.status(200).json({
        ok: true,
        phase: 'charBoard',
        done: true,
        charBoardUrl: charBoardImageUrl,
        rawPhotoUrl
      });
    }

    // 캐릭터 보드 실패 → 원본 사진으로 진행
    console.warn('캐릭터 보드 실패, 원본 사진으로 진행');
    return res.status(200).json({
      ok: true,
      phase: 'charBoard',
      done: true,
      charBoardUrl: rawPhotoUrl,
      rawPhotoUrl
    });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── GPT Image 2 이미지 생성 (동기 — 즉시 반환)
async function generateGPTImage(apiKey, prompt, referenceImageUrl) {
  try {
    // 레퍼런스 이미지를 base64로 다운로드
    let messages_content = [];

    if (referenceImageUrl) {
      // 이미지 URL → base64 변환
      const imgResp = await fetch(referenceImageUrl);
      if (imgResp.ok) {
        const imgBuffer = await imgResp.arrayBuffer();
        const base64    = Buffer.from(imgBuffer).toString('base64');
        const mimeType  = imgResp.headers.get('content-type') || 'image/jpeg';

        messages_content = [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:' + mimeType + ';base64,' + base64 } },
              { type: 'text', text: prompt }
            ]
          }
        ];
      } else {
        messages_content = [{ role: 'user', content: prompt }];
      }
    } else {
      messages_content = [{ role: 'user', content: prompt }];
    }

    // GPT Image 2 API 호출 (최신 플래그십 모델)
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: prompt,
        n: 1,
        size: '1536x1024',
        quality: 'low'
      })
    });

    const txt = await r.text();
    console.log('GPT Image (' + r.status + '):', txt.slice(0, 200));

    if (!r.ok) {
      console.warn('GPT Image 실패:', txt.slice(0, 200));
      return null;
    }

    const d = JSON.parse(txt);
    if (!d.data || !d.data[0]) return null;

    // URL 반환 시
    if (d.data[0].url) return d.data[0].url;

    // b64_json 반환 시 → imgbb 업로드
    if (d.data[0].b64_json) {
      console.log('GPT Image b64_json 반환 → imgbb 업로드');
      const uploaded = await uploadBase64ToImgbb(d.data[0].b64_json, process.env.IMGBB_API_KEY);
      if (uploaded) return uploaded;
      // imgbb 실패 시 data URL로 반환
      return 'data:image/png;base64,' + d.data[0].b64_json;
    }

    return null;
  } catch(e) {
    console.warn('GPT Image 오류:', e.message);
    return null;
  }
}

// ── base64 이미지 → imgbb 업로드
async function uploadBase64ToImgbb(base64, imgbbKey) {
  try {
    if (!imgbbKey) return null;
    const form = new URLSearchParams();
    form.append('image', base64);
    form.append('expiration', '600');
    const r = await fetch('https://api.imgbb.com/1/upload?key=' + imgbbKey, { method: 'POST', body: form });
    const d = await r.json();
    if (r.ok && d.data && d.data.url) return d.data.url;
    return null;
  } catch(e) { return null; }
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

// ── 씬 이미지 프롬프트 (GPT Image 2용)
async function generateImagePrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  const BASE_STYLE =
    'Disney Pixar 3D animated movie style, same characters as in the reference image, ' +
    'warm cinematic lighting, romantic mood, highly detailed, masterpiece quality';

  const SCENE_CONFIGS = [
    { scene: 'cozy cafe interior, couple meeting for the first time, eyes meeting across the room, warm golden afternoon sunlight, soft bokeh background', no: 'NO ring, NO proposal box' },
    { scene: 'cinema interior, couple on first date sitting side by side, man gently holding the woman hand, soft warm cinema glow, popcorn on armrest', no: 'NO ring, NO proposal box' },
    { scene: 'narrow quiet alley at night near apartment entrance, warm street lamp glowing, couple standing face to face very close, first kiss moment, romantic night bokeh', no: 'NO ring, NO proposal box' },
    { scene: 'beautiful scenic travel destination, couple walking together excitedly, golden hour warm lighting, joyful bright smiles', no: 'NO ring, NO proposal box' },
    { scene: 'indoor home setting, couple sitting apart with visible distance, both looking away with sulky expressions, bittersweet emotional atmosphere', no: 'NO ring, NO proposal box' },
    { scene: 'couple reconciling with warm apologetic smiles facing each other, soft warm lighting', no: 'NO ring, NO proposal box' },
    { scene: 'cozy everyday moment together at home, comfortable and happy, warm ambient lighting', no: 'NO ring, NO proposal box' },
    { scene: 'romantic outdoor setting at sunset, man looking nervous and excited, woman smiling warmly unaware', no: 'ring hidden in pocket, not visible' },
    { scene: 'magical proposal moment at sunset beach, man on one knee holding a sparkling ring, woman covering her mouth with tears of joy, golden sky', no: '' },
    { scene: 'couple embracing joyfully after proposal, engagement ring visible, golden cinematic light, fairytale ending wide shot', no: '' },
  ];

  function buildPrompt(input, idx) {
    const cfg    = SCENE_CONFIGS[Math.min(idx, SCENE_CONFIGS.length - 1)];
    const userCtx = input ? input + ', ' : '';
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
        system: 'GPT Image 2 이미지 프롬프트 전문가.\n' +
          '패턴: "Disney Pixar 3D animated movie style, same characters as in the reference image, warm cinematic lighting, romantic mood, [고객 입력 내용], [씬 상황], NO ring NO proposal box"\n' +
          '규칙: 1)패턴으로 시작 2)고객 입력 내용 장소/행동에 반영 3)씬 상황 구체적으로 4)순수 JSON만',
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

// ── DoP 영상 움직임 프롬프트
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s = {};
  for (let i = 1; i <= 10; i++) s['s'+i] = (scenes && scenes['s'+i]) || '';

  const defaults = [
    'Gentle cinematic push-in, subtle romantic motion, soft glowing light particles floating, tender heartwarming atmosphere',
    'Slow cinematic pan, warm golden light, the couple sharing a tender moment, soft bokeh, emotional romantic atmosphere'
  ];

  if (!apiKey) return defaults;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: 'DoP 영상 프롬프트 전문가. 카메라 움직임과 분위기 위주, 40단어 이내. 순수 JSON만.',
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
