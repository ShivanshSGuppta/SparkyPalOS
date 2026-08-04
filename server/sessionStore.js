import { randomUUID } from 'crypto';
import { getSupabaseAdminClient, isSupabaseConfigured } from './supabaseClient.js';

const memorySessions = new Map();

function toIso() {
  return new Date().toISOString();
}

function memoryGetOrCreate({ sessionId = '', username = 'USER', ownerId = 'anon', ttlMs = 86400000, maxSessions = 2000 }) {
  const now = Date.now();
  for (const [key, value] of memorySessions.entries()) {
    if (now - (value.lastSeenAt || now) > ttlMs) memorySessions.delete(key);
  }

  if (memorySessions.size > maxSessions) {
    const oldest = Array.from(memorySessions.entries())
      .sort((a, b) => (a[1].lastSeenAt || 0) - (b[1].lastSeenAt || 0));
    const removeCount = Math.max(1, memorySessions.size - maxSessions);
    for (let i = 0; i < removeCount; i += 1) memorySessions.delete(oldest[i][0]);
  }

  const id = sessionId || randomUUID();
  if (!memorySessions.has(id)) {
    memorySessions.set(id, {
      id,
      ownerId,
      username,
      createdAt: toIso(),
      lastSeenAt: now,
      history: []
    });
  } else {
    memorySessions.get(id).lastSeenAt = now;
  }
  return memorySessions.get(id);
}

async function supabaseGetOrCreate({ sessionId = '', username = 'USER', ownerId = 'anon' }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const id = sessionId || randomUUID();
  const { data: found } = await supabase
    .from('sessions')
    .select('id, owner_id, username, created_at, last_seen_at')
    .eq('id', id)
    .maybeSingle();

  if (found) {
    await supabase.from('sessions').update({ last_seen_at: toIso() }).eq('id', id);
    const { data: rows } = await supabase
      .from('messages')
      .select('role,content,created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true })
      .limit(30);

    return {
      id,
      ownerId: found.owner_id || ownerId,
      username: found.username || username,
      createdAt: found.created_at,
      lastSeenAt: Date.now(),
      history: (rows || []).map((r) => ({ role: r.role, content: r.content, ts: r.created_at }))
    };
  }

  await supabase.from('sessions').insert({
    id,
    owner_id: ownerId,
    username,
    created_at: toIso(),
    last_seen_at: toIso()
  });

  return {
    id,
    ownerId,
    username,
    createdAt: toIso(),
    lastSeenAt: Date.now(),
    history: []
  };
}

async function supabaseAppend({ sessionId, role, content, ownerId = 'anon' }) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !sessionId) return;

  await supabase.from('messages').insert({
    id: randomUUID(),
    session_id: sessionId,
    owner_id: ownerId,
    role,
    content,
    created_at: toIso()
  });

  await supabase.from('sessions').update({ last_seen_at: toIso() }).eq('id', sessionId);

  const { data: rows } = await supabase
    .from('messages')
    .select('id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });

  if ((rows || []).length > 30) {
    const toDelete = rows.slice(30).map((r) => r.id);
    if (toDelete.length) {
      await supabase.from('messages').delete().in('id', toDelete);
    }
  }
}

export function createSessionStore({ sessionTtlMs, maxSessions }) {
  return {
    async getOrCreateSession({ sessionId, username, ownerId }) {
      if (isSupabaseConfigured()) {
        try {
          const fromDb = await supabaseGetOrCreate({ sessionId, username, ownerId });
          if (fromDb) return fromDb;
        } catch {
          // fallback to memory
        }
      }

      return memoryGetOrCreate({
        sessionId,
        username,
        ownerId,
        ttlMs: sessionTtlMs,
        maxSessions
      });
    },

    async appendHistory(session, role, content) {
      session.history.push({ role, content, ts: toIso() });
      session.lastSeenAt = Date.now();
      if (session.history.length > 30) session.history = session.history.slice(-30);

      if (isSupabaseConfigured()) {
        try {
          await supabaseAppend({ sessionId: session.id, role, content, ownerId: session.ownerId || 'anon' });
        } catch {
          // keep app healthy with in-memory fallback
        }
      }
    },

    getSessionCount() {
      return memorySessions.size;
    }
  };
}
