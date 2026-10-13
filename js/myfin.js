const ORIGIN = 'https://myfin.by';
const PARALLEL_REQUESTS = 4;
const LIST_PAGE_SIZE = 20;

export const CURRENCIES = {
  usd: { label: 'USD', multiplier: 1 },
  eur: { label: 'EUR', multiplier: 1 },
  rub: { label: 'RUB', multiplier: 100 },
};

export async function fetchCityRates(city, onProgress) {
  const cityPage = await fetchDocument(`/currency/${city}`);
  const banks = readBanks(cityPage);
  let loaded = 0;
  const results = await mapWithLimit([...banks.values()], async (bank) => {
    try {
      const page = await fetchDocument(`${bank.samplePath}/courses`);
      return { bank, branches: readBranchRates(page, bank.alias) };
    } catch (error) {
      return { bank, error };
    } finally {
      onProgress?.(++loaded, banks.size);
    }
  });
  return {
    banks: Object.fromEntries([...banks.values()].map(({ alias, name }) => [alias, name])),
    branches: results.flatMap((result) => result.branches ?? []),
    failedBanks: results.filter((result) => result.error).map((result) => result.bank.name),
  };
}

export async function fetchCitySchedules(city, branches) {
  const bankAliases = [...new Set(branches.map((branch) => branch.bank))];
  const listResults = await mapWithLimit(bankAliases, (alias) =>
    fetchBankSchedules(city, alias).then((entries) => ({ entries }), (error) => ({ alias, error })),
  );
  const schedules = Object.fromEntries(listResults.flatMap((result) => result.entries ?? []));
  const unlisted = branches.filter((branch) => !schedules[branch.path]);
  const pageResults = await mapWithLimit(unlisted, (branch) =>
    fetchBranchDetails(branch.path).then((details) => ({ branch, details }), (error) => ({ branch, error })),
  );
  for (const { branch, details } of pageResults) {
    if (details) schedules[branch.path] = details;
  }
  const failedBanks = new Set([
    ...listResults.filter((result) => result.error).map((result) => result.alias),
    ...pageResults.filter((result) => result.error).map((result) => result.branch.bank),
  ]);
  return { schedules, failedBanks: [...failedBanks] };
}

async function fetchBankSchedules(city, alias) {
  const basePath = `/bank/${alias}/otdelenija-spiskom${city === 'minsk' ? '' : `/${city}`}`;
  const entries = [];
  for (let page = 1; ; page++) {
    const doc = await fetchDocument(page === 1 ? basePath : `${basePath}?page=${page}`);
    const pageEntries = readScheduleEntries(doc);
    entries.push(...pageEntries);
    const total = Number(doc.querySelector('.count_product')?.value ?? 0);
    if (pageEntries.length === 0 || page * LIST_PAGE_SIZE >= total) return entries;
  }
}

async function fetchBranchDetails(path) {
  const doc = await fetchDocument(path);
  return {
    name: doc.querySelector('h1')?.textContent.trim() ?? '',
    schedule: readSchedule(doc),
    phones: readPhones(doc),
  };
}

async function fetchDocument(path) {
  const response = await fetch(ORIGIN + path);
  if (!response.ok) throw new Error(`myfin.by ответил ${response.status} на ${path}`);
  return new DOMParser().parseFromString(await response.text(), 'text/html');
}

function readBanks(doc) {
  const banks = new Map();
  for (const link of doc.querySelectorAll('a.currencies-courses__branch-name')) {
    const alias = link.closest('tr[data-bank-sef-alias]')?.dataset.bankSefAlias;
    if (alias && !banks.has(alias)) {
      banks.set(alias, { alias, name: alias, samplePath: link.getAttribute('href') });
    }
  }
  for (const row of doc.querySelectorAll('tr[data-row-type="default"][data-bank-sef-alias]')) {
    const bank = banks.get(row.dataset.bankSefAlias);
    const name = row.querySelector('td img[alt]')?.alt.trim();
    if (bank && name) bank.name = name;
  }
  return banks;
}

function readBranchRates(doc, bankAlias) {
  return [...doc.querySelectorAll('tr.currencies-courses__row-main--filial')]
    .map((row) => readBranchRow(row, bankAlias))
    .filter(Boolean);
}

function readBranchRow(row, bankAlias) {
  const link = row.querySelector('a.currencies-courses__branch-name');
  const coordinates = readCoordinates(row.querySelector('[data-fillial-coords]'));
  if (!link || !coordinates) return null;
  return {
    path: link.getAttribute('href'),
    bank: bankAlias,
    address: link.textContent.trim(),
    updatedAt: row.querySelector('.ic-update-time')?.parentElement.textContent.trim() ?? '',
    lat: coordinates[0],
    lon: coordinates[1],
    rates: readRates(row),
  };
}

function readCoordinates(cell) {
  const [pair] = JSON.parse(cell?.dataset.fillialCoords ?? '[]');
  const coordinates = pair?.split(',').map(Number);
  return coordinates?.length === 2 && coordinates.every(Number.isFinite) ? coordinates : null;
}

function readRates(row) {
  const rates = {};
  for (const currency of Object.keys(CURRENCIES)) {
    const [bankBuysCell, bankSellsCell] = row.querySelectorAll(`td[data-currency-cell="${currency}"]`);
    rates[currency] = { youSell: readPrice(bankBuysCell), youBuy: readPrice(bankSellsCell) };
  }
  return rates;
}

function readPrice(cell) {
  const price = Number.parseFloat(cell?.textContent.trim().replace(',', '.'));
  return price > 0 ? price : null;
}

function readScheduleEntries(doc) {
  return [...doc.querySelectorAll('.mapobject-list-item')].flatMap((item) => {
    const link = item.querySelector('.mapobject-list-item__name a');
    if (!link) return [];
    return [[link.getAttribute('href'), {
      name: link.textContent.trim(),
      schedule: readSchedule(item),
      phones: readPhones(item),
    }]];
  });
}

function readSchedule(root) {
  return JSON.parse(root.querySelector('[data-work-schedule]')?.dataset.workSchedule ?? 'null');
}

function readPhones(root) {
  return [...new Set([...root.querySelectorAll('a[href^="tel:"]')].map((link) => link.textContent.trim()))];
}

async function mapWithLimit(items, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, items.length) }, worker));
  return results;
}
