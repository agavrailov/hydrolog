const WMO: Record<number, string> = {
  0: 'Ясно', 1: 'Предимно ясно', 2: 'Частично облачно', 3: 'Облачно',
  45: 'Мъгла', 48: 'Скреж',
  51: 'Слаба мъгла-дъжд', 53: 'Умерена мъгла-дъжд', 55: 'Плътна мъгла-дъжд',
  61: 'Слаб дъжд', 63: 'Умерен дъжд', 65: 'Силен дъжд',
  71: 'Слаб сняг', 73: 'Умерен сняг', 75: 'Силен сняг', 77: 'Зърнест сняг',
  80: 'Слаби превалявания', 81: 'Умерени превалявания', 82: 'Силни превалявания',
  85: 'Слаби снежни превалявания', 86: 'Силни снежни превалявания',
  95: 'Гръмотевична буря', 96: 'Гръмотевична буря с градушка', 99: 'Гръмотевична буря с едра градушка',
};

export interface WeatherResult {
  description: string;
  tempC: number;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherResult | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=Europe%2FSofia`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as {
      current?: { temperature_2m?: number; weathercode?: number };
    };
    const cur = data.current;
    if (!cur) return null;
    const tempC = cur.temperature_2m ?? NaN;
    const code  = cur.weathercode ?? -1;
    const description = WMO[code] ?? '';
    if (isNaN(tempC)) return null;
    return { description, tempC };
  } catch {
    return null;
  }
}
