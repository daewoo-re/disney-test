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

  try {
    // ── 1. 프롬프트 생성 (Claude or 기본값)
    const prompts = await generatePrompts(ANTHROPIC, concept, scenes);

    // ── 2. Higgsfield 공식 형식으로 영상 생성 요청
    const credentials = `${HF_KEY}:${HF_SECRET}`;
    const jobIds = [];

    for (let i = 0; i < 2; i++) {
      let endpoint, body;

      if (photo) {
        // 사진 있을 때: image-to-video (DoP 모델)
        endpoint = '/v1/image2video/dop';
        body = {
          model: 'dop-turbo',
          prompt: prompts[i],
          input_images: [
            { type: 'image_url', image_url: photo }
          ]
        };
      } else {
        // 사진 없을 때: text-to-video (Soul 모델)
        endpoint = '/v1/text2video/soul';
        body = {
          prompt: prompts[i],
          aspect_ratio: '9:16',
          duration: 5
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

      // 상세 오류 로깅
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let errJson = {};
        try { errJson = JSON.parse(errText); } catch (_) {}
        const msg = errJson.message || errJson.detail || errText || resp.status;
        console.error(`Higgsfield 씬${i+1} 오류 (${resp.status}):`, msg);
        console.error(`endpoint: ${endpoint}, body:`, JSON.stringify(body).slice(0, 200));
        throw new Error(`Higgsfield 씬${i+1} 오류: ${resp.status} — ${msg}`);
      }

      const data = await resp.json();
      console.log(`씬${i+1} 응답:`, JSON.stringify(data).slice(0, 300));

      const jobId = data.request_id || data.id || data.job_id || data.requestId;
      if (!jobId) throw new Error(`씬${i+1} 작업 ID를 받지 못했습니다. 응답: ${JSON.stringify(data).slice(0,200)}`);
      jobIds.push(jobId);
    }

    return res.status(200).json({ ok: true, jobId: jobIds.join(',') });

  } catch (e) {
    console.error('preview 최종 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── Claude 프롬프트 생성 (실패 시 기본값 반환)
async function generatePrompts(apiKey, concept, scenes) {
  const defaults = [
    'Disney Pixar animated style. Two young Korean people meet for the first time, eyes lock in a magical moment. Soft golden light, romantic sparkles, slow zoom in. Cinematic, 8k quality, heartwarming atmosphere.',
    'Disney Pixar animated style. A young couple on their first date, gently holding hands at a riverside cafe. Warm golden hour light, joyful expressions, smooth cinematic dolly shot. 8k quality, romantic mood.'
  ];

  if (!apiKey) return defaults;

  try {
    const s1 = scenes.s1 || '';
    const s2 = scenes.s2 || '';
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
          content: `씬1: ${s1}\n씬2: ${s2}\n컨셉: ${concept||'propose'}\n\n` +
            '{"prompts":["씬1 영어 영상 프롬프트 (Disney Pixar animated style로 시작, 80단어 이내)","씬2 영어 영상 프롬프트"]} 형식으로만 응답'
        }]
      })
    });
    if (!resp.ok) return defaults;
    const data = await resp.json();
    let raw = data.content.map(b => b.text || '').join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(raw);
    if (parsed.prompts?.length >= 2) return parsed.prompts;
    return defaults;
  } catch (e) {
    console.warn('Claude 프롬프트 생성 실패, 기본값 사용:', e.message);
    return defaults;
  }
}
