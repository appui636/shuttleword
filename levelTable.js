// 20mシャトルラン レベル・回数テーブル生成
// 各レベルの回数(往復数)は標準テストの仕様に準拠
// 速度モデルで相対時間を算出し、実音源の長さ(ACTUAL_DURATION)に正規化する

const SHUTTLE_COUNTS = [
  7,8,8,9,9,10,10,11,11,11,12,12,13,13,13,14,14,15,15,15,16,1
]; // レベル1〜22 (22は247回に到達する1回のみ)

function buildLevelTable(actualDurationSec) {
  // 速度モデル: レベルnの速度 = 8.0 + 0.5*(n-1) km/h
  let laps = []; // {lap, level, startTime, endTime}
  let rawTimes = [];
  let cum = 0;
  let lapNo = 0;
  let totalCount = 0;

  SHUTTLE_COUNTS.forEach((count, idx) => {
    const level = idx + 1;
    const speed = 8.0 + 0.5 * idx; // km/h
    const perShuttle = 72 / speed; // 20m / (km/h -> m/s) = 20 / (speed*1000/3600) = 72/speed
    for (let i = 0; i < count; i++) {
      lapNo++;
      totalCount++;
      const dur = perShuttle;
      rawTimes.push({ lap: lapNo, level, dur });
    }
  });

  const rawTotal = rawTimes.reduce((s, r) => s + r.dur, 0);
  const scale = actualDurationSec / rawTotal;

  let t = 0;
  const table = rawTimes.map(r => {
    const dur = r.dur * scale;
    const entry = { lap: r.lap, level: r.level, startTime: t, endTime: t + dur };
    t += dur;
    return entry;
  });

  return { table, totalCount, totalDuration: t };
}

module.exports = { buildLevelTable, SHUTTLE_COUNTS };
