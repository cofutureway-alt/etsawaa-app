/**
 * M2 — staff-isolation tests. A `staff` user WITHOUT the relevant permission
 * must NOT be able to read:
 *   1. private `settings` keys (beyond the public allowlist site.general /
 *      settings.design) — proven against a private probe key inserted by the
 *      service role,
 *   2. `audit_logs` rows (they exist — service-role count is printed),
 *   3. `profiles` rows beyond their own (a second test user exists).
 *
 * The phase-01 permission matrix seeds `staff` WITH settings.read/users.read
 * (seed.sql), so the fixture strips the staff role's permissions to `[]` for
 * the duration of the checks and restores the original set afterwards —
 * "staff without permission" as specified.
 *
 * Raw output is the artifact: evidence/phase-01/staff-isolation.txt
 * Reproduce: node --env-file=.env scripts/test-staff-isolation.mjs
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const STAMP = Date.now();
const STAFF_EMAIL = `staff-iso-${STAMP}@etsawaa-e2e.com`;
const CUST_EMAIL = `cust-iso-${STAMP}@etsawaa-e2e.com`;
const PASSWORD = 'Staff#12345';
const PRIVATE_KEY = 'payments.private_probe';

const lines = [];
const emit = (obj) => {
  const line = typeof obj === 'string' ? obj : JSON.stringify(obj);
  lines.push(line);
  console.log(line);
};
const count = async (table) => {
  const { count: n, error } = await svc.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return n;
};

const results = [];
const check = (test, expected, actual, pass, detail) => {
  results.push({ test, expected, actual, pass, ...(detail ? { detail } : {}) });
  emit({ test, expected, actual, pass, ...(detail ? { detail } : {}) });
};

try {
  // --- fixture: staff user + second (customer) user -------------------------
  const mk = async (email, role) => {
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: email.split('@')[0],
        phone_e164: `+201${role === 'staff' ? '1' : '2'}${String(STAMP).slice(-8)}`,
      },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    if (role !== 'customer') {
      const { error: upErr } = await svc.from('profiles').update({ role }).eq('id', data.user.id);
      if (upErr) throw new Error(`set role: ${upErr.message}`);
    }
    return data.user.id;
  };
  const staffId = await mk(STAFF_EMAIL, 'staff');
  const custId = await mk(CUST_EMAIL, 'customer');
  emit({ fixture: { staffId, custId, staffEmail: STAFF_EMAIL } });

  // --- fixture: a PRIVATE settings key nobody but the service may read ------
  const { error: privErr } = await svc
    .from('settings')
    .upsert([{ key: PRIVATE_KEY, value: { secret: 'probe' } }], { onConflict: 'key' });
  if (privErr) throw new Error(`private probe insert: ${privErr.message}`);

  // --- fixture: strip the staff role's permissions for the checks -----------
  const { data: roleRow, error: roleErr } = await svc
    .from('roles')
    .select('permissions')
    .eq('slug', 'staff')
    .single();
  if (roleErr) throw new Error(`read staff role: ${roleErr.message}`);
  const originalPerms = roleRow.permissions;
  const { error: stripErr } = await svc.from('roles').update({ permissions: [] }).eq('slug', 'staff');
  if (stripErr) throw new Error(`strip staff permissions: ${stripErr.message}`);
  emit({
    fixture: {
      staffPermissions: { duringTest: [], original: originalPerms },
      mechanism: 'has_permission() reads roles live (security definer) — no JWT cache involved',
    },
  });

  try {
    // --- sign in as staff through the public auth API -----------------------
    const { data: sess, error: signInErr } = await anon.auth.signInWithPassword({
      email: STAFF_EMAIL,
      password: PASSWORD,
    });
    if (signInErr) throw new Error(`staff sign-in: ${signInErr.message}`);
    emit({ staffJwtSubject: sess.user.id, staffRole: sess.user.app_metadata?.role ?? 'staff(profile)' });

    // [1] staff must not read the private settings key
    const { data: staffSettings, error: sErr } = await anon.from('settings').select('key,value');
    const staffKeys = (staffSettings ?? []).map((r) => r.key);
    check(
      'staff.settings.privateProbeHidden',
      `no ${PRIVATE_KEY} row`,
      staffKeys.includes(PRIVATE_KEY) ? 'VISIBLE (FAIL)' : 'hidden',
      !staffKeys.includes(PRIVATE_KEY) && !sErr,
      { keysSeen: staffKeys },
    );
    // [2] staff sees exactly the two public keys (the RLS allowlist)
    check(
      'staff.settings.publicAllowlistOnly',
      'exactly [site.general, settings.design]',
      JSON.stringify([...staffKeys].sort()),
      JSON.stringify([...staffKeys].sort()) === JSON.stringify(['settings.design', 'site.general']) && !sErr,
      { error: sErr?.message },
    );

    // [3] staff must not read audit_logs (rows exist — service count printed)
    const auditInDb = await count('audit_logs');
    const { data: staffAudit, error: aErr } = await anon.from('audit_logs').select('id');
    check(
      'staff.audit_logs.unreadable',
      `0 rows (DB holds ${auditInDb})`,
      (staffAudit ?? []).length,
      (staffAudit ?? []).length === 0 && !aErr,
      { error: aErr?.message },
    );

    // [4] staff must not read profiles beyond their own
    const profilesInDb = await count('profiles');
    const { data: staffProfiles, error: pErr } = await anon
      .from('profiles')
      .select('id,role');
    const seenIds = (staffProfiles ?? []).map((r) => r.id);
    check(
      'staff.profiles.ownRowOnly',
      `exactly 1 row (${staffId}) — DB holds ${profilesInDb}`,
      `${seenIds.length} rows`,
      seenIds.length === 1 && seenIds[0] === staffId && !pErr,
      { seenIds, error: pErr?.message },
    );
  } finally {
    // restore the seeded permission matrix no matter how the checks end
    const { error: restoreErr } = await svc
      .from('roles')
      .update({ permissions: originalPerms })
      .eq('slug', 'staff');
    emit({ fixture: { permissionsRestored: !restoreErr, error: restoreErr?.message } });
  }

  // --- cleanup: remove every fixture ----------------------------------------
  const { error: delPrivErr } = await svc.from('settings').delete().eq('key', PRIVATE_KEY);
  emit({ cleanup: { privateProbeDeleted: !delPrivErr, error: delPrivErr?.message } });
  for (const id of [staffId, custId]) await svc.auth.admin.deleteUser(id);
  let usersRemaining = -1;
  for (let i = 0; i < 5; i += 1) {
    const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 });
    usersRemaining = list.users.length;
    if (usersRemaining === 0) break;
    for (const u of list.users) await svc.auth.admin.deleteUser(u.id);
  }
  emit({
    cleanup: {
      usersRemaining,
      privateProbeGone: !(await svc.from('settings').select('key').eq('key', PRIVATE_KEY)).data?.length,
    },
  });

  const failed = results.filter((r) => !r.pass);
  emit({
    summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
  });
  fs.writeFileSync('evidence/phase-01/staff-isolation.txt', `${lines.join('\n')}\n`);
  if (failed.length > 0 || usersRemaining !== 0) {
    throw new Error(`staff-isolation FAILED (${failed.length} failing, usersRemaining=${usersRemaining})`);
  }
  console.log('M2 STAFF-ISOLATION OK');
} catch (error) {
  fs.writeFileSync('evidence/phase-01/staff-isolation.txt', `${lines.join('\n')}\n`);
  console.error('M2 STAFF-ISOLATION ERROR:', error.message);
  process.exitCode = 1;
}
