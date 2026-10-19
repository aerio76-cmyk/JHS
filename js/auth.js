// 家長登入頁共用的 Auth 邏輯（Google OAuth via Supabase Auth）

async function getSession() {
  const { data } = await sbClient.auth.getSession();
  return data.session;
}

function loginWithGoogle() {
  sbClient.auth.signInWithOAuth({
    provider: 'google',
    // 只帶 origin + 路徑（不帶 query／hash），必須跟 Supabase Redirect URLs 的精確網址一致
    options: { redirectTo: window.location.origin + window.location.pathname },
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
