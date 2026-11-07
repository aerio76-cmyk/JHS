// 學習資料庫 Phase 0 假資料：只有標題與資料夾結構，圖片一律用 CSS 佔位圖，不放任何真實教材圖片
/* exported MAT */
const MAT = (() => {
  // 頂層六類固定（is_system），自然、社會的子資料夾是預設種子（可改可刪），其餘是家長自訂示範
  const folders = [
    { id: 'chinese', parent: null, name: '國文', icon: 'chinese', hue: 14, system: true },
    { id: 'english', parent: null, name: '英文', icon: 'english', hue: 255, system: true },
    { id: 'math', parent: null, name: '數學', icon: 'math', hue: 44, system: true },
    { id: 'science', parent: null, name: '自然', icon: 'science', hue: 170, system: true },
    { id: 'social', parent: null, name: '社會', icon: 'social', hue: 198, system: true },
    { id: 'other', parent: null, name: '其他', icon: 'other', hue: 345, system: true },
    { id: 'sci-phy', parent: 'science', name: '理化' },
    { id: 'sci-bio', parent: 'science', name: '生物' },
    { id: 'sci-earth', parent: 'science', name: '地球科學' },
    { id: 'sci-phy-elec', parent: 'sci-phy', name: '電學' },
    { id: 'soc-his', parent: 'social', name: '歷史' },
    { id: 'soc-geo', parent: 'social', name: '地理' },
    { id: 'soc-civ', parent: 'social', name: '公民' },
    { id: 'math-formula', parent: 'math', name: '公式整理' },
    { id: 'eng-grammar', parent: 'english', name: '文法' },
    { id: 'chi-poem', parent: 'chinese', name: '古詩詞' },
  ];

  const T = [
    ['chinese', '形音義易混字整理', 1], ['chinese', '修辭法一覽', 1], ['chinese', '文言虛詞「之」的用法', 2],
    ['chinese', '成語接龍表（ㄅ–ㄇ）', 1], ['chinese', '應用文：書信格式', 2],
    ['english', '不規則動詞三態表', 1], ['english', '常用片語 50 個', 1],
    ['eng-grammar', '現在完成式 vs 過去式', 2], ['eng-grammar', '關係代名詞 who／which／that', 2], ['eng-grammar', '比較級與最高級規則', 1],
    ['math', '國一數學名詞對照', 1], ['math-formula', '乘法公式與展開', 2], ['math-formula', '畢氏定理圖解', 2],
    ['math-formula', '一元二次方程式解法流程', 3], ['math-formula', '三角形全等性質', 2], ['math-formula', '圓的弧長與扇形面積', 3],
    ['science', '實驗室安全守則', 1],
    ['sci-phy', '密度與浮力', 2], ['sci-phy', '酸鹼指示劑顏色表', 2], ['sci-phy', '牛頓三大運動定律', 3],
    ['sci-phy-elec', '歐姆定律整理', 3], ['sci-phy-elec', '串聯與並聯電路比較', 3],
    ['sci-bio', '細胞構造圖', 1], ['sci-bio', '人體消化系統', 1], ['sci-bio', '遺傳：孟德爾豌豆實驗', 2],
    ['sci-earth', '板塊運動示意', 3], ['sci-earth', '月相變化', 3],
    ['soc-his', '台灣史年代表', 1], ['soc-his', '中國朝代歌', 2], ['soc-his', '工業革命重點', 3],
    ['soc-geo', '台灣地形剖面', 1], ['soc-geo', '氣候類型與分布', 2], ['soc-geo', '經緯度判讀', 1],
    ['soc-civ', '三權分立架構', 3], ['soc-civ', '人權的類型', 3],
    ['other', '讀書計畫表範例', null], ['other', '考前一週複習清單', null],
  ];

  const learned = new Set([1, 5, 22, 30]);
  const base = Date.parse('2026-11-06T20:00:00+08:00');
  const materials = T.map(([folder, title, grade], i) => ({
    id: `m${i + 1}`, folder, title, grade,
    tall: i % 3 === 1,
    learned: learned.has(i),
    created: new Date(base - ((T.length - i) * 37 % 23) * 86400000 - i * 3600000),
  }));

  const byId = Object.fromEntries(folders.map(f => [f.id, f]));
  const children = id => folders.filter(f => f.parent === id);
  const path = id => { const p = []; for (let f = byId[id]; f; f = byId[f.parent]) p.unshift(f); return p; };
  const top = id => path(id)[0];
  const depth = id => path(id).length;
  const descendants = id => { const out = [id]; for (const c of children(id)) out.push(...descendants(c.id)); return out; };
  const inFolder = (id, { deep = false, includeLearned = false } = {}) => {
    const ids = deep ? new Set(descendants(id)) : new Set([id]);
    return materials.filter(m => ids.has(m.folder) && (includeLearned || !m.learned));
  };
  const hueOf = m => top(m.folder).hue;
  const GRADE = { 1: '國一', 2: '國二', 3: '國三' };
  const fmtDate = d => `${d.getMonth() + 1}/${d.getDate()}`;

  // 佔位圖（DOM 節點，不用 innerHTML 拼字串）
  function placeholder(m, extraClass = '') {
    const d = document.createElement('div');
    d.className = `ph ${m.tall ? 'ph--tall' : 'ph--wide'} ${extraClass}`.trim();
    d.style.setProperty('--h', hueOf(m));
    const s = document.createElement('span');
    s.textContent = '示意圖';
    d.appendChild(s);
    return d;
  }

  return { folders, materials, byId, children, path, top, depth, descendants, inFolder, hueOf, GRADE, fmtDate, placeholder };
})();
