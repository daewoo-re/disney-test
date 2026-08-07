// ══════════════════════════════════════════════
// /api/preview.js
// POST: 씬 1~2 영상 생성 → Higgsfield 공식 SDK 형식
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

  // ── 더미 모드
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({ ok: true, jobId: 'dummy-' + Date.now() });
  }

  const credentials = `${HF_KEY}:${HF_SECRET}`;

  try {
    // ── 1. 프롬프트 생성
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // ── 2. base64 사진 → Higgsfield CDN 업로드 (URL로 변환)
    let photoUrl = null;
    if (photo && photo.startsWith('data:')) {
      photoUrl = await uploadPhotoToHiggsfield(photo, credentials);
      console.log('사진 업로드 결과:', photoUrl ? '성공' : '실패');
    }

    // ── 3. 씬별 영상 생성 요청
    const jobIds = [];

    for (let i = 0; i < 2; i++) {
      let endpoint, body;

      if (photoUrl) {
        // 사진 있을 때: image-to-video (DoP 모델)
        endpoint = '/v1/image2video/dop';
        body = {
          params: {
            model: 'dop-turbo',
            prompt: prompts[i],
            input_images: [{ type: 'image_url', image_url: photoUrl }]
          }
        };
      } else {
        // 사진 없을 때 or 업로드 실패: text-to-video (Kling 모델)
        endpoint = '/v1/text2video/kling';
        body = {
          params: {
            prompt: prompts[i],
            aspect_ratio: '9:16',
            duration: 5
          }
        };
      }

      const resp = await fetch('https://platform.higgsfield.ai' + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${credentials}`,
          'User-Agent': 'higgsfield-server-js/2.0'
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          errMsg = JSON.stringify(errJson);
        } catch (_) {}
        console.error(`씬${i+1} 오류 (${resp.status}):`, errMsg.slice(0, 500));
        throw new Error(`Higgsfield 씬${i+1} 오류 (${resp.status}): ${errMsg.slice(0, 200)}`);
      }

      const data = await resp.json();
      console.log(`씬${i+1} 응답:`, JSON.stringify(data).slice(0, 300));

      const jobId = data.request_id || data.id || data.job_id || data.requestId;
      if (!jobId) {
        throw new Error(`씬${i+1} 작업 ID 없음. 응답: ${JSON.stringify(data).slice(0, 200)}`);
      }
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── base64 사진 → Higgsfield CDN 업로드
async function uploadPhotoToHiggsfield(base64DataUrl, credentials) {
  try {
    // data:image/jpeg;base64,xxx 형태 파싱
    const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];
    const base64   = match[2];
    const buffer   = Buffer.from(base64, 'base64');

    // 파일 크기 제한: 10MB 초과 시 스킵
    if (buffer.length > 10 * 1024 * 1024) {
      console.warn('사진 크기 초과 (10MB), text-to-video로 대체');
      return null;
    }

    // Higgsfield 업로드 엔드포인트
    const uploadResp = await fetch('https://platform.higgsfield.ai/v1/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${credentials}`,
        'User-Agent': 'higgsfield-server-js/2.0',
        'Content-Type': mimeType,
        'Content-Length': buffer.length.toString()
      },
      body: buffer
    });

    if (!uploadResp.ok) {
      const errTxt = await uploadResp.text().catch(() => '');
      console.warn('Higgsfield 업로드 실패:', uploadResp.status, errTxt.slice(0, 200));
      return null;
    }

    const uploadData = await uploadResp.json();
    console.log('업로드 응답:', JSON.stringify(uploadData).slice(0, 200));
    return uploadData.url || uploadData.image_url || uploadData.cdn_url || null;

  } catch (e) {
    console.warn('사진 업로드 오류:', e.message);
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
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: '디즈니/픽사 스타일 영상 프롬프트 전문가입니다. 순수 JSON만 응답하세요. 마크다운 코드블록 없이.',
        messages: [{
          role: 'user',
          content: '씬1: ' + s1 + '\n씬2: ' + s2 + '\n컨셉: ' + (concept || 'propose') + '\n\n' +
            '{"prompts":["씬1 영어 영상 프롬프트 (Disney Pixar animated style로 시작, 80단어 이내)","씬2 영어 영상 프롬프트"]} 형식으로만 응답'
        }]
      })
    });
    if (!resp.ok) return defaults;
    const data = await resp.json();
    let raw = data.content.map(function(b) { return b.text || ''; }).join('');
    raw = raw.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);
    if (parsed.prompts && parsed.prompts.length >= 2) return parsed.prompts;
    return defaults;
  } catch (e) {
    console.warn('Claude 프롬프트 생성 실패, 기본값 사용:', e.message);
    return defaults;
  }
}
