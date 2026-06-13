// Firebase Admin 초기화 (서비스 계정 = Vercel 환경변수)
// 클라이언트는 Firestore에 직접 접근하지 않음 → 보안 규칙은 `if false` 유지.
// Admin SDK는 규칙을 우회하므로 서버 함수에서만 읽기/쓰기 가능.
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel 환경변수에 \n 이 literal 로 들어오므로 실제 줄바꿈으로 변환
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

module.exports = admin.firestore();
