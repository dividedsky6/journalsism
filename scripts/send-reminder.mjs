// Sends the daily "What happened today?" push to every subscribed device.
// Run by .github/workflows/reminder.yml. Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// PUSH_SUBSCRIPTIONS (one subscription code per line, copied from Journalism → Settings).
import webpush from 'web-push';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTIONS = '', SCHEDULE = '',
  REMINDER_TZ = 'America/Los_Angeles', REMINDER_TIME = '21:00', REMINDER_TEXT = 'What happened today?' } = process.env;

// The workflow runs at two UTC times (one for daylight time, one for standard time).
// Only the run that lands on REMINDER_TIME in REMINDER_TZ sends; manual runs always send.
if (SCHEDULE) {
  const [min, hour] = SCHEDULE.trim().split(/\s+/);
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +hour, +min));
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: REMINDER_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  if (local !== REMINDER_TIME) { console.log(`Skipping: ${SCHEDULE} is ${local} in ${REMINDER_TZ}, reminder is at ${REMINDER_TIME}.`); process.exit(0); }
}

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) { console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets.'); process.exit(1); }
const subs = PUSH_SUBSCRIPTIONS.split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => {
  try { return JSON.parse(s); } catch { console.error(`Line ${i + 1} of PUSH_SUBSCRIPTIONS is not a valid code; skipping.`); return null; }
}).filter(Boolean);
if (!subs.length) { console.log('No devices subscribed yet (PUSH_SUBSCRIPTIONS is empty).'); process.exit(0); }

webpush.setVapidDetails('https://github.com/dividedsky6/journalsism', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const payload = JSON.stringify({ title: 'Journalism', body: REMINDER_TEXT });
let failed = 0;
for (const [i, sub] of subs.entries()) {
  try { await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: 'normal' }); console.log(`Device ${i + 1}: sent.`); }
  catch (err) {
    failed++;
    const gone = err.statusCode === 404 || err.statusCode === 410;
    console.error(`Device ${i + 1}: ${gone ? 'subscription expired. Turn reminders off and on in the app and replace its code.' : `failed (${err.statusCode || ''} ${err.body || err.message})`}`);
  }
}
if (failed === subs.length) process.exit(1);
