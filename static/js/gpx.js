// GPX export/import of the routes. Pure functions (string-based), testable in
// Node. Coordinates are [lng, lat, (ele?)] (GeoJSON order).

const xmlEscape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

/**
 * Builds a GPX document from tracks: `[{ name, coords: [[lng,lat,(ele)], …] }]`.
 * One `<trk>` per track (e.g. per stage).
 */
export function buildGPX(tracks, { creator = "GoneCycling" } = {}) {
  const trks = tracks
    .map((t) => {
      const pts = t.coords
        .map((c) => {
          const ele = c[2] != null ? `<ele>${c[2]}</ele>` : "";
          return `<trkpt lat="${c[1]}" lon="${c[0]}">${ele}</trkpt>`;
        })
        .join("");
      return `<trk><name>${xmlEscape(t.name || "")}</name><trkseg>${pts}</trkseg></trk>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${xmlEscape(creator)}" xmlns="http://www.topografix.com/GPX/1/1">${trks}</gpx>\n`;
}

function extractPoints(xml, tag) {
  const points = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "g");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const lat = parseFloat((m[1].match(/lat="([^"]+)"/) || [])[1]);
    const lon = parseFloat((m[1].match(/lon="([^"]+)"/) || [])[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lon, lat]);
  }
  return points;
}

/**
 * Reads the (first) name and all track points from a GPX string
 * (`<trkpt>`, alternatively `<rtept>`) as `[lng,lat]`. Deliberately regex-based
 * (DOMParser-free) so it's testable without a browser.
 */
export function parseGPX(xml) {
  const name = ((xml.match(/<name>([^<]*)<\/name>/) || [])[1] || "").trim();
  let points = extractPoints(xml, "trkpt");
  if (!points.length) points = extractPoints(xml, "rtept");
  return { name, points };
}
