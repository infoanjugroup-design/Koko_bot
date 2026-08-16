import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables. ' +
      'Set them in your .env file (local) or Render Environment tab (deployed).'
  );
}

// IMPORTANT: this must be the SERVICE ROLE key, not the anon key.
// The bot writes/reads sessions, users and transactions server-side,
// and RLS on those tables intentionally has no public policies —
// only the service role can touch them.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default supabase;
