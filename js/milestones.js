// 成長分析的純函式：里程碑、學年地圖分級、排名變化、文案、小語挑選。
// 不碰 DOM、不連網路，瀏覽器與 node --test 共用。依賴 stats.js（瀏覽器端已先載入成全域）。

if (typeof module !== 'undefined') {
  Object.assign(globalThis, require('./stats.js'));
}

// 3 年 × 2 學期 × 3 次 = 18 個記錄點，依時間排序
const ALL_SLOTS = [];
for (const grade of [1, 2, 3]) {
  for (const semester of [1, 2]) {
    for (const exam_type of [1, 2, 3]) ALL_SLOTS.push({ grade, semester, exam_type });
  }
}

const EXAM_NUM = ['', '一', '二', '三'];

function slotShortLabel(s) {
  return `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}・${EXAM_NUM[s.exam_type]}`;
}

function slotLongLabel(s) {
  return `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}・${EXAM_TYPE_LABEL[s.exam_type]}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function formatScore(n) {
  return n == null || Number.isNaN(n) ? '—' : round1(n).toFixed(1);
}

// 「跟上次比」的中性文案：不用「退步」。
// 用「畫面上顯示的兩個值」相減，讀者自己算會對得上（例如 83.0 與 80.8 → 2.2）
function diffText(cur, prev) {
  if (prev == null) return '第一次記錄';
  const d = round1(round1(cur) - round1(prev));
  if (d > 0) return `比上次多 ${d.toFixed(1)} 分`;
  if (d < 0) return `與上次相差 ${Math.abs(d).toFixed(1)} 分`;
  return '跟上次一樣';
}

function rankDeltaText(change) {
  if (change == null) return '這是第一筆排名紀錄';
  if (change > 0) return `比上次前進 ${change} 名`;
  if (change < 0) return `與上次相差 ${Math.abs(change)} 名`;
  return '跟上次同名次';
}

// 學年地圖：該次平均在「自己全部已考平均」中的 min–max 位置 → 1..4 級；
// 少於 3 筆回傳 0（中性色）；全部同分回傳 2
function heatLevel(average, allAverages) {
  if (!Number.isFinite(average) || allAverages.length < 3 || !allAverages.every(Number.isFinite)) return 0;
  const min = Math.min(...allAverages);
  const max = Math.max(...allAverages);
  if (max === min) return 2;
  // + 1e-9：剛好 .5 時浮點誤差會讓 Math.round 往下捨，補回來才是四捨五入
  return 1 + Math.round(((average - min) / (max - min)) * 3 + EPS);
}

function sortedRankings(rankings) {
  return [...rankings].sort((a, b) => sittingOrder(a) - sittingOrder(b));
}

// 與「上一筆排名紀錄」相比的名次變化：正數 = 前進；只比名次數字，不考慮總人數（使用者決定）
function rankChange(rankings, sitting) {
  const sorted = sortedRankings(rankings);
  const idx = sorted.findIndex((r) => sittingKey(r) === sittingKey(sitting));
  if (idx <= 0) return null;
  return sorted[idx - 1].rank - sorted[idx].rank;
}

// 里程碑（規劃書 6.5 + 2026-10-19 使用者確認的規則）。
// sittings 需為 buildSittings() 的輸出（已依時間排序）；回傳依時間排序的清單，每筆標記取得的段考。
function computeMilestones(sittings, rankings, subjects) {
  const result = [];
  const subjectBest = {};
  let risingStreak = 0;
  let steadyStreak = 0;
  const keys = new Set(sittings.map(sittingKey));

  sittings.forEach((s, i) => {
    const at = { grade: s.grade, semester: s.semester, exam_type: s.exam_type };
    const add = (id, title, detail) => result.push({ id, title, detail, at });

    if (i === 0) add('first', '踏出第一步', '記下了第一次段考');

    // 科目新高：同一次段考的多科合併成一個
    const newBests = [];
    for (const subj of subjects) {
      const score = s.scores[subj.code];
      if (score == null) continue;
      if (subj.code in subjectBest && score > subjectBest[subj.code]) newBests.push(`${subj.display_name} ${score}`);
      subjectBest[subj.code] = Math.max(subjectBest[subj.code] ?? -Infinity, score);
    }
    if (newBests.length) add('subject-best', '科目新高', `${newBests.join('、')} 分，都超過自己之前的最高`);

    // 缺科段考的平均只算登錄的科目，跟齊全的段考不能公平比較：
    // 缺科那次不給「平均新高」，也不拿它當之後比較的基準
    const isComplete = (x) => x.subjectCount >= subjects.length;
    const prevAverages = sittings.slice(0, i).map((p) => p.average);
    const prevCompleteAverages = sittings.slice(0, i).filter(isComplete).map((p) => p.average);
    if (prevCompleteAverages.length && isComplete(s) && s.average > Math.max(...prevCompleteAverages) + EPS) {
      add('avg-best', '平均新高', `平均 ${formatScore(s.average)} 分，是目前最高的一次`);
    }

    // 連續進步：平均連續 2 次上升，剛好達到時給一次（中斷後重新累計，可再次取得）
    risingStreak = i > 0 && s.average > sittings[i - 1].average + EPS ? risingStreak + 1 : 0;
    if (risingStreak === 2) add('rising', '連續進步', '平均連續兩次往上');

    // 穩定三連：連續 3 次判定為 stable 以上（資料不足不算），剛好達到時給一次
    const category = classifyScore(s.average, prevAverages);
    steadyStreak = ['stable', 'progress', 'peak'].includes(category) ? steadyStreak + 1 : 0;
    if (steadyStreak === 3) add('steady', '穩定三連', '連續三次維持在自己的水準以上');

    const change = rankChange(rankings, s);
    if (change != null && change > 0) add('rank-up', '名次前進', `校排名前進 ${change} 名`);

    if (s.exam_type === 3 && [1, 2, 3].every((e) => keys.has(`${s.grade}-${s.semester}-${e}`))) {
      add('semester', '學期完成', `${GRADE_LABEL[s.grade]}${SEMESTER_LABEL[s.semester]}三次段考都記錄了`);
      if (s.semester === 2 && [1, 2, 3].every((e) => keys.has(`${s.grade}-1-${e}`))) {
        add('year', '學年完成', `${GRADE_LABEL[s.grade]}六次段考全部完成`);
      }
    }
  });
  return result;
}

// 這次分數最高的科目（同分取科目排序在前的）
function topSubject(sitting, subjects) {
  let best = null;
  for (const subj of subjects) {
    const score = sitting.scores[subj.code];
    if (score != null && (!best || score > best.score)) best = { code: subj.code, score };
  }
  return best;
}

// 段考回顧的「最亮眼科目」：比上次進步最多；第一次或沒有任何科目進步時，取最高分
function highlightSubject(sitting, prev, subjects) {
  let star = null;
  if (prev) {
    for (const subj of subjects) {
      const cur = sitting.scores[subj.code];
      const before = prev.scores[subj.code];
      if (cur == null || before == null) continue;
      const gain = cur - before;
      if (gain > 0 && (!star || gain > star.gain)) star = { code: subj.code, score: cur, gain };
    }
  }
  if (star) return star;
  const top = topSubject(sitting, subjects);
  return top ? { ...top, gain: null } : null;
}

// 各學期平均（只算有紀錄的學期）
function termAverages(sittings) {
  const terms = new Map();
  for (const s of sittings) {
    const k = `${s.grade}-${s.semester}`;
    if (!terms.has(k)) terms.set(k, { grade: s.grade, semester: s.semester, averages: [] });
    terms.get(k).averages.push(s.average);
  }
  return [...terms.values()].map((t) => ({
    grade: t.grade,
    semester: t.semester,
    count: t.averages.length,
    average: t.averages.reduce((a, b) => a + b, 0) / t.averages.length,
  }));
}

// 依類別挑小語：避開最近用過的 id；全部都用過就不避開。rand 可注入以便測試。
function pickQuote(quotes, category, recentIds = [], rand = Math.random) {
  const pool = quotes.filter((q) => q.category === category);
  if (!pool.length) return null;
  const recent = Array.isArray(recentIds) ? recentIds : [];
  const fresh = pool.filter((q) => !recent.includes(q.id));
  const list = fresh.length ? fresh : pool;
  const idx = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)));
  return list[idx] ?? null;
}

// 同一次段考固定挑同一句（回顧頁重新整理不會換句）
function quoteForSitting(quotes, category, sitting) {
  const pool = quotes.filter((q) => q.category === category);
  if (!pool.length) return null;
  return pool[sittingOrder(sitting) % pool.length];
}

// 主題色只接受 #RRGGBB（資料庫也有同樣限制，這裡是第二道防線）
function safeThemeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

const AVATAR_PRESETS = ['cat', 'bunny', 'bear', 'penguin'];
const AVATAR_URL_PATTERN = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/avatars\//;
const AVATAR_PATH_PREFIX = '/storage/v1/object/public/avatars/';

// 上傳的頭像網址是否可用：https、（有給 allowedOrigin 時）必須是本專案的 Supabase、
// 路徑在 avatars bucket 內，且不含 ..（含 %2e%2e 這類編碼後的寫法）
function isSafeAvatarUrl(url, allowedOrigin) {
  if (typeof url !== 'string' || !AVATAR_URL_PATTERN.test(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (allowedOrigin && parsed.origin !== allowedOrigin) return false;
  let raw;
  try {
    raw = decodeURIComponent(url);
  } catch {
    return false;
  }
  return !raw.includes('..') && parsed.pathname.startsWith(AVATAR_PATH_PREFIX);
}

// 頭像來源：合法的上傳網址優先，其次預設款，最後退回 cat
function avatarSrc(student, allowedOrigin) {
  const url = student?.avatar_url;
  if (isSafeAvatarUrl(url, allowedOrigin)) return url;
  const preset = AVATAR_PRESETS.includes(student?.avatar_preset) ? student.avatar_preset : 'cat';
  return `assets/avatars/${preset}.svg`;
}

// 解析 location.hash（例如 #/exam/1-2-3）。只接受 views 自己的鍵，
// 不能用 in（#/constructor、#/__proto__ 會從原型鏈通過）
function parseRoute(hash, views) {
  const [name = '', ...rest] = String(hash ?? '').replace(/^#\/?/, '').split('/');
  return { name: Object.prototype.hasOwnProperty.call(views, name) ? name : 'home', arg: rest.join('/') };
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseRoute, isSafeAvatarUrl,
    ALL_SLOTS, slotShortLabel, slotLongLabel, round1, formatScore, diffText, rankDeltaText,
    heatLevel, rankChange, computeMilestones, topSubject, highlightSubject, termAverages,
    pickQuote, quoteForSitting, safeThemeColor, AVATAR_PRESETS, avatarSrc,
  };
}
