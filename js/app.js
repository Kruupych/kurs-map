import { CURRENCIES, fetchCityRates, fetchCitySchedules } from './myfin.js';
import { MAJOR_CITIES, OTHER_CITIES, cityName, nearestMajorCity } from './cities.js';
import { distanceKm } from './geo.js';
import { minskNow, openingStatus } from './hours.js';
import { readCache, removeCache, writeCache } from './cache.js';
import { createMapView } from './map-view.js';
import { YANDEX_MAPS_API_KEY } from './config.js';
import { shortBankName } from './bank-names.js';
import {
  balloonHtml, branchItemHtml, escapeHtml, formatPrice, moreItemsHtml, shortAddress, summaryHtml,
} from './templates.js';

const RATES_TTL_MS = 10 * 60 * 1000;
const SCHEDULES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;
const MARKERS_DEBOUNCE_MS = 200;
const LIST_LIMIT = 60;
const INITIAL_ZOOM = 14;
const FOCUS_ZOOM = 16;
const LOCATION_RERENDER_KM = 0.03;
const RADII = [
  { value: '1', chip: '1 км', label: 'в 1 км' },
  { value: '3', chip: '3 км', label: 'в 3 км' },
  { value: '5', chip: '5 км', label: 'в 5 км' },
  { value: 'all', chip: 'Весь город', label: 'по всему городу' },
];
const QUICK_AMOUNTS = { usd: [100, 500, 1000], eur: [100, 500, 1000], rub: [5000, 10000, 50000] };
const DEFAULT_SETTINGS = {
  city: 'minsk',
  currency: 'usd',
  side: 'sell',
  radius: '1',
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
  noticeDismissed: false,
  location: null,
  renderedLocation: null,
  followLocation: true,
  mapReference: cityPoint(settings.city),
  mapReferenceCity: MAJOR_CITIES[settings.city] ? settings.city : null,
  fitPending: false,
  selectedPath: null,
  watchId: null,
  locationRequested: false,
  markersTimer: null,
};
const inFlight = new Map();
let mapView = null;

const elements = {
  map: document.getElementById('map'),
  side: document.getElementById('side'),
  currency: document.getElementById('currency'),
  radiusButton: document.getElementById('radius-button'),
  radiusMenu: document.getElementById('radius-menu'),
  openOnly: document.getElementById('open-only'),
  amountButton: document.getElementById('amount-button'),
  amountDialog: document.getElementById('amount-dialog'),
  amountForm: document.getElementById('amount-form'),
  amountInput: document.getElementById('amount-input'),
  amountUnit: document.getElementById('amount-unit'),
  amountClear: document.getElementById('amount-clear'),
  quickAmounts: document.getElementById('quick-amounts'),
  cityButton: document.getElementById('city-button'),
  cityDialog: document.getElementById('city-dialog'),
  citySearch: document.getElementById('city-search'),
  cityList: document.getElementById('city-list'),
  cityClose: document.getElementById('city-close'),
  notice: document.getElementById('notice'),
  noticeText: document.getElementById('notice-text'),
  noticeRetry: document.getElementById('notice-retry'),
  noticeClose: document.getElementById('notice-close'),
  summary: document.getElementById('summary'),
  list: document.getElementById('list'),
  statusText: document.getElementById('status-text'),
  refresh: document.getElementById('refresh'),
  locate: document.getElementById('locate'),
  sheet: document.getElementById('sheet'),
  sheetToggle: document.getElementById('sheet-toggle'),
};

bindControls();
initMap();
loadCity();
startLocating();
setInterval(tick, TICK_MS);

async function initMap() {
  try {
    mapView = await createMapView(elements.map, {
      center: [state.mapReference.lat, state.mapReference.lon],
      zoom: INITIAL_ZOOM,
      apiKey: YANDEX_MAPS_API_KEY,
      overlay: document.querySelector('.toolbar'),
      onMove: onMapMove,
      onMarkerClick: (path) => highlightListItem(path, { scroll: true }),
    });
  } catch (error) {
    showNotice(`Карта не загрузилась: ${error.message}. Список отделений работает без неё.`, { canRetry: false });
    return;
  }
  fitMapToSearch();
  render();
}

function bindControls() {
  bindSegmented(elements.side, 'side');
  bindSegmented(elements.currency, 'currency');
  bindRadiusMenu();
  bindAmountDialog();
  bindCityDialog();
  elements.openOnly.addEventListener('click', () => updateSettings({ openOnly: !settings.openOnly }));
  elements.summary.addEventListener('click', onSummaryAction);
  elements.refresh.addEventListener('click', () => refreshRates(settings.city));
  elements.locate.addEventListener('click', onLocateClick);
  elements.noticeRetry.addEventListener('click', retryLocating);
  elements.noticeClose.addEventListener('click', () => {
    state.noticeDismissed = true;
    if (state.notice?.rememberHidden) writeCache('location-notice-hidden', true);
    renderNotice();
  });
  elements.sheetToggle.addEventListener('click', toggleSheet);
  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('.branch__main');
    if (button) focusBranch(button.closest('[data-path]').dataset.path);
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

function bindRadiusMenu() {
  const setOpen = (open) => {
    elements.radiusMenu.hidden = !open;
    elements.radiusButton.setAttribute('aria-expanded', String(open));
    if (open) elements.radiusMenu.querySelector('[aria-checked="true"]')?.focus();
  };
  elements.radiusButton.addEventListener('click', () => setOpen(elements.radiusMenu.hidden));
  elements.radiusMenu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-value]');
    if (!item) return;
    setOpen(false);
    changeRadius(item.dataset.value);
  });
  document.addEventListener('click', (event) => {
    if (!elements.radiusMenu.hidden && !event.target.closest('.dropdown')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || elements.radiusMenu.hidden) return;
    setOpen(false);
    elements.radiusButton.focus();
  });
}

function bindAmountDialog() {
  elements.amountButton.addEventListener('click', () => {
    elements.amountInput.value = settings.amount;
    elements.quickAmounts.innerHTML = QUICK_AMOUNTS[settings.currency]
      .map((value) => `<button type="button" data-amount="${value}">${value.toLocaleString('ru-RU')}</button>`)
      .join('');
    elements.amountDialog.showModal();
  });
  elements.quickAmounts.addEventListener('click', (event) => {
    const button = event.target.closest('[data-amount]');
    if (!button) return;
    elements.amountDialog.close();
    updateSettings({ amount: button.dataset.amount }, { markers: false });
  });
  elements.amountForm.addEventListener('submit', () => {
    updateSettings({ amount: elements.amountInput.value.trim() }, { markers: false });
  });
  elements.amountClear.addEventListener('click', () => {
    elements.amountDialog.close();
    updateSettings({ amount: '' }, { markers: false });
  });
  closeOnBackdropClick(elements.amountDialog);
}

function bindCityDialog() {
  elements.cityButton.addEventListener('click', () => {
    elements.citySearch.value = '';
    renderCityList();
    elements.cityDialog.showModal();
    elements.cityList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
  });
  elements.citySearch.addEventListener('input', renderCityList);
  elements.cityClose.addEventListener('click', () => elements.cityDialog.close());
  elements.cityList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-city]');
    if (!button) return;
    elements.cityDialog.close();
    state.followLocation = false;
    if (MAJOR_CITIES[button.dataset.city]) setMapReference(cityPoint(button.dataset.city), button.dataset.city);
    switchCity(button.dataset.city);
  });
  closeOnBackdropClick(elements.cityDialog);
}

function closeOnBackdropClick(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function renderCityList() {
  const query = elements.citySearch.value.trim().toLocaleLowerCase('ru');
  const cities = [
    ...Object.entries(MAJOR_CITIES).map(([slug, city]) => [slug, city.name]),
    ...Object.entries(OTHER_CITIES).sort(([, a], [, b]) => a.localeCompare(b, 'ru')),
  ].filter(([, name]) => name.toLocaleLowerCase('ru').includes(query));
  elements.cityList.innerHTML = cities.length
    ? cities.map(([slug, name]) => `
        <li><button type="button" data-city="${slug}" aria-current="${slug === settings.city}">${escapeHtml(name)}</button></li>`).join('')
    : '<li class="city-list__empty">Такого города нет на myfin.by</li>';
}

function switchCity(slug) {
  state.fitPending = true;
  updateSettings({ city: slug });
  loadCity();
}

function changeRadius(radius) {
  updateSettings({ radius });
  fitMapToSearch();
}

function onSummaryAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'show-closed') updateSettings({ openOnly: false });
  if (button.dataset.action === 'widen-radius') changeRadius(button.dataset.radius);
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
  if (state.fitPending) fitMapToSearch();
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
      if (state.fitPending) fitMapToSearch();
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
    showNotice('Местоположение доступно только по HTTPS. Расстояния считаются от центра карты.', { canRetry: false });
    return;
  }
  if (!('geolocation' in navigator)) {
    showNotice('Браузер не определяет местоположение. Расстояния считаются от центра карты.', { canRetry: false });
    return;
  }
  state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 30000,
    timeout: 20000,
  });
}

function retryLocating() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  state.locationRequested = true;
  state.noticeDismissed = true;
  renderNotice();
  startLocating();
}

function onPosition({ coords }) {
  const isFirstFix = !state.location;
  state.location = { lat: coords.latitude, lon: coords.longitude };
  state.notice = null;
  removeCache('location-notice-hidden');
  mapView?.showLocation(state.location, coords.accuracy);
  if (isFirstFix && state.followLocation) {
    showMyArea();
    return;
  }
  const moved = !state.renderedLocation || distanceKm(state.renderedLocation, state.location) > LOCATION_RERENDER_KM;
  if (state.followLocation && moved) render({ markers: !mapView?.isBalloonOpen() });
  else renderNotice();
}

function onPositionError(error) {
  if (state.location) return;
  if (error.code !== error.PERMISSION_DENIED) {
    showNotice('Местоположение пока не определилось. Расстояния считаются от центра карты.');
    return;
  }
  navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  if (!state.locationRequested && readCache('location-notice-hidden')) return;
  showNotice('Нет доступа к местоположению, расстояния считаются от центра карты. Разрешите доступ в настройках сайта (значок у адреса).', { rememberHidden: true });
}

function showNotice(text, { canRetry = true, rememberHidden = false } = {}) {
  state.notice = { text, canRetry, rememberHidden };
  state.noticeDismissed = false;
  renderNotice();
}

function onLocateClick() {
  if (!state.location) {
    retryLocating();
    return;
  }
  state.followLocation = true;
  showMyArea();
}

function showMyArea() {
  const city = nearestMajorCity(state.location);
  if (city && city !== settings.city) {
    switchCity(city);
    return;
  }
  fitMapToSearch();
  render();
}

function onMapMove(center) {
  setMapReference(center, settings.city);
  if (usesLocation()) return;
  render({ markers: false });
  scheduleMarkers();
}

function setMapReference(point, city) {
  state.mapReference = point;
  state.mapReferenceCity = city;
}

function scheduleMarkers() {
  clearTimeout(state.markersTimer);
  state.markersTimer = setTimeout(() => renderMarkers(evaluateBranches()), MARKERS_DEBOUNCE_MS);
}

function fitMapToSearch() {
  if (!mapView) return;
  const needsBranches = settings.radius === 'all' || !hasReference();
  state.fitPending = needsBranches && !state.rates?.branches.length;
  if (state.fitPending) return;
  if (needsBranches) mapView.fitPoints(state.rates.branches);
  else mapView.fitRadius(referencePoint(), Number(settings.radius));
}

function hasReference() {
  return usesLocation() || state.mapReferenceCity === settings.city;
}

function focusBranch(path) {
  highlightListItem(path, { scroll: false });
  mapView?.focusMarker(path, FOCUS_ZOOM);
}

function highlightListItem(path, { scroll }) {
  state.selectedPath = path;
  for (const item of elements.list.querySelectorAll('[data-path]')) {
    const selected = item.dataset.path === path;
    item.classList.toggle('is-selected', selected);
    if (selected && scroll) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function evaluateBranches() {
  const reference = referencePoint();
  const now = minskNow();
  const radiusLimit = radiusKm();
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
  const eligible = all.filter((item) => item.eligible).sort(byPrice);
  const prices = eligible.map((item) => item.price);
  const bestPrice = prices.length ? (settings.side === 'buy' ? Math.min(...prices) : Math.max(...prices)) : null;
  return { all, eligible, bestPrice, closedHidden, reference };
}

function byPrice(a, b) {
  return (settings.side === 'buy' ? a.price - b.price : b.price - a.price) || a.distance - b.distance;
}

function render({ markers = true } = {}) {
  syncControls();
  const view = evaluateBranches();
  state.renderedLocation = state.location;
  mapView?.showSearchArea(view.reference, radiusKm());
  if (markers) renderMarkers(view);
  renderSummary(view);
  renderList(view);
  renderStatus();
  renderNotice();
}

function syncControls() {
  syncPressed(elements.side, settings.side);
  syncPressed(elements.currency, settings.currency);
  for (const item of elements.radiusMenu.querySelectorAll('[data-value]')) {
    item.setAttribute('aria-checked', String(item.dataset.value === settings.radius));
  }
  elements.radiusButton.textContent = RADII.find((radius) => radius.value === settings.radius).chip;
  elements.openOnly.setAttribute('aria-pressed', String(settings.openOnly));
  const amount = parseAmount();
  const currencyLabel = CURRENCIES[settings.currency].label;
  elements.amountButton.textContent = amount ? `${amount.toLocaleString('ru-RU')} ${currencyLabel}` : 'Сумма';
  elements.amountButton.classList.toggle('is-set', Boolean(amount));
  elements.amountUnit.textContent = currencyLabel;
  elements.cityButton.textContent = cityName(settings.city);
  elements.locate.classList.toggle('is-active', usesLocation());
}

function syncPressed(container, value) {
  for (const button of container.querySelectorAll('button[data-value]')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }
}

function renderMarkers(view) {
  clearTimeout(state.markersTimer);
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
      balloonHtml: balloonHtml({ item, settings, bankName, address, routeFrom }),
    };
  }));
}

function renderSummary(view) {
  const radiusIndex = RADII.findIndex((radius) => radius.value === settings.radius);
  elements.summary.innerHTML = summaryHtml({
    view,
    isLoading: Boolean(state.loading) && !state.rates,
    radiusLabel: radiusLabel(),
    closedHidden: view.closedHidden,
    nextRadius: RADII[radiusIndex + 1] ?? null,
  });
}

function renderList(view) {
  const amount = parseAmount();
  const routeFrom = state.location;
  const items = view.eligible.slice(0, LIST_LIMIT).map((item) => branchItemHtml({
    item,
    view,
    settings,
    bankName,
    address,
    selected: item.branch.path === state.selectedPath,
    amount,
    routeFrom,
  }));
  const hidden = view.eligible.length - LIST_LIMIT;
  elements.list.innerHTML = items.join('') + (hidden > 0 ? moreItemsHtml(hidden) : '');
}

function renderStatus() {
  elements.refresh.disabled = Boolean(state.loading);
  elements.refresh.classList.toggle('is-spinning', Boolean(state.loading));
  const text = statusText();
  elements.statusText.textContent = text;
  elements.statusText.title = text;
  elements.statusText.classList.toggle('is-error', Boolean(state.error) && !state.loading);
}

function renderNotice() {
  const visible = Boolean(state.notice) && !state.noticeDismissed;
  elements.notice.hidden = !visible;
  if (!visible) return;
  elements.noticeText.textContent = state.notice.text;
  elements.noticeRetry.hidden = !state.notice.canRetry;
}

function statusText() {
  if (state.loading) return state.loading;
  const sentences = [];
  if (state.error) sentences.push(state.error);
  else if (state.ratesSavedAt) sentences.push(`Курсы myfin.by на ${formatClock(state.ratesSavedAt)}`);
  if (state.rates?.failedBanks.length) sentences.push(`Нет курсов: ${state.rates.failedBanks.join(', ')}`);
  if (state.schedulesLoading) sentences.push('Загружаю часы работы');
  if (state.scheduleFailures.length) sentences.push(`Нет часов работы: ${state.scheduleFailures.join(', ')}`);
  return sentences.join('. ');
}

function radiusLabel() {
  if (settings.radius === 'all') return `в городе ${cityName(settings.city)}`;
  return `в ${settings.radius} км ${usesLocation() ? 'от вас' : 'от центра карты'}`;
}

function radiusKm() {
  return settings.radius === 'all' ? Infinity : Number(settings.radius);
}

function parseAmount() {
  const amount = Number.parseFloat(settings.amount.replace(',', '.').replace(/\s/g, ''));
  return amount > 0 ? amount : null;
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

function address(branch) {
  return shortAddress(branch.address, cityName(settings.city));
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
