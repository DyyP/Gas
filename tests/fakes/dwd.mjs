// Erzeugt Dateien im Format des DWD (produkt_klima_tag_*.txt) und passende Fake-HTTP-Antworten.
const HEADER = 'STATIONS_ID;MESS_DATUM;QN_3;  FX;  FM;QN_4; RSK;RSKF; SDK;SHK_TAG;  NM; VPM;  PM; TMK; UPM; TXK; TNK; TGK;eor';
const dn = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
const iso = n => new Date(n * 864e5).toISOString().slice(0, 10);

/** Saisonaler Temperaturverlauf (Mannheim-ähnlich): ~1,5 °C Mitte Januar, ~20 °C Mitte Juli. */
export const seasonalTemp = d => {
  const doy = (dn(d) - dn(d.slice(0, 4) + '-01-01')) / 365.25;
  return Math.round((10.8 - 9.3 * Math.cos(2 * Math.PI * (doy - 0.04))) * 10) / 10;
};

export function dwdText(from, to, tm = seasonalTemp, { missing = [] } = {}) {
  const lines = [HEADER];
  for (let n = dn(from); n <= dn(to); n++) {
    const d = iso(n);
    const t = missing.includes(d) ? '-999' : tm(d).toFixed(1);
    lines.push(`       5906;${d.replace(/-/g, '')};   10;   5.0;   2.0;    9;   0.0;   0;    1.000;   0;   5.0;   7.0; 1010.00;${t.padStart(7)};   80.00;   10.0;    2.0;    0.0;eor`);
  }
  return lines.join('\r\n') + '\r\n';
}

const BASE = 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/';

/** Fake-HTTP für Historie (bis Ende Vorjahr) und laufende Datei (bis gestern). */
export function dwdHttp({ histTo = '2025-12-31', recentFrom = '2025-05-06', recentTo = '2026-11-07', tm = seasonalTemp, missing = [] } = {}) {
  const histName = `tageswerte_KL_05906_17810101_${histTo.replace(/-/g, '')}_hist.zip`;
  return {
    [`${BASE}historical/`]: { body: `<a href="tageswerte_KL_05906_17810101_20241231_hist.zip">alt</a>\n<a href="${histName}">${histName}</a>\n<a href="tageswerte_KL_05692_19360101_20251231_hist.zip">Worms</a>` },
    [`${BASE}historical/${histName}`]: { body: [{ name: 'Metadaten.txt', text: 'x' }, { name: 'produkt_klima_tag_17810101_20251231_05906.txt', text: dwdText('2019-12-01', histTo, tm, { missing }) }] },
    [`${BASE}recent/tageswerte_KL_05906_akt.zip`]: { body: [{ name: 'produkt_klima_tag_20250506_20261107_05906.txt', text: dwdText(recentFrom, recentTo, tm, { missing }) }] },
  };
}
