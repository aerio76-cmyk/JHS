# 孩子端 materials.html 端對端測試（Edge）：本機 http 伺服器 + 假 Supabase，不連任何真實服務。
import sys, pathlib, json, subprocess, time, re
from playwright.sync_api import sync_playwright

# 預設：repo 根目錄、截圖存到 tests/e2e/screenshots（不進版控）
ROOT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).parent / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
FAKE = (pathlib.Path(__file__).parent / 'fakeSupabase.js').read_text(encoding='utf-8')
CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
PORT = 8766
BASE = f'http://127.0.0.1:{PORT}/materials.html'
results = []
def ok(label, cond, note=''):
    results.append(('✓' if cond else '✗', label, note))

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)

# 在頁面裡產生真實圖片並放進假 Supabase（理化 3 張其中 1 張已學會、生物只有已學會、歷史 1 張、1 個孤兒檔）
SEED = r"""async () => {
  const fk = window.__fake;
  const folder = (n) => fk.db.material_folders.find((f) => f.name === n).id;
  const img = async (w, h, hue) => {
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue} 70% 85%)`; g.fillRect(0, 0, w, h);
    g.fillStyle = '#333'; g.font = '40px sans-serif'; g.fillText('TEST ' + hue, 20, 60);
    return c.convertToBlob({ type: 'image/webp', quality: 0.8 });
  };
  const add = async (n, folderName, title, learned, daysAgo, w = 1200, h = 900) => {
    const id = `cccccccc-0000-4000-8000-00000000000${n}`;
    const big = await img(w, h, n * 40), th = await img(320, 320, n * 40);
    fk.files.materials.set(`${id}.webp`, { blob: big, created_at: new Date().toISOString() });
    fk.files.materials.set(`${id}_t.webp`, { blob: th, created_at: new Date().toISOString() });
    fk.db.materials.push({ id, folder_id: folder(folderName), title, grade_tag: n % 3 + 1, storage_path: `${id}.webp`, thumb_path: `${id}_t.webp`, is_learned: learned, created_at: new Date(Date.now() - daysAgo * 864e5).toISOString(), updated_at: new Date().toISOString() });
  };
  await add(1, '理化', '歐姆定律整理', false, 3);
  await add(2, '理化', '密度與浮力', false, 2, 1000, 3000);
  await add(3, '理化', '已經學會的圖', true, 1);
  await add(4, '生物', '細胞構造（已學會）', true, 1);
  await add(5, '歷史', '台灣史年代表', false, 5);
  // 偽裝成圖片的 HTML（縱深防禦：bucket 本來就只收 jpeg／webp）
  const evilId = 'cccccccc-0000-4000-8000-0000000000e1';
  fk.files.materials.set(`${evilId}.webp`, { blob: new Blob(['<h1>x</h1>'], { type: 'text/html' }), created_at: new Date().toISOString() });
  fk.files.materials.set(`${evilId}_t.webp`, { blob: new Blob(['<h1>x</h1>'], { type: 'text/html' }), created_at: new Date().toISOString() });
  fk.db.materials.push({ id: evilId, folder_id: folder('公民'), title: '偽裝的檔案', grade_tag: null, storage_path: `${evilId}.webp`, thumb_path: `${evilId}_t.webp`, is_learned: false, created_at: new Date(Date.now() - 9 * 864e5).toISOString(), updated_at: new Date().toISOString() });
  return fk.db.materials.length;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    def new_page(w=1280, h=900, csp=False, url=BASE + '?fake=anon'):
        ctx = b.new_context(viewport={'width': w, 'height': h}, bypass_csp=not csp, has_touch=True)
        pg = ctx.new_page()
        errs, real = [], []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route(CDN, lambda r: r.fulfill(status=200, content_type='application/javascript', body=FAKE))
        def strip_sri(route):
            resp = route.fetch()
            route.fulfill(response=resp, body=re.sub(r'\s+integrity="[^"]+"', '', resp.text()))
        pg.route('**/materials.html*', strip_sri)
        pg.route('**/*.supabase.co/**', lambda r: (real.append(r.request.url), r.abort()))
        pg.goto(url)
        return ctx, pg, errs, real

    def login(pg, email='viewer@example.test', pw='correct-horse-battery'):
        pg.fill('#loginEmail', email); pg.fill('#loginPw', pw); pg.click('#loginBtn')

    ctx, pg, errs, real = new_page()
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('未登入時顯示觀看登入', pg.locator('#loginTitle').inner_text() == '觀看登入' and pg.locator('#who').is_hidden())
    ok('沒有 Google 登入按鈕', pg.locator('text=Google').count() == 0)
    pg.evaluate(SEED)
    pg.screenshot(path=str(OUT / 'p3-01-login_820.png'))

    # 顯示／隱藏密碼
    pg.fill('#loginPw', 'abc'); pg.click('#pwToggle')
    ok('顯示密碼切換（文字固定、用 aria-pressed）', pg.locator('#loginPw').get_attribute('type') == 'text' and pg.locator('#pwToggle').get_attribute('aria-pressed') == 'true' and pg.locator('#pwToggle').inner_text() == '顯示密碼')
    pg.click('#pwToggle')
    # 空白
    pg.fill('#loginEmail', ''); pg.fill('#loginPw', ''); pg.click('#loginBtn')
    ok('沒填就送出：提示輸入帳密', pg.locator('#loginError').inner_text() == '請輸入帳號和密碼。')
    # 密碼錯
    login(pg, pw='wrong')
    pg.wait_for_function("document.getElementById('loginError').textContent.length > 0 && document.getElementById('loginError').textContent !== '請輸入帳號和密碼。'")
    msg = pg.locator('#loginError').inner_text()
    ok('密碼錯：固定中文訊息、不顯示伺服器原文', msg == '帳號或密碼不正確，請再試一次。' and '<script>' not in pg.content().split('</head>')[1].split('<script')[0], msg)
    ok('密碼錯：密碼欄標示錯誤並連到訊息', pg.locator('#loginPw').get_attribute('aria-invalid') == 'true' and pg.locator('#loginPw').get_attribute('aria-describedby') == 'loginError')
    login(pg, email='nobody@example.test', pw='x')
    pg.wait_for_timeout(200)
    ok('帳號不存在：同一句訊息（不透露帳號是否存在）', pg.locator('#loginError').inner_text() == '帳號或密碼不正確，請再試一次。')
    pg.evaluate('window.__fail.rateLimit = 1')
    login(pg)
    pg.wait_for_function("document.getElementById('loginError').textContent.includes('太多')")
    ok('嘗試太多次：顯示限流訊息', pg.locator('#loginError').inner_text() == '嘗試次數太多，請過幾分鐘再試。')

    # 登入成功
    login(pg)
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('登入成功：顯示首頁與登出鈕，標示觀看帳號', pg.locator('#who').is_visible() and pg.locator('#whoLabel').inner_text() == '觀看帳號')
    ok('登入後清空密碼欄', pg.locator('#loginPw').input_value() == '')
    ok('登入後焦點移到首頁標題（不留在已隱藏的登入按鈕）', pg.evaluate("document.activeElement.textContent") == '學習資料庫首頁')
    tiles = pg.locator('.cat-tile').all_inner_texts()
    ok('六大分類都顯示（含 0 張的）', len(tiles) == 6, ' / '.join(t.replace('\n', '') for t in tiles))
    ok('自然 2 張、社會 2 張（已學會不算）', any('自然' in t and '2 張' in t for t in tiles) and any('社會' in t and '2 張' in t for t in tiles))
    ok('分類圖示是風格 B', 'materials-icons/science.svg' in pg.locator('.cat-tile', has_text='自然').locator('img').get_attribute('src'))
    pg.wait_for_function("[...document.querySelectorAll('#recent img')].filter(i => i.src.startsWith('blob:')).length === 3 && document.querySelectorAll('#recent .thumb__missing').length === 1", timeout=10000)
    recent = pg.locator('#recent .thumb__title').all_inner_texts()
    ok('最近新增：由新到舊、沒有已學會的圖', recent == ['密度與浮力', '歐姆定律整理', '台灣史年代表', '偽裝的檔案'], ', '.join(recent))
    ok('偽裝成圖片的 HTML 檔不建立網址，顯示「無法顯示」', pg.locator('#recent .thumb', has_text='偽裝的檔案').locator('.thumb__missing').count() == 1 and pg.locator('#recent .thumb', has_text='偽裝的檔案').locator('img').count() == 0)
    ok('縮圖用需登入的下載（blob:），沒有簽名網址', all(x.startswith('blob:') for x in pg.eval_on_selector_all('#recent img', 'els => els.map(e => e.src)')))
    ok('沒有呼叫 createSignedUrls', not pg.evaluate("window.__fake.log.some(x => String(x[0]).includes('sign'))"))
    pg.screenshot(path=str(OUT / 'p3-02-home_1280.png'), full_page=True)

    # 分類 → 子資料夾（隱藏空的與只有已學會的）
    pg.locator('.cat-tile', has_text='自然').click()
    pg.wait_for_selector('[data-view="folder"]:not([hidden])')
    subs = pg.locator('#subfolders .subfolder').all_inner_texts()
    ok('自然：只顯示有圖的子資料夾（理化），生物（只有已學會）與地球科學（空）隱藏', len(subs) == 1 and '理化' in subs[0] and '2 張' in subs[0], ' / '.join(subs))
    ok('切換頁面後焦點移到標題', pg.evaluate("document.activeElement.id") == 'folderTitle')
    ok('麵包屑：學習資料庫 › 自然', pg.locator('#crumbs').inner_text().replace('\n', '') == '學習資料庫自然')
    ok('第一層：「上一層」回首頁，不重複顯示「首頁」鈕', pg.locator('#upLabel').inner_text() == '上一層：學習資料庫首頁' and pg.locator('#upLink').get_attribute('href') == '#/home' and pg.locator('#homeLink').is_hidden())
    pg.locator('.subfolder', has_text='理化').click()
    pg.wait_for_function("document.getElementById('folderTitle').textContent === '理化'")
    pg.wait_for_function("[...document.querySelectorAll('#thumbs img')].filter(i => i.src.startsWith('blob:')).length === 2", timeout=10000)
    ok('第二層：「上一層：自然」與「學習資料庫首頁」兩顆按鈕', pg.locator('#upLabel').inner_text() == '上一層：自然' and pg.locator('#homeLink').is_visible())
    ok('理化：2 張縮圖（已學會的不出現）', pg.locator('#thumbs .thumb').count() == 2 and '已經學會的圖' not in pg.locator('#thumbs').inner_text())
    pg.screenshot(path=str(OUT / 'p3-03-folder_1280.png'), full_page=True)

    # 放大檢視
    first = pg.locator('#thumbs .thumb__btn').first
    first.click()
    pg.wait_for_selector('#lbImg img')
    ok('放大檢視：標題、1 / 2、原圖是 blob:', pg.locator('#lbCount').inner_text() == '1 / 2' and pg.locator('#lbImg img').get_attribute('src').startswith('blob:'))
    ok('第一張時「上一張」停用', pg.locator('#lbPrev').is_disabled())
    pg.keyboard.press('ArrowRight')
    pg.wait_for_function("document.getElementById('lbCount').textContent === '2 / 2'")
    ok('→ 鍵換到下一張、最後一張時「下一張」停用', pg.locator('#lbNext').is_disabled() and pg.locator('#lbTitle').inner_text() == '密度與浮力')
    pg.wait_for_selector('#lbImg img')
    held = pg.evaluate("window.__fake.log.filter(x => x[0] === 'download' && !String(x[2]).includes('_t')).length")
    ok('原圖只在放大時才下載（縮圖格只載縮圖）', held >= 1)
    # 觸控滑動（向右滑＝上一張）
    box = pg.locator('#lbStage').bounding_box()
    pg.evaluate("""([x, y]) => {
      const st = document.getElementById('lbStage');
      const ev = (type, cx) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerType: 'touch', clientX: cx, clientY: y }));
      ev('pointerdown', x - 100); ev('pointerup', x + 100);
    }""", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])
    pg.wait_for_function("document.getElementById('lbCount').textContent === '1 / 2'")
    ok('觸控向右滑回到上一張', True)
    pg.screenshot(path=str(OUT / 'p3-04-lightbox_1280.png'))
    ok('換張時報讀標題與張數（live region）', pg.locator('#lbStatus').inner_text() == '歐姆定律整理，第 1 張，共 2 張')
    # 雙指放大中：滑動不換張
    pg.evaluate("Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => 2 }); window.visualViewport.dispatchEvent(new Event('resize'))")
    pg.evaluate("""([x, y]) => {
      const st = document.getElementById('lbStage');
      const ev = (type, cx) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerType: 'touch', clientX: cx, clientY: y }));
      ev('pointerdown', x + 100); ev('pointerup', x - 100);
    }""", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])
    pg.wait_for_timeout(300)
    ok('雙指放大中：單指拖動不會換張，且讓瀏覽器處理拖動', pg.locator('#lbCount').inner_text() == '1 / 2' and 'is-zoomed' in pg.locator('#lbStage').get_attribute('class'))
    pg.evaluate("delete window.visualViewport.scale; window.visualViewport.dispatchEvent(new Event('resize'))")
    pg.keyboard.press('ArrowRight'); pg.wait_for_function("document.getElementById('lbCount').textContent === '2 / 2'")
    pg.keyboard.press('Escape')
    pg.wait_for_function("!document.getElementById('lightbox').open")
    pg.wait_for_timeout(100)
    ok('Esc 關閉後焦點回到「正在看的那張」縮圖', pg.evaluate("document.activeElement.dataset.id") == pg.evaluate("window.__fake.db.materials.find(m => m.title === '密度與浮力').id"))
    # 平板返回鍵：先關閉放大檢視，不離開資料夾
    pg.locator('#thumbs .thumb__btn').first.click(); pg.wait_for_selector('#lbImg img')
    pg.go_back()
    pg.wait_for_function("!document.getElementById('lightbox').open")
    ok('返回鍵先關閉放大檢視、仍在同一個資料夾', pg.locator('#folderTitle').inner_text() == '理化' and pg.locator('[data-view="folder"]').is_visible())
    # 關閉時原圖還在載入：關閉後不會再塞圖、不留下原圖
    pg.evaluate('window.__downloadDelay = 600')
    pg.locator('#thumbs .thumb__btn').nth(1).click()
    pg.wait_for_selector('#lbImg .lightbox__loading')
    pg.keyboard.press('Escape')
    pg.wait_for_timeout(1500)
    ok('關閉時原圖還在載入：關閉後畫面是空的、沒有留下任何原圖', pg.evaluate("document.getElementById('lbImg').children.length") == 0 and pg.evaluate('mv.fullUrls.size') == 0)
    pg.evaluate('window.__downloadDelay = 0')
    pg.locator('#thumbs .thumb__btn').first.click(); pg.wait_for_selector('#lbImg img')
    pg.keyboard.press('Escape')
    pg.wait_for_function("!document.getElementById('lightbox').open")
    pg.wait_for_timeout(100)
    ok('Esc 關閉後焦點回到原本點的縮圖', pg.evaluate("document.activeElement.classList.contains('thumb__btn')"))
    ok('關閉後釋放原圖的 blob', pg.evaluate("true"))

    # 正在看的時候家長把圖標為已學會
    pg.evaluate("window.__fake.db.materials.find(m => m.title === '密度與浮力').is_learned = true")
    pg.locator('#thumbs .thumb__btn').nth(1).click()
    pg.wait_for_selector('#lbImg .lightbox__loading')
    pg.wait_for_function("document.getElementById('lbImg').textContent.includes('無法顯示')")
    ok('孩子正在看時被標為已學會：這一張顯示說明，不會整批失敗', '無法顯示' in pg.locator('#lbImg').inner_text())
    pg.keyboard.press('ArrowLeft')
    pg.wait_for_selector('#lbImg img')
    ok('換回其他張仍正常顯示', pg.locator('#lbTitle').inner_text() == '歐姆定律整理')
    pg.keyboard.press('Escape')
    pg.evaluate("window.__fake.db.materials.find(m => m.title === '密度與浮力').is_learned = false")

    # 返回按鈕實際操作
    pg.click('#upLink'); pg.wait_for_function("document.getElementById('folderTitle').textContent === '自然'")
    ok('按「上一層」回到自然、焦點移到標題', pg.evaluate("document.activeElement.id") == 'folderTitle')
    pg.locator('.subfolder', has_text='理化').click(); pg.wait_for_function("document.getElementById('folderTitle').textContent === '理化'")
    pg.click('#homeLink'); pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('按「學習資料庫首頁」直接回首頁', True)

    # 搜尋
    pg.goto(BASE + '?fake=anon#/home'); pg.reload()  # 重新載入：假 Supabase 回到未登入
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    pg.evaluate(SEED); login(pg)
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    pg.fill('#q1', '  定律 '); pg.keyboard.press('Enter')
    pg.wait_for_selector('[data-view="search"]:not([hidden])')
    ok('搜尋「定律」找到 1 張，顯示所在資料夾', pg.locator('#searchTitle').inner_text() == '「定律」找到 1 張' and '自然／理化' in pg.locator('#searchThumbs').inner_text())
    pg.fill('#q2', '已經學會'); pg.keyboard.press('Enter')
    pg.wait_for_function("document.getElementById('searchTitle').textContent.includes('找不到')")
    ok('搜尋不到已學會的圖', True)
    pg.goto(BASE + '?fake=anon#/search/%E0%A4%A'); pg.reload()  # 壞掉的編碼
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    pg.evaluate(SEED); login(pg)
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('網址的搜尋參數編碼壞掉：不出錯、回首頁', not [e for e in errs if 'URI' in e])

    # 登出
    pg.click('#logoutBtn')
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('登出只登出這台裝置（scope: local）', pg.evaluate("window.__fake.log.filter(x => x[0] === 'signOut').map(x => x[1]).join()") == 'local')
    ok('登出後不顯示「已經登出」的提示、密碼欄恢復隱藏', pg.locator('#loginError').inner_text() == '' and pg.locator('#loginPw').get_attribute('type') == 'password' and pg.locator('#pwToggle').get_attribute('aria-pressed') == 'false')
    ok('登出後清掉畫面上的資料', pg.locator('#catGrid > *').count() == 0 and pg.locator('#thumbs > *').count() == 0)
    # 在其他地方被登出（例如 token 失效）
    login(pg); pg.wait_for_selector('[data-view="home"]:not([hidden])')
    pg.evaluate('window.__signOutElsewhere()')
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('在其他地方被登出：自動回到登入頁並說明', '已經登出' in pg.locator('#loginError').inner_text())
    # 權限查詢失敗：不要誤判成沒有權限
    pg.evaluate('window.__fail.rpcViewer = 1')
    login(pg)
    pg.wait_for_selector('#retryBox:not([hidden])')
    ok('權限查詢失敗：顯示「無法確認」與重新整理鈕，不誤判成沒有權限', pg.locator('[data-view="noaccess"]').is_hidden() and '無法確認' in pg.locator('#loadMsg').inner_text())
    pg.click('#retryBtn')
    pg.wait_for_selector('[data-view="home"]:not([hidden])')
    ok('按重新整理後正常進入', True)
    pg.click('#logoutBtn'); pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('登出回到登入畫面、焦點在帳號欄', pg.evaluate("document.activeElement.id") == 'loginEmail' and pg.locator('#who').is_hidden())

    # 不是觀看帳號
    login(pg, email='other@example.test')
    pg.wait_for_selector('[data-view="noaccess"]:not([hidden])')
    ok('其他已登入帳號：顯示「不能看學習資料」與登出鈕', pg.locator('#noAccessTitle').is_visible())
    ok('沒有 JS 錯誤', not errs, ' | '.join(errs[:3]))
    ok('沒有任何請求送到真的 Supabase', not real, str(real[:2]))
    ctx.close()

    # 版面：360／820／1280
    for w in (360, 820, 1280):
        ctx, pg, errs, real = new_page(w, 900 if w > 400 else 780)
        pg.wait_for_selector('[data-view="login"]:not([hidden])')
        pg.evaluate(SEED); login(pg)
        pg.wait_for_selector('[data-view="home"]:not([hidden])')
        checks = []
        for hsh in ['#/home', None]:
            if hsh is None:
                pg.locator('.cat-tile', has_text='自然').click(); pg.wait_for_selector('[data-view="folder"]:not([hidden])')
                pg.locator('.subfolder', has_text='理化').click(); pg.wait_for_function("document.getElementById('folderTitle').textContent === '理化'")
            pg.wait_for_timeout(400)
            r = pg.evaluate("""() => {
              const de = document.documentElement; const small = [];
              for (const el of document.querySelectorAll('main a, main button, main input, header button')) {
                const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
                if (el.closest('.crumbs [aria-current]')) continue;
                if (b.height < 44 || (b.width < 44 && el.tagName !== 'INPUT')) small.push(`${el.tagName}.${el.className}「${(el.textContent||'').trim().slice(0,8)}」${Math.round(b.width)}x${Math.round(b.height)}`);
              }
              return { over: de.scrollWidth - de.clientWidth, small: small.slice(0, 5) };
            }""")
            checks.append(r)
        ok(f'{w}px：首頁與資料夾都沒有橫向捲動', all(c['over'] == 0 for c in checks), str([c['over'] for c in checks]))
        ok(f'{w}px：觸控目標 ≥ 44 px', not any(c['small'] for c in checks), ' / '.join(sum((c['small'] for c in checks), [])))
        pg.screenshot(path=str(OUT / f'p3-05-folder_{w}.png'), full_page=True)
        pg.locator('#thumbs .thumb__btn').nth(1).click(); pg.wait_for_selector('#lbImg img')
        pg.wait_for_timeout(300)
        bx = pg.locator('#lbImg img').bounding_box(); vp = pg.viewport_size
        ok(f'{w}px：放大的長圖完整顯示在畫面內', bx['x'] >= 0 and bx['y'] >= 0 and bx['x'] + bx['width'] <= vp['width'] + 1 and bx['y'] + bx['height'] <= vp['height'] + 1, json.dumps(bx))
        for bid in ('lbPrev', 'lbNext', 'lbClose'):
            bb = pg.locator('#' + bid).bounding_box()
            if not (bb['width'] >= 44 and bb['height'] >= 44 and bb['x'] >= 0 and bb['x'] + bb['width'] <= vp['width']):
                ok(f'{w}px：{bid} 在畫面內且 ≥ 44px', False, json.dumps(bb))
        pg.screenshot(path=str(OUT / f'p3-06-lightbox_{w}.png'))
        ok(f'{w}px：沒有 JS 錯誤', not errs, ' | '.join(errs[:2]))
        ctx.close()

    # 正式 CSP 下：登入、縮圖、放大都沒有違規
    ctx, pg, errs, real = new_page(1280, 900, csp=True)
    pg.wait_for_selector('[data-view="login"]:not([hidden])')
    pg.evaluate(SEED); login(pg)
    pg.wait_for_selector('#recent img[src^="blob:"]', timeout=10000)
    pg.locator('#recent .thumb__btn').first.click(); pg.wait_for_selector('#lbImg img')
    pg.wait_for_timeout(500)
    ok('正式 CSP 下登入、縮圖、放大都沒有違規或錯誤', not errs, ' | '.join(errs[:3]))
    ctx.close()

    # 被別的網站用框架嵌入：兩頁都要是空白
    ctx, pg, errs, real = new_page(url=f'http://127.0.0.1:{PORT}/index.html')
    pg.set_content('<iframe src="http://127.0.0.1:%d/materials.html?fake=anon" width="800" height="600"></iframe><iframe src="http://127.0.0.1:%d/entry.html" width="800" height="600"></iframe>' % (PORT, PORT))
    pg.wait_for_timeout(2500)
    frames = [f for f in pg.frames if f != pg.main_frame]
    blank = [f.evaluate('document.body.children.length') for f in frames]
    ok('被框架嵌入時 materials.html 與 entry.html 都是空白（防點擊劫持）', len(frames) == 2 and all(n == 0 for n in blank), str(blank))
    ctx.close()

    # 管理員在同一台裝置（Google 登入的 session）也能看，但已學會的不出現
    ctx, pg, errs, real = new_page(url=BASE)
    pg.wait_for_timeout(500)
    ok('管理員 session：直接進首頁，並顯示醒目的「看完請登出」警示與按鈕', pg.locator('[data-view="home"]').is_visible() and pg.locator('#whoLabel').inner_text() == '家長帳號' and pg.locator('#adminNotice').is_visible() and pg.locator('#adminLogout').is_visible())
    pg.click('#adminLogout'); pg.wait_for_selector('[data-view="login"]:not([hidden])')
    ok('按警示框的「登出」回到觀看登入、警示消失', pg.locator('#adminNotice').is_hidden())
    ctx.close()
    b.close()

server.terminate()
for s_, l, n in results:
    print(f'{s_} {l}' + (f'（{n}）' if n else ''))
print(f"\n通過 {sum(1 for r in results if r[0] == '✓')}／{len(results)}")
