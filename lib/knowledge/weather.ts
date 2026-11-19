// Weather reports for the story's real cities, from Open-Meteo (free, no key, no AI).
// One report per day per city goes into World; characters can form impressions of it.
// Pure (unit-tested) except nothing: fetching happens in refresh.ts like any feed.
import type { FeedItem } from "./feed";

export const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
export const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";

export function weatherUrl(lat: number, lon: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto", forecast_days: "3", temperature_unit: "fahrenheit", wind_speed_unit: "mph",
  });
  return `${WEATHER_API}?${p}`;
}

/** WMO weather codes → plain words. */
export function describe(code: number | null | undefined): string {
  if (code == null) return "unknown";
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

export function parseGeocode(body: string): { lat: number; lon: number; name: string; region: string } | null {
  try {
    const r = (JSON.parse(body) as { results?: { latitude: number; longitude: number; name: string; admin1?: string; country?: string }[] }).results?.[0];
    return r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
      ? { lat: r.latitude, lon: r.longitude, name: r.name, region: [r.admin1, r.country].filter(Boolean).join(", ") } : null;
  } catch { return null; }
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const deg = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${Math.round(n)}°F` : "?");

/** Today's report as one item (key = city + date, so each day adds one). */
export function parseWeather(body: string, city: string): FeedItem[] | { error: string } {
  let j: { current?: Record<string, number>; daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[] } };
  try { j = JSON.parse(body); } catch { return { error: "The weather service didn't answer properly." }; }
  const d = j.daily; const t = d?.time ?? [];
  if (!t.length) return { error: "The weather service sent no forecast." };
  const c = j.current ?? {};
  const lines = t.slice(0, 3).map((date, i) => {
    const rain = d?.precipitation_probability_max?.[i];
    return `${i === 0 ? "Today" : day(date)}: ${describe(d?.weather_code?.[i])}, high ${deg(d?.temperature_2m_max?.[i])}, low ${deg(d?.temperature_2m_min?.[i])}${typeof rain === "number" ? `, ${rain}% chance of rain` : ""}.`;
  });
  const now = c.temperature_2m != null ? `Now: ${deg(c.temperature_2m)} (feels like ${deg(c.apparent_temperature)}), ${describe(c.weather_code)}, wind ${Math.round(c.wind_speed_10m ?? 0)} mph.` : "";
  return [{
    key: `weather:${city.toLowerCase()}:${t[0]}`, title: `${city} weather · ${day(t[0])}: ${describe(d?.weather_code?.[0])}, ${deg(d?.temperature_2m_max?.[0])} / ${deg(d?.temperature_2m_min?.[0])}`,
    url: null, author: "Open-Meteo", published_at: `${t[0]}T12:00:00.000Z`, content: [now, ...lines].filter(Boolean).join("\n"),
  }];
}
