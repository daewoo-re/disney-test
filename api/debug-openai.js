// /api/debug-openai.js
// GET: OpenAI API 키 유효성 + 모델 접근 가능 여부 확인
// 실제 이미지 생성 없음 → 비용 $0

export default async function handler(req, res) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY 없음' });

  const results = {};

  // 1. API 키 유효성 확인 (모델 목록 조회 — 무료)
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY }
    });
    const d = await r.json();
    results.apiKey = {
      status: r.status,
      valid: r.ok,
      modelCount: d.data ? d.data.length : 0,
    };

    // 이미지 모델만 필터
    if (d.data) {
      results.imageModels = d.data
        .filter(m => m.id.includes('image') || m.id.includes('dall'))
        .map(m => m.id);
    }
  } catch(e) {
    results.apiKey = { error: e.message };
  }

  // 2. 크레딧 잔액 확인
  try {
    const r = await fetch('https://api.openai.com/v1/organization/usage/costs?start_time=' + (Math.floor(Date.now()/1000) - 86400), {
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY }
    });
    const txt = await r.text();
    results.usage = { status: r.status, body: txt.slice(0, 200) };
  } catch(e) {
    results.usage = { error: e.message };
  }

  // 3. gpt-image-1 모델 접근 가능 여부 (모델 상세 조회 — 무료)
  const imageModels = ['gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'];
  results.modelAccess = {};
  for (const model of imageModels) {
    try {
      const r = await fetch('https://api.openai.com/v1/models/' + model, {
        headers: { 'Authorization': 'Bearer ' + OPENAI_KEY }
      });
      const d = await r.json();
      results.modelAccess[model] = {
        status: r.status,
        accessible: r.ok,
        id: d.id || null
      };
    } catch(e) {
      results.modelAccess[model] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
