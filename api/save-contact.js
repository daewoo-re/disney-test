// ══════════════════════════════════════════════
// /api/save-contact.js
// 연락처 저장 — 서버에서만 실행
// Google Sheets API로 전송
// 환경변수: GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON
// ══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { name, phone, groom, bride, scenes, videoUrl, createdAt } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: '이름과 전화번호는 필수입니다.' });
  }

  // 더미 모드: 콘솔 출력만
  if (process.env.DUMMY_MODE === 'true') {
    console.log('[연락처 저장 - 더미]', { name, phone, groom, bride, scenes, videoUrl, createdAt });
    return res.status(200).json({ ok: true, message: '더미 모드 저장' });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!sheetId || !serviceAccountJson) {
    // Google Sheets 미설정 시 콘솔에만 출력하고 성공 응답
    console.log('[연락처 저장 - Sheets 미설정]', { name, phone, groom, bride });
    return res.status(200).json({ ok: true, message: 'Sheets 미설정 (콘솔 출력)' });
  }

  try {
    // Google Service Account로 JWT 토큰 발급
    const serviceAccount = JSON.parse(serviceAccountJson);
    const token = await getGoogleAccessToken(serviceAccount);

    // Sheets API append
    const row = [
      new Date(createdAt).toLocaleString('ko-KR'),
      name,
      phone,
      groom,
      bride,
      (scenes || []).join(' | '),
      videoUrl || ''
    ];

    const sheetsRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:G:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [row] })
      }
    );

    if (!sheetsRes.ok) {
      const err = await sheetsRes.json().catch(() => ({}));
      console.error('Sheets 저장 실패:', err);
      return res.status(502).json({ error: 'Google Sheets 저장 실패' });
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('save-contact 오류:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ── Google Service Account JWT 발급
async function getGoogleAccessToken(serviceAccount) {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  // Node.js crypto로 RS256 서명
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(serviceAccount.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}
