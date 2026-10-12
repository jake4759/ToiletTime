// Moderation tool: see reported reviews and remove or restore them.
//   npm run moderate                 list reported reviews
//   npm run moderate -- delete <id>  delete a review
//   npm run moderate -- restore <id> show a hidden review again and clear its reports
//   npm run moderate -- suspicious   accounts whose reviews all give the same 1 or 5 stars
const path = require('node:path');

require('../env').loadEnvFile(path.join(__dirname, '..', '.env'));
const { createStore } = require('../store');
const { REPORT_REASONS, HIDE_AFTER_REPORTS } = require('../moderation');

(async () => {
  const store = await createStore();
  const [action, id] = process.argv.slice(2);
  try {
    if (action === 'delete' || action === 'restore') {
      if (!id) throw new Error(`Usage: npm run moderate -- ${action} <review id>`);
      const ok = await store.moderate(id, action);
      console.log(ok ? (action === 'delete' ? 'Review deleted.' : 'Review restored and its reports cleared.') : 'No review with that ID.');
      return;
    }
    if (action === 'suspicious') {
      const accounts = await store.listSuspicious(5);
      if (!accounts.length) console.log('No suspicious accounts found.');
      for (const a of accounts) {
        console.log(`@${a.username ?? '(no username)'}: all ${a.reviews} reviews are ${a.overall}/5  (user ${a.userId})`);
      }
      if (accounts.length) console.log('\nSee their reviews in the app, and delete any fake ones with: npm run moderate -- delete <ID>');
      return;
    }
    const reported = await store.listReported();
    if (!reported.length) {
      console.log('No reported reviews. All clear!');
      return;
    }
    console.log(`\n${reported.length} reported review(s). Reviews with ${HIDE_AFTER_REPORTS}+ reports are hidden automatically.\n`);
    for (const r of reported) {
      const reasons = r.reports.map((x) => REPORT_REASONS[x.reason] || x.reason);
      console.log(`${r.hidden ? '[HIDDEN] ' : ''}${r.restroomName}: review by ${r.author}, ${r.overall}/5`);
      console.log(`  "${r.comment || '(no comment)'}"`);
      console.log(`  ${r.reports.length} report(s): ${reasons.join('; ')}`);
      console.log(`  ID: ${r.id}\n`);
    }
    console.log('To remove one:   npm run moderate -- delete <ID>');
    console.log('To keep one:     npm run moderate -- restore <ID>\n');
  } finally {
    await store.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
