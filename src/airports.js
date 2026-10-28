'use strict';
// Indian domestic airports. lat/lon are used to derive distance -> duration and base fare.
// `remote: true` airports are only served by the two full-service carriers in the demo schedule.
const AIRPORTS = [
  ['BOM', 'Mumbai', 'Chhatrapati Shivaji Maharaj Intl', 19.0896, 72.8656],
  ['DEL', 'New Delhi', 'Indira Gandhi Intl', 28.5562, 77.1],
  ['BLR', 'Bengaluru', 'Kempegowda Intl', 13.1986, 77.7066],
  ['HYD', 'Hyderabad', 'Rajiv Gandhi Intl', 17.2403, 78.4294],
  ['MAA', 'Chennai', 'Chennai Intl', 12.9941, 80.1709],
  ['CCU', 'Kolkata', 'Netaji Subhas Chandra Bose Intl', 22.6547, 88.4467],
  ['GOI', 'Goa', 'Dabolim', 15.3808, 73.8314],
  ['AMD', 'Ahmedabad', 'Sardar Vallabhbhai Patel Intl', 23.0772, 72.6347],
  ['PNQ', 'Pune', 'Pune Airport', 18.5821, 73.9197],
  ['COK', 'Kochi', 'Cochin Intl', 10.152, 76.4019],
  ['JAI', 'Jaipur', 'Jaipur Intl', 26.8242, 75.8122],
  ['LKO', 'Lucknow', 'Chaudhary Charan Singh Intl', 26.7606, 80.8893],
  ['IXL', 'Leh', 'Kushok Bakula Rimpochee', 34.1359, 77.5465, true],
  ['GAU', 'Guwahati', 'Lokpriya Gopinath Bordoloi Intl', 26.1061, 91.5859],
  ['PAT', 'Patna', 'Jay Prakash Narayan Intl', 25.5913, 85.088],
  ['IXC', 'Chandigarh', 'Chandigarh Intl', 30.6735, 76.7885],
  ['TRV', 'Thiruvananthapuram', 'Trivandrum Intl', 8.4821, 76.92],
  ['NAG', 'Nagpur', 'Dr. Babasaheb Ambedkar Intl', 21.0922, 79.0472],
  ['IDR', 'Indore', 'Devi Ahilya Bai Holkar', 22.7218, 75.8011],
  ['BBI', 'Bhubaneswar', 'Biju Patnaik Intl', 20.2444, 85.8178],
  ['SXR', 'Srinagar', 'Sheikh ul-Alam Intl', 33.9871, 74.7742, true],
  ['VNS', 'Varanasi', 'Lal Bahadur Shastri Intl', 25.4524, 82.8593],
  ['IXB', 'Bagdogra', 'Bagdogra Airport', 26.6812, 88.3286, true],
  ['ATQ', 'Amritsar', 'Sri Guru Ram Dass Jee Intl', 31.7096, 74.7973],
  ['IXZ', 'Port Blair', 'Veer Savarkar Intl', 11.6412, 92.7297, true],
  ['CJB', 'Coimbatore', 'Coimbatore Intl', 11.03, 77.0434],
  ['VTZ', 'Visakhapatnam', 'Visakhapatnam Airport', 17.7212, 83.2245],
  ['UDR', 'Udaipur', 'Maharana Pratap', 24.6177, 73.8961],
  ['DED', 'Dehradun', 'Jolly Grant', 30.1897, 78.1803, true],
  ['RPR', 'Raipur', 'Swami Vivekananda', 21.1804, 81.7388],
  ['IXR', 'Ranchi', 'Birsa Munda', 23.3143, 85.3217],
  ['BHO', 'Bhopal', 'Raja Bhoj', 23.2875, 77.3374],
].map(([code, city, name, lat, lon, remote]) => ({ code, city, name, lat, lon, remote: !!remote }));

const BY_CODE = new Map(AIRPORTS.map((a) => [a.code, a]));
const HUBS = ['DEL', 'BOM', 'BLR', 'HYD'];

const publicShape = (a) => ({ code: a.code, city: a.city, name: a.name, label: `${a.city} (${a.code})` });

function get(code) { return BY_CODE.get(String(code || '').toUpperCase().trim()); }

/** Accepts "BOM", "Mumbai (BOM)" or "Mumbai" and returns an airport or undefined. */
function resolve(input) {
  if (!input) return undefined;
  const s = String(input).trim();
  const paren = s.match(/\(([A-Za-z]{3})\)\s*$/);
  if (paren) return get(paren[1]);
  if (/^[A-Za-z]{3}$/.test(s) && get(s)) return get(s);
  const lower = s.toLowerCase();
  return AIRPORTS.find((a) => a.city.toLowerCase() === lower);
}

function search(q, limit = 8) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return AIRPORTS.filter((a) => ['BOM', 'DEL', 'BLR', 'HYD', 'MAA', 'CCU', 'GOI', 'PNQ'].includes(a.code)).map(publicShape);
  const scored = [];
  for (const a of AIRPORTS) {
    const city = a.city.toLowerCase(); const code = a.code.toLowerCase(); const name = a.name.toLowerCase();
    let score = -1;
    if (code === s) score = 0;
    else if (city.startsWith(s)) score = 1;
    else if (code.startsWith(s)) score = 2;
    else if (city.includes(s)) score = 3;
    else if (name.includes(s)) score = 4;
    if (score >= 0) scored.push([score, a]);
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].city.localeCompare(y[1].city)).slice(0, limit).map(([, a]) => publicShape(a));
}

function distanceKm(a, b) {
  const R = 6371; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { AIRPORTS, HUBS, get, resolve, search, distanceKm, publicShape };
