// UK-local clock for schedulers (handles BST/GMT via Europe/London).
function londonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;
  const weekday = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short'
  }).format(new Date()); // 'Mon', 'Tue', ...
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10)
  };
}

module.exports = { londonNow };
