// 填入你 Supabase 專案的 URL 與 anon public key（Project Settings -> API）。
// 這組 anon key 設計上就是可以公開的，安全性由 schema.sql 裡的 RLS 政策把關，
// 不需要因為它出現在這裡而擔心，也不需要另外用 .gitignore 排除這個檔案。
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',
};
