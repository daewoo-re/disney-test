// ══════════════════════════════════════════════
// /api/lead.js
// POST: 연락처 + 주문 데이터 저장
// Google Sheets 저장 or 콘솔 출력 (DUMMY_MODE)
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { concept, name, phone, scenes, jobId } = req.body || {};

  if (!name || !phone) {
    return res.status(400).json({ ok: false, message: '이름과 전화번호는 필수입니다.' });
  }

  const record = {
    receivedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    concept: concept || '',
    name,
    phone,
    jobId: jobId || '',
    scenes: scenes ? Object.entries(scenes).map(([k,v]) => `${k}:${v}`).join(' | ') : ''
  };

  // 더미 모드: 콘솔 출력
  if (process.env.DUMMY_MODE === 'true') {
    console.log('[리드 저장 - 더미]', JSON.stringify(record));
    return res.status(200).json({ ok: true });
  }

  // Google Sheets 저장
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const saJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!sheetId || !saJson) {
    console.log('[리드 저장 - Sheets 미설정]', JSON.stringify(record));
    return res.status(200).json({ ok: true });
  }

  try {
    const sa    = JSON.parse(saJson);
    const token = await getGoogleToken(sa);

    const row = [
      record.receivedAt,
      record.name,
      record.phone,
      record.concept,
      record.jobId,
      record.scenes
    ];

    const sheetResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:F:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      }
    );

    if (!sheetResp.ok) throw new Error('Sheets 저장 실패');
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('lead 오류:', e.message);
    // Sheets 실패해도 고객에게는 성공 응답 (데이터 손실 방지용 콘솔 보존)
    console.log('[리드 백업]', JSON.stringify(record));
    return res.status(200).json({ ok: true });
  }
}

async function getGoogleToken(sa) {
  const { createSign } = await import('crypto');
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${sig}`
    })
  });
  const td = await tokenRes.json();
  return td.access_token;
}
