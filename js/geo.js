const EARTH_RADIUS_KM = 6371;

export function distanceKm(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} м`;
  return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} км`;
}
