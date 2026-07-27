/* LTA.sync — Supabase auth + cloud sync. Plain fetch against the REST API, no SDK.
 *
 * Security model: the anon key is NOT a credential. It's a public project identifier
 * (safe in client code, safe if it leaks) and every request must additionally carry a
 * signed-in user's access token. Row-level security scopes every row to auth.uid(),
 * so the key alone gets you nothing.
 *
 * Tokens live under their own localStorage key, deliberately outside the app state —
 * that way they can never ride along in an export or get pushed to the cloud.
 *
 * One-time setup (Supabase SQL editor):
 *   create table if not exists user_state (
 *     user_id uuid primary key references auth.users(id) on delete cascade,
 *     state jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table user_state enable row level security;
 *   create policy "own row select" on user_state for select using (auth.uid() = user_id);
 *   create policy "own row insert" on user_state for insert with check (auth.uid() = user_id);
 *   create policy "own row update" on user_state for update
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */
window.LTA = window.LTA || {};

LTA.sync = (function () {
  'use strict';

  const AUTH_KEY = 'lta.auth';
  const TABLE = 'user_state';
  let auth = null;              // { access_token, refresh_token, expiresAt, userId, email }
  let pushTimer = null;
  let status = { state: 'off', detail: '' };   // off | signedout | ok | syncing | error
  const listeners = [];

  // ---------- status ----------
  function onStatus(fn) { listeners.push(fn); }
  function setStatus(state, detail) {
    status = { state, detail: detail || '' };
    listeners.forEach((fn) => fn(status));
  }
  function getStatus() { return status; }

  // ---------- project config (public, not secret) ----------
  function project() {
    const st = LTA.store.getState();
    const url = (st.settings.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = (st.settings.supabaseKey || '').trim();
    return url && key ? { url, key } : null;
  }

  // ---------- token storage ----------
  function loadAuth() {
    try { auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
    catch (e) { auth = null; }
    return auth;
  }
  function saveAuth(a) {
    auth = a;
    try {
      if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* storage full or blocked */ }
  }
  function currentUser() { return auth ? { email: auth.email, userId: auth.userId } : null; }

  function sessionFrom(json) {
    if (!json || !json.access_token) return null;
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expiresAt: Date.now() + ((json.expires_in || 3600) * 1000),
      userId: json.user ? json.user.id : (auth && auth.userId),
      email: json.user ? json.user.email : (auth && auth.email),
    };
  }

  function errorText(json, res) {
    return (json && (json.error_description || json.msg || json.message || json.error)) || ('HTTP ' + res.status);
  }

  // ---------- auth ----------
  async function signUp(email, password) {
    const p = project();
    if (!p) throw new Error('Add your project URL and anon key first.');
    const res = await fetch(p.url + '/auth/v1/signup', {
      method: 'POST',
      headers: { apikey: p.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(errorText(json, res));
    const sess = sessionFrom(json);
    if (!sess) {
      // Email confirmation is on — no session until the link is clicked.
      setStatus('signedout', 'check your email to confirm');
      return { confirmationRequired: true };
    }
    saveAuth(sess);
    setStatus('ok', 'signed in');
    return { confirmationRequired: false };
  }

  async function signIn(email, password) {
    const p = project();
    if (!p) throw new Error('Add your project URL and anon key first.');
    const res = await fetch(p.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: p.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(errorText(json, res));
    const sess = sessionFrom(json);
    if (!sess) throw new Error('No session returned — is the email confirmed?');
    saveAuth(sess);
    setStatus('ok', 'signed in');
    return true;
  }

  async function signOut() {
    const p = project();
    try {
      if (p && auth) {
        await fetch(p.url + '/auth/v1/logout', {
          method: 'POST',
          headers: { apikey: p.key, Authorization: 'Bearer ' + auth.access_token },
        });
      }
    } catch (e) { /* logging out locally is what matters */ }
    saveAuth(null);
    setStatus('signedout', '');
  }

  // Refresh slightly early so a long session never fails mid-request.
  async function freshToken() {
    if (!auth) return null;
    if (Date.now() < auth.expiresAt - 60000) return auth.access_token;
    const p = project();
    if (!p) return null;
    try {
      const res = await fetch(p.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { apikey: p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: auth.refresh_token }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorText(json, res));
      const sess = sessionFrom(json);
      if (!sess) throw new Error('refresh returned no session');
      saveAuth(sess);
      return sess.access_token;
    } catch (e) {
      saveAuth(null);
      setStatus('signedout', 'session expired — sign in again');
      return null;
    }
  }

  async function dataHeaders() {
    const p = project();
    const token = await freshToken();
    if (!p || !token) return null;
    return { apikey: p.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  // ---------- sync ----------
  async function pull() {
    const p = project();
    if (!p) { setStatus('off'); return null; }
    if (!auth) { setStatus('signedout'); return null; }
    const h = await dataHeaders();
    if (!h) return null;
    setStatus('syncing', 'pulling');
    try {
      const res = await fetch(p.url + '/rest/v1/' + TABLE + '?user_id=eq.' + auth.userId + '&select=state,updated_at', { headers: h });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — check the table exists and its policies are set');
      const rows = await res.json();
      setStatus('ok', 'pulled');
      return rows.length ? rows[0] : null;
    } catch (e) {
      setStatus('error', e.message);
      return null;
    }
  }

  async function push() {
    const p = project();
    if (!p) { setStatus('off'); return false; }
    if (!auth) { setStatus('signedout'); return false; }
    const h = await dataHeaders();
    if (!h) return false;
    setStatus('syncing', 'pushing');
    try {
      const st = LTA.store.getState();
      // Training data only — credentials and tokens never go into the row.
      const payload = LTA.store.withoutCredentials(st);
      const res = await fetch(p.url + '/rest/v1/' + TABLE, {
        method: 'POST',
        headers: Object.assign({}, h, { Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify([{ user_id: auth.userId, state: payload, updated_at: st.updatedAt }]),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setStatus('ok', 'synced ' + new Date().toLocaleTimeString());
      return true;
    } catch (e) {
      setStatus('error', e.message);
      return false;
    }
  }

  function schedulePush() {
    if (!project() || !auth) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 2500);
  }

  // On app open: adopt the cloud copy if it's newer, asking first so a stale device
  // can't silently overwrite fresh work.
  async function initialSync() {
    loadAuth();
    if (!project()) { setStatus('off'); return; }
    if (!auth) { setStatus('signedout'); return; }
    const remote = await pull();
    if (!remote || !remote.state) { push(); return; }
    const local = LTA.store.getState();
    const remoteAt = remote.state.updatedAt || remote.updated_at;
    if (remoteAt && local.updatedAt && remoteAt > local.updatedAt) {
      const ok = confirm('Cloud copy is newer (' + (remote.state.sessions || []).length +
        ' sessions vs ' + local.sessions.length + ' here). Load it on this device?');
      if (ok) {
        const merged = remote.state;
        merged.settings.supabaseUrl = local.settings.supabaseUrl;
        merged.settings.supabaseKey = local.settings.supabaseKey;
        LTA.store.replaceState(merged);
        if (LTA.engine) LTA.engine.applyUserExercises();
        if (LTA.ui) LTA.ui.render();
        setStatus('ok', 'loaded cloud copy');
        return;
      }
    }
    push();
  }

  const TABLE_SQL = [
    'create table if not exists user_state (',
    '  user_id uuid primary key references auth.users(id) on delete cascade,',
    '  state jsonb not null,',
    '  updated_at timestamptz not null default now()',
    ');',
    'alter table user_state enable row level security;',
    '',
    'create policy "own row select" on user_state',
    '  for select using (auth.uid() = user_id);',
    'create policy "own row insert" on user_state',
    '  for insert with check (auth.uid() = user_id);',
    'create policy "own row update" on user_state',
    '  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
    '',
    '-- no delete policy: nothing can wipe the row through the API',
  ].join('\n');

  return {
    pull, push, schedulePush, initialSync, getStatus, onStatus, TABLE_SQL,
    signUp, signIn, signOut, currentUser, loadAuth,
  };
})();
