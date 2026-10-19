// index.html 主要邏輯：讀資料 → hash route（#/home、#/growth、#/map、#/history、#/exam/g-s-e）→ 畫出各頁。
// 計算都在 stats.js / milestones.js；這裡只負責 DOM。
// 安全：學生名、小語等資料庫字串一律用 textContent 輸出，不用 innerHTML。

const DEFAULT_ACCENT = '#F28B6D';
const STORAGE_STUDENT = 'jhs.student';
const STORAGE_RECENT_QUOTES = 'jhs.recentQuotes';
const RECENT_QUOTE_LIMIT = 8;
const INSUFFICIENT_QUOTE = '每一次段考都是一頁新的紀錄，先把它們一筆一筆存起來。';
const EMPTY_QUOTE = '第一次段考結束後，這裡就會開始記錄你的成長。';

const state = {
  students: [],
  subjects: [],
  examScores: [],
  rankings: [],
  quotes: [],
  studentId: null,
  subject: null,
  charts: [],
  homeQuote: {}, // 每位學生在這次瀏覽中固定一句，換頁不重抽
  focusKey: null,
};

/* ================= 小工具 ================= */
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v; // 走 CSSOM，不受 CSP 的 inline style 限制
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
};

const ICONS = {
  foot: '<path d="M8 15c-2 0-3-2-2.5-4.5S8 6 9.5 7s1 4 .5 5.5S10 15 8 15Z"/><path d="M15.5 19c-2 0-2.6-2-2-4s2.6-4 4-3 .8 3.5.3 5S17.5 19 15.5 19Z"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4c3-1.5 5 1.5 8 0s4-1 4-1v8s-1-.5-4 1-5-1.5-8 0"/>',
  arrow: '<path d="M4 17c4-1 7-5 9-10"/><path d="M9 6.5 13.2 6l1.3 4"/><path d="M15 18c1.5-.5 3-1.6 4-3"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19 13 11"/>',
  star: '<path d="M12 3.5l2.4 5.2 5.6.6-4.2 3.8 1.2 5.5L12 15.9 7 18.6l1.2-5.5L4 9.3l5.6-.6Z"/>',
  book: '<path d="M4 5.5C7 4 9.5 4.5 12 6.5c2.5-2 5-2.5 8-1V18c-3-1.5-5.5-1-8 1-2.5-2-5-2.5-8-1Z"/><path d="M12 6.5V19"/>',
};
const MILESTONE_ICON = {
  first: 'foot', semester: 'flag', year: 'flag', rising: 'arrow', 'rank-up': 'arrow',
  steady: 'leaf', 'avg-best': 'star', 'subject-best': 'star',
};

const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    s.setAttribute(k, v);
  }
  s.innerHTML = ICONS[name] || ICONS.star; // 固定常數，非使用者資料
  return s;
};

function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 無痕模式或被封鎖時略過，只是少了「記住」的便利 */
  }
}

function emptyBlock(title, body) {
  const box = el('div', { class: 'empty' });
  box.append(icon('book'), el('strong', { text: title }), el('span', { text: body }));
  return box;
}

// 上傳頭像只接受本專案 Supabase 的網址
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(window.APP_CONFIG.SUPABASE_URL).origin;
  } catch {
    return null;
  }
})();

function setAvatar(img, student) {
  img.onerror = () => {
    img.onerror = null;
    img.src = 'assets/avatars/cat.svg';
  };
  img.src = SUPABASE_ORIGIN ? avatarSrc(student, SUPABASE_ORIGIN) : avatarSrc({ avatar_preset: student.avatar_preset });
}

const subjectName = (code) => state.subjects.find((s) => s.code === code)?.display_name ?? code;

/* ================= 資料 ================= */
async function loadAll() {
  const q = (table, columns, order) => {
    let req = sbClient.from(table).select(columns);
    if (order) req = req.order(order);
    return req;
  };
  const [students, subjects, scores, rankings, quotes] = await Promise.all([
    q('students', 'id, name, theme_color, avatar_preset, avatar_url, enrolled_year', 'enrolled_year'),
    q('subjects', 'code, display_name, sort_order', 'sort_order'),
    q('exam_scores', 'student_id, grade, semester, exam_type, subject, score'),
    q('exam_rankings', 'student_id, grade, semester, exam_type, rank, total_students'),
    q('motivational_quotes', 'id, category, content').eq('is_active', true),
  ]);
  const failed = [students, subjects, scores, rankings, quotes].find((r) => r.error);
  if (failed) throw failed.error;

  state.students = students.data;
  state.subjects = subjects.data;
  state.examScores = scores.data.map((r) => ({ ...r, score: Number(r.score) }));
  state.rankings = rankings.data;
  state.quotes = quotes.data;
}

function student() {
  return state.students.find((s) => s.id === state.studentId);
}

function studentData() {
  const examScores = state.examScores.filter((r) => r.student_id === state.studentId);
  const rankings = state.rankings.filter((r) => r.student_id === state.studentId);
  const sittings = buildSittings(examScores);
  return { examScores, rankings, sittings, milestones: computeMilestones(sittings, rankings, state.subjects) };
}

function homeQuoteFor(category) {
  if (category === 'insufficient_data') return INSUFFICIENT_QUOTE;
  const cacheKey = `${state.studentId}:${category}`;
  if (!state.homeQuote[cacheKey]) {
    const stored = storageGet(STORAGE_RECENT_QUOTES, []);
    const recent = Array.isArray(stored) ? stored : [];
    const quote = pickQuote(state.quotes, category, recent);
    state.homeQuote[cacheKey] = quote ? quote.content : CATEGORY_LABEL[category];
    if (quote) storageSet(STORAGE_RECENT_QUOTES, [quote.id, ...recent.filter((id) => id !== quote.id)].slice(0, RECENT_QUOTE_LIMIT));
  }
  return state.homeQuote[cacheKey];
}

/* ================= 頁首 ================= */
function renderSwitch() {
  const wrap = document.getElementById('studentSwitch');
  wrap.replaceChildren();
  for (const s of state.students) {
    const color = safeThemeColor(s.theme_color, DEFAULT_ACCENT);
    const btn = el('button', { class: 'student-chip', type: 'button', 'aria-pressed': String(s.id === state.studentId), 'data-focus-key': `student-${s.id}` });
    btn.style.setProperty('--chip-color', color);
    btn.style.setProperty('--chip-soft', `color-mix(in srgb, ${color} 16%, #fff)`);
    const img = el('img', { alt: '' });
    setAvatar(img, s);
    btn.append(img, el('span', { text: s.name }));
    btn.addEventListener('click', () => {
      state.studentId = s.id;
      storageSet(STORAGE_STUDENT, s.id);
      render();
    });
    wrap.append(btn);
  }
}

/* ================= 首頁 ================= */
function renderHome(d) {
  const s = student();
  const { sittings, rankings, milestones } = d;
  const latest = sittings.at(-1);
  const prev = sittings.at(-2);
  const verdict = classifyLatestSitting(sittings);
  const category = verdict ? verdict.category : 'insufficient_data';

  setAvatar(document.getElementById('greetAvatar'), s); // alt=""：旁邊就是「嗨，名字」
  document.getElementById('greetName').textContent = `嗨，${s.name}`;
  document.getElementById('greetQuote').textContent = latest ? homeQuoteFor(category) : EMPTY_QUOTE;

  // 數字磚
  const tiles = document.getElementById('tiles');
  tiles.replaceChildren();
  const tile = (label, value, note, extra) => {
    const t = el('div', { class: 'tile' }, el('p', { class: 'tile__label', text: label }));
    const v = el('p', { class: 'tile__value' });
    if (Array.isArray(value)) v.append(value[0], el('small', { text: value[1] }));
    else v.textContent = value;
    t.append(v);
    if (note) t.append(el('p', { class: 'tile__note', text: note }));
    if (extra) t.append(extra);
    tiles.append(t);
  };
  if (latest) {
    tile('最新一次平均', formatScore(latest.average), slotLongLabel(latest));
    const d1 = prev ? round1(round1(latest.average) - round1(prev.average)) : null;
    tile('與上次相比', d1 == null ? '—' : d1 > 0 ? `+${d1.toFixed(1)}` : d1.toFixed(1), diffText(latest.average, prev?.average));
    const top = topSubject(latest, state.subjects);
    tile('這次最高分', [subjectName(top.code), ` ${top.score}`],
      latest.subjectCount < state.subjects.length ? `這次登錄 ${latest.subjectCount} 科` : `${state.subjects.length} 科中最高`);
  } else {
    tile('最新一次平均', '—', '還沒有段考紀錄');
    tile('與上次相比', '—', '有兩次紀錄後出現');
    tile('這次最高分', '—', '等第一次段考');
  }
  const dots = el('div', { class: 'dots', 'aria-hidden': 'true' });
  const done = new Set(sittings.map(sittingKey));
  for (const slot of ALL_SLOTS) dots.append(el('i', { class: done.has(sittingKey(slot)) ? 'on' : '' }));
  tile('已完成段考', [String(sittings.length), ' / 18'], null, dots);

  // 學習總評
  const vc = document.getElementById('verdictCard');
  vc.replaceChildren(el('h2', { text: '學習總評' }));
  if (!latest) {
    vc.append(emptyBlock('還沒有段考紀錄', '家長登錄第一次段考成績後，這裡會出現總評。'));
  } else {
    const avg = formatScore(latest.average);
    const explain = {
      peak: `這次平均 ${avg} 分，高過自己之前 ${sittings.length - 1} 次的紀錄。`,
      progress: `這次平均 ${avg} 分，明顯高於自己過去的平均水準。`,
      stable: `這次平均 ${avg} 分，落在自己平常的範圍裡。`,
      fluctuation: `這次平均 ${avg} 分，可能遇到比較有挑戰的題目，下次再看看。`,
      insufficient_data: `已經記錄 ${sittings.length} 次段考，累積滿 4 次後會開始跟自己的歷史比較。`,
    }[category];
    vc.append(el('div', { class: 'verdict' },
      el('div', { class: 'verdict__head' },
        el('p', { class: 'verdict__title', text: CATEGORY_LABEL[category] }),
        el('span', { class: `tag tag--${category}`, text: slotLongLabel(latest) })),
      el('p', { text: explain })));
  }

  // 校排名
  const rc = document.getElementById('rankCard');
  rc.replaceChildren(el('h2', { text: '校排名' }));
  // 用最新一筆排名（可能比最新成績更新，例如排名先登、成績還沒登）
  const latestRank = [...rankings].sort((a, b) => sittingOrder(a) - sittingOrder(b)).at(-1);
  if (!latestRank) {
    rc.append(el('p', { class: 'hint', text: '還沒有排名紀錄。' }));
  } else {
    rc.append(
      el('div', { class: 'rank' },
        el('span', { class: 'rank__of', text: '第' }),
        el('span', { class: 'rank__n', text: String(latestRank.rank) }),
        el('span', { class: 'rank__of', text: `名／共 ${latestRank.total_students} 人` })),
      el('p', { class: 'rank__delta', text: rankDeltaText(rankChange(rankings, latestRank)) }),
      el('p', { class: 'hint', text: slotLongLabel(latestRank) }));
  }

  // 里程碑：最近 3 個 + 看全部
  const mc = document.getElementById('milestoneCard');
  mc.replaceChildren(el('h2', {}, '里程碑', el('small', { text: `已達成 ${milestones.length} 個` })));
  if (!milestones.length) {
    mc.append(el('p', { class: 'hint', text: '第一次段考記錄後，就會拿到第一個里程碑。' }));
  } else {
    const recent = [...milestones].reverse();
    mc.append(milestoneList(recent.slice(0, 3)));
    if (recent.length > 3) {
      const more = el('details', { class: 'more' }, el('summary', { text: `看全部 ${recent.length} 個` }));
      more.append(milestoneList(recent.slice(3)));
      mc.append(more);
    }
  }
}

function milestoneList(items) {
  const ul = el('ul', { class: 'milestones' });
  for (const m of items) {
    const ic = el('span', { class: 'milestone__icon' });
    ic.append(icon(MILESTONE_ICON[m.id] || 'leaf'));
    ul.append(el('li', { class: 'milestone' }, ic,
      el('div', {},
        el('p', { class: 'milestone__title', text: m.title }),
        el('p', { class: 'milestone__meta', text: `${slotLongLabel(m.at)}・${m.detail}` }))));
  }
  return ul;
}

/* ================= 圖表 ================= */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// canvas 不吃 color-mix()，先讓瀏覽器算出實際顏色
function resolvedColor(varName) {
  const probe = el('span', { style: `color: var(${varName}); display: none` });
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

function withAlpha(rgb, alpha) {
  const m = rgb.match(/\d+(\.\d+)?/g);
  return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})` : rgb;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// 手繪風註解：在指定點畫一圈不規則圓 + 文字
const handNote = {
  id: 'handNote',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.index == null || opts.index < 0) return;
    const pt = chart.getDatasetMeta(0).data[opts.index];
    if (!pt) return;
    const { ctx } = chart;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2.15; a += 0.2) {
      const r = 13 + Math.sin(a * 3) * 1.6;
      const x = pt.x + Math.cos(a) * r;
      const y = pt.y + Math.sin(a) * r * 0.85;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = opts.color;
    ctx.font = "15px Huninn, 'Noto Sans TC', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText(opts.label, pt.x, pt.y - 22);
    ctx.restore();
  },
};

function destroyCharts() {
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
}

function axisX() {
  return { grid: { display: false }, ticks: { color: cssVar('--ink-soft'), font: { size: 12 }, autoSkip: false, maxRotation: 0 } };
}

// extra 的 plugins 與 base 合併（淺層展開會把預設 tooltip 整個蓋掉）
function baseOptions(extra = {}) {
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion() ? false : { duration: 400 },
    plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
    scales: {
      x: axisX(),
      y: { grace: '10%', grid: { color: '#EFE9E1' }, ticks: { color: cssVar('--ink-soft'), precision: 0 }, border: { display: false } },
    },
  };
  return { ...base, ...extra, plugins: { ...base.plugins, ...extra.plugins } };
}

// X 軸：第一行是第幾次，學期名稱只標在該學期第一次，避免 18 個長標籤擠在一起
const SLOT_LABELS = ALL_SLOTS.map((s) => [String(s.exam_type), s.exam_type === 1 ? `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}` : '']);

function showEmptyChart(card, title, body) {
  card.querySelectorAll('.chart-scroll, .chart-box--radar, .scroll-hint').forEach((n) => (n.hidden = true));
  card.append(emptyBlock(title, body));
}

function resetCard(id) {
  const card = document.getElementById(id);
  card.querySelectorAll('.empty, .chart-data').forEach((n) => n.remove());
  card.querySelectorAll('.chart-scroll, .chart-box--radar, .scroll-hint').forEach((n) => (n.hidden = false));
  return card;
}

// 圖表下方可收合的數據表：canvas 對報讀器與鍵盤使用者沒有內容，數字在這裡都讀得到
function chartDataTable(caption, headers, rows) {
  const table = el('table', { class: 'score-table' }, el('caption', { class: 'visually-hidden', text: caption }));
  const hr = el('tr');
  for (const head of headers) hr.append(el('th', { scope: 'col', text: head }));
  const tb = el('tbody');
  for (const row of rows) {
    const tr = el('tr', {}, el('th', { scope: 'row', text: row[0] }));
    for (const cell of row.slice(1)) tr.append(el('td', { class: 'num', text: cell }));
    tb.append(tr);
  }
  table.append(el('thead', {}, hr), tb);
  return el('details', { class: 'more chart-data' }, el('summary', { text: '看數據表' }), el('div', { class: 'table-scroll' }, table));
}

function radarChart(canvas, latest, prev, accent) {
  const ink = cssVar('--ink-soft');
  const datasets = [{
    label: slotShortLabel(latest), data: state.subjects.map((s) => latest.scores[s.code] ?? null),
    borderColor: accent, backgroundColor: withAlpha(accent, 0.22), borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: accent,
  }];
  if (prev) {
    datasets.push({
      label: slotShortLabel(prev), data: state.subjects.map((s) => prev.scores[s.code] ?? null),
      borderColor: '#8A8390', backgroundColor: 'transparent', borderDash: [5, 4], borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#8A8390',
    });
  }
  canvas.setAttribute('aria-label', `科目雷達圖：${slotShortLabel(latest)} ${state.subjects.map((s) => `${s.display_name} ${latest.scores[s.code] ?? '未登錄'}`).join('、')}`);
  return new Chart(canvas, {
    type: 'radar',
    data: { labels: state.subjects.map((s) => s.display_name), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 400 },
      plugins: { legend: { position: 'bottom', labels: { color: ink, boxWidth: 14, usePointStyle: true } } },
      scales: {
        r: {
          suggestedMin: 50, suggestedMax: 100,
          ticks: { stepSize: 10, color: ink, backdropColor: 'transparent', showLabelBackdrop: false },
          grid: { color: '#EAE3DA' }, angleLines: { color: '#EAE3DA' },
          pointLabels: { color: cssVar('--ink'), font: { size: 13 } },
        },
      },
    },
  });
}

function renderGrowth(d) {
  destroyCharts();
  const { sittings, rankings } = d;
  const accent = resolvedColor('--accent');
  const accentInk = resolvedColor('--accent-ink');
  const byKey = new Map(sittings.map((s) => [sittingKey(s), s]));

  // 平均走勢
  const avgCard = resetCard('avgCard');
  if (!sittings.length) {
    showEmptyChart(avgCard, '還沒有段考紀錄', '第一次段考登錄後，這裡會出現走勢線。');
  } else {
    const series = ALL_SLOTS.map((s) => (byKey.has(sittingKey(s)) ? round1(byKey.get(sittingKey(s)).average) : null));
    const maxIdx = series.reduce((best, v, i) => (v != null && (best < 0 || v > series[best]) ? i : best), -1);
    const canvas = document.getElementById('avgChart');
    canvas.setAttribute('aria-label', `平均走勢：最新 ${formatScore(sittings.at(-1).average)} 分，最高 ${formatScore(series[maxIdx])} 分（${slotLongLabel(ALL_SLOTS[maxIdx])}）`);
    state.charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels: SLOT_LABELS, datasets: [{ data: series, borderColor: accent, backgroundColor: accent, pointBackgroundColor: '#fff', pointBorderWidth: 2.5, pointRadius: 5, borderWidth: 3, tension: 0.35 }] },
      options: baseOptions({
        plugins: { legend: { display: false }, handNote: sittings.length > 1 ? { index: maxIdx, color: accentInk, label: '最高' } : {} },
        layout: { padding: { top: 28 } },
      }),
      plugins: [handNote],
    }));
    avgCard.append(chartDataTable('各次段考平均', ['段考', '平均'], sittings.map((s) => [slotLongLabel(s), formatScore(s.average)])));
  }

  // 科目走勢
  if (!state.subject || !state.subjects.some((s) => s.code === state.subject)) state.subject = state.subjects[0]?.code;
  const chips = document.getElementById('subjectChips');
  chips.replaceChildren();
  for (const subj of state.subjects) {
    const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(subj.code === state.subject), 'data-focus-key': `subject-${subj.code}`, text: subj.display_name });
    b.addEventListener('click', () => {
      state.subject = subj.code;
      state.focusKey = `subject-${subj.code}`;
      render();
    });
    chips.append(b);
  }
  const subjCard = resetCard('subjectCard');
  if (!sittings.length) {
    showEmptyChart(subjCard, '還沒有科目分數', '有紀錄後可以切換各科查看。');
  } else {
    const series = ALL_SLOTS.map((s) => byKey.get(sittingKey(s))?.scores[state.subject] ?? null);
    const canvas = document.getElementById('subjectChart');
    const latestScore = sittings.at(-1).scores[state.subject];
    canvas.setAttribute('aria-label', `${subjectName(state.subject)}走勢：最新 ${latestScore ?? '未登錄'}`);
    state.charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels: SLOT_LABELS, datasets: [{ data: series, borderColor: accentInk, pointBackgroundColor: '#fff', pointBorderWidth: 2.5, pointRadius: 5, borderWidth: 2.5, tension: 0.35 }] },
      options: baseOptions(),
    }));
    subjCard.append(chartDataTable(`${subjectName(state.subject)}各次分數`, ['段考', subjectName(state.subject)],
      sittings.map((s) => [slotLongLabel(s), s.scores[state.subject] == null ? '未登錄' : String(s.scores[state.subject])])));
  }

  // 校排名（反向 Y 軸：越上面名次越前）
  const rankCard = resetCard('rankTrendCard');
  const rankByKey = new Map(rankings.map((r) => [sittingKey(r), r]));
  if (rankings.length < 2) {
    showEmptyChart(rankCard, rankings.length ? '目前只有一筆排名' : '還沒有排名紀錄', '累積兩次以上的排名，就能看到走勢。');
  } else {
    const series = ALL_SLOTS.map((s) => rankByKey.get(sittingKey(s))?.rank ?? null);
    const latestRank = [...rankings].sort((a, b) => sittingOrder(a) - sittingOrder(b)).at(-1);
    const canvas = document.getElementById('rankChart');
    canvas.setAttribute('aria-label', `校排名走勢：最新第 ${latestRank.rank} 名／共 ${latestRank.total_students} 人`);
    state.charts.push(new Chart(canvas, {
      type: 'line',
      data: { labels: SLOT_LABELS, datasets: [{ data: series, borderColor: accent, pointBackgroundColor: accent, pointRadius: 4, borderWidth: 2.5, borderDash: [6, 5], tension: 0.3, spanGaps: true }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => { const r = rankByKey.get(sittingKey(ALL_SLOTS[c.dataIndex])); return r ? `第 ${r.rank} 名／共 ${r.total_students} 人` : ''; } } },
        },
        scales: {
          x: axisX(),
          y: { reverse: true, grace: '8%', grid: { color: '#EFE9E1' }, ticks: { color: cssVar('--ink-soft'), precision: 0, callback: (v) => `第 ${v} 名` }, border: { display: false } },
        },
      }),
    }));
    rankCard.append(chartDataTable('各次校排名', ['段考', '名次', '全校人數'],
      [...rankings].sort((a, b) => sittingOrder(a) - sittingOrder(b)).map((r) => [slotLongLabel(r), `第 ${r.rank} 名`, `${r.total_students} 人`])));
  }

  // 雷達：本次 vs 上次
  const radarCard = resetCard('radarCard');
  const latest = sittings.at(-1);
  const prev = sittings.at(-2);
  document.getElementById('radarCaption').textContent = latest ? `${slotShortLabel(latest)} vs ${prev ? slotShortLabel(prev) : '—'}` : '';
  if (!latest) showEmptyChart(radarCard, '還沒有段考紀錄', '有紀錄後會用雷達圖比較各科。');
  else {
    state.charts.push(radarChart(document.getElementById('radarChart'), latest, prev, accent));
    radarCard.append(chartDataTable('本次與上次各科分數', ['科目', '本次', '上次'],
      state.subjects.map((subj) => [subj.display_name, latest.scores[subj.code] == null ? '未登錄' : String(latest.scores[subj.code]),
        !prev ? '—' : prev.scores[subj.code] == null ? '未登錄' : String(prev.scores[subj.code])])));
  }

  // 學期比較
  const tc = document.getElementById('termCard');
  tc.replaceChildren(el('h2', { text: '學期比較' }));
  const terms = termAverages(sittings);
  if (!terms.length) {
    tc.append(el('p', { class: 'hint', text: '有段考紀錄後，這裡會列出每個學期的平均。' }));
  } else {
    const grid = el('div', { class: 'terms' });
    for (const t of terms) {
      grid.append(el('div', { class: 'term' },
        el('p', { class: 'term__label', text: `${GRADE_LABEL[t.grade]}${SEMESTER_LABEL[t.semester]}` }),
        el('p', { class: 'term__value' }, formatScore(t.average), el('small', { text: t.count < 3 ? `　${t.count}/3 次` : '' }))));
    }
    tc.append(grid);
  }
}

/* ================= 學年地圖 ================= */
function renderMap(d) {
  const { sittings } = d;
  const wrap = document.getElementById('yearMap');
  wrap.replaceChildren();
  const averages = sittings.map((s) => s.average);
  const byKey = new Map(sittings.map((s) => [sittingKey(s), s]));
  const best = sittings.length ? sittings.reduce((a, b) => (b.average > a.average ? b : a)) : null;
  const bestKey = sittings.length >= 3 ? sittingKey(best) : null;
  const nextSlot = ALL_SLOTS.find((s) => !byKey.has(sittingKey(s)));

  // 視覺上是格狀；每格自帶完整說明，表頭對報讀器隱藏（避免錯誤的 grid ARIA）
  const grid = el('div', { class: 'yearmap' });
  const hiddenHead = (cls, text) => el('span', { class: cls, text, 'aria-hidden': 'true' });
  grid.append(el('span', { class: 'yearmap__corner', 'aria-hidden': 'true' }), hiddenHead('yearmap__term', '上學期'), hiddenHead('yearmap__term', '下學期'));
  grid.append(el('span', { class: 'yearmap__corner', 'aria-hidden': 'true' }));
  for (let i = 0; i < 6; i++) grid.append(hiddenHead('yearmap__colhead', `第${['一', '二', '三'][i % 3]}次`));

  for (const g of [1, 2, 3]) {
    grid.append(hiddenHead('yearmap__rowhead', GRADE_LABEL[g]));
    for (const slot of ALL_SLOTS.filter((s) => s.grade === g)) {
      const s = byKey.get(sittingKey(slot));
      if (!s) {
        const isNext = nextSlot && sittingKey(nextSlot) === sittingKey(slot);
        grid.append(el('span', { class: `cell cell--empty${isNext ? ' cell--next' : ''}` },
          isNext ? el('span', { text: '下一次', style: 'display:block', 'aria-hidden': 'true' }) : null,
          el('span', { class: 'visually-hidden', text: `${slotLongLabel(slot)}：${isNext ? '下一次段考' : '還沒考'}` })));
        continue;
      }
      const isBest = sittingKey(s) === bestKey;
      grid.append(el('a', {
        class: `cell cell--l${heatLevel(s.average, averages)}${isBest ? ' cell--best' : ''}`,
        href: `#/exam/${sittingKey(s)}`,
        'aria-label': `${slotLongLabel(s)}，平均 ${formatScore(s.average)} 分${isBest ? '，目前最高' : ''}，開啟段考回顧`,
      }, el('b', { text: formatScore(s.average) }), el('span', { text: '平均' })));
    }
  }
  wrap.append(grid);

  const legend = el('div', { class: 'legend' });
  if (sittings.length < 3) {
    legend.append(el('span', { text: `目前 ${sittings.length} 筆紀錄；滿 3 筆後，格子會依「跟自己比的高低」顯示深淺。` }));
  } else {
    const scale = el('span', { class: 'legend__scale', 'aria-hidden': 'true' });
    for (const lv of [1, 2, 3, 4]) scale.append(el('i', { class: `cell--l${lv}` }));
    legend.append(el('span', {}, '自己的較低 ', scale, ' 自己的較高'));
    legend.append(el('span', {}, el('i', { class: 'legend__best' }), ' 目前最高'));
  }
  legend.append(el('span', {}, el('i', { class: 'legend__empty' }), ' 還沒考'));
  wrap.append(legend);
  if (!sittings.length) wrap.append(el('p', { class: 'hint', text: '還沒有任何段考紀錄，整張地圖等著被填滿。' }));

  const aside = document.getElementById('mapAside');
  aside.replaceChildren(el('h2', { text: '怎麼看這張地圖' }),
    el('p', { style: 'margin:0 0 12px', text: '每一格是一次段考。顏色越深，代表那次平均在自己的紀錄裡越高——只跟自己比，不跟別人比。' }));
  const facts = el('div', { class: 'terms' });
  const fact = (label, value) => facts.append(el('div', { class: 'term' }, el('p', { class: 'term__label', text: label }), el('p', { class: 'term__value', text: value })));
  fact('已走過', `${sittings.length} / 18`);
  if (best) fact('目前最高', formatScore(best.average));
  aside.append(facts);
  if (best) aside.append(el('p', { class: 'hint', text: `最高那次是${slotLongLabel(best)}。` }));
}

/* ================= 段考回顧 ================= */
function renderExam(d, key) {
  const body = document.getElementById('examBody');
  body.replaceChildren();
  const { sittings, examScores, rankings, milestones } = d;
  const idx = sittings.findIndex((s) => sittingKey(s) === key);
  if (idx === -1) {
    const box = emptyBlock('這次段考還沒有紀錄', '回到學年地圖，選一個已經有分數的格子。');
    box.append(el('p', {}, el('a', { href: '#/map', class: 'btn', text: '回學年地圖' })));
    body.append(el('h1', { class: 'visually-hidden', id: 'examTitle', text: '段考回顧' }), el('div', { class: 'card' }, box));
    return;
  }
  const s = sittings[idx];
  const prev = sittings[idx - 1];
  const next = sittings[idx + 1];

  // 沒有上一次／下一次時輸出不可聚焦的 span，避免鍵盤按到 href="#" 被丟回首頁
  const pageLink = (target, text) => (target
    ? el('a', { class: 'btn', href: `#/exam/${sittingKey(target)}`, text })
    : el('span', { class: 'btn', 'aria-disabled': 'true' },
      el('span', { 'aria-hidden': 'true', text }), el('span', { class: 'visually-hidden', text: `${text}（沒有了）` })));
  body.append(el('div', { class: 'exam-head' },
    el('h1', { id: 'examTitle', text: slotLongLabel(s) }),
    el('div', { class: 'pager' }, pageLink(prev, '← 上一次'), pageLink(next, '下一次 →'))));

  const left = el('div', { class: 'stack' });
  const right = el('div', { class: 'stack' });
  body.append(el('div', { class: 'cols' }, left, right));

  const category = classifyScore(s.average, sittings.slice(0, idx).map((x) => x.average));
  const tilesBox = el('div', { class: 'tiles' });
  const t = (label, value, note) => tilesBox.append(el('div', { class: 'tile' },
    el('p', { class: 'tile__label', text: label }), el('p', { class: 'tile__value', text: value }), el('p', { class: 'tile__note', text: note })));
  t('本次平均', formatScore(s.average), diffText(s.average, prev?.average));
  t('判定', CATEGORY_LABEL[category], '跟自己過去比');
  const rank = rankings.find((r) => sittingKey(r) === key);
  t('校排名', rank ? `第 ${rank.rank} 名` : '—', rank ? `共 ${rank.total_students} 人・${rankDeltaText(rankChange(rankings, s))}` : '這次沒有排名');
  t('登錄科目', `${s.subjectCount} / ${state.subjects.length}`, s.subjectCount < state.subjects.length ? '有科目未登錄' : '各科齊全');
  left.append(tilesBox);

  const star = highlightSubject(s, prev, state.subjects);
  if (star) {
    left.append(el('div', { class: 'card highlight' },
      el('span', { class: 'highlight__mark', 'aria-hidden': 'true', text: '✦' }),
      el('div', {},
        el('p', { class: 'tile__label', text: '這次最亮眼' }),
        el('p', { class: 'verdict__title', text: `${subjectName(star.code)} ${star.score} 分` }),
        el('p', { class: 'hint', text: star.gain ? `比上次多 ${round1(star.gain)} 分` : '這次分數最高的科目' }))));
  }

  const table = el('table', { class: 'score-table' });
  table.append(el('thead', {}, el('tr', {}, el('th', { text: '科目' }), el('th', { text: '分數' }), el('th', { text: '和上次比' }), el('th', { text: '判定' }))));
  const tb = el('tbody');
  for (const subj of state.subjects) {
    const score = s.scores[subj.code];
    const cat = score == null ? null : classifySubjectAt(examScores, subj.code, s);
    const prevScore = prev?.scores[subj.code];
    let delta = '—';
    if (score == null) delta = '未登錄';
    else if (prevScore != null) delta = score > prevScore ? `+${round1(score - prevScore)}` : score === prevScore ? '持平' : `相差 ${round1(prevScore - score)}`;
    tb.append(el('tr', {},
      el('td', { text: subj.display_name }),
      el('td', { class: 'num', text: score == null ? '—' : String(score) }),
      el('td', { class: 'delta', text: delta }),
      el('td', {}, cat ? el('span', { class: `tag tag--${cat}`, text: CATEGORY_LABEL[cat] }) : el('span', { class: 'hint', text: '—' }))));
  }
  table.append(tb);
  left.append(el('div', { class: 'card' }, el('h2', { text: '各科分數' }), el('div', { class: 'table-scroll' }, table)));

  const canvas = el('canvas', { role: 'img', 'aria-label': '本次與上次各科分數雷達圖' });
  right.append(el('div', { class: 'card' },
    el('h2', {}, '科目雷達', el('small', { text: prev ? `本次 vs ${slotShortLabel(prev)}` : '第一次，沒有上次可比' })),
    el('div', { class: 'chart-box chart-box--radar' }, canvas)));
  state.charts.push(radarChart(canvas, s, prev, resolvedColor('--accent')));

  const quote = category === 'insufficient_data' ? null : quoteForSitting(state.quotes, category, s);
  right.append(el('div', { class: 'card' }, el('h2', { text: '給這次的一句話' }),
    el('p', { class: 'bubble', text: quote ? quote.content : INSUFFICIENT_QUOTE })));

  const gained = milestones.filter((m) => sittingKey(m.at) === key);
  const mc = el('div', { class: 'card' }, el('h2', {}, '這次的里程碑', el('small', { text: `${gained.length} 個` })));
  mc.append(gained.length ? milestoneList(gained) : el('p', { class: 'hint', text: '這次沒有新的里程碑，持續記錄就會累積。' }));
  right.append(mc);
}

/* ================= 歷史紀錄 ================= */
function renderHistory(d) {
  const body = document.getElementById('historyBody');
  body.replaceChildren();
  const { sittings } = d;
  if (!sittings.length) {
    body.append(emptyBlock('還沒有段考紀錄', '家長登錄成績後會依時間列在這裡。'));
    return;
  }
  const rows = [...sittings].reverse();
  const makeBody = (list) => {
    const tb = el('tbody');
    for (const s of list) {
      const tr = el('tr', {}, el('td', {}, el('a', { href: `#/exam/${sittingKey(s)}`, text: slotLongLabel(s) })));
      for (const subj of state.subjects) tr.append(el('td', { class: 'num', text: s.scores[subj.code] == null ? '—' : String(s.scores[subj.code]) }));
      tr.append(el('td', { class: 'num', text: formatScore(s.average) }));
      tb.append(tr);
    }
    return tb;
  };
  const head = el('tr', {}, el('th', { text: '段考' }));
  for (const subj of state.subjects) head.append(el('th', { text: subj.display_name }));
  head.append(el('th', { text: '平均' }));
  const older = makeBody(rows.slice(3));
  older.hidden = true;
  body.append(el('div', { class: 'table-scroll' }, el('table', { class: 'score-table' }, el('thead', {}, head), makeBody(rows.slice(0, 3)), older)));
  if (rows.length > 3) {
    const btn = el('button', { class: 'btn', type: 'button', style: 'margin-top:12px', text: `顯示更早的 ${rows.length - 3} 次` });
    btn.addEventListener('click', () => {
      older.hidden = false;
      btn.remove();
      older.querySelector('a')?.focus(); // 焦點移到第一筆新顯示的紀錄
    });
    body.append(btn);
  }
}

/* ================= 路由 ================= */
const VIEW_TITLE = { home: '首頁', growth: '成長圖表', map: '學年地圖', history: '歷史紀錄', exam: '段考回顧' };

function route() {
  return parseRoute(location.hash, VIEW_TITLE);
}

function render() {
  const msg = document.getElementById('loadMsg');
  try {
    renderView();
    msg.className = 'load-msg';
    msg.textContent = '';
  } catch (error) {
    console.error(error);
    msg.className = 'load-msg load-msg--error';
    msg.textContent = '畫面載入失敗，請重新整理頁面。';
  } finally {
    state.focusKey = null;
  }
}

function renderView() {
  const s = student();
  document.documentElement.style.setProperty('--accent', safeThemeColor(s.theme_color, DEFAULT_ACCENT));
  renderSwitch();

  const r = route();
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== r.name));
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.route === r.name) a.setAttribute('aria-current', 'page');
    else if (r.name === 'exam' && a.dataset.route === 'map') a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  document.title = `${VIEW_TITLE[r.name]}・成長記錄本`;

  destroyCharts();
  const d = studentData();
  if (r.name === 'home') renderHome(d);
  if (r.name === 'growth') renderGrowth(d);
  if (r.name === 'map') renderMap(d);
  if (r.name === 'history') renderHistory(d);
  if (r.name === 'exam') renderExam(d, r.arg);

  // 不把資料字串拼進 CSS 選擇器（科目代碼含引號會讓 querySelector 丟錯）
  if (state.focusKey) [...document.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === state.focusKey)?.focus();
}

async function init() {
  const msg = document.getElementById('loadMsg');
  try {
    await loadAll();
  } catch (error) {
    console.error(error);
    msg.className = 'load-msg load-msg--error';
    msg.textContent = '資料讀取失敗，請稍後重新整理頁面。';
    return;
  }
  if (!state.students.length) {
    msg.textContent = '還沒有學生資料，請家長先在 Supabase 新增學生。';
    return;
  }
  msg.textContent = '';

  const saved = storageGet(STORAGE_STUDENT, null);
  state.studentId = state.students.some((s) => s.id === saved) ? saved : state.students[0].id;

  // 學生鈕重繪後把焦點還回去
  document.getElementById('studentSwitch').addEventListener('click', (e) => {
    state.focusKey = e.target.closest('[data-focus-key]')?.dataset.focusKey ?? null;
  }, true);

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
    // 換頁後焦點移到該頁標題，讓報讀器知道內容換了
    const view = document.querySelector('.view:not([hidden])');
    const heading = view?.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  });

  render();
  document.fonts?.ready.then(() => { if (route().name === 'growth') render(); }); // 字型載入後重畫 canvas 上的手寫字
}

document.addEventListener('DOMContentLoaded', init);
