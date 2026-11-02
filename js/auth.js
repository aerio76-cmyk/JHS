// 家長登入頁共用的 Auth 邏輯（Google OAuth via Supabase Auth）

async function getSession() {
  const { data } = await sbClient.auth.getSession();
  return data.session;
}

// 回傳 Promise<{ error }>；成功時瀏覽器會整頁跳轉到 Google
function loginWithGoogle() {
  return sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // 只帶 origin + 路徑（不帶 query／hash），必須跟 Supabase Redirect URLs 的精確網址一致
      redirectTo: window.location.origin + window.location.pathname,
      // 每次都讓使用者選帳號：登入失敗時才換得了帳號，不會被同一個帳號卡住
      queryParams: { prompt: 'select_account' },
    },
  });
}

async function logout() {
  await sbClient.auth.signOut();
  window.location.reload();
}

// 回傳 null（未登入）或 { email, role } / { email, role: 'none' }（已登入但不在白名單）
async function getCurrentAdminStatus() {
  const session = await getSession();
  if (!session) return null;

  const email = session.user.email;
  const { data, error } = await sbClient.from('admins').select('*').eq('email', email).maybeSingle();
  if (error) {
    console.error(error);
    return { email, role: 'none' };
  }
  return { email, role: data ? data.role : 'none' };
}
