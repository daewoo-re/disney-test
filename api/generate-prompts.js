// ══════════════════════════════════════════════
// /api/generate-prompts.js
// Anthropic Claude API 호출 — 서버에서만 실행
// API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에서 로드
// 브라우저에는 절대 노출되지 않습니다.
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });
  }

  const { groom, bride, sentences, memos, hasPhoto } = req.body;
  if (!sentences || sentences.length === 0) {
    return res.status(400).json({ error: '씬 정보가 없습니다.' });
  }

  // 더미 모드: 환경변수 DUMMY_MODE=true 이면 하드코딩 프롬프트 반환
  if (process.env.DUMMY_MODE === 'true') {
    return res.status(200).json({
      characterPrompt:
        'Disney Pixar style animated couple, Korean young adults in their mid-20s. ' +
        'Male character: warm brown eyes, neat dark hair, gentle smile, casual light blue sweater. ' +
        'Female character: bright expressive eyes, soft wavy black hair, cheerful expression, cozy pink cardigan. ' +
        'Soft rounded Pixar-style features, vibrant colors, cinematic lighting, 8k quality, romantic atmosphere.',
      scenePrompts: [
        'Disney Pixar animated style. A cozy university library filled with warm golden light. ' +
        'Two young students accidentally make eye contact over their books and share a shy sweet smile. ' +
        'Slow zoom in on their faces, soft bokeh background. Romantic and heartwarming atmosphere. ' +
        'Cinematic lighting, 8k quality.',

        'Disney Pixar animated style. A charming riverside cafe with large windows overlooking the Han River at golden hour. ' +
        'A young couple walks side by side holding takeaway coffee cups, their hands gently touching and intertwining. ' +
        'Camera follows from behind with a warm cinematic dolly shot. Soft warm tones, romantic atmosphere, 8k quality.',

        'Disney Pixar animated style. Interior of a scenic train moving through beautiful Korean countryside. ' +
        'A young couple sits together by the window, the girl leans her head softly on the boys shoulder while watching passing scenery. ' +
        'Gentle camera pan from the landscape outside to their peaceful expressions. ' +
        'Warm afternoon light, dreamy and romantic mood, 8k quality.'
      ]
    });
  }

  const systemPrompt =
    '당신은 디즈니/픽사 스타일 AI 영상 제작 전문가입니다.\n' +
    '입력된 커플 스토리 씬을 바탕으로 Higgsfield AI에서 사용할 이미지 프롬프트와 영상 프롬프트를 생성합니다.\n' +
    '반드시 순수 JSON만 응답하세요. 마크다운 코드블록 없이.';

  const userMsg =
    `커플 정보:\n남자: ${groom}\n여자: ${bride}\n사진 업로드 여부: ${hasPhoto ? '있음' : '없음'}\n\n` +
    `씬 목록:\n` +
    sentences.map((s, i) => `씬${i + 1}: ${s}${memos[i] ? ` (메모: ${memos[i]})` : ''}`).join('\n') +
    '\n\n아래 JSON 형식으로 응답:\n' +
    '{"characterPrompt":"커플을 디즈니 픽사 스타일로 표현한 캐릭터 이미지 프롬프트 (영어, 150단어 이내)",' +
    '"scenePrompts":["씬1 Higgsfield 영상 프롬프트 (영어, Disney Pixar animated style, 씬별 카메라 무브 포함, 80단어 이내)","씬2 영상 프롬프트","씬3 영상 프롬프트"]}';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Anthropic API 오류' });
    }

    const data = await response.json();
    let raw = data.content.map(b => b.text || '').join('');
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
    const parsed = JSON.parse(raw);
    return res.status(200).json(parsed);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
