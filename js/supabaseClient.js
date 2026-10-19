// 初始化 Supabase client。命名為 window.sbClient，避免跟 CDN 載入的全域 `supabase`
// 物件（@supabase/supabase-js 本身）互相覆蓋。
// flowType 'pkce'：OAuth 回來時網址只帶一次性 code（不是 access token），安全性較 implicit 高
window.sbClient = supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY,
  { auth: { flowType: 'pkce' } }
);
