import { CURRENCIES, fetchCityRates, fetchCitySchedules } from './myfin.js';
import { MAJOR_CITIES, OTHER_CITIES, cityName, nearestMajorCity } from './cities.js';
import { distanceKm } from './geo.js';
import { minskNow, openingStatus } from './hours.js';
import { readCache, writeCache } from './cache.js';
import { createMapView } from './map-view.js';
import { YANDEX_MAPS_API_KEY } from './config.js';
import { shortBankName } from './bank-names.js';
import { balloonHtml, branchItemHtml, formatPrice, moreItemsHtml, summaryHtml } from './templates.js';

const RATES_TTL_MS = 10 * 60 * 1000;
const SCHEDULES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;
const LIST_LIMIT = 60;
const CITY_ZOOM = 12;
const LOCATION_ZOOM = 15;
const LOCATION_RERENDER_KM = 0.03;
const RADII = [
  { value: '1', label: 'в 1 км' },
  { value: '3', label: 'в 3 км' },
  { value: '5', label: 'в 5 км' },
  { value: 'all', label: 'по всему городу' },
];
const DEFAULT_SETTINGS = {
  city: 'minsk',
  currency: 'usd',
  side: 'sell',
  radius: '1',
  sortBy: 'price',
  openOnly: true,
  amount: '',
};

const userChoices = readCache('choices')?.value ?? {};
const settings = { ...DEFAULT_SETTINGS, ...userChoices };
const state = {
  rates: null,
  ratesSavedAt: null,
  schedules: {},
  schedulesLoading: false,
  scheduleFailures: [],
  loading: null,
  error: null,
  notice: null,
  location: null,
  renderedLocation: null,
  followLocation: true,
  mapReference: cityPoint(settings.city),
  fitCityPending: true,
  selectedPath: null,
  watchId: null,
};
const inFlight = new Map();
let mapView = null;

const elements = {
  map: document.getElementById('map'),
  side: document.getElementById('side'),
  currency: document.getElementById('currency'),
  radius: document.getElementById('radius'),
  sort: document.getElementById('sort'),
  openOnly: document.getElementById('open-only'),
  amount: document.getElementById('amount'),
  amountUnit: document.getElementById('amount-unit'),
  summary: document.getElementById('summary'),
  list: document.getElementById('list'),
  city: document.getElementById('city'),
  statusText: document.getElementById('status-text'),
  refresh: document.getElementById('refresh'),
  locate: document.getElementById('locate'),
  sheet: document.getElementById('sheet'),
  sheetToggle: document.getElementById('sheet-toggle'),
};

fillCitySelect();
bindControls();
initMap();
loadCity();
startLocating();
setInterval(tick, TICK_MS);

async function initMap() {
  try {
    mapView = await createMapView(elements.map, {
      center: [state.mapReference.lat, state.mapReference.lon],
      zoom: CITY_ZOOM,
      apiKey: YANDEX_MAPS_API_KEY,
      onMove: onMapMove,
      onMarkerClick: (path) => selectBranch(path, { moveMap: false }),
    });
  } catch (error) {
    state.notice = `Карта не загрузилась (${error.message}), список работает без неё`;
    renderStatus();
    return;
  }
  if (usesLocation()) {
    mapView.setView(state.location, LOCATION_ZOOM);
  } else {
    fitCityIfPending();
  }
  render();
}

function bindControls() {
  bindSegmented(elements.side, 'side');
  bindSegmented(elements.currency, 'currency');
  bindSegmented(elements.radius, 'radius');
  bindSegmented(elements.sort, 'sortBy');
  elements.openOnly.addEventListener('change', () => updateSettings({ openOnly: elements.openOnly.checked }));
  elements.amount.addEventListener('input', () => {
    updateSettings({ amount: elements.amount.value }, { markers: false });
  });
  elements.city.addEventListener('change', () => {
    state.followLocation = false;
    state.fitCityPending = true;
    updateSettings({ city: elements.city.value });
    if (MAJOR_CITIES[settings.city]) {
      state.mapReference = cityPoint(settings.city);
      mapView?.setView(state.mapReference, CITY_ZOOM);
    }
    loadCity();
  });
  elements.summary.addEventListener('click', onSummaryAction);
  elements.refresh.addEventListener('click', () => refreshRates(settings.city));
  elements.locate.addEventListener('click', onLocateClick);
  elements.sheetToggle.addEventListener('click', toggleSheet);
  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('.branch__main');
    if (button) selectBranch(button.closest('[data-path]').dataset.path, { moveMap: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}

function bindSegmented(container, key) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (button) updateSettings({ [key]: button.dataset.value });
  });
}

function onSummaryAction(event) {
  const button = event.target.closest('button[data-action]');
  if (button?.dataset.action === 'show-closed') updateSettings({ openOnly: false });
  if (button?.dataset.action === 'widen-radius') updateSettings({ radius: button.dataset.radius });
}

function toggleSheet() {
  const expanded = elements.sheet.classList.toggle('is-expanded');
  elements.sheetToggle.setAttribute('aria-expanded', String(expanded));
  elements.sheetToggle.setAttribute('aria-label', expanded ? 'Свернуть список' : 'Развернуть список');
  elements.sheet.addEventListener('transitionend', () => mapView?.fitToViewport(), { once: true });
}

function updateSettings(patch, { markers = true } = {}) {
  Object.assign(settings, patch);
  Object.assign(userChoices, patch);
  writeCache('choices', userChoices);
  render({ markers });
}

function fillCitySelect() {
  const option = (slug, name) => `<option value="${slug}">${name}</option>`;
  const others = Object.entries(OTHER_CITIES).sort(([, a], [, b]) => a.localeCompare(b, 'ru'));
  elements.city.innerHTML = `
    <optgroup label="Крупные города">${Object.entries(MAJOR_CITIES).map(([slug, city]) => option(slug, city.name)).join('')}</optgroup>
    <optgroup label="Другие">${others.map(([slug, name]) => option(slug, name)).join('')}</optgroup>`;
}

async function loadCity() {
  const city = settings.city;
  const cachedRates = readCache(`rates:${city}`);
  const cachedSchedules = readCache(`schedules:${city}`);
  state.rates = cachedRates?.value ?? null;
  state.ratesSavedAt = cachedRates?.savedAt ?? null;
  state.schedules = cachedSchedules?.value ?? {};
  state.scheduleFailures = [];
  state.error = null;
  state.selectedPath = null;
  fitCityIfPending();
  render();
  if (!isFresh(state.ratesSavedAt, RATES_TTL_MS)) await refreshRates(city);
  if (state.rates && city === settings.city && !isFresh(cachedSchedules?.savedAt, SCHEDULES_TTL_MS)) {
    await refreshSchedules(city);
  }
}

function refreshRates(city) {
  return runOnce(`rates:${city}`, async () => {
    setLoading(city, 'Загружаю курсы с myfin.by');
    try {
      const rates = await fetchCityRates(city, (done, total) => {
        setLoading(city, `Загружаю курсы: ${done} из ${total} банков`);
      });
      if (rates.branches.length === 0) {
        throw new Error('на странице города нет отделений с курсами, возможно, myfin изменил разметку');
      }
      writeCache(`rates:${city}`, rates);
      if (city !== settings.city) return;
      state.rates = rates;
      state.ratesSavedAt = Date.now();
      state.error = null;
      fitCityIfPending();
    } catch (error) {
      if (city === settings.city) state.error = `Курсы не обновились: ${describeError(error)}`;
    } finally {
      setLoading(city, null);
      if (city === settings.city) render();
    }
  });
}

function refreshSchedules(city) {
  return runOnce(`schedules:${city}`, async () => {
    state.schedulesLoading = true;
    renderStatus();
    try {
      const { schedules, failedBanks } = await fetchCitySchedules(city, state.rates.branches);
      if (failedBanks.length === 0) writeCache(`schedules:${city}`, schedules);
      if (city !== settings.city) return;
      state.schedules = schedules;
      state.scheduleFailures = failedBanks.map(bankName);
    } finally {
      state.schedulesLoading = false;
      if (city === settings.city) render();
    }
  });
}

function runOnce(key, task) {
  if (!inFlight.has(key)) inFlight.set(key, task().finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

function tick() {
  if (document.hidden) return;
  if (!isFresh(state.ratesSavedAt, RATES_TTL_MS)) refreshRates(settings.city);
  render({ markers: !mapView?.isBalloonOpen() });
}

function setLoading(city, text) {
  if (city !== settings.city) return;
  state.loading = text;
  renderStatus();
}

function startLocating() {
  if (!window.isSecureContext) {
    state.notice = 'Геолокация работает только по HTTPS';
    return;
  }
  if (!('geolocation' in navigator)) {
    state.notice = 'Браузер не определяет местоположение';
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 30000,
    timeout: 20000,
  });
}

function onPosition({ coords }) {
  const isFirstFix = !state.location;
  state.location = { lat: coords.latitude, lon: coords.longitude };
  state.notice = null;
  mapView?.showLocation(state.location, coords.accuracy);
  if (isFirstFix && state.followLocation) {
    state.fitCityPending = false;
    mapView?.setView(state.location, LOCATION_ZOOM);
    const city = nearestMajorCity(state.location);
    if (city && city !== settings.city) {
      updateSettings({ city });
      loadCity();
      return;
    }
  }
  const moved = !state.renderedLocation || distanceKm(state.renderedLocation, state.location) > LOCATION_RERENDER_KM;
  if (state.followLocation && moved) render({ markers: !mapView?.isBalloonOpen() });
}

function onPositionError(error) {
  if (state.location) return;
  state.notice = error.code === error.PERMISSION_DENIED
    ? 'Геолокация запрещена в настройках браузера'
    : 'Местоположение пока не определилось';
  if (error.code === error.PERMISSION_DENIED) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  renderStatus();
}

function onLocateClick() {
  if (!state.location) {
    if (state.watchId === null) startLocating();
    renderStatus();
    return;
  }
  state.followLocation = true;
  mapView?.setView(state.location, mapView.zoomAtLeast(LOCATION_ZOOM));
  const city = nearestMajorCity(state.location);
  if (city && city !== settings.city) {
    updateSettings({ city });
    loadCity();
  } else {
    render();
  }
}

function onMapMove(center) {
  state.mapReference = center;
  if (!usesLocation()) render();
}

function fitCityIfPending() {
  if (!mapView || !state.fitCityPending || !state.rates?.branches.length) return;
  state.fitCityPending = false;
  if (MAJOR_CITIES[settings.city]) {
    mapView.setView(cityPoint(settings.city), CITY_ZOOM);
  } else {
    mapView.fitPoints(state.rates.branches, LOCATION_ZOOM);
  }
}

function selectBranch(path, { moveMap }) {
  state.selectedPath = path;
  mapView?.selectMarker(path);
  const point = mapView?.markerPoint(path);
  if (moveMap && point) {
    mapView.setView(point, mapView.zoomAtLeast(LOCATION_ZOOM), { silent: true }).then(() => mapView.openBalloon(path));
  }
  for (const item of elements.list.querySelectorAll('[data-path]')) {
    const selected = item.dataset.path === path;
    item.classList.toggle('is-selected', selected);
    if (selected && !moveMap) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function evaluateBranches() {
  const reference = referencePoint();
  const now = minskNow();
  const radiusLimit = settings.radius === 'all' ? Infinity : Number(settings.radius);
  const priceKey = settings.side === 'buy' ? 'youBuy' : 'youSell';
  const all = [];
  let closedHidden = 0;
  for (const branch of state.rates?.branches ?? []) {
    const price = branch.rates[settings.currency]?.[priceKey];
    if (!price) continue;
    const details = state.schedules[branch.path] ?? null;
    const status = details ? openingStatus(details.schedule, now) : null;
    const distance = distanceKm(reference, branch);
    const inRadius = distance <= radiusLimit;
    const hiddenAsClosed = settings.openOnly && status?.open === false;
    if (inRadius && hiddenAsClosed) closedHidden++;
    all.push({ branch, price, details, status, distance, eligible: inRadius && !hiddenAsClosed });
  }
  const eligible = all.filter((item) => item.eligible).sort(settings.sortBy === 'price' ? byPrice : byDistance);
  const prices = eligible.map((item) => item.price);
  const bestPrice = prices.length ? (settings.side === 'buy' ? Math.min(...prices) : Math.max(...prices)) : null;
  return { all, eligible, bestPrice, closedHidden };
}

function byPrice(a, b) {
  return (settings.side === 'buy' ? a.price - b.price : b.price - a.price) || byDistance(a, b);
}

function byDistance(a, b) {
  return a.distance - b.distance;
}

function render({ markers = true } = {}) {
  syncControls();
  const view = evaluateBranches();
  state.renderedLocation = state.location;
  if (markers) renderMarkers(view);
  renderSummary(view);
  renderList(view);
  renderStatus();
}

function syncControls() {
  syncSegmented(elements.side, settings.side);
  syncSegmented(elements.currency, settings.currency);
  syncSegmented(elements.radius, settings.radius);
  syncSegmented(elements.sort, settings.sortBy);
  elements.openOnly.checked = settings.openOnly;
  if (elements.amount.value !== settings.amount) elements.amount.value = settings.amount;
  elements.amountUnit.textContent = CURRENCIES[settings.currency].label;
  elements.city.value = settings.city;
  elements.locate.classList.toggle('is-active', usesLocation());
}

function syncSegmented(container, value) {
  for (const button of container.querySelectorAll('button[data-value]')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }
}

function renderMarkers(view) {
  if (!mapView) return;
  const routeFrom = state.location;
  mapView.setMarkers(view.all.map((item) => {
    const isBest = item.eligible && item.price === view.bestPrice;
    const classes = [
      isBest && 'pin--best',
      !item.eligible && 'pin--outside',
      item.status?.open === false && 'pin--closed',
    ];
    return {
      id: item.branch.path,
      lat: item.branch.lat,
      lon: item.branch.lon,
      bank: shortBankName(item.branch.bank, bankName(item.branch.bank)),
      label: formatPrice(item.price),
      className: classes.filter(Boolean).join(' '),
      zIndex: isBest ? 1000 : item.eligible ? 500 : 100,
      balloonHtml: balloonHtml({ item, settings, bankName, routeFrom }),
    };
  }));
  if (state.selectedPath) mapView.selectMarker(state.selectedPath);
}

function renderSummary(view) {
  const radiusIndex = RADII.findIndex((radius) => radius.value === settings.radius);
  elements.summary.innerHTML = summaryHtml({
    view,
    settings,
    bankName,
    isLoading: Boolean(state.loading) && !state.rates,
    radiusLabel: radiusLabel(),
    closedHidden: view.closedHidden,
    nextRadius: RADII[radiusIndex + 1] ?? null,
  });
}

function renderList(view) {
  const amount = Number.parseFloat(settings.amount.replace(',', '.'));
  const routeFrom = state.location;
  const items = view.eligible.slice(0, LIST_LIMIT).map((item) => branchItemHtml({
    item,
    view,
    settings,
    bankName,
    selected: item.branch.path === state.selectedPath,
    amount: amount > 0 ? amount : null,
    routeFrom,
  }));
  const hidden = view.eligible.length - LIST_LIMIT;
  elements.list.innerHTML = items.join('') + (hidden > 0 ? moreItemsHtml(hidden) : '');
}

function renderStatus() {
  elements.refresh.disabled = Boolean(state.loading);
  elements.refresh.classList.toggle('is-spinning', Boolean(state.loading));
  elements.statusText.textContent = statusText();
  elements.statusText.classList.toggle('is-error', Boolean(state.error) && !state.loading);
}

function statusText() {
  if (state.loading) return state.loading;
  const sentences = [];
  if (state.error) sentences.push(state.error);
  else if (state.ratesSavedAt) sentences.push(`Курсы обновлены в ${formatClock(state.ratesSavedAt)}`);
  if (state.rates?.failedBanks.length) sentences.push(`Нет курсов: ${state.rates.failedBanks.join(', ')}`);
  if (state.schedulesLoading) sentences.push('Загружаю часы работы');
  if (state.scheduleFailures.length) sentences.push(`Нет часов работы: ${state.scheduleFailures.join(', ')}`);
  if (state.notice) sentences.push(state.notice);
  return sentences.join('. ');
}

function radiusLabel() {
  if (settings.radius === 'all') return `в городе ${cityName(settings.city)}`;
  return `в ${settings.radius} км ${usesLocation() ? 'от вас' : 'от центра карты'}`;
}

function usesLocation() {
  return state.followLocation && Boolean(state.location);
}

function referencePoint() {
  return usesLocation() ? state.location : state.mapReference;
}

function bankName(alias) {
  return state.rates?.banks[alias] ?? alias;
}

function cityPoint(slug) {
  const city = MAJOR_CITIES[slug] ?? MAJOR_CITIES.minsk;
  return { lat: city.lat, lon: city.lon };
}

function isFresh(savedAt, ttl) {
  return Boolean(savedAt) && Date.now() - savedAt < ttl;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function describeError(error) {
  return error instanceof TypeError ? 'нет связи с myfin.by' : error.message;
}
