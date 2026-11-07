// 測試用的假 supabase-js（只在 Playwright 攔截 CDN 時使用）：資料在記憶體，不連任何網路。
// window.__fake 可檢查狀態；window.__fail = { insertMaterials: n, uploadNetwork: n } 讓接下來 n 次失敗。
(() => {
  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const S = (id) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  const db = {
    admins: [{ email: 'parent@example.com', role: 'super_admin', created_at: now() }],
    students: [
      { id: S(1), name: 'Enisa', theme_color: '#F28B6D', avatar_preset: 'bear', avatar_url: null, enrolled_year: 2025 },
      { id: S(2), name: 'Milo', theme_color: '#3FA796', avatar_preset: 'bunny', avatar_url: null, enrolled_year: 2026 },
    ],
    subjects: ['chinese', 'english', 'math', 'science', 'social'].map((c, i) => ({ code: c, display_name: ['國文', '英文', '數學', '自然', '社會'][i], sort_order: i + 1 })),
    exam_scores: [], exam_rankings: [], motivational_quotes: [],
    material_folders: [], materials: [],
  };
  const sys = [['chinese', '國文', null], ['english', '英文', null], ['math', '數學', null], ['science', '自然', ['理化', '生物', '地球科學']], ['social', '社會', ['歷史', '地理', '公民']], ['other', '其他', null]];
  sys.forEach(([key, name, subs], i) => {
    const id = uuid();
    db.material_folders.push({ id, parent_id: null, name, sort: i + 1, is_system: true, system_key: key, created_at: now() });
    (subs || []).forEach((n, j) => db.material_folders.push({ id: uuid(), parent_id: id, name: n, sort: j + 1, is_system: false, system_key: null, created_at: now() }));
  });
  const files = { materials: new Map(), avatars: new Map() };
  window.__fail = {};
  const startAnon = new URLSearchParams(location.search).get('fake') === 'anon';
  let session = startAnon ? null : { role: 'admin', user: { id: 'admin-uid', email: 'parent@example.com', identities: [{ provider: 'google' }] } };
  window.__setSession = (role) => { session = role ? { role, user: { id: role + '-uid', email: role === 'viewer' ? 'viewer@example.test' : 'parent@example.com' } } : null; };
  const isViewer = () => session?.role === 'viewer';
  const authListeners = [];
  const emit = (event) => authListeners.forEach((cb) => cb(event, session ? { user: session.user } : null));
  window.__signOutElsewhere = () => { session = null; emit('SIGNED_OUT'); };
  const failOnce = (k) => { if (window.__fail[k] > 0) { window.__fail[k]--; return true; } return false; };
  const log = [];
  window.__fake = { db, files, log };

  const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_t)?\.(webp|jpg)$/;

  function cascadeDeleteFolder(id) {
    const kids = db.material_folders.filter((f) => f.parent_id === id).map((f) => f.id);
    kids.forEach(cascadeDeleteFolder);
    db.materials = db.materials.filter((m) => m.folder_id !== id);
    db.material_folders = db.material_folders.filter((f) => f.id !== id);
  }

  function builder(table) {
    const st = { op: 'select', filters: [], wantRows: false, single: null, payload: null, range: null };
    const b = {
      select() { if (st.op !== 'select') st.wantRows = true; return b; },
      eq(col, v) { st.filters.push((r) => r[col] === v); return b; },
      in(col, arr) { st.filters.push((r) => arr.includes(r[col])); return b; },
      order() { return b; },
      limit() { return b; },
      range(a, z) { st.range = [a, z]; return b; },
      maybeSingle() { st.single = 'maybe'; return b; },
      single() { st.single = 'one'; return b; },
      insert(rows) { st.op = 'insert'; st.payload = Array.isArray(rows) ? rows : [rows]; return b; },
      update(patch) { st.op = 'update'; st.payload = patch; return b; },
      delete() { st.op = 'delete'; return b; },
      upsert(rows) { st.op = 'upsert'; st.payload = Array.isArray(rows) ? rows : [rows]; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      log.push([table, st.op]);
      const rows = db[table];
      if (!rows) return { data: null, error: { message: `relation ${table} does not exist` } };
      const match = (r) => st.filters.every((f) => f(r));
      let out;
      if (st.op === 'select') {
        if (!session && ['materials', 'material_folders'].includes(table)) return { data: null, error: { message: `permission denied for table ${table}`, code: '42501' } };
        out = rows.filter(match);
        if (table === 'materials' && isViewer()) out = out.filter((r) => !r.is_learned);
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
      } else if (st.op === 'insert' || st.op === 'upsert') {
        if (table === 'materials' && failOnce('insertMaterials')) return { data: null, error: { message: 'new row violates row-level security policy for table "materials"', code: '42501' } };
        out = st.payload.map((p) => {
          const row = { id: uuid(), created_at: now(), ...p };
          if (table === 'materials') Object.assign(row, { is_learned: p.is_learned ?? false, grade_tag: p.grade_tag ?? null, updated_at: now() });
          if (table === 'material_folders') {
            if (db.material_folders.some((f) => f.parent_id === row.parent_id && f.name === row.name)) return { __err: { message: 'duplicate key value violates unique constraint', code: '23505' } };
            Object.assign(row, { is_system: false, system_key: null });
          }
          return row;
        });
        const err = out.find((r) => r.__err);
        if (err) return { data: null, error: err.__err };
        rows.push(...out);
        if (table === 'materials' && failOnce('insertLost')) return { data: null, error: { message: 'Failed to fetch' } }; // 已寫入但回應遺失
      } else if (st.op === 'update') {
        out = rows.filter(match).filter((r) => !(table === 'material_folders' && r.is_system));
        out.forEach((r) => Object.assign(r, st.payload, table === 'materials' ? { updated_at: now() } : {}));
      } else if (st.op === 'delete') {
        out = rows.filter(match).filter((r) => !(table === 'material_folders' && r.is_system));
        if (table === 'material_folders') out.forEach((r) => cascadeDeleteFolder(r.id));
        else db[table] = rows.filter((r) => !out.includes(r));
      }
      const data = out.map((r) => ({ ...r }));
      if (st.single === 'maybe') return { data: data[0] ?? null, error: null };
      if (st.single === 'one') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      return { data: st.op === 'select' || st.wantRows ? data : null, error: null };
    }
    return b;
  }

  function bucket(name) {
    const map = files[name];
    return {
      async upload(path, blob, opts = {}) {
        log.push(['upload', name, path]);
        if (failOnce('uploadNetwork')) return { data: null, error: { message: 'Failed to fetch' } };
        if (name === 'materials' && !PATH_RE.test(path)) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
        if (map.has(path) && !opts.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
        if (blob.size > 2 * 1024 * 1024) return { data: null, error: { message: 'The object exceeded the maximum allowed size', statusCode: '413' } };
        if (!['image/jpeg', 'image/webp', 'image/png'].includes(opts.contentType || blob.type)) return { data: null, error: { message: 'mime type not supported', statusCode: '415' } };
        map.set(path, { blob, created_at: now(), type: opts.contentType || blob.type });
        return { data: { path }, error: null };
      },
      async remove(paths) {
        log.push(['remove', name, ...paths]);
        const removed = paths.filter((p) => map.delete(p));
        return { data: removed.map((p) => ({ name: p })), error: null };
      },
      async list(_prefix, { limit = 100, offset = 0 } = {}) {
        const all = [...map.entries()].map(([n, f]) => ({ name: n, id: n, created_at: f.created_at, metadata: { size: f.blob.size } }));
        return { data: all.slice(offset, offset + limit), error: null };
      },
      async createSignedUrls(paths) {
        return { data: paths.map((p) => ({ path: p, signedUrl: map.has(p) ? URL.createObjectURL(map.get(p).blob) : null, error: map.has(p) ? null : 'Object not found' })), error: null };
      },
      async download(path) {
        log.push(['download', name, path]);
        if (window.__downloadDelay) await new Promise((r) => setTimeout(r, window.__downloadDelay));
        const f = map.get(path);
        const row = db.materials.find((m) => m.storage_path === path || m.thumb_path === path);
        const allowed = session && (session.role === 'admin' || (isViewer() && row && !row.is_learned));
        if (!f || !allowed) return { data: null, error: { message: 'Object not found', statusCode: '400' } };
        return { data: f.blob, error: null };
      },
      getPublicUrl(path) { return { data: { publicUrl: `https://cfalawxigobkpqjtcpzq.supabase.co/storage/v1/object/public/${name}/${path}` } }; },
    };
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: session ? { user: session.user } : null } }; },
          async signOut(opts = {}) { log.push(['signOut', opts.scope || 'global']); try { sessionStorage.setItem('fakeLastSignOut', opts.scope || 'global'); } catch {} session = null; emit('SIGNED_OUT'); return { error: null }; },
          async signInWithPassword({ email, password }) {
            log.push(['login', email]);
            if (window.__fail.rateLimit > 0) { window.__fail.rateLimit--; return { data: {}, error: { status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' } }; }
            if (email === 'viewer@example.test' && password === 'correct-horse-battery') { window.__setSession('viewer'); return { data: { session }, error: null }; }
            if (email === 'other@example.test' && password === 'correct-horse-battery') { session = { role: 'none', user: { id: 'other-uid', email } }; return { data: { session }, error: null }; }
            return { data: {}, error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials <script>' } };
          },
          async signInWithOAuth() { return { error: null }; },
          onAuthStateChange(cb) { authListeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session ? { user: session.user } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        },
        from: builder,
        storage: { from: bucket },
        rpc: async (fn) => {
          if (fn === 'is_viewer' && window.__fail.rpcViewer > 0) { window.__fail.rpcViewer--; return { data: null, error: { message: 'Failed to fetch' } }; }
          return { data: fn === 'is_viewer' ? isViewer() : fn === 'is_admin' ? session?.role === 'admin' : null, error: null };
        },
      };
    },
  };
})();
