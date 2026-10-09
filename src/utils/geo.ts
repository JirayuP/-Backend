export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * คำนวณระยะทางเส้นตรง Haversine Distance (กิโลเมตร)
 */
export function calculateStraightDistanceKm(p1: LatLng, p2: LatLng): number {
  const R = 6371; // รัศมีโลกเฉลี่ย (km)
  const dLat = (p2.latitude - p1.latitude) * (Math.PI / 180);
  const dLon = (p2.longitude - p1.longitude) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.latitude * (Math.PI / 180)) *
      Math.cos(p2.latitude * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}
