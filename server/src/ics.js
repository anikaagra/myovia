// Calendar reminder for the next check, repeating on the patient's schedule. Works with Apple Calendar on iPhone.
const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function reminderIcs({ due, everyDays, uid, base = process.env.RISE_PUBLIC_URL || '' }) {
  const start = new Date(`${due}T17:00:00Z`);
  const end = new Date(start.getTime() + 15 * 60e3);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rise//Muscle check//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `RRULE:FREQ=DAILY;INTERVAL=${everyDays};COUNT=12`,
    'SUMMARY:Rise muscle check',
    `DESCRIPTION:Your muscle check is due. It takes about 3 minutes.${base ? `\\n${base}` : ''}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Your Rise muscle check is due', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
