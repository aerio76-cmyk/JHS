# 頁面導覽與返回（規劃書 v2.7 第十節）端對端測試（Edge）：本機 http 伺服器 + 假 Supabase，不連任何真實服務。
# 檢查：三個站每個畫面與狀態都有看得到的出口；管理員在家長管理與學習資料庫之間互通；段考回顧依來源返回；版面。
import sys, pathlib, json, subprocess, time, re
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).parent / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
FAKE = (pathlib.Path(__file__).parent / 'fakeSupabase.js').read_text(encoding='utf-8')
SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
PORT = 8767
B = f'http://127.0.0.1:{PORT}'
results = []
def ok(label, cond, note=''):
    results.append(('✓' if cond else '✗', label, note))

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)

EXITS = """(target) => [...document.querySelectorAll('a[href]')].filter((a) => {
  const r = a.getBoundingClientRect(); if (!r.width || !r.height) return false;
  if (a.closest('[hidden]') || getComputedStyle(a).visibility === 'hidden') return false;
  return new URL(a.href, location.href).pathname.endsWith(target);
}).map((a) => a.textContent.trim())"""

LAYOUT = """() => {
  const de = document.documentElement; const small = [];
  for (const el of document.querySelectorAll('header a, header button, main a, main button')) {
    const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
    if (el.closest('.crumbs [aria-current]') || el.closest('.tabs')) continue;
    if (b.height < 44 || b.width < 44) small.push(`${el.tagName}「${(el.textContent||'').trim().slice(0,8)}」${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  return { over: de.scrollWidth - de.clientWidth, small: small.slice(0, 5) };
}"""

with sync_playwright() as p:
    br = p.chromium.launch(channel='msedge')
    def new_page(url, w=1280, h=900):
        ctx = br.new_context(viewport={'width': w, 'height': h}, bypass_csp=True)
        pg = ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(SUPABASE_CDN, lambda r: r.fulfill(status=200, content_type='application/javascript', body=FAKE))
        def strip_sri(route):
            resp = route.fetch()
            route.fulfill(response=resp, body=re.sub(r'\s+integrity="[^"]+"', '', resp.text()))
        pg.route(re.compile(r'.*/(index|entry|materials)\.html.*'), strip_sri)
        pg.route('**/*.supabase.co/**', lambda r: r.abort())
        pg.goto(url)
        return ctx, pg, errs
    exits = lambda pg, target='index.html': pg.evaluate(EXITS, target)

    # ---------- index.html：段考回顧依來源返回 ----------
    ctx, pg, errs = new_page(f'{B}/index.html#/map')
    pg.wait_for_selector('a.cell', timeout=15000)
    ok('成長記錄本：品牌文字連到首頁', pg.locator('a.brand').get_attribute('href') == '#/home')
    pg.locator('a.cell').first.click()
    pg.wait_for_selector('[data-exam-back]')
    ok('從學年地圖進段考回顧：返回鈕「回學年地圖」，頁首標示學年地圖', pg.locator('[data-exam-back]').inner_text() == '回學年地圖' and pg.locator('.tabs a[data-route="map"]').get_attribute('aria-current') == 'true')
    pg.click('[data-exam-back]'); pg.wait_for_selector('a.cell')
    ok('按返回回到學年地圖', pg.evaluate('location.hash') == '#/map')
    pg.evaluate("location.hash = '#/history'"); pg.wait_for_selector('#historyBody a[href^="#/exam/"]')
    pg.locator('#historyBody a[href^="#/exam/"]').last.click()
    pg.wait_for_selector('[data-exam-back]')
    ok('從歷史紀錄進段考回顧：返回鈕「回歷史紀錄」，頁首標示歷史紀錄', pg.locator('[data-exam-back]').inner_text() == '回歷史紀錄' and pg.locator('.tabs a[data-route="history"]').get_attribute('aria-current') == 'true' and pg.locator('.tabs a[data-route="map"]').get_attribute('aria-current') is None)
    nxt = pg.locator('.pager a', has_text='下一次')
    if nxt.count():
        nxt.click(); pg.wait_for_timeout(300)
    ok('在段考回顧按上一次／下一次，來源不變', pg.locator('[data-exam-back]').inner_text() == '回歷史紀錄')
    pg.reload(); pg.wait_for_selector('[data-exam-back]')
    ok('重新整理後仍記得來源（sessionStorage）', pg.locator('[data-exam-back]').inner_text() == '回歷史紀錄')
    ok('返回鈕在內容最上方（標題之前）', pg.evaluate("(() => { const b = document.querySelector('[data-exam-back]').getBoundingClientRect().top; const h = document.getElementById('examTitle').getBoundingClientRect().top; return b < h; })()"))
    exam_url = pg.url
    ok('成長記錄本：頁尾有學習資料庫、家長登入', exits(pg, 'materials.html') == ['學習資料庫'] and exits(pg, 'entry.html') == ['家長登入'])
    ok('index 沒有 JS 錯誤', not errs, ' | '.join(errs[:2]))
    ctx.close()
    ctx, pg, errs = new_page(exam_url)
    pg.wait_for_selector('[data-exam-back]')
    ok('直接開段考回顧連結（新分頁）：預設回學年地圖', pg.locator('[data-exam-back]').inner_text() == '回學年地圖')
    pg.evaluate("location.hash = '#/exam/9-9-9'"); pg.wait_for_timeout(300)
    ok('不存在的段考：仍有返回鈕', pg.locator('[data-exam-back]').is_visible())
    pg.set_viewport_size({'width': 360, 'height': 800}); pg.evaluate("location.hash = '#/map'"); pg.wait_for_selector('a.cell'); pg.locator('a.cell').first.click(); pg.wait_for_selector('[data-exam-back]')
    r = pg.evaluate(LAYOUT)
    ok('段考回顧 360px：沒有橫向捲動', r['over'] == 0, json.dumps(r, ensure_ascii=False))
    pg.screenshot(path=str(OUT / 'nav-exam_360.png'), clip={'x': 0, 'y': 0, 'width': 360, 'height': 420})
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/index.html?fake=indexfail')
    pg.wait_for_selector('#loadActions:not([hidden])')
    ok('成長記錄本（資料讀取失敗）：有重新整理，頁尾出口仍在', pg.locator('#reloadBtn').is_visible() and exits(pg, 'materials.html') == ['學習資料庫'])
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/index.html?fake=nostudents')
    pg.wait_for_function("document.getElementById('loadMsg').textContent.includes('還沒有學生')")
    ok('成長記錄本（還沒有學生資料）：頁尾出口仍在', exits(pg, 'entry.html') == ['家長登入'])
    ctx.close()

    # ---------- entry.html ----------
    ctx, pg, errs = new_page(f'{B}/entry.html')
    pg.wait_for_selector('#entryPanel:not([hidden])')
    ok('家長管理（登入後）：頁首有「回成長記錄本」', exits(pg) == ['回成長記錄本'], str(exits(pg)))
    ok('家長管理：頁首有「學習資料庫（孩子端預覽）」', '學習資料庫（孩子端預覽）' in exits(pg, 'materials.html'), str(exits(pg, 'materials.html')))
    ok('家長管理：品牌文字連到 #/scores', pg.locator('a.brand').get_attribute('href') == '#/scores')
    pg.evaluate("location.hash = '#/materials'"); pg.wait_for_selector('#matTree li')
    ok('學習資料頁標題旁有「孩子端預覽」（報讀器會念出學習資料庫）', any(x.endswith('孩子端預覽') and x.startswith('學習資料庫') for x in exits(pg, 'materials.html')))
    pg.locator('.site-links a', has_text='學習資料庫').click()
    pg.wait_for_selector('[data-view="home"]:not([hidden])', timeout=10000)
    ok('管理員：家長管理 → 學習資料庫一次點擊', pg.url.endswith('materials.html'))
    ok('學習資料庫（管理員）：頁首有「回家長管理」與「回成長記錄本」', '回家長管理' in exits(pg, 'entry.html') and '回成長記錄本' in exits(pg))
    pg.locator('#adminBackLink').click()
    pg.wait_for_selector('#matTree li', timeout=10000)
    ok('管理員：學習資料庫 → 家長管理（直接到學習資料頁）一次點擊', '#/materials' in pg.url)
    pg.set_viewport_size({'width': 1280, 'height': 700}); pg.wait_for_timeout(300)
    pg.evaluate('window.scrollTo(0, 2000)'); pg.wait_for_timeout(300)
    gap = pg.evaluate("document.querySelector('.admin-nav a').getBoundingClientRect().top - document.querySelector('.site-header').getBoundingClientRect().bottom")
    ok('家長管理 1280px：往下捲動後，左側選單第一項不被頁首蓋住', gap >= 0, f'間距 {gap}px')
    pg.evaluate('window.scrollTo(0, 0)')
    for w in (360, 820):
        pg.set_viewport_size({'width': w, 'height': 800}); pg.wait_for_timeout(300)
        r = pg.evaluate(LAYOUT)
        ok(f'家長管理 {w}px：沒有橫向捲動、觸控目標 ≥ 44 px', r['over'] == 0 and not r['small'], json.dumps(r, ensure_ascii=False))
        pg.screenshot(path=str(OUT / f'nav-entry_{w}.png'), clip={'x': 0, 'y': 0, 'width': w, 'height': 420})
    # 未儲存提醒：段考成績輸入到一半就點頁首連結
    pg.set_viewport_size({'width': 1280, 'height': 900})
    pg.evaluate("location.hash = '#/scores'"); pg.wait_for_selector('#subjectInputs input:not([disabled])', timeout=10000)
    pg.locator('#subjectInputs input').first.fill('88')
    seen = []
    pg.once('dialog', lambda d: (seen.append(d.message), d.dismiss()))
    pg.locator('.site-links a', has_text='回成長記錄本').click(); pg.wait_for_timeout(500)
    ok('有未儲存的成績時點頁首連結：先確認，按取消就留在原頁', bool(seen) and '尚未儲存' in seen[0] and pg.url.split('#')[0].endswith('entry.html'), str(seen))
    pg.once('dialog', lambda d: d.accept())
    pg.locator('.site-links a', has_text='回成長記錄本').click(); pg.wait_for_url('**/index.html', timeout=10000)
    ok('確認離開後才到成長記錄本', pg.url.endswith('index.html'))
    ok('entry 沒有 JS 錯誤', not errs, ' | '.join(errs[:2]))
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/entry.html?fake=other')
    pg.wait_for_selector('#noAccessPanel:not([hidden])')
    ok('家長管理（無權限）：卡片裡有回成長記錄本、頁首站台列隱藏、品牌連到成長記錄本', sorted(exits(pg)) == sorted(['回成長記錄本', '成長記錄本・家長管理']) and pg.locator('#siteLinks').is_hidden(), str(exits(pg)))
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/entry.html?fake=studentsfail')
    pg.wait_for_selector('#loadActions:not([hidden])')
    ok('家長管理（學生資料讀取失敗）：有重新整理與回成長記錄本', '回成長記錄本' in exits(pg) and pg.locator('#reloadBtn').is_visible(), str(exits(pg)))
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/entry.html?fake=anon')
    pg.wait_for_selector('#loginGate:not([hidden])')
    ok('家長管理（登入前）：有「回成長記錄本」、頁首站台列隱藏', '回成長記錄本' in exits(pg) and pg.locator('#siteLinks').is_hidden(), str(exits(pg)))
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/entry.html?fake=error')
    pg.wait_for_selector('#loadActions:not([hidden])')
    ok('家長管理（無法確認登入狀態）：有重新整理與「回成長記錄本」', '回成長記錄本' in exits(pg) and pg.locator('#reloadBtn').is_visible(), str(exits(pg)))
    ctx.close()

    # ---------- materials.html ----------
    ctx, pg, errs = new_page(f'{B}/materials.html?fake=anon')
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('學習資料庫（登入前）：有「回成長記錄本」', '回成長記錄本' in exits(pg), str(exits(pg)))
    pg.fill('#loginEmail', 'viewer@example.test'); pg.fill('#loginPw', 'correct-horse-battery'); pg.click('#loginBtn')
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('學習資料庫（觀看帳號）：頁首有「回成長記錄本」，沒有「回家長管理」', exits(pg) == ['回成長記錄本'] and pg.locator('#adminBackLink').is_hidden(), str(exits(pg)))
    ok('學習資料庫：品牌文字連到 #/home', pg.locator('a.brand').get_attribute('href') == '#/home')
    pg.locator('.cat-tile', has_text='自然').click(); pg.wait_for_selector('[data-view="folder"]:not([hidden])')
    ok('資料夾：頁首「回成長記錄本」與「上一層」都在', exits(pg) == ['回成長記錄本'] and pg.locator('#upLink').is_visible())
    pg.evaluate("location.hash = '#/home'"); pg.locator('.cat-tile', has_text='國文').click(); pg.wait_for_selector('#folderEmpty:not([hidden])')
    ok('空資料夾：有回成長記錄本與上一層', exits(pg) == ['回成長記錄本'] and pg.locator('#upLink').is_visible())
    pg.evaluate("location.hash = '#/search/' + encodeURIComponent('理化')"); pg.wait_for_selector('[data-view="search"]:not([hidden])')
    ok('搜尋結果：「學習資料庫首頁」在搜尋框上方', pg.evaluate("(() => { const v = document.querySelector('[data-view=search]'); return v.querySelector('.folder-nav').getBoundingClientRect().top < v.querySelector('.search').getBoundingClientRect().top; })()"))
    for w in (360, 820):
        pg.set_viewport_size({'width': w, 'height': 800}); pg.evaluate("location.hash = '#/home'"); pg.wait_for_timeout(400)
        r = pg.evaluate(LAYOUT)
        ok(f'學習資料庫 {w}px：沒有橫向捲動、觸控目標 ≥ 44 px', r['over'] == 0 and not r['small'], json.dumps(r, ensure_ascii=False))
        pg.screenshot(path=str(OUT / f'nav-materials_{w}.png'), clip={'x': 0, 'y': 0, 'width': w, 'height': 420})
    pg.click('#logoutBtn'); pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('登出後頁首站台列隱藏', pg.locator('#siteLinks').is_hidden())
    pg.evaluate('window.__fail.rpcViewer = 1')
    pg.fill('#loginEmail', 'viewer@example.test'); pg.fill('#loginPw', 'correct-horse-battery'); pg.click('#loginBtn')
    pg.wait_for_selector('#retryBox:not([hidden])')
    ok('學習資料庫（無法確認）：有重新整理與「回成長記錄本」', '回成長記錄本' in exits(pg) and pg.locator('#retryBtn').is_visible(), str(exits(pg)))
    ok('materials 沒有 JS 錯誤', not errs, ' | '.join(errs[:2]))
    pg.click('#retryBtn'); pg.wait_for_selector('[data-view="home"]:not([hidden])')
    pg.click('#logoutBtn'); pg.wait_for_selector('[data-view="login"]:not([hidden])')
    pg.fill('#loginEmail', 'other@example.test'); pg.fill('#loginPw', 'correct-horse-battery'); pg.click('#loginBtn')
    pg.wait_for_selector('[data-view="noaccess"]:not([hidden])')
    ok('學習資料庫（無權限）：卡片裡有回成長記錄本，頁首站台列不重複', exits(pg).count('回成長記錄本') == 1 and pg.locator('#siteLinks').is_hidden(), str(exits(pg)))
    pg.click('#noAccessLogout'); pg.wait_for_selector('[data-view="login"]:not([hidden])')
    pg.evaluate('window.__fail.selectMaterials = 1')
    pg.fill('#loginEmail', 'viewer@example.test'); pg.fill('#loginPw', 'correct-horse-battery'); pg.click('#loginBtn')
    pg.wait_for_selector('#retryBox:not([hidden])')
    ok('學習資料庫（學習資料讀取失敗）：有重新整理與回成長記錄本、頁首站台列不重複', exits(pg).count('回成長記錄本') == 1 and pg.locator('#siteLinks').is_hidden(), str(exits(pg)))
    ctx.close()
    ctx, pg, errs = new_page(f'{B}/materials.html')  # 預設是管理員 session
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('學習資料庫（管理員）：警示框內有「看完回家長管理」（與頁首的文字可區分）', pg.locator('#adminNotice a[href="entry.html#/materials"]').inner_text() == '看完回家長管理')
    pg.set_viewport_size({'width': 360, 'height': 800}); pg.wait_for_timeout(300)
    r = pg.evaluate(LAYOUT)
    ok('學習資料庫（管理員）360px：沒有橫向捲動、觸控目標 ≥ 44 px', r['over'] == 0 and not r['small'], json.dumps(r, ensure_ascii=False))
    pg.screenshot(path=str(OUT / 'nav-materials-admin_360.png'), clip={'x': 0, 'y': 0, 'width': 360, 'height': 520})
    ctx.close()
    br.close()

server.terminate()
for s_, l, n in results:
    print(f'{s_} {l}' + (f'（{n}）' if n else ''))
print(f"\n通過 {sum(1 for r in results if r[0] == '✓')}／{len(results)}")
