// ══════════════════════════════════════════════
// /api/preview.js
// 씬별 Soul 이미지 생성 → DoP 영상 변환
// Soul: 씬 상황이 담긴 디즈니 이미지 생성
// DoP: 해당 이미지에 움직임만 추가
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

  const { concept, scenes, photo, phase, soulJobIds, sceneImageUrls } = req.body || {};

  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, phase: 'video', jobId: 'dummy-' + Date.now() });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE = 'https://platform.higgsfield.ai';
  const CHAR_BOARD_URL = 'https://disney-test-phi.vercel.app/character-board.png';

  try {
    // ── PHASE 3: 씬 이미지 완성 → DoP 영상 생성
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

    // ── PHASE 1: 사진 업로드 → 씬별 Soul 이미지 생성 요청
    if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터 없음' });
    if (!photo)  return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요.' });

    // 사진 업로드
    const rawPhotoUrl = await uploadToImgbb(photo, IMGBB_KEY);
    if (!rawPhotoUrl) return res.status(400).json({ ok: false, message: '사진 업로드 실패' });
    console.log('사진 URL:', rawPhotoUrl.slice(0, 80));

    // 씬별 Soul 이미지 프롬프트 생성
    const soulPrompts = await generateSoulPrompts(ANTHROPIC, concept, scenes);
    const soulJobList = [];

    for (let i = 0; i < 2; i++) {
      const body = {
        prompt: soulPrompts[i],
        reference_image_url: CHAR_BOARD_URL,
        input_image_url: rawPhotoUrl,
        reference_strength: 0.85
      };

      const r = await fetch(BASE + '/higgsfield-ai/soul/cinema', {
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
      console.log('Soul 씬' + (i+1) + ' (' + r.status + '):', txt.slice(0, 200));

      if (r.ok) {
        const d = JSON.parse(txt);
        // 즉시 완료
        const imgUrl = d.url || d.image_url || (d.images && d.images[0] && d.images[0].url);
        if (imgUrl) {
          soulJobList.push({ done: true, url: imgUrl });
          console.log('Soul 씬' + (i+1) + ' 즉시 완료:', imgUrl.slice(0, 60));
          continue;
        }
        // 비동기
        const jid = d.request_id || d.id;
        if (jid) { soulJobList.push({ done: false, jobId: jid }); continue; }
      }

      // 실패 → 실사 사용
      console.warn('Soul 씬' + (i+1) + ' 실패 → 실사 사용');
      soulJobList.push({ done: true, url: rawPhotoUrl });
    }

    return res.status(200).json({
      ok: true,
      phase: 'soul',
      soulJobs: soulJobList,
      rawPhotoUrl: rawPhotoUrl
    });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── Soul 이미지 프롬프트 (s1~s10 전체 컨텍스트 반영, 영상은 s1~s2만)
async function generateSoulPrompts(apiKey, concept, scenes) {
  // s1~s10 전체 수집
  const s = {};
  for (var i = 1; i <= 10; i++) {
    s['s'+i] = (scenes && scenes['s'+i]) || '';
  }
  const customerName = (scenes && scenes.customerName) || '';

  const CHAR_BASE =
    'Disney Pixar 3D animated movie style, Korean young adult couple, ' +
    'character consistency, same characters throughout, ' +
    'male: tall handsome Korean man with medium wavy dark brown hair, warm brown eyes, gentle face, ' +
    'female: beautiful Korean woman with shoulder-length wavy dark brown hair, large bright eyes, warm smile, ' +
    'Disney princess and prince aesthetic, large expressive eyes, smooth porcelain skin, ' +
    'clean and minimal styling, natural and elegant, ' +
    'masterpiece, ultra detailed, high quality 3D CG animation';

  // 씬별 의상 + 배경 설정 (s1~s10 대응)
  const SCENE_CONFIGS = [
    { // s1: 첫 만남
      outfit_m: 'simple white t-shirt, light beige chinos, white sneakers',
      outfit_f: 'soft pastel blouse, light blue jeans, white sneakers',
      vibe: 'casual clean everyday look',
      fallback_scene: 'warm cozy cafe interior, couple meeting for the first time, eyes meeting across the room, nervous excited expressions, warm golden sunlight, soft bokeh',
      no: 'NO ring, NO proposal'
    },
    { // s2: 첫 데이트
      outfit_m: 'neat navy blue crewneck sweater, dark slim pants, clean sneakers',
      outfit_f: 'simple knit top, midi skirt, ballet flats',
      vibe: 'smart casual date look',
      fallback_scene: 'cozy cinema interior, couple sitting side by side, man gently holding the woman hand, soft warm cinema lighting',
      no: 'NO ring, NO proposal'
    },
    { // s3: 첫키스
      outfit_m: 'light grey hoodie, slim jeans, sneakers',
      outfit_f: 'cozy oversized cardigan, simple dress, sneakers',
      vibe: 'relaxed cozy evening look',
      fallback_scene: 'narrow quiet alley at night, warm street lamp, couple standing face to face, first kiss moment, night bokeh',
      no: 'NO ring, NO proposal'
    },
    { // s4: 여행
      outfit_m: 'linen shirt, comfortable travel pants, sneakers, small backpack',
      outfit_f: 'flowy summer dress, comfortable sandals, crossbody bag',
      vibe: 'casual comfortable travel look',
      fallback_scene: 'beautiful scenic travel destination, couple walking together excited and happy, golden hour warm lighting',
      no: 'NO ring, NO proposal'
    },
    { // s5: 다툼
      outfit_m: 'casual t-shirt, jogger pants',
      outfit_f: 'comfortable casual top, loose pants',
      vibe: 'relaxed home casual look',
      fallback_scene: 'indoor home setting, couple sitting apart, both looking away with sulky expressions, bittersweet atmosphere',
      no: 'NO ring, NO proposal'
    },
    { // s6: 화해
      outfit_m: 'clean simple shirt, casual pants',
      outfit_f: 'soft casual blouse, comfortable pants',
      vibe: 'warm casual look',
      fallback_scene: 'couple facing each other with apologetic warm smiles, reconciliation moment, soft warm lighting',
      no: 'NO ring, NO proposal'
    },
    { // s7: 일상
      outfit_m: 'cozy knit sweater, casual pants',
      outfit_f: 'soft casual dress, cardigan',
      vibe: 'cozy everyday look',
      fallback_scene: 'cozy everyday moment together, comfortable and happy, warm home atmosphere',
      no: 'NO ring, NO proposal'
    },
    { // s8: 프로포즈 직전
      outfit_m: 'neat dress shirt, slacks, clean shoes',
      outfit_f: 'elegant simple dress, heels',
      vibe: 'smart elegant look',
      fallback_scene: 'romantic setting at sunset, man looking nervous and excited, woman smiling unaware',
      no: 'NO ring visible yet'
    },
    { // s9: 프로포즈
      outfit_m: 'neat dress shirt, slacks',
      outfit_f: 'elegant simple dress',
      vibe: 'elegant romantic look',
      fallback_scene: 'man kneeling with sparkling ring, woman covering mouth with tears of joy, magical romantic moment, sunset background',
      no: ''
    },
    { // s10: 엔딩
      outfit_m: 'neat dress shirt, slacks',
      outfit_f: 'elegant simple dress',
      vibe: 'elegant romantic look',
      fallback_scene: 'couple embracing joyfully, golden light, happily ever after ending, cinematic wide shot',
      no: ''
    },
  ];

  function buildPrompt(sceneInput, configIdx) {
    var cfg = SCENE_CONFIGS[Math.min(configIdx, SCENE_CONFIGS.length - 1)];
    var userContext = sceneInput ? sceneInput + ', ' : '';
    return CHAR_BASE + ', ' +
      'male wearing ' + cfg.outfit_m + ', ' +
      'female wearing ' + cfg.outfit_f + ', ' +
      cfg.vibe + ', ' +
      userContext +
      cfg.fallback_scene +
      (cfg.no ? ', ' + cfg.no : '');
  }

  // 기본값: s1~s2 각 입력값 반영
  var defaults = [
    buildPrompt(s.s1, 0),
    buildPrompt(s.s2, 1)
  ];

  if (!apiKey) return defaults;

  // s1~s10 전체 스토리 컨텍스트 구성 (Claude에게 전체 흐름 전달)
  var storyContext = '';
  for (var i = 1; i <= 10; i++) {
    if (s['s'+i]) storyContext += '씬' + i + ': "' + s['s'+i] + '"\n';
  }

  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: 'Higgsfield Soul Cinema 이미지 생성용 프롬프트 전문가.\n' +
          '전체 스토리 흐름(씬1~씬10)을 파악하고, 씬1·씬2 이미지 프롬프트를 작성합니다.\n' +
          '규칙:\n' +
          '1. CHAR_BASE로 시작\n' +
          '2. 씬에 맞는 자연스럽고 깔끔한 의상 선택\n' +
          '3. 고객이 입력한 씬 내용을 장소/상황에 반드시 반영\n' +
          '4. 반드시 NO ring, NO proposal 포함 (씬9 프로포즈 씬 제외)\n' +
          '5. 150단어 이내\n' +
          '6. 순수 JSON만 응답',
        messages: [{
          role: 'user',
          content: 'CHAR_BASE: "' + CHAR_BASE + '"\n\n' +
            '전체 스토리 흐름:\n' + (storyContext || '씬1: 카페 첫 만남\n씬2: 첫 데이트\n') + '\n' +
            '컨셉: ' + (concept || 'propose') + '\n' +
            (customerName ? '고객 이름: ' + customerName + '\n' : '') +
            '\n영상으로 만들 씬: 씬1, 씬2\n' +
            '씬1("' + (s.s1 || '카페에서 처음 만나는 순간') + '")과 ' +
            '씬2("' + (s.s2 || '첫 데이트') + '")의 이미지 프롬프트를 작성하세요.\n' +
            '고객 입력 내용을 장소/상황에 구체적으로 반영하세요.\n' +
            '{"prompts":["씬1 이미지 프롬프트","씬2 이미지 프롬프트"]}'
        }]
      })
    });

    if (!r.ok) return defaults;
    var d = await r.json();
    var raw = d.content.map(function(b){ return b.text||''; }).join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    var p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('Soul 씬1:', p.prompts[0].slice(0, 80));
      console.log('Soul 씬2:', p.prompts[1].slice(0, 80));
      return p.prompts;
    }
    return defaults;
  } catch(e) {
    console.warn('Soul 프롬프트 생성 실패:', e.message);
    return defaults;
  }
}

// ── DoP 영상 움직임 프롬프트 (s1~s10 컨텍스트, 영상은 s1~s2만)
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s = {};
  for (var i = 1; i <= 10; i++) {
    s['s'+i] = (scenes && scenes['s'+i]) || '';
  }

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
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: 'Higgsfield DoP 영상 프롬프트 전문가. 이미지 기반이므로 카메라 움직임과 분위기만 30단어 이내로 간결하게. 순수 JSON만 응답.',
        messages: [{
          role: 'user',
          content: '전체 스토리:\n' + (storyContext || '씬1: 카페 첫 만남\n씬2: 첫 데이트\n') +
            '\n씬1("' + (s.s1||'카페 첫 만남') + '")과 씬2("' + (s.s2||'첫 데이트') + '") 카메라 움직임 프롬프트:\n{"prompts":["씬1","씬2"]}'
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

  const CHAR_BASE =
    'Disney Pixar 3D animated movie style, Korean young adult couple, ' +
    'character consistency, same characters throughout, ' +
    'male: tall handsome Korean man with medium wavy dark brown hair, warm brown eyes, gentle face, ' +
    'female: beautiful Korean woman with shoulder-length wavy dark brown hair, large bright eyes, warm smile, ' +
    'Disney princess and prince aesthetic, large expressive eyes, smooth porcelain skin, ' +
    'clean and minimal styling, natural and elegant, ' +
    'masterpiece, ultra detailed, high quality 3D CG animation';

  // 씬 인덱스 기반 의상 + 상황 설정
  const SCENE_CONFIGS = [
    {
      outfit_m: 'simple white t-shirt, light beige chinos, white sneakers',
      outfit_f: 'soft pastel blouse, light blue jeans, white sneakers',
      vibe: 'casual clean everyday look',
      scene: 'wide shot of a warm cozy cafe interior, couple meeting for the first time, man sitting at window seat holding coffee cup looking surprised, woman just walked in, eyes meeting across the room, nervous excited expressions, warm golden afternoon sunlight, soft bokeh background',
      no: 'NO ring, NO proposal'
    },
    {
      outfit_m: 'neat navy blue crewneck sweater, dark slim pants, clean sneakers',
      outfit_f: 'simple knit top, midi skirt, ballet flats',
      vibe: 'smart casual date look',
      scene: 'cozy cinema interior, couple sitting side by side in plush seats, man gently holding the woman hand, woman smiling shyly looking at their hands, soft warm cinema lighting, popcorn on armrest',
      no: 'NO ring, NO proposal'
    },
    {
      outfit_m: 'light grey hoodie, slim jeans, sneakers',
      outfit_f: 'cozy oversized cardigan, simple dress underneath, sneakers',
      vibe: 'relaxed cozy evening look',
      scene: 'narrow quiet alley at night near apartment entrance, warm street lamp glowing softly, couple standing face to face very close, man leaning in gently for a first kiss, woman eyes closing softly, night bokeh lights in background',
      no: 'NO ring, NO proposal'
    },
    {
      outfit_m: 'linen shirt, comfortable travel pants, sneakers, small backpack',
      outfit_f: 'flowy summer dress, comfortable sandals, crossbody bag',
      vibe: 'casual comfortable travel look',
      scene: 'beautiful scenic travel destination, couple walking together excited and happy, stunning landscape background, golden hour warm lighting, bright joyful smiles',
      no: 'NO ring, NO proposal'
    },
    {
      outfit_m: 'casual t-shirt, jogger pants, home casual look',
      outfit_f: 'comfortable casual top, loose pants, indoor casual look',
      vibe: 'relaxed home casual look',
      scene: 'indoor home setting, couple sitting apart with visible distance between them, both looking away with sulky expressions, man looking guilty, woman pouting, soft warm home lighting, bittersweet atmosphere',
      no: 'NO ring, NO proposal'
    },
  ];

  // 씬 입력값 기반으로 가장 맞는 config 선택 (기본: 씬1=config0, 씬2=config1)
  function buildPrompt(sceneInput, configIdx) {
    var cfg = SCENE_CONFIGS[Math.min(configIdx, SCENE_CONFIGS.length-1)];
    var userContext = sceneInput ? sceneInput + ', ' : '';
    return CHAR_BASE + ', ' +
      'male wearing ' + cfg.outfit_m + ', ' +
      'female wearing ' + cfg.outfit_f + ', ' +
      cfg.vibe + ', ' +
      userContext +
      cfg.scene + ', ' +
      cfg.no;
  }

  // Claude 없이도 기본값으로 정확한 씬 생성
  var defaults = [
    buildPrompt(s1, 0),
    buildPrompt(s2, 1)
  ];

  if (!apiKey) return defaults;

  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'Higgsfield Soul Cinema 이미지 생성용 프롬프트 전문가.\n' +
          '씬 상황이 담긴 정지 이미지 프롬프트를 작성합니다.\n' +
          '규칙:\n' +
          '1. CHAR_BASE로 시작 후 의상(outfit) 추가\n' +
          '2. 씬 상황(장소+행동) 구체적으로 묘사\n' +
          '3. 씬에 맞는 자연스럽고 깔끔한 의상 선택 (과하지 않게)\n' +
          '4. 반드시 NO ring, NO proposal 포함 (마지막 프로포즈 씬 제외)\n' +
          '5. 순수 JSON만 응답',
        messages: [{
          role: 'user',
          content: 'CHAR_BASE: "' + CHAR_BASE + '"\n\n' +
            '씬1: "' + (s1 || '카페에서 처음 만나는 순간') + '"\n' +
            '씬2: "' + (s2 || '영화관에서 손을 잡는 순간') + '"\n' +
            '컨셉: ' + (concept || 'propose') + '\n\n' +
            'CHAR_BASE를 앞에 붙이고, 씬에 어울리는 자연스러운 의상과 상황 묘사.\n' +
            '150단어 이내. NO ring NO proposal 필수.\n' +
            '{"prompts":["씬1","씬2"]}'
        }]
      })
    });

    if (!r.ok) return defaults;
    var d = await r.json();
    var raw = d.content.map(function(b){ return b.text||''; }).join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    var p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('Soul 씬1 프롬프트:', p.prompts[0].slice(0,80));
      console.log('Soul 씬2 프롬프트:', p.prompts[1].slice(0,80));
      return p.prompts;
    }
    return defaults;
  } catch(e) {
    console.warn('Soul 프롬프트 생성 실패:', e.message);
    return defaults;
  }
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
