/* LTA.sync — optional Supabase cloud sync. Plain fetch against the PostgREST API,
 * no SDK. Credentials live only in localStorage (Settings), never in the repo.
 *
 * One-time setup (Supabase SQL editor):
 *   create table if not exists app_state (
 *     id text primary key,
 *     state jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *   alter table app_state enable row level security;
 *   create policy "anon read/write" on app_state for all
 *     using (true) with check (true);
 *
 * Note: with the anon key baked into RLS-open policies, anyone holding your
 * project URL + anon key can read this row. Fine for a single-user training log;
 * keep the key out of public places anyway.
 */
window.LTA = window.LTA || {};

LTA.sync = (function () {
  'use strict';

  const ROW_ID = 'luke';
  let pushTimer = null;
  let status = { state: 'off', detail: '' }; // off | ok | syncing | error
  const listeners = [];

  function onStatus(fn) { listeners.push(fn); }
  function setStatus(state, detail) {
    status = { state, detail: detail || '' };
    listeners.forEach((fn) => fn(status));
  }
  function getStatus() { return status; }

  function creds() {
    const st = LTA.store.getState();
    const url = (st.settings.supabaseUrl || '').trim().replace(/\/+$/, '');
    const key = (st.settings.supabaseKey || '').trim();
    return url && key ? { url, key } : null;
  }

  function headers(key) {
    return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  }

  async function pull() {
    const c = creds();
    if (!c) { setStatus('off'); return null; }
    setStatus('syncing', 'pulling');
    try {
      const res = await fetch(c.url + '/rest/v1/app_state?id=eq.' + ROW_ID + '&select=state,updated_at', { headers: headers(c.key) });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — check URL/key and that the app_state table exists');
      const rows = await res.json();
      setStatus('ok', 'pulled');
      return rows.length ? rows[0] : null;
    } catch (e) {
      setStatus('error', e.message);
      return null;
    }
  }

  async function push() {
    const c = creds();
    if (!c) { setStatus('off'); return false; }
    setStatus('syncing', 'pushing');
    try {
      const st = LTA.store.getState();
      // Push the training data, not the keys — no reason to store a credential inside
      // the row that credential unlocks.
      const payload = LTA.store.withoutCredentials(st);
      const res = await fetch(c.url + '/rest/v1/app_state', {
        method: 'POST',
        headers: Object.assign(headers(c.key), { Prefer: 'resolution=merge-duplicates' }),
        body: JSON.stringify([{ id: ROW_ID, state: payload, updated_at: st.updatedAt }]),
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
    if (!creds()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 2500);
  }

  // On app open: adopt the remote copy if it's newer than local (last-write-wins,
  // with a confirm so a stale device can't silently clobber fresh local work).
  async function initialSync() {
    const c = creds();
    if (!c) return;
    const remote = await pull();
    if (!remote || !remote.state) { push(); return; }
    const local = LTA.store.getState();
    const remoteAt = remote.state.updatedAt || remote.updated_at;
    if (remoteAt && local.updatedAt && remoteAt > local.updatedAt) {
      const localSessions = local.sessions.length;
      const remoteSessions = (remote.state.sessions || []).length;
      const ok = confirm('Cloud copy is newer (' + remoteSessions + ' sessions vs ' + localSessions + ' here). Load it on this device?');
      if (ok) {
        remote.state.settings.supabaseUrl = local.settings.supabaseUrl;
        remote.state.settings.supabaseKey = local.settings.supabaseKey;
        LTA.store.replaceState(remote.state);
        if (LTA.ui) LTA.ui.render();
        setStatus('ok', 'loaded cloud copy');
        return;
      }
    }
    push();
  }

  const TABLE_SQL = [
    'create table if not exists app_state (',
    '  id text primary key,',
    '  state jsonb not null,',
    '  updated_at timestamptz not null default now()',
    ');',
    'alter table app_state enable row level security;',
    'create policy "anon read/write" on app_state for all',
    '  using (true) with check (true);',
  ].join('\n');

  return { pull, push, schedulePush, initialSync, getStatus, onStatus, TABLE_SQL };
})();
