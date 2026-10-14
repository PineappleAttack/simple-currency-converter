// Currency calculator: Frankfurter daily fetch with localStorage caching, versioning,
// and UI display of lastUpdated vs lastChecked.

// Minimal static fallback rates (used only if no cached rates and fetch fails).
const FALLBACK_RATES = {
  "USD": 1.0,
  "EUR": 0.92,
  "GBP": 0.79,
  "JPY": 156.5,
  "AUD": 1.55,
  "CAD": 1.36,
  "CHF": 0.92,
  "CNY": 7.23,
  "INR": 83.2,
  "BRL": 5.25,
  "ISK": 128.5
};

const STORAGE_KEY = 'frankfurter_rates_v2';
const CACHE_SCHEMA = 'frankfurter_cache_v2';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const el = id => document.getElementById(id);
const fromSel = el('from');
const toSel = el('to');
const amountInput = el('amount');
const convertBtn = el('convert');
const resultDiv = el('result');
const metaDiv = el('meta');
const errorDiv = el('error');
const loading = el('loading');
const swapBtn = el('swap');

let currentRates = null; // { base: 'EUR', rates: {...}, date: 'YYYY-MM-DD' }
let availableCurrencies = [];

// Helpers
function formatTimestamp(ms) {
  if (!ms) return 'never';
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Tolerate older shapes: if there's no schema, try to map common fields.
    if (!parsed.schema) {
      // old-cache shape might be { base, rates, lastUpdated, lastChecked, dataVersion? }
      return {
        schema: CACHE_SCHEMA,
        dataVersion: parsed.dataVersion != null ? parsed.dataVersion : 1,
        base: parsed.base || 'EUR',
        rates: parsed.rates || parsed,
        lastUpdated: parsed.lastUpdated || null,
        lastChecked: parsed.lastChecked || null,
        note: parsed.note || null
      };
    }

    // If schema matches or is a newer known shape, return it directly
    return parsed;
  } catch (e) {
    console.warn('Failed to read rates cache', e);
    return null;
  }
}

function writeCache(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to write rates cache', e);
  }
}

const CURRENCY_NAMES = {
  AUD: 'Australian Dollar',
  BGN: 'Bulgarian Lev',
  BRL: 'Brazilian Real',
  CAD: 'Canadian Dollar',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Renminbi',
  CZK: 'Czech Koruna',
  DKK: 'Danish Krone',
  EUR: 'Euro',
  GBP: 'British Pound',
  HKD: 'Hong Kong Dollar',
  HUF: 'Hungarian Forint',
  IDR: 'Indonesian Rupiah',
  ILS: 'Israeli Shekel',
  INR: 'Indian Rupee',
  ISK: 'Icelandic Króna',
  JPY: 'Japanese Yen',
  KRW: 'South Korean Won',
  MXN: 'Mexican Peso',
  MYR: 'Malaysian Ringgit',
  NOK: 'Norwegian Krone',
  NZD: 'New Zealand Dollar',
  PHP: 'Philippine Peso',
  PLN: 'Polish Złoty',
  RON: 'Romanian Leu',
  SEK: 'Swedish Krona',
  SGD: 'Singapore Dollar',
  THB: 'Thai Baht',
  TRY: 'Turkish Lira',
  USD: 'US Dollar',
  ZAR: 'South African Rand'
};

function populateSelectorsFromList(list) {
  const prevFrom = fromSel.value;
  const prevTo = toSel.value;

  fromSel.innerHTML = '';
  toSel.innerHTML = '';
  list.forEach(c => {
    const label = CURRENCY_NAMES[c] ? `${c} – ${CURRENCY_NAMES[c]}` : c;
    const o1 = document.createElement('option');
    o1.value = c; o1.textContent = label;
    fromSel.appendChild(o1);

    const o2 = document.createElement('option');
    o2.value = c; o2.textContent = label;
    toSel.appendChild(o2);
  });

  if (list.includes(prevFrom)) fromSel.value = prevFrom;
  else fromSel.value = list.includes('USD') ? 'USD' : list[0];

  if (list.includes(prevTo)) toSel.value = prevTo;
  else toSel.value = list.includes('EUR') ? 'EUR' : (list[1] || list[0]);
}

function convertUsingRates(amount, from, to, ratesObj) {
  const base = ratesObj.base;
  const rates = Object.assign({}, ratesObj.rates);
  rates[base] = 1.0;

  if (!(from in rates) || !(to in rates)) throw new Error('Rate missing for currency');

  const rate = rates[to] / rates[from];
  const converted = amount * rate;
  return { converted, rate };
}

async function fetchFrankfurterLatest() {
  const url = 'https://api.frankfurter.app/latest';
  const resp = await fetch(url, { cache: 'no-cache' });
  if (!resp.ok) throw new Error('Frankfurter API returned ' + resp.status);
  const data = await resp.json();
  if (!data || !data.rates || !data.base || !data.date) throw new Error('Invalid Frankfurter payload');
  return {
    base: data.base,
    rates: data.rates,
    date: data.date
  };
}

function updateMetaUI(cache, statusMessage) {
  // cache: the stored cache object (may be null)
  // statusMessage: short string describing what happened on last check
  let lastUpdatedText = cache && cache.lastUpdated ? `${cache.lastUpdated}` : 'never';
  let dataVersionText = cache && (cache.dataVersion != null) ? cache.dataVersion : '—';
  let lastCheckedText = cache && cache.lastChecked ? formatTimestamp(cache.lastChecked) : 'never';

  const lines = [];
  lines.push(`Rates last updated: ${lastUpdatedText} (data version ${dataVersionText})`);
  lines.push(`Last checked: ${lastCheckedText} — ${statusMessage || 'idle'}`);
  metaDiv.textContent = lines.join(' • ');
}

// Ensure we have rates available; obey 24h check rule
async function ensureRates() {
  loading.style.display = 'inline';
  loading.setAttribute('aria-hidden', 'false');
  errorDiv.textContent = '';

  const now = Date.now();
  let cache = readCache();

  // If cache exists and we've checked within 24h, use it
  if (cache && cache.lastChecked && (now - cache.lastChecked) < MS_PER_DAY) {
    currentRates = {
      base: cache.base,
      rates: cache.rates,
      date: cache.lastUpdated
    };
    updateMetaUI(cache, 'used cached (fresh)');
    loading.style.display = 'none';
    loading.setAttribute('aria-hidden', 'true');
    return;
  }

  // Need to attempt a fetch (either no cache or past 24h)
  try {
    const fetched = await fetchFrankfurterLatest();

    if (cache && cache.lastUpdated && fetched.date === cache.lastUpdated) {
      // No new values — keep old rates, but mark that we checked now
      cache.lastChecked = now;
      writeCache(cache);
      currentRates = {
        base: cache.base,
        rates: cache.rates,
        date: cache.lastUpdated
      };
      updateMetaUI(cache, 'checked — no new rates');
    } else {
      // New rates or no cache — update and increment dataVersion
      const prevVersion = cache && (cache.dataVersion != null) ? cache.dataVersion : 0;
      const newVersion = prevVersion + 1;
      const newCache = {
        schema: CACHE_SCHEMA,
        dataVersion: newVersion,
        base: fetched.base,
        rates: fetched.rates,
        lastUpdated: fetched.date,
        lastChecked: now
      };
      writeCache(newCache);
      currentRates = {
        base: fetched.base,
        rates: fetched.rates,
        date: fetched.date
      };
      updateMetaUI(newCache, 'fetched new rates');
    }
  } catch (fetchErr) {
    console.warn('Frankfurter fetch failed:', fetchErr);
    if (cache) {
      // keep using cached rates, record that we checked now
      cache.lastChecked = now;
      writeCache(cache);
      currentRates = {
        base: cache.base,
        rates: cache.rates,
        date: cache.lastUpdated
      };
      updateMetaUI(cache, 'fetch failed — using cached rates');
    } else {
      // No cache at all -> fall back to static table (base USD) and persist a fallback cache
      const fallbackCache = {
        schema: CACHE_SCHEMA,
        dataVersion: 0, // 0 indicates built-in fallback
        base: 'USD',
        rates: FALLBACK_RATES,
        lastUpdated: null,
        lastChecked: now,
        note: 'fallback'
      };
      writeCache(fallbackCache);
      currentRates = {
        base: 'USD',
        rates: FALLBACK_RATES,
        date: null
      };
      updateMetaUI(fallbackCache, 'could not fetch — using fallback rates');
    }
  } finally {
    loading.style.display = 'none';
    loading.setAttribute('aria-hidden', 'true');
  }
}

function buildCurrencyList() {
  if (!currentRates) {
    availableCurrencies = Object.keys(FALLBACK_RATES).sort();
  } else {
    const rates = Object.assign({}, currentRates.rates);
    rates[currentRates.base] = 1.0;
    availableCurrencies = Object.keys(rates).sort();
  }
  populateSelectorsFromList(availableCurrencies);
}

async function convert() {
  errorDiv.textContent = '';
  resultDiv.textContent = '';
  metaDiv.textContent = '';

  const amountVal = amountInput.value.trim();
  if (amountVal === '') {
    return;
  }

  const amount = parseFloat(amountVal);
  if (!isFinite(amount) || amount < 0) {
    errorDiv.textContent = 'Enter a valid non-negative amount.';
    return;
  }
  const from = fromSel.value;
  const to = toSel.value;
  if (from === to) {
    resultDiv.textContent = `${amount.toLocaleString()} ${from} = ${amount.toLocaleString()} ${to} (1 ${from} = 1 ${to})`;
    return;
  }

  convertBtn.disabled = true;
  loading.style.display = 'inline';
  loading.setAttribute('aria-hidden', 'false');

  try {
    await ensureRates();
    const { converted, rate } = convertUsingRates(amount, from, to, currentRates);
    const maxFrac = converted < 1 ? 4 : 2;
    const rateFrac = rate < 1 ? 4 : 4;
    const formattedConverted = converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: maxFrac });
    const formattedRate = rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: rateFrac });

    resultDiv.textContent = `${amount.toLocaleString()} ${from} = ${formattedConverted} ${to} (1 ${from} = ${formattedRate} ${to})`;

    // Refresh the meta UI from the stored cache so the UI shows the exact stored timestamps/version
    const cache = readCache();
    updateMetaUI(cache, 'conversion done');
  } catch (err) {
    errorDiv.textContent = 'Conversion error: ' + (err.message || err);
  } finally {
    convertBtn.disabled = false;
    loading.style.display = 'none';
    loading.setAttribute('aria-hidden', 'true');
  }
}

// Swap currencies
swapBtn.addEventListener('click', () => {
  const a = fromSel.value;
  fromSel.value = toSel.value;
  toSel.value = a;
  convert();
});

// Convert button click
convertBtn.addEventListener('click', convert);

// Enter key triggers convert
amountInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') convert();
});

// Live conversion on input or currency changes
amountInput.addEventListener('input', () => {
  convert();
});
fromSel.addEventListener('change', convert);
toSel.addEventListener('change', convert);

// Initialize
(async function init() {
  loading.style.display = 'inline';
  loading.setAttribute('aria-hidden', 'false');

  const cache = readCache();
  if (cache && cache.rates) {
    currentRates = {
      base: cache.base,
      rates: cache.rates,
      date: cache.lastUpdated
    };
    buildCurrencyList();
    updateMetaUI(cache, 'loaded cache for UI');
  } else {
    availableCurrencies = Object.keys(FALLBACK_RATES).sort();
    populateSelectorsFromList(availableCurrencies);
  }

  await ensureRates();
  buildCurrencyList();
  convert();

  loading.style.display = 'none';
  loading.setAttribute('aria-hidden', 'true');
})();