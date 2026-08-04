// 単語の正規化・比較ユーティリティ

// 全角英数記号を半角に、カタカナ⇄ひらがな差やスペース・記号のゆらぎを吸収する簡易正規化
function normalize(str) {
  if (!str) return '';
  let s = str.trim();
  // 全角英数->半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
  );
  // 全角記号ゆらぎの統一
  s = s.replace(/[！]/g, '!')
       .replace(/[？]/g, '?')
       .replace(/[　]/g, ' ')
       .replace(/[‐－ー―]/g, '-')
       .replace(/['’]/g, "'")
       .replace(/["“”]/g, '"')
       .replace(/[、，]/g, ',');
  // カタカナ -> ひらがな (比較用)
  s = s.replace(/[\u30a1-\u30f6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
  // 空白除去・小文字化
  s = s.replace(/\s/g, '').toLowerCase();
  return s;
}

// レーベンシュタイン距離
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

// 類似度 (0〜1、1が完全一致)
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

// 正誤判定: お題の解答例リストのいずれかと十分一致するか
function isCorrectAnswer(input, answerList, threshold = 0.85) {
  const ni = normalize(input);
  if (!ni) return false;
  for (const ans of answerList) {
    const na = normalize(ans);
    if (na === ni) return true;
    // ほぼ一致(表記ゆらぎ)も正解扱い
    const maxLen = Math.max(na.length, ni.length);
    if (maxLen > 0 && 1 - levenshtein(na, ni) / maxLen >= threshold) return true;
  }
  return false;
}

// 既出単語との類似判定(同一参加者内での再使用禁止)
function isTooSimilarToPast(input, pastWords, threshold = 0.8) {
  for (const w of pastWords) {
    if (similarity(input, w) >= threshold) return true;
  }
  return false;
}

module.exports = { normalize, similarity, isCorrectAnswer, isTooSimilarToPast };
