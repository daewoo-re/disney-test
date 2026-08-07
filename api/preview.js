// ══════════════════════════════════════════════
// /api/preview.js
// POST: 씬 1~2 영상 생성 요청 → Higgsfield
// GET /api/preview/:jobId → 폴링 (video-status.js 에서 처리)
// API 키는 Vercel 환경변수에서만 로드 — 클라이언트에 절대 노출 안 됨
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

  const HF_API_KEY    = process.env.HIGGSFIELD_API_KEY;
  const HF_API_SECRET = process.env.HIGGSFIELD_API_SECRET;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!HF_API_KEY || !HF_API_SECRET) {
    return res.status(500).json({ ok: false, message: 'API 키가 설정되지 않았습니다.' });
  }

  const { concept, scenes, photo } = req.body || {};
  if (!scenes) return res.status(400).json({ ok: false, message: '씬 데이터가 없습니다.' });

  // ── 더미 모드
  if (process.env.DUMMY_MODE === 'true') {
    const fakeJobId = 'dummy-' + Date.now();
    return res.status(200).json({ ok: true, jobId: fakeJobId });
  }

  try {
    // ── 1. Claude로 씬 1~2 영상 프롬프트 생성
    const scenePrompts = await generatePrompts(ANTHROPIC_KEY, concept, scenes);

    // ── 2. Higgsfield로 씬 1~2 영상 생성 요청 (비동기)
    const credentials = `${HF_API_KEY}:${HF_API_SECRET}`;
    const jobIds = [];

    for (let i = 0; i < 2; i++) {
      const body = {
        prompt: scenePrompts[i],
        duration: 5,
      };
      // 사진이 있으면 image-to-video, 없으면 text-to-video
      const endpoint = photo
        ? '/v1/image2video/dop'
        : '/v1/text2video/dop';

      if (photo && i === 0) body.input_images = [{ type: 'image_url', image_url: photo }];

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
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Higgsfield 씬${i+1} 오류: ${err.message || resp.status}`);
      }

      const data = await resp.json();
      const jobId = data.request_id || data.id || data.job_id;
      if (!jobId) throw new Error(`씬${i+1} 작업 ID 없음`);
      jobIds.push(jobId);
    }

    // 두 jobId를 하나의 복합 ID로 묶어서 반환
    const compositeJobId = jobIds.join(',');
    return res.status(200).json({ ok: true, jobId: compositeJobId });

  } catch (e) {
    console.error('preview 오류:', e.message);
    return res.status(500).json({ ok: false, message: e.message });
  }
}

// ── Claude로 프롬프트 생성 (없으면 기본 프롬프트 사용)
async function generatePrompts(apiKey, concept, scenes) {
  const defaults = [
    'Disney Pixar animated style. Two young Korean people meet for the first time, eyes lock in a magical moment. Soft golden light, romantic atmosphere, slow zoom in. Cinematic, 8k quality.',
    'Disney Pixar animated style. A young couple on their first date, holding hands gently. Warm cafe setting, magical sparkles, heartwarming expression. Cinematic lighting, 8k quality.'
  ];

  if (!apiKey) return defaults;

  const sceneTexts = Object.entries(scenes)
    .filter(([k]) => k === 's1' || k === 's2')
    .map(([k, v]) => `${k}: ${v}`).join(', ');

  try {
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
        system: '디즈니/픽사 스타일 영상 프롬프트 전문가입니다. 순수 JSON만 응답하세요. 코드블록 없이.',
        messages: [{
          role: 'user',
          content: `씬 정보: ${sceneTexts}\n컨셉: ${concept}\n\n{"prompts":["씬1 영어 영상 프롬프트 (Disney Pixar animated style로 시작, 80단어)","씬2 영어 영상 프롬프트"]} 형식으로 응답`
        }]
      })
    });

    if (!resp.ok) return defaults;
    const data = await resp.json();
    let raw = data.content.map(b => b.text || '').join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(raw);
    return parsed.prompts?.length >= 2 ? parsed.prompts : defaults;
  } catch (e) {
    return defaults;
  }
}
