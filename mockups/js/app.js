// Phase 0 前台模擬：hash route（#/home、#/growth、#/map、#/history、#/exam/g-s-e）+ 學生切換。
// 所有使用者可見字串以 textContent / 已知常數組成；正式版的英文名、小語一律走 textContent。

const params = new URLSearchParams(location.search);
if (params.has('shot')) document.documentElement.classList.add('is-shot');

const AVATAR_SRC = (preset) => `avatars/${preset}.svg`;
const state = { studentId: params.get('student') === 'milo' ? 'milo' : 'enisa', subject: 'math', charts: [] };

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
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
const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ICONS.star; // 固定常數，非使用者資料
  return s;
};

function student() {
  return MOCK_STUDENTS.find((s) => s.id === state.studentId);
}

function data() {
  const { examScores, examRankings } = mockRecordsFor(state.studentId);
  const sittings = buildSittings(examScores);
  return {
    examScores,
    rankings: examRankings,
    sittings,
    milestones: computeMilestones(sittings, examRankings, MOCK_SUBJECTS),
  };
}

const subjectName = (code) => MOCK_SUBJECTS.find((s) => s.code === code)?.display_name ?? code;
const fmt = (n) => (n == null ? '—' : round1(n).toFixed(1));

function diffText(cur, prev) {
  if (prev == null) return '第一次記錄';
  const d = round1(cur - prev);
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

function pickQuote(category) {
  const list = MOCK_QUOTES[category] || MOCK_QUOTES.insufficient_data;
  return list[0];
}

function emptyBlock(title, body) {
  const box = el('div', { class: 'empty' });
  box.append(icon('book'), el('strong', { text: title }), el('span', { text: body }));
  return box;
}

/* ================= 頁首 ================= */
function renderSwitch() {
  const wrap = document.getElementById('studentSwitch');
  wrap.replaceChildren();
  for (const s of MOCK_STUDENTS) {
    const btn = el('button', { class: 'student-chip', type: 'button', 'aria-pressed': String(s.id === state.studentId), 'data-focus-key': `student-${s.id}` });
    btn.style.setProperty('--chip-color', s.theme_color);
    btn.style.setProperty('--chip-soft', `color-mix(in srgb, ${s.theme_color} 16%, #fff)`);
    btn.append(el('img', { src: AVATAR_SRC(s.avatar_preset), alt: '' }), el('span', { text: s.name }));
    btn.addEventListener('click', () => {
      state.studentId = s.id;
      const u = new URL(location.href);
      u.searchParams.set('student', s.id);
      history.replaceState(null, '', u);
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

  const avatar = document.getElementById('greetAvatar');
  avatar.src = AVATAR_SRC(s.avatar_preset);
  avatar.alt = ''; // 緊接著就是「嗨，名字」，頭像視為裝飾
  avatar.onerror = () => { avatar.src = AVATAR_SRC('cat'); };
  document.getElementById('greetName').textContent = `嗨，${s.name}`;
  document.getElementById('greetQuote').textContent = pickQuote(category);

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
    tile('最新一次平均', fmt(latest.average), slotLongLabel(latest));
    const d1 = prev ? round1(latest.average - prev.average) : null;
    tile('與上次相比', d1 == null ? '—' : (d1 > 0 ? `+${d1.toFixed(1)}` : d1.toFixed(1)), diffText(latest.average, prev?.average));
    const best = Object.entries(latest.scores).sort((a, b) => b[1] - a[1])[0];
    tile('這次最高分', [subjectName(best[0]), ` ${best[1]}`], latest.subjectCount < MOCK_SUBJECTS.length ? `這次登錄 ${latest.subjectCount} 科` : '五科中最高');
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
    const box = el('div', { class: 'verdict' });
    const head = el('div', { class: 'verdict__head' },
      el('p', { class: 'verdict__title', text: CATEGORY_LABEL[category] }),
      el('span', { class: `tag tag--${category}`, text: slotLongLabel(latest) }));
    const historyCount = sittings.length - 1;
    const explain = {
      peak: `這次平均 ${fmt(latest.average)} 分，高過自己之前 ${historyCount} 次的紀錄。`,
      progress: `這次平均 ${fmt(latest.average)} 分，明顯高於自己過去的平均水準。`,
      stable: `這次平均 ${fmt(latest.average)} 分，落在自己平常的範圍裡。`,
      fluctuation: `這次平均 ${fmt(latest.average)} 分，可能遇到比較有挑戰的題目，下次再看看。`,
      insufficient_data: `已經記錄 ${sittings.length} 次段考，累積滿 4 次後會開始跟自己的歷史比較。`,
    }[category];
    box.append(head, el('p', { text: explain }));
    vc.append(box);
  }

  // 校排名
  const rc = document.getElementById('rankCard');
  rc.replaceChildren(el('h2', { text: '校排名' }));
  const latestRank = latest && rankings.find((r) => sittingKey(r) === sittingKey(latest));
  if (!latestRank) {
    rc.append(el('p', { class: 'hint', text: '還沒有排名紀錄。' }));
  } else {
    rc.append(
      el('div', { class: 'rank' },
        el('span', { class: 'rank__of', text: '第' }),
        el('span', { class: 'rank__n', text: String(latestRank.rank) }),
        el('span', { class: 'rank__of', text: `名／共 ${latestRank.total_students} 人` })),
      el('p', { class: 'rank__delta', text: rankDeltaText(rankChange(rankings, latest)) }),
      el('p', { class: 'hint', text: slotLongLabel(latest) }));
  }

  // 里程碑
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

// 以實際算出的顏色給 Chart.js（canvas 不吃 color-mix）
function resolvedColor(varName) {
  const probe = el('span', { style: `color: var(${varName}); display:none` });
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

// 手繪風註解：在最高點畫一圈不規則圓 + 「最高」字樣
const handNote = {
  id: 'handNote',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.index == null) return;
    const meta = chart.getDatasetMeta(0);
    const pt = meta.data[opts.index];
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
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
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

function baseOptions(extra = {}) {
  const ink = cssVar('--ink-soft');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
    plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink, font: { size: 11 }, autoSkip: false, maxRotation: 0 } },
      y: { grace: '10%', grid: { color: '#EFE9E1' }, ticks: { color: ink, precision: 0 }, border: { display: false } },
    },
    ...extra,
  };
}

function slotSeries(valueFor) {
  return ALL_SLOTS.map(valueFor);
}

function emptyChart(card, title, body) {
  const box = card.querySelector('.chart-scroll, .chart-box--radar');
  box.hidden = true;
  card.querySelector('.scroll-hint')?.setAttribute('hidden', '');
  card.append(emptyBlock(title, body));
}

function resetCard(id) {
  const card = document.getElementById(id);
  card.querySelectorAll('.empty').forEach((n) => n.remove());
  card.querySelectorAll('.chart-scroll, .chart-box--radar, .scroll-hint').forEach((n) => (n.hidden = false));
  return card;
}

function renderGrowth(d) {
  destroyCharts();
  const { sittings, rankings, examScores } = d;
  const accent = resolvedColor('--accent');
  const accentInk = resolvedColor('--accent-ink');
  // X 軸：第一行是第幾次，學期名稱只標在該學期第一次，避免 18 個長標籤擠在一起
  const labels = ALL_SLOTS.map((s) => [String(s.exam_type), s.exam_type === 1 ? `${GRADE_LABEL[s.grade]}${s.semester === 1 ? '上' : '下'}` : '']);
  const byKey = new Map(sittings.map((s) => [sittingKey(s), s]));

  // 平均走勢
  const avgCard = resetCard('avgCard');
  if (sittings.length === 0) {
    emptyChart(avgCard, '還沒有段考紀錄', '第一次段考登錄後，這裡會出現走勢線。');
  } else {
    const series = slotSeries((s) => (byKey.has(sittingKey(s)) ? round1(byKey.get(sittingKey(s)).average) : null));
    const maxIdx = series.reduce((best, v, i) => (v != null && (best < 0 || v > series[best]) ? i : best), -1);
    state.charts.push(new Chart(document.getElementById('avgChart'), {
      type: 'line',
      data: { labels, datasets: [{ data: series, borderColor: accent, backgroundColor: accent, pointBackgroundColor: '#fff', pointBorderWidth: 2.5, pointRadius: 5, borderWidth: 3, tension: 0.35, spanGaps: false }] },
      options: baseOptions({ plugins: { legend: { display: false }, handNote: sittings.length > 1 ? { index: maxIdx, color: accentInk, label: '最高' } : {} }, layout: { padding: { top: 28 } } }),
      plugins: [handNote],
    }));
  }

  // 科目走勢
  const chips = document.getElementById('subjectChips');
  chips.replaceChildren();
  for (const subj of MOCK_SUBJECTS) {
    const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(subj.code === state.subject), text: subj.display_name });
    b.setAttribute('data-focus-key', `subject-${subj.code}`);
    b.addEventListener('click', () => {
      state.subject = subj.code;
      renderGrowth(data());
      document.querySelector(`[data-focus-key="subject-${subj.code}"]`)?.focus();
    });
    chips.append(b);
  }
  const subjCard = resetCard('subjectCard');
  if (sittings.length === 0) {
    emptyChart(subjCard, '還沒有科目分數', '有紀錄後可以切換五個科目查看。');
  } else {
    const series = slotSeries((s) => byKey.get(sittingKey(s))?.scores[state.subject] ?? null);
    state.charts.push(new Chart(document.getElementById('subjectChart'), {
      type: 'line',
      data: { labels, datasets: [{ data: series, borderColor: accentInk, pointBackgroundColor: '#fff', pointBorderWidth: 2.5, pointRadius: 5, borderWidth: 2.5, tension: 0.35 }] },
      options: baseOptions(),
    }));
  }

  // 校排名（反向 Y 軸）
  const rankCard = resetCard('rankTrendCard');
  const rankByKey = new Map(rankings.map((r) => [sittingKey(r), r]));
  if (rankings.length < 2) {
    emptyChart(rankCard, rankings.length ? '目前只有一筆排名' : '還沒有排名紀錄', '累積兩次以上的排名，就能看到走勢。');
  } else {
    const series = slotSeries((s) => rankByKey.get(sittingKey(s))?.rank ?? null);
    state.charts.push(new Chart(document.getElementById('rankChart'), {
      type: 'line',
      data: { labels, datasets: [{ data: series, borderColor: accent, pointBackgroundColor: accent, pointRadius: 4, borderWidth: 2.5, borderDash: [6, 5], tension: 0.3 }] },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => { const r = rankByKey.get(sittingKey(ALL_SLOTS[c.dataIndex])); return `第 ${r.rank} 名／共 ${r.total_students} 人`; } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--ink-soft'), font: { size: 11 }, autoSkip: false, maxRotation: 0 } },
          y: { reverse: true, grace: '8%', grid: { color: '#EFE9E1' }, ticks: { color: cssVar('--ink-soft'), callback: (v) => `第 ${v} 名` }, border: { display: false } },
        },
      }),
    }));
  }

  // 雷達：本次 vs 上次
  const radarCard = resetCard('radarCard');
  const latest = sittings.at(-1);
  const prev = sittings.at(-2);
  document.getElementById('radarCaption').textContent = latest ? `${slotShortLabel(latest)} vs ${prev ? slotShortLabel(prev) : '—'}` : '';
  if (!latest) {
    emptyChart(radarCard, '還沒有段考紀錄', '有紀錄後會用雷達圖比較五科。');
  } else {
    state.charts.push(radarChart(document.getElementById('radarChart'), latest, prev, accent));
  }

  // 學期比較
  const tc = document.getElementById('termCard');
  tc.replaceChildren(el('h2', { text: '學期比較' }));
  const terms = new Map();
  for (const s of sittings) {
    const k = `${s.grade}-${s.semester}`;
    if (!terms.has(k)) terms.set(k, { grade: s.grade, semester: s.semester, list: [] });
    terms.get(k).list.push(s.average);
  }
  if (!terms.size) {
    tc.append(el('p', { class: 'hint', text: '有段考紀錄後，這裡會列出每個學期的平均。' }));
  } else {
    const grid = el('div', { class: 'terms' });
    for (const t of terms.values()) {
      const avg = t.list.reduce((a, b) => a + b, 0) / t.list.length;
      grid.append(el('div', { class: 'term' },
        el('p', { class: 'term__label', text: `${GRADE_LABEL[t.grade]}${SEMESTER_LABEL[t.semester]}` }),
        el('p', { class: 'term__value' }, fmt(avg), el('small', { text: t.list.length < 3 ? `　${t.list.length}/3 次` : '' }))));
    }
    tc.append(grid);
  }
}

function radarChart(canvas, latest, prev, accent) {
  const datasets = [{
    label: slotShortLabel(latest), data: MOCK_SUBJECTS.map((s) => latest.scores[s.code] ?? null),
    borderColor: accent, backgroundColor: accent.replace('rgb(', 'rgba(').replace(')', ', .22)'), borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: accent,
  }];
  if (prev) {
    datasets.push({
      label: slotShortLabel(prev), data: MOCK_SUBJECTS.map((s) => prev.scores[s.code] ?? null),
      borderColor: '#8A8390', backgroundColor: 'transparent', borderDash: [5, 4], borderWidth: 2, pointRadius: 2, pointBackgroundColor: '#8A8390',
    });
  }
  const ink = cssVar('--ink-soft');
  return new Chart(canvas, {
    type: 'radar',
    data: { labels: MOCK_SUBJECTS.map((s) => s.display_name), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 400 },
      plugins: { legend: { position: 'bottom', labels: { color: ink, boxWidth: 14, usePointStyle: true } } },
      scales: { r: { suggestedMin: 50, suggestedMax: 100, ticks: { stepSize: 10, color: ink, backdropColor: 'transparent', showLabelBackdrop: false }, grid: { color: '#EAE3DA' }, angleLines: { color: '#EAE3DA' }, pointLabels: { color: cssVar('--ink'), font: { size: 13 } } } },
    },
  });
}

/* ================= 學年地圖 ================= */
function renderMap(d) {
  const { sittings } = d;
  const wrap = document.getElementById('yearMap');
  wrap.replaceChildren();
  const averages = sittings.map((s) => s.average);
  const byKey = new Map(sittings.map((s) => [sittingKey(s), s]));
  const bestKey = sittings.length >= 3 ? sittingKey(sittings.reduce((a, b) => (b.average > a.average ? b : a))) : null;
  const nextSlot = ALL_SLOTS.find((s) => !byKey.has(sittingKey(s)));

  // 視覺上是格狀；語意上每格自帶完整說明（年級・學期・次別），表頭對報讀器隱藏，避免錯誤的 grid ARIA
  const grid = el('div', { class: 'yearmap' });
  const hiddenHead = (cls, text) => el('span', { class: cls, text, 'aria-hidden': 'true' });
  grid.append(el('span', { 'aria-hidden': 'true' }), hiddenHead('yearmap__term', '上學期'), hiddenHead('yearmap__term', '下學期'));
  grid.append(el('span', { 'aria-hidden': 'true' }));
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
      const level = heatLevel(s.average, averages);
      const isBest = sittingKey(s) === bestKey;
      const a = el('a', {
        class: `cell cell--l${level}${isBest ? ' cell--best' : ''}`,
        href: `#/exam/${sittingKey(s)}`,
        'aria-label': `${slotLongLabel(s)}，平均 ${fmt(s.average)} 分${isBest ? '，目前最高' : ''}，開啟段考回顧`,
      }, el('b', { text: fmt(s.average) }), el('span', { text: '平均' }));
      grid.append(a);
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

  // 側欄：怎麼看 + 摘要
  const aside = document.getElementById('mapAside');
  aside.replaceChildren(el('h2', { text: '怎麼看這張地圖' }));
  aside.append(
    el('p', { style: 'margin:0 0 12px', text: '每一格是一次段考。顏色越深，代表那次平均在自己的紀錄裡越高——只跟自己比，不跟別人比。' }));
  const facts = el('div', { class: 'terms' });
  const fact = (label, value) => facts.append(el('div', { class: 'term' }, el('p', { class: 'term__label', text: label }), el('p', { class: 'term__value', text: value })));
  fact('已走過', `${sittings.length} / 18`);
  if (sittings.length) {
    const best = sittings.reduce((a, b) => (b.average > a.average ? b : a));
    fact('目前最高', `${fmt(best.average)}`);
    aside.append(facts, el('p', { class: 'hint', text: `最高那次是${slotLongLabel(best)}。` }));
  } else {
    aside.append(facts);
  }
}

/* ================= 段考回顧 ================= */
function renderExam(d, key) {
  destroyCharts();
  const body = document.getElementById('examBody');
  body.replaceChildren();
  const { sittings, examScores, rankings, milestones } = d;
  const idx = sittings.findIndex((s) => sittingKey(s) === key);
  if (idx === -1) {
    body.append(el('div', { class: 'card' }, emptyBlock('這次段考還沒有紀錄', '回到學年地圖，選一個已經有分數的格子。')));
    body.querySelector('.empty').append(el('p', {}, el('a', { href: '#/map', class: 'btn', text: '回學年地圖' })));
    return;
  }
  const s = sittings[idx];
  const prev = sittings[idx - 1];
  const next = sittings[idx + 1];

  const head = el('div', { class: 'exam-head' }, el('h1', { id: 'examTitle', text: slotLongLabel(s) }));
  const pager = el('div', { class: 'pager' });
  // 沒有上一次／下一次時輸出不可聚焦的 span，避免鍵盤按到 href="#" 被丟回首頁
  const pageLink = (target, text) => (target
    ? el('a', { class: 'btn', href: `#/exam/${sittingKey(target)}`, text })
    : el('span', { class: 'btn', 'aria-disabled': 'true', text }));
  pager.append(pageLink(prev, '← 上一次'), pageLink(next, '下一次 →'));
  head.append(pager);
  body.append(head);

  const cols = el('div', { class: 'cols' });
  const left = el('div', { class: 'stack' });
  const right = el('div', { class: 'stack' });
  cols.append(left, right);
  body.append(cols);

  // 本次平均 + 最亮眼科目
  const historical = sittings.slice(0, idx).map((x) => x.average);
  const category = classifyScore(s.average, historical);
  const tilesBox = el('div', { class: 'tiles' });
  const t = (label, value, note) => tilesBox.append(el('div', { class: 'tile' },
    el('p', { class: 'tile__label', text: label }), el('p', { class: 'tile__value', text: value }), el('p', { class: 'tile__note', text: note })));
  t('本次平均', fmt(s.average), diffText(s.average, prev?.average));
  t('判定', CATEGORY_LABEL[category], '跟自己過去比');
  const rank = rankings.find((r) => sittingKey(r) === key);
  t('校排名', rank ? `第 ${rank.rank} 名` : '—', rank ? `共 ${rank.total_students} 人・${rankDeltaText(rankChange(rankings, s))}` : '這次沒有排名');
  t('登錄科目', `${s.subjectCount} / 5`, s.subjectCount < 5 ? '有科目未登錄' : '五科齊全');
  left.append(tilesBox);

  // 最亮眼：比上次進步最多的科目；第一次則取最高分
  let star = null;
  if (prev) {
    for (const [code, score] of Object.entries(s.scores)) {
      if (prev.scores[code] == null) continue;
      const gain = score - prev.scores[code];
      if (!star || gain > star.gain) star = { code, score, gain };
    }
  }
  if (!star || star.gain <= 0) {
    const [code, score] = Object.entries(s.scores).sort((a, b) => b[1] - a[1])[0];
    star = { code, score, gain: null };
  }
  const hl = el('div', { class: 'card highlight' },
    el('span', { class: 'highlight__mark', 'aria-hidden': 'true', text: '✦' }),
    el('div', {},
      el('p', { class: 'tile__label', text: '這次最亮眼' }),
      el('p', { class: 'verdict__title', text: `${subjectName(star.code)} ${star.score} 分` }),
      el('p', { class: 'hint', text: star.gain ? `比上次多 ${star.gain} 分` : '這次分數最高的科目' })));
  left.append(hl);

  // 各科分數表
  const table = el('table', { class: 'score-table' });
  table.append(el('thead', {}, el('tr', {}, el('th', { text: '科目' }), el('th', { text: '分數' }), el('th', { text: '和上次比' }), el('th', { text: '判定' }))));
  const tb = el('tbody');
  for (const subj of MOCK_SUBJECTS) {
    const score = s.scores[subj.code];
    const cat = score == null ? null : classifySubjectAt(examScores, subj.code, s);
    const prevScore = prev?.scores[subj.code];
    tb.append(el('tr', {},
      el('td', { text: subj.display_name }),
      el('td', { class: 'num', text: score == null ? '—' : String(score) }),
      el('td', { class: 'delta', text: score == null ? '未登錄' : prevScore == null ? '—' : score - prevScore > 0 ? `+${score - prevScore}` : score === prevScore ? '持平' : `相差 ${prevScore - score}` }),
      el('td', {}, cat ? el('span', { class: `tag tag--${cat}`, text: CATEGORY_LABEL[cat] }) : el('span', { class: 'hint', text: '—' }))));
  }
  table.append(tb);
  left.append(el('div', { class: 'card' }, el('h2', { text: '各科分數' }), el('div', { class: 'table-scroll' }, table)));

  // 雷達
  const radarBox = el('div', { class: 'chart-box chart-box--radar' });
  const canvas = el('canvas', { role: 'img', 'aria-label': '本次與上次各科分數雷達圖' });
  radarBox.append(canvas);
  right.append(el('div', { class: 'card' }, el('h2', {}, '科目雷達', el('small', { text: prev ? `本次 vs ${slotShortLabel(prev)}` : '第一次，沒有上次可比' })), radarBox));
  state.charts.push(radarChart(canvas, s, prev, resolvedColor('--accent')));

  // 當次小語 + 里程碑
  right.append(el('div', { class: 'card' }, el('h2', { text: '給這次的一句話' }), el('p', { class: 'bubble', text: pickQuote(category) })));
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
  const mk = (list) => {
    const tb = el('tbody');
    for (const s of list) {
      const tr = el('tr', {}, el('td', {}, el('a', { href: `#/exam/${sittingKey(s)}`, text: slotLongLabel(s) })));
      for (const subj of MOCK_SUBJECTS) tr.append(el('td', { class: 'num', text: s.scores[subj.code] == null ? '—' : String(s.scores[subj.code]) }));
      tr.append(el('td', { class: 'num', text: fmt(s.average) }));
      tb.append(tr);
    }
    return tb;
  };
  const table = el('table', { class: 'score-table' });
  const hr = el('tr', {}, el('th', { text: '段考' }));
  for (const subj of MOCK_SUBJECTS) hr.append(el('th', { text: subj.display_name }));
  hr.append(el('th', { text: '平均' }));
  table.append(el('thead', {}, hr), mk(rows.slice(0, 3)));
  const older = mk(rows.slice(3));
  older.hidden = true;
  table.append(older);
  body.append(el('div', { class: 'table-scroll' }, table));
  if (rows.length > 3) {
    const btn = el('button', { class: 'btn', type: 'button', style: 'margin-top:12px', 'aria-expanded': 'false', text: `顯示更早的 ${rows.length - 3} 次` });
    btn.addEventListener('click', () => {
      older.hidden = false;
      btn.remove();
      older.querySelector('a')?.focus(); // 焦點移到第一筆新顯示的紀錄
    });
    body.append(btn);
  }
}

/* ================= 路由 ================= */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  return { name: ['home', 'growth', 'map', 'history', 'exam'].includes(name) ? name : 'home', arg };
}

function render() {
  document.documentElement.dataset.student = state.studentId;
  renderSwitch();
  const r = route();
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.dataset.view !== r.name));
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.route === r.name) a.setAttribute('aria-current', 'page');
    else if (r.name === 'exam' && a.dataset.route === 'map') a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  const d = data();
  destroyCharts();
  if (r.name === 'home') renderHome(d);
  if (r.name === 'growth') renderGrowth(d);
  if (r.name === 'map') renderMap(d);
  if (r.name === 'history') renderHistory(d);
  if (r.name === 'exam') renderExam(d, r.arg);

  document.querySelectorAll('.mock-bar [data-mode]').forEach((a) => {
    const u = new URL(location.href);
    u.searchParams.set('data', a.dataset.mode);
    a.href = u.toString();
    a.setAttribute('aria-current', String(mockDataMode() === a.dataset.mode));
  });

  if (state.focusKey) document.querySelector(`[data-focus-key="${state.focusKey}"]`)?.focus();
  state.focusKey = null;
}

const VIEW_TITLE = { home: '首頁', growth: '成長圖表', map: '學年地圖', history: '歷史紀錄', exam: '段考回顧' };

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  // 換頁後把焦點移到該頁標題並更新 document.title，讓報讀器知道內容換了
  const r = route();
  const heading = document.querySelector(`.view[data-view="${r.name}"] h1, .view[data-view="${r.name}"] h2`);
  document.title = `${VIEW_TITLE[r.name]}・成長記錄本`;
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
});

// 重繪會重建按鈕；記住剛按的是哪一顆，重繪後把焦點還回去
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-focus-key]');
  state.focusKey = b ? b.dataset.focusKey : null;
}, true);
document.fonts?.ready.then(render);
render();
