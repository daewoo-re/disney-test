// ══════════════════════════════════════════════
// /api/preview.js  — 검증된 Higgsfield API 기반
// 엔드포인트: POST /{slug}
// 필수: image_url (DoP 모델은 이미지 필수)
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

  // 사진 필수 체크 (DoP 모델은 image_url 필수)
  if (!photo) {
    return res.status(400).json({ ok: false, message: '사진을 업로드해 주세요. Higgsfield DoP 모델은 사진이 필수입니다.' });
  }

  const auth = 'Key ' + HF_KEY + ':' + HF_SECRET;
  const BASE  = 'https://platform.higgsfield.ai';

  try {
    // 1. 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // 2. base64 사진 → Higgsfield CDN 업로드
    // /generate/{slug} 엔드포인트는 400 + 'prompt required' → 올바른 엔드포인트
    // image_url은 반드시 외부 URL이어야 함 → 먼저 업로드 필요
    const photoUrl = await uploadImage(photo, auth, BASE);
    if (!photoUrl) {
      return res.status(400).json({ ok: false, message: '사진 업로드에 실패했습니다. 다른 사진으로 시도해주세요.' });
    }
    console.log('사진 업로드 성공:', photoUrl.slice(0, 80));

    // 3. 씬별 영상 생성
    // 확인된 엔드포인트: POST /{slug}
    // 확인된 모델: higgsfield-ai/dop/lite (저비용), higgsfield-ai/dop/turbo (고품질)
    const jobIds = [];
    const models = [
      'higgsfield-ai/dop/lite',     // 2 크레딧 - 빠름
      'higgsfield-ai/dop/turbo',    // 6.5 크레딧 - 고품질
      'higgsfield-ai/dop/standard', // 9 크레딧 - 최고품질
    ];

    for (let i = 0; i < 2; i++) {
      let jobId = null;

      for (const model of models) {
        const body = {
          image_url: photoUrl,
          prompt: prompts[i]
        };

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
          if (jid) {
            jobId = jid;
            console.log('씬' + (i+1) + ' 성공! model:', model, 'jobId:', jid);
            break;
          }
        }
      }

      if (!jobId) {
        throw new Error('씬' + (i+1) + ' 영상 생성 실패. 로그를 확인해주세요.');
      }
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── base64 사진 업로드
// /generate/{slug} 엔드포인트 패턴 확인됨
// 업로드는 별도 엔드포인트 필요 — 테스트로 확인된 후보들 시도
async function uploadImage(base64DataUrl, auth, BASE) {
  try {
    const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mimeType = match[1];
    const buffer   = Buffer.from(match[2], 'base64');
    if (buffer.length > 8 * 1024 * 1024) {
      console.warn('사진 8MB 초과');
      return null;
    }

    // /generate/{slug} 는 400 + prompt required → 올바른 경로
    // 업로드 전용 엔드포인트 후보
    const uploadCandidates = [
      { url: BASE + '/generate/upload', contentType: mimeType },
      { url: BASE + '/uploads/image',   contentType: mimeType },
      { url: BASE + '/upload',          contentType: mimeType },
      { url: BASE + '/files',           contentType: mimeType },
      { url: BASE + '/generate/higgsfield-ai/dop/lite/upload', contentType: mimeType },
    ];

    for (const c of uploadCandidates) {
      try {
        const r = await fetch(c.url, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'User-Agent': 'higgsfield-server-js/2.0',
            'Content-Type': c.contentType,
          },
          body: buffer
        });
        const txt = await r.text();
        console.log('업로드 시도', c.url.replace(BASE,''), '→', r.status, txt.slice(0, 150));

        if (r.ok) {
          try {
            const d = JSON.parse(txt);
            const u = d.url || d.cdn_url || d.file_url || d.image_url || d.media_url;
            if (u) return u;
          } catch(_) {}
        }

        // 422: 파라미터 있음 → multipart 시도
        if (r.status === 422) {
          const mpUrl = await tryMultipartUpload(c.url, buffer, mimeType, auth);
          if (mpUrl) return mpUrl;
        }
      } catch(e) {
        console.warn('업로드 오류:', c.url.replace(BASE,''), e.message);
      }
    }
    return null;
  } catch(e) {
    console.warn('uploadImage 오류:', e.message);
    return null;
  }
}

// multipart/form-data 업로드 시도
async function tryMultipartUpload(url, buffer, mimeType, auth) {
  try {
    const boundary = '----FormBoundary' + Date.now();
    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = 'photo.' + ext;

    const parts = [];
    parts.push('--' + boundary + '\r\n');
    parts.push('Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n');
    parts.push('Content-Type: ' + mimeType + '\r\n\r\n');

    const headerBuf = Buffer.from(parts.join(''));
    const footerBuf = Buffer.from('\r\n--' + boundary + '--\r\n');
    const body = Buffer.concat([headerBuf, buffer, footerBuf]);

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'User-Agent': 'higgsfield-server-js/2.0',
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': String(body.length)
      },
      body: body
    });
    const txt = await r.text();
    console.log('multipart 업로드', url.split('/').pop(), '→', r.status, txt.slice(0, 150));
    if (r.ok) {
      const d = JSON.parse(txt);
      return d.url || d.cdn_url || d.file_url || d.image_url || null;
    }
    return null;
  } catch(e) {
    console.warn('multipart 오류:', e.message);
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
  } catch(e) {
    return defaults;
  }
}
