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

// ── Soul 이미지 프롬프트 (씬 상황 포함)
async function generateSoulPrompts(apiKey, concept, scenes) {
  const s1 = (scenes && scenes.s1) || '';
  const s2 = (scenes && scenes.s2) || '';
  const customerName = (scenes && scenes.customerName) || '';
  const maleName   = customerName || 'the man';

  const CHAR =
    'Disney Pixar 3D animated movie style, Korean young adult couple, ' +
    'male: wavy dark brown hair, blue denim shirt, khaki pants, white sneakers, ' +
    'female: shoulder-length wavy dark brown hair, pink floral sundress, white sneakers, ' +
    'Disney princess and prince aesthetic, large expressive eyes, smooth porcelain skin, ' +
    'masterpiece, ultra detailed, 3D CG animation';

  // 씬 상황이 담긴 정지 이미지 (DoP가 이걸 움직임으로 변환)
  const defaults = [
    CHAR + ', ' +
    'wide shot of a cozy cafe interior, ' +
    (s1 ? s1 + ', ' : 'couple meeting for the first time, ') +
    maleName + ' sitting at cafe window seat with coffee cup, ' +
    'the woman just walked in, their eyes meeting across the room, ' +
    'surprised and nervous expressions, warm golden sunlight, soft bokeh background, ' +
    'NO ring, NO proposal, just a first meeting moment',

    CHAR + ', ' +
    (s2 ? s2 + ', ' : 'first date scene, ') +
    'couple sitting side by side, ' +
    'romantic moment, warm lighting, gentle smiles, ' +
    'NO ring, NO proposal box, natural casual scene'
  ];

  if (!apiKey) return defaults;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: 'Higgsfield Soul Cinema 이미지 생성용 프롬프트 전문가.\n씬 상황이 담긴 정지 이미지 프롬프트를 작성합니다.\n반드시 지켜야 할 규칙:\n1. 캐릭터: Disney Pixar 3D style, 남자=blue denim shirt/khaki pants, 여자=pink floral sundress\n2. 반드시 씬 상황(장소+행동)을 구체적으로 묘사\n3. 반지/프로포즈 관련 내용 절대 금지 (마지막 씬 제외)\n4. "NO ring NO proposal" 문구 포함\n5. 순수 JSON만 응답',
        messages: [{
          role: 'user',
          content: '씬1: "' + (s1 || '카페에서 처음 만나는 순간') + '"\n' +
            '씬2: "' + (s2 || '첫 데이트') + '"\n' +
            '컨셉: ' + (concept || 'propose') + '\n\n' +
            '각 씬의 상황이 담긴 Disney Pixar 3D 정지 이미지 프롬프트를 작성하세요.\n' +
            '씬 상황(장소, 행동, 분위기)을 매우 구체적으로 묘사하고 반지/프로포즈는 절대 포함하지 마세요.\n' +
            '{"prompts":["씬1 이미지 프롬프트 (150단어 이내)","씬2 이미지 프롬프트 (150단어 이내)"]}'
        }]
      })
    });

    if (!r.ok) return defaults;
    const d = await r.json();
    let raw = d.content.map(function(b){ return b.text||''; }).join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const p = JSON.parse(raw);
    if (p.prompts && p.prompts.length >= 2) {
      console.log('Soul 프롬프트 씬1:', p.prompts[0].slice(0,80));
      console.log('Soul 프롬프트 씬2:', p.prompts[1].slice(0,80));
      return p.prompts;
    }
    return defaults;
  } catch(e) {
    console.warn('Soul 프롬프트 생성 실패:', e.message);
    return defaults;
  }
}

// ── DoP 영상 움직임 프롬프트 (짧고 간결하게)
async function generateVideoPrompts(apiKey, concept, scenes) {
  const s1 = (scenes && scenes.s1) || '';
  const s2 = (scenes && scenes.s2) || '';

  // DoP는 이미지 기반이므로 움직임 지시만
  const defaults = [
    'gentle camera zoom in, soft bokeh, romantic atmosphere, cinematic motion',
    'slow cinematic pan, warm lighting, emotional moment, gentle movement'
  ];

  if (!apiKey) return defaults;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: 'Higgsfield DoP 영상 프롬프트 전문가. DoP는 이미지를 기반으로 움직임을 추가하므로 카메라 움직임과 분위기만 간결하게 작성. 순수 JSON만 응답.',
        messages: [{
          role: 'user',
          content: '씬1: "' + (s1||'카페 첫 만남') + '"\n씬2: "' + (s2||'첫 데이트') + '"\n\n각 씬에 맞는 카메라 움직임과 분위기 프롬프트 (30단어 이내):\n{"prompts":["씬1","씬2"]}'
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
