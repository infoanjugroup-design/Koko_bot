import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';
import supabase from './supabase.js';

const TABLE = 'sessions';

/**
 * Reads one (session_id, key) row and revives Buffers via Baileys' own
 * BufferJSON reviver (Baileys creds/keys contain Buffer/Uint8Array fields
 * that plain JSON.stringify/parse would otherwise corrupt).
 */
async function readData(sessionId, key) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('value')
    .eq('session_id', sessionId)
    .eq('key', key)
    .maybeSingle();

  if (error) {
    console.error(`[sessionStore] read failed for "${key}":`, error.message);
    return null;
  }
  if (!data) return null;

  return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
}

async function writeData(sessionId, key, value) {
  const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));

  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { session_id: sessionId, key, value: serialized, updated_at: new Date().toISOString() },
      { onConflict: 'session_id,key' }
    );

  if (error) console.error(`[sessionStore] write failed for "${key}":`, error.message);
}

async function removeData(sessionId, key) {
  const { error } = await supabase.from(TABLE).delete().eq('session_id', sessionId).eq('key', key);
  if (error) console.error(`[sessionStore] delete failed for "${key}":`, error.message);
}

/**
 * Drop-in replacement for Baileys' useMultiFileAuthState(), but persists
 * everything in Supabase Postgres instead of local files — so the login
 * session survives Render free-tier restarts/redeploys (which wipe disk).
 *
 * One row per key: ('creds'), ('pre-key-<id>'), ('session-<id>'),
 * ('sender-key-<id>'), ('app-state-sync-key-<id>'), etc.
 */
export async function useSupabaseAuthState(sessionId = 'default-session') {
  const storedCreds = await readData(sessionId, 'creds');
  const creds = storedCreds || initAuthCreds();

  const saveCreds = async () => {
    await writeData(sessionId, 'creds', creds);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(sessionId, `${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(sessionId, key, value) : removeData(sessionId, key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds,
  };
}
