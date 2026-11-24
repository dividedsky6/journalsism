// Sends the daily "What happened today?" push to every subscribed device.
// Run by .github/workflows/reminder.yml. Secret: PUSH_SUBSCRIPTIONS, one setup code per line, copied
// from Journalsism → Settings → Daily reminder. Each code holds that device's subscription and its own keys.
import webpush from 'web-push';

const { PUSH_SUBSCRIPTIONS = '', SCHEDULE = '',
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

const subs = PUSH_SUBSCRIPTIONS.split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => {
  try { return JSON.parse(s); } catch { console.error(`Line ${i + 1} of PUSH_SUBSCRIPTIONS is not a valid code; skipping.`); return null; }
}).filter(Boolean);
if (!subs.length) { console.log('No devices subscribed yet (PUSH_SUBSCRIPTIONS is empty).'); process.exit(0); }

const SUBJECT = 'https://github.com/dividedsky6/journalsism';
const payload = JSON.stringify({ title: 'Journalsism', body: REMINDER_TEXT });
let failed = 0;
for (const [i, code] of subs.entries()) {
  if (!code.s || !code.k || !code.p) { failed++; console.error(`Device ${i + 1}: old-style code without keys. Turn reminders off and on in the app and paste the new setup code.`); continue; }
  try {
    await webpush.sendNotification(code.s, payload, { TTL: 6 * 3600, urgency: 'normal', vapidDetails: { subject: SUBJECT, publicKey: code.k, privateKey: code.p } });
    console.log(`Device ${i + 1}: sent.`);
  }
  catch (err) {
    failed++;
    const gone = err.statusCode === 404 || err.statusCode === 410;
    console.error(`Device ${i + 1}: ${gone ? 'subscription expired. Turn reminders off and on in the app and replace its code.' : `failed (${err.statusCode || ''} ${err.body || err.message})`}`);
  }
}
if (failed === subs.length) process.exit(1);
