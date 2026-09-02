// 初始化 Supabase client。命名為 window.sbClient，避免跟 CDN 載入的全域 `supabase`
// 物件（@supabase/supabase-js 本身）互相覆蓋。
window.sbClient = supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
