/* Journalsism settings you may want to edit.
 * DEFAULT_JOURNAL_COLORS: colors given to journals with these names the first time they
 * appear (for example on a Day One import, since Day One's export has no colors).
 * You can still change any color in the app with "Edit journal". */
window.JOURNALISM_CONFIG = {
  DEFAULT_JOURNAL_COLORS: {
    'The Daily Download': '#2f8f4e',   // Green
    'The Career Chapters': '#d9651a',  // Orange
    'The Extra Big Things': '#0f8a8a', // Teal
    'Highdeas': '#9a7ae0',             // Light purple
  },
  // Daily reminder text shown in the notification. The time is set in .github/workflows/reminder.yml.
  REMINDER_TEXT: 'What happened today?',
};
