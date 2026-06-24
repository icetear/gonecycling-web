// Sunrise/sunset from date + coordinate (NOAA approximation, "sunrise equation").
// Purely local, no API. Returns UTC Date instants; the display formats the
// local time from them (fitting for trips in your own time zone, otherwise an approximation).

const RAD = Math.PI / 180;
const J2000 = 2451545.0;

function toJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}
function fromJulian(j) {
  return new Date((j - 2440587.5) * 86400000);
}

/**
 * Sunrise/sunset for `date` (its UTC date) at lat/lon.
 * @returns {{sunrise:Date|null, sunset:Date|null, polar?:"day"|"night"}}
 *   During polar day/night sunrise/sunset are null (+ `polar`).
 */
export function sunTimes(date, lat, lon) {
  const d0 = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const n = Math.round(toJulian(d0) - J2000 + 0.0008);
  const Jstar = n - lon / 360; // mean solar noon
  const M = (357.5291 + 0.98560028 * Jstar) % 360; // mean anomaly
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 282.9372) % 360; // ecliptic longitude (180 + 102.9372)
  const Jtransit = J2000 + Jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const delta = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD)); // declination
  const cosO = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(delta)) / (Math.cos(lat * RAD) * Math.cos(delta));
  if (cosO > 1) return { sunrise: null, sunset: null, polar: "night" }; // sun does not rise
  if (cosO < -1) return { sunrise: null, sunset: null, polar: "day" }; // sun does not set
  const omega = Math.acos(cosO) / RAD; // hour angle in degrees
  return { sunrise: fromJulian(Jtransit - omega / 360), sunset: fromJulian(Jtransit + omega / 360) };
}
