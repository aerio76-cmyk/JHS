# 家長端「學習資料」端對端測試（Edge）：本機 http 伺服器 + 假 Supabase（攔截 CDN），不連任何真實服務。
import sys, pathlib, base64, json, subprocess, time
from playwright.sync_api import sync_playwright

# 預設：repo 根目錄、截圖存到 tests/e2e/screenshots（不進版控）
ROOT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).parent / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)
FAKE = (pathlib.Path(__file__).parent / 'fakeSupabase.js').read_text(encoding='utf-8')
CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
PORT = 8765
BASE = f'http://127.0.0.1:{PORT}/entry.html'

results = []
def ok(label, cond, note=''):
    results.append(('✓' if cond else '✗', label, note))

server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)

# 在頁面裡產生測試圖片（回傳 base64）
MAKE_IMAGES = r"""async () => {
  const make = async (w, h, type, color) => {
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = `hsl(${i * 37} 70% 50%)`; g.fillRect((i * 97) % w, (i * 151) % h, w / 9, h / 13); }
    g.fillStyle = '#000'; g.font = `${Math.floor(w / 12)}px sans-serif`; g.fillText('TEST', 20, Math.floor(h / 6));
    const b = await c.convertToBlob({ type, quality: 0.95 });
    const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
  };
  return {
    wide: await make(4000, 3000, 'image/png', '#ffeedd'),
    tall: await make(1000, 8000, 'image/jpeg', '#ddeeff'),
    small: await make(300, 200, 'image/webp', '#eeffdd'),
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    def new_page(w=1280, h=900, csp=False):
        # 功能測試略過 CSP（Playwright 的等待需要 eval）；csp=True 時用正式的 CSP 檢查違規
        ctx = b.new_context(viewport={'width': w, 'height': h}, bypass_csp=not csp)
        pg = ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        real = []
        pg.route(CDN, lambda r: r.fulfill(status=200, content_type='application/javascript', body=FAKE))
        # 測試專用：假 Supabase 的雜湊值和 SRI 不同，只在攔截到的 entry.html 回應裡拿掉 integrity（實際檔案不動）
        def strip_sri(route):
            resp = route.fetch()
            body = resp.text()
            import re as _re
            route.fulfill(response=resp, body=_re.sub(r'\s+integrity="[^"]+"', '', body))
        pg.route('**/entry.html*', strip_sri)
        pg.route('**/*.supabase.co/**', lambda r: (real.append(r.request.url), r.abort()))
        return ctx, pg, errs, real

    ctx, pg, errs, real = new_page()
    pg.goto(BASE + '#/materials')
    pg.wait_for_selector('#matTree li', timeout=8000)
    ok('學習資料頁載入、資料夾樹有 12 個資料夾', pg.locator('#matTree .tree__link').count() == 12, str(pg.locator('#matTree .tree__link').count()))
    ok('導覽列有「學習資料」且為目前頁', pg.locator('.admin-nav a[data-route="materials"][aria-current="page"]').count() == 1)
    ok('預設選第一個分類（國文），固定分類不能改名或刪除', pg.locator('#matFolderTitle').inner_text() == '國文' and pg.locator('#matRenameFolderBtn').is_hidden() and pg.locator('#matDeleteFolderBtn').is_hidden())
    ok('分類圖示是風格 B 的 SVG', 'materials-icons/chinese.svg' in (pg.locator('#matFolderIcon img').get_attribute('src') or ''))
    pg.screenshot(path=str(OUT / 'p2-01-materials_1280.png'), full_page=True)

    # 切到「理化」
    pg.locator('#matTree a', has_text='理化').click()
    pg.wait_for_function("document.getElementById('matFolderTitle').textContent === '理化'")
    ok('點資料夾樹切換資料夾（網址帶資料夾 id）', '#/materials/' in pg.url)

    # 新增子資料夾（第三層）→ 不能再往下
    pg.click('#matNewFolderBtn'); pg.fill('#matFolderName', '  電學  '); pg.keyboard.press('Enter')
    pg.wait_for_function("document.getElementById('matFolderTitle').textContent === '電學'")
    ok('新增子資料夾（Enter 送出、前後空白去掉），自動切到新資料夾', True)
    ok('第三層不能再新增子資料夾', pg.locator('#matNewFolderBtn').is_disabled() and '第三層' in pg.locator('#matFolderNote').inner_text())
    sort = pg.evaluate("window.__fake.db.material_folders.find(f => f.name === '電學').sort")
    ok('新資料夾排序是同層最大值 + 1（理化原本沒有子資料夾 → 1）', sort == 1, str(sort))
    # 重名
    pg.locator('#matCrumbs a', has_text='理化').click()
    pg.wait_for_function("document.getElementById('matFolderTitle').textContent === '理化'")
    pg.click('#matNewFolderBtn'); pg.fill('#matFolderName', '電學'); pg.click('#matDlgFolder button[value="ok"]')
    ok('同層重名在對話框內提示、不關閉', pg.locator('#matDlgFolder').evaluate('d => d.open') and '已經有「電學」' in pg.locator('#matDlgFolder .msg--error').inner_text())
    pg.keyboard.press('Escape')
    ok('Esc 關閉對話框不會新增', pg.evaluate("window.__fake.db.material_folders.filter(f => f.name === '電學').length") == 1)

    # 上傳：寬圖 PNG、長圖 JPEG、小圖 WebP、GIF、超過 10 MB、內容損壞
    imgs = pg.evaluate(MAKE_IMAGES)
    pg.click('#matUploadToggle')
    files = [
        {'name': '歐姆定律_整理.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['wide'])},
        {'name': '長長的資訊圖.jpg', 'mimeType': 'image/jpeg', 'buffer': base64.b64decode(imgs['tall'])},
        {'name': '小圖.webp', 'mimeType': 'image/webp', 'buffer': base64.b64decode(imgs['small'])},
        {'name': '動畫.gif', 'mimeType': 'image/gif', 'buffer': b'GIF89a' + bytes(100)},
        {'name': '超大.jpg', 'mimeType': 'image/jpeg', 'buffer': bytes(11 * 1024 * 1024)},
        {'name': '壞掉.png', 'mimeType': 'image/png', 'buffer': b'not really a png' * 10},
    ]
    t0 = time.time()
    pg.set_input_files('#matFilePick', files)
    pg.wait_for_function("document.getElementById('matUploadSummary').textContent.includes('6 張中') && !document.getElementById('matUploadSummary').textContent.includes('處理中')", timeout=60000)
    ok('批次上傳 6 張：3 張完成、3 張沒有上傳', pg.locator('#matUploadSummary').inner_text() == '6 張中：3 張完成、3 張沒有上傳', f"{pg.locator('#matUploadSummary').inner_text()}（{time.time() - t0:.1f}s）")
    statuses = pg.locator('.upload-item__status').all_inner_texts()
    ok('GIF 的失敗原因', any('不是 JPG、PNG 或 WebP' in s for s in statuses))
    ok('超過 10 MB 的失敗原因', any('超過 10 MB（11.0 MB）' in s for s in statuses))
    ok('內容損壞的失敗原因', any('無法辨識圖片內容' in s for s in statuses))
    ok('格式錯、超限不提供重試', pg.locator('#matUploadList button', has_text='重試').count() == 0)
    info = pg.evaluate("""async () => {
      const out = [];
      for (const m of window.__fake.db.materials) {
        const f = window.__fake.files.materials.get(m.storage_path), t = window.__fake.files.materials.get(m.thumb_path);
        const bm = await createImageBitmap(f.blob), tb = await createImageBitmap(t.blob);
        out.push({ title: m.title, type: f.type, size: f.blob.size, w: bm.width, h: bm.height, tw: tb.width, th: tb.height, path: m.storage_path });
      }
      return out;
    }""")
    by = {x['title']: x for x in info}
    ok('預設標題取自檔名（底線換空白）', '歐姆定律 整理' in by, ', '.join(by))
    w = by.get('歐姆定律 整理', {})
    ok('4000×3000 縮成 1600×1200、縮圖 320×320', (w.get('w'), w.get('h'), w.get('tw'), w.get('th')) == (1600, 1200, 320, 320), json.dumps(w, ensure_ascii=False))
    t = by.get('長長的資訊圖', {})
    ok('1000×8000 長圖縮成 600×4800（不會被壓成細條）', (t.get('w'), t.get('h')) == (600, 4800), json.dumps(t, ensure_ascii=False))
    s = by.get('小圖', {})
    ok('小圖不放大（300×200，縮圖 200×200）', (s.get('w'), s.get('h'), s.get('tw')) == (300, 200, 200), json.dumps(s, ensure_ascii=False))
    ok('存成 webp、每張 ≤ 2 MB、檔名為 uuid.webp', all(x['type'] == 'image/webp' and x['size'] <= 2 * 1024 * 1024 and x['path'].endswith('.webp') for x in info))
    ok('縮圖顯示在格子裡（3 張）', pg.locator('#matThumbs .thumb img').count() == 3)
    pg.screenshot(path=str(OUT / 'p2-02-upload_1280.png'), full_page=True)

    # 補償：寫資料列失敗 → 兩個檔都刪
    nfiles = pg.evaluate('window.__fake.files.materials.size')
    pg.evaluate('window.__fail.insertMaterials = 1')
    pg.set_input_files('#matFilePick', [{'name': 'x.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['small'])}])
    pg.wait_for_function("[...document.querySelectorAll('.upload-item__status')].some(e => e.textContent.includes('寫入權限'))", timeout=20000)
    ok('寫資料列失敗：顯示原因、不提供重試、上傳的兩個檔都刪掉', pg.evaluate('window.__fake.files.materials.size') == nfiles and pg.evaluate('window.__fake.db.materials.length') == 3)
    # 網路錯誤 → 可重試
    pg.evaluate('window.__fail.uploadNetwork = 1')
    pg.set_input_files('#matFilePick', [{'name': '網路.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['small'])}])
    pg.wait_for_selector('#matUploadList button:has-text("重試")', timeout=20000)
    ok('網路錯誤：出現「重試」與「重試失敗的 1 張」', pg.locator('#matRetryAll').is_visible() and '1 張' in pg.locator('#matRetryAll').inner_text())
    pg.click('#matUploadList button:has-text("重試")')
    pg.wait_for_function("window.__fake.db.materials.some(m => m.title === '網路')", timeout=20000)
    ok('按重試後上傳成功', True)
    # 寫入其實成功、只是回應遺失：應該當成功，不重複、不刪檔
    nrows = pg.evaluate('window.__fake.db.materials.length'); nfiles2 = pg.evaluate('window.__fake.files.materials.size')
    pg.evaluate('window.__fail.insertLost = 1')
    pg.set_input_files('#matFilePick', [{'name': '回應遺失.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['small'])}])
    pg.wait_for_function("window.__fake.db.materials.some(m => m.title === '回應遺失') && !document.getElementById('matUploadSummary').textContent.includes('處理中')", timeout=20000)
    pg.wait_for_timeout(300)
    ok('寫入成功但回應遺失：當成功、只有 1 筆、兩個檔都在', pg.evaluate('window.__fake.db.materials.length') == nrows + 1 and pg.evaluate('window.__fake.files.materials.size') == nfiles2 + 2 and pg.locator('.upload-item', has_text='回應遺失').locator('.upload-item__status--ok').count() == 1)
    pg.click('#matUploadDone')
    ok('按「完成」收起上傳區、清掉已結束的項目', pg.locator('#matUploadPanel').is_hidden())

    # 選單：編輯、已學會、篩選、移動、刪除
    def menu(title, item):
        pg.locator('.thumb', has_text=title).locator('.thumb__menu').click()
        pg.locator('.menu button', has_text=item).click()
    menu('小圖', '編輯標題')
    pg.fill('#matEditTitle', '電功率公式'); pg.select_option('#matEditGrade', '2'); pg.keyboard.press('Enter')
    pg.wait_for_function("window.__fake.db.materials.some(m => m.title === '電功率公式' && m.grade_tag === 2)")
    ok('編輯標題與年級（Enter 送出）', '國二' in pg.locator('.thumb', has_text='電功率公式').inner_text())
    menu('電功率公式', '標為已學會')
    pg.wait_for_function("window.__fake.db.materials.find(m => m.title === '電功率公式').is_learned === true")
    ok('標為已學會：顯示標籤與灰階', pg.locator('.thumb--learned .badge-learned').count() == 1)
    pg.click('[data-mat-filter="learned"]')
    ok('已學會篩選只顯示 1 張', pg.locator('#matThumbs .thumb').count() == 1)
    pg.click('[data-mat-filter="active"]')
    ok('學習中篩選顯示 4 張', pg.locator('#matThumbs .thumb').count() == 4)
    pg.click('[data-mat-filter="all"]')
    menu('長長的資訊圖', '移動到')
    target = pg.evaluate("window.__fake.db.material_folders.find(f => f.name === '生物').id")
    pg.select_option('#matMoveTo', target); pg.click('#matDlgMove button[value="ok"]')
    pg.wait_for_function(f"window.__fake.db.materials.find(m => m.title === '長長的資訊圖').folder_id === '{target}'")
    ok('移動到「生物」：理化剩 4 張，資料夾樹數字更新', pg.locator('#matThumbs .thumb').count() == 4 and pg.locator('#matTree a', has_text='生物').inner_text().split()[-2:] == ['1', '張'])
    before = pg.evaluate('window.__fake.files.materials.size')
    menu('網路', '永久刪除')
    ok('刪除確認框預設焦點在「取消」', pg.evaluate("document.activeElement.value") == 'cancel')
    pg.click('#matDlgDelImage button[value="ok"]')
    pg.wait_for_function("!window.__fake.db.materials.some(m => m.title === '網路')")
    ok('永久刪除：資料列與兩個檔案都刪掉', pg.evaluate('window.__fake.files.materials.size') == before - 2)

    # 換圖：新檔名、舊檔刪除
    old = pg.evaluate("(() => { const m = window.__fake.db.materials.find(m => m.title === '歐姆定律 整理'); return [m.storage_path, m.thumb_path]; })()")
    with pg.expect_file_chooser() as fc:
        menu('歐姆定律 整理', '換圖')
    fc.value.set_files([{'name': 'new.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['small'])}])
    pg.wait_for_function(f"window.__fake.db.materials.find(m => m.title === '歐姆定律 整理').storage_path !== '{old[0]}'", timeout=20000)
    ok('換圖：改用新檔名、舊的兩個檔刪掉、標題保留', not pg.evaluate(f"window.__fake.files.materials.has('{old[0]}') || window.__fake.files.materials.has('{old[1]}')"))

    # 預覽
    pg.locator('.thumb', has_text='歐姆定律 整理').locator('.thumb__btn').click()
    pg.wait_for_selector('#matDlgPreview .preview-box img')
    ok('點縮圖開啟預覽（大圖）', pg.locator('#matDlgPreview h2').inner_text() == '歐姆定律 整理')
    pg.keyboard.press('Escape')

    # 孤兒檔案清理
    pg.evaluate("""() => {
      const old = new Date(Date.now() - 48 * 3600e3).toISOString();
      window.__fake.files.materials.set('aaaaaaaa-0000-4000-8000-000000000001.webp', { blob: new Blob(['x']), created_at: old });
      window.__fake.files.materials.set('aaaaaaaa-0000-4000-8000-000000000002.webp', { blob: new Blob(['y']), created_at: new Date().toISOString() });
    }""")
    pg.click('#matOrphanBtn')
    pg.wait_for_selector('#matDlgOrphans[open]')
    ok('孤兒檢查只找到 1 個（24 小時內的不算）', '1 個' in pg.locator('#matDlgOrphans [data-body]').inner_text())
    pg.click('#matDlgOrphans button[value="ok"]')
    pg.wait_for_function("!window.__fake.files.materials.has('aaaaaaaa-0000-4000-8000-000000000001.webp')")
    ok('清理後新的那個檔案還在', pg.evaluate("window.__fake.files.materials.has('aaaaaaaa-0000-4000-8000-000000000002.webp')"))

    # 刪除資料夾（含子資料夾與圖片）
    pg.locator('#matTree a', has_text='電學').click()
    pg.wait_for_function("document.getElementById('matFolderTitle').textContent === '電學'")
    pg.click('#matUploadToggle')
    pg.set_input_files('#matFilePick', [{'name': '電路.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['small'])}])
    pg.wait_for_function("window.__fake.db.materials.some(m => m.title === '電路')", timeout=20000)
    pg.locator('#matCrumbs a', has_text='理化').click()
    pg.wait_for_function("document.getElementById('matFolderTitle').textContent === '理化'")
    nmat = pg.evaluate('window.__fake.db.materials.length'); nf = pg.evaluate('window.__fake.files.materials.size')
    pg.click('#matDeleteFolderBtn')
    body = pg.locator('#matDlgDelFolder [data-body]').inner_text(); btn = pg.locator('#matDlgDelFolder button[value="ok"]').inner_text()
    ok('刪除資料夾的說明與按鈕寫出數量', '1 個子資料夾、4 張圖片' in body and btn == '刪除資料夾和 4 張圖片', f'{body}｜{btn}')
    pg.click('#matDlgDelFolder button[value="ok"]')
    pg.wait_for_function("!window.__fake.db.material_folders.some(f => f.name === '理化')")
    ok('刪除資料夾：子資料夾、4 筆圖片、8 個檔案都刪掉，回到上一層', pg.evaluate('window.__fake.db.materials.length') == nmat - 4 and pg.evaluate('window.__fake.files.materials.size') == nf - 8 and pg.locator('#matFolderTitle').inner_text() == '自然')

    # 頭像也改用共用處理
    pg.goto(BASE + '#/students'); pg.wait_for_selector('.student-card')
    pg.locator('.student-card').first.locator('input[type=file]').set_input_files([{'name': 'big.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(imgs['wide'])}])
    pg.wait_for_function("[...document.querySelectorAll('.msg--ok')].some(e => e.textContent.includes('已裁成'))", timeout=20000)
    ok('頭像：4000×3000 裁成 512×512（共用的圖片處理）', any('512×512' in t for t in pg.locator('.msg--ok').all_inner_texts()))
    pg.locator('.student-card').first.locator('input[type=file]').set_input_files([{'name': '動畫.gif', 'mimeType': 'image/gif', 'buffer': b'GIF89a' + bytes(10)}])
    pg.wait_for_function("[...document.querySelectorAll('.msg--error')].some(e => e.textContent.includes('不是 JPG'))")
    ok('頭像：GIF 被拒並說明原因', True)

    unexpected = [e for e in errs if 'row-level security policy for table "materials"' not in e and 'Failed to fetch' not in e]
    ok('除了故意注入的兩個失敗，沒有其他 JS／CSP 錯誤', not unexpected and len(errs) == 2, ' | '.join(errs[:3]))
    ok('沒有任何請求送到真的 Supabase', not real, str(real[:2]))
    pg.click('#logoutBtn')
    pg.wait_for_timeout(500)
    ok('家長端登出只登出這台裝置（scope: local；共用的觀看帳號不會被全部登出）', pg.evaluate("sessionStorage.getItem('fakeLastSignOut')") == 'local')  # 登出後頁面會重新載入，所以記在 sessionStorage
    ctx.close()

    # 版面：360／820／1280 沒有橫向捲動、觸控目標 ≥ 44 px
    for w in (360, 820, 1280):
        ctx, pg, errs, real = new_page(w, 900)
        pg.goto(BASE + '#/materials'); pg.wait_for_selector('#matTree li')
        pg.locator('#matTree a', has_text='理化').click()
        imgs2 = pg.evaluate(MAKE_IMAGES)
        pg.click('#matUploadToggle')
        pg.set_input_files('#matFilePick', [{'name': f'圖{i}.webp', 'mimeType': 'image/webp', 'buffer': base64.b64decode(imgs2['small'])} for i in range(4)] + [{'name': '動畫.gif', 'mimeType': 'image/gif', 'buffer': b'GIF89a'}])
        pg.wait_for_function("!document.getElementById('matUploadSummary').textContent.includes('處理中') && document.getElementById('matUploadSummary').textContent.includes('5 張中')", timeout=30000)
        r = pg.evaluate("""() => {
          const de = document.documentElement; const small = [];
          for (const el of document.querySelectorAll('#entryPanel a, #entryPanel button, #entryPanel input:not([type=file]), #entryPanel select')) {
            const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
            if (el.closest('.crumbs [aria-current]')) continue;
            if (b.height < 44 || (b.width < 44 && el.tagName !== 'INPUT')) small.push(`${el.tagName}.${el.className}「${(el.textContent||'').trim().slice(0,10)}」${Math.round(b.width)}x${Math.round(b.height)}`);
          }
          return { over: de.scrollWidth - de.clientWidth, small: small.slice(0, 6) };
        }""")
        ok(f'{w}px：沒有橫向捲動', r['over'] == 0, str(r['over']))
        ok(f'{w}px：觸控目標 ≥ 44 px', not r['small'], ' / '.join(r['small']))
        pg.screenshot(path=str(OUT / f'p2-03-layout_{w}.png'), full_page=True)
        if w == 360:
            pg.locator('.thumb__menu').first.click()
            box = pg.locator('.menu').bounding_box()
            ok('360px：操作選單在畫面內（底部面板）', box['x'] >= 0 and box['x'] + box['width'] <= 360, json.dumps(box))
            pg.screenshot(path=str(OUT / 'p2-04-menu_360.png'))
        ok(f'{w}px：沒有 JS 錯誤', not errs, ' | '.join(errs[:2]))
        ctx.close()

    # 正式 CSP 下：開學習資料頁、上傳、看縮圖與預覽，不能有任何 CSP 違規
    ctx, pg, errs, real = new_page(1280, 900, csp=True)
    pg.goto(BASE + '#/materials'); pg.wait_for_selector('#matTree li')
    pg.locator('#matTree a', has_text='理化').click()
    pg.wait_for_timeout(500)
    imgs3 = None
    pg.click('#matUploadToggle')
    import base64 as _b
    imgs3 = pg.evaluate(MAKE_IMAGES)
    pg.set_input_files('#matFilePick', [{'name': 'csp.webp', 'mimeType': 'image/webp', 'buffer': _b.b64decode(imgs3['small'])}])
    try:
        pg.wait_for_selector('#matThumbs .thumb img', timeout=20000)
    except Exception:
        print('CSP 模式上傳狀態:', pg.locator('.upload-item__status').all_inner_texts(), errs[:3])
        raise
    pg.locator('#matThumbs .thumb__btn').first.click()
    pg.wait_for_selector('#matDlgPreview .preview-box img')
    pg.wait_for_timeout(500)
    ok('正式 CSP 下上傳、縮圖、預覽都沒有違規或錯誤', not errs, ' | '.join(errs[:3]))
    ctx.close()
    b.close()

server.terminate()
for s_, l, n in results:
    print(f'{s_} {l}' + (f'（{n}）' if n else ''))
print(f"\n通過 {sum(1 for r in results if r[0] == '✓')}／{len(results)}")
