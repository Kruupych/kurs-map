import { CURRENCIES } from './myfin.js';
import { formatDistance } from './geo.js';

const MYFIN_ORIGIN = 'https://myfin.by';
const BYN = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SETTLEMENT_PREFIX = /^(?:г\.п\.|аг\.|г\.|д\.|п\.)\s*(?:[^,\s]+(?:\s[^,\s]+)?,\s*|\S+\s+)/;
const BRANCH_FORMS = ['отделение', 'отделения', 'отделений'];
const ROUTE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20v-6a4 4 0 0 1 4-4h9M15 6l4 4-4 4"/></svg>';

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function formatPrice(price) {
  return String(price).replace('.', ',');
}

export function shortAddress(address, city) {
  const withoutCity = address.startsWith(`${city}, `) ? address.slice(city.length + 2) : address;
  return withoutCity.replace(SETTLEMENT_PREFIX, '') || address;
}

export function summaryHtml({ view, isLoading, radiusLabel, closedHidden, nextRadius }) {
  const count = view.eligible.length;
  if (count > 0) return `<p class="summary__title">${count} ${plural(count, BRANCH_FORMS)} ${radiusLabel}, выгодные сверху</p>`;
  if (isLoading) return '<p class="summary__title">Загружаю курсы с myfin.by</p>';
  const actions = [
    closedHidden > 0 && `<button type="button" data-action="show-closed">Показать закрытые (${closedHidden})</button>`,
    nextRadius && `<button type="button" data-action="widen-radius" data-radius="${nextRadius.value}">Искать ${nextRadius.label}</button>`,
  ].filter(Boolean);
  return `
    <p class="summary__title">Нет ${closedHidden > 0 ? 'открытых ' : ''}отделений ${radiusLabel}</p>
    ${actions.length ? `<p class="summary__actions">${actions.join('')}</p>` : ''}`;
}

export function branchItemHtml({ item, view, settings, bankName, address, selected, amount, routeFrom }) {
  const { branch } = item;
  const isBest = item.price === view.bestPrice;
  const classes = ['branch', isBest && 'is-best', item.status?.open === false && 'is-closed', selected && 'is-selected'];
  return `
    <li class="${classes.filter(Boolean).join(' ')}" data-path="${escapeHtml(branch.path)}">
      <button type="button" class="branch__main">
        <span class="branch__line">
          <span class="branch__price">${formatPrice(item.price)}</span>
          <span class="branch__bank">${escapeHtml(bankName(branch.bank))}</span>
          <span class="branch__distance">${formatDistance(item.distance)}</span>
        </span>
        <span class="branch__meta">
          ${item.status ? `<span class="branch__status ${item.status.open ? 'is-open' : 'is-closed'}">${escapeHtml(item.status.text)}</span>` : ''}
          <span class="branch__address">${escapeHtml(address(branch))}</span>
        </span>
        ${amount ? totalHtml(item.price, view.bestPrice, amount, settings) : ''}
      </button>
      <a class="branch__route" href="${routeUrl(routeFrom, branch)}" target="_blank" rel="noopener" aria-label="Маршрут в Яндекс Картах" title="Маршрут в Яндекс Картах">${ROUTE_ICON}</a>
    </li>`;
}

export function balloonHtml({ item, settings, bankName, address, routeFrom }) {
  const { branch } = item;
  const rates = branch.rates[settings.currency];
  const unit = currencyUnit(settings.currency);
  const phones = item.details?.phones ?? [];
  return `
    <div class="balloon">
      <p class="balloon__bank">${escapeHtml(bankName(branch.bank))}</p>
      <p>${escapeHtml(address(branch))}</p>
      <p class="balloon__rates">Купить ${unit}: ${formatRate(rates.youBuy)}<br>Сдать ${unit}: ${formatRate(rates.youSell)}</p>
      ${branch.updatedAt ? `<p class="balloon__muted">Курс обновлён в ${escapeHtml(branch.updatedAt)}</p>` : ''}
      ${item.status ? `<p class="${item.status.open ? 'is-open' : 'is-closed'}">${escapeHtml(item.status.text)}</p>` : ''}
      ${phones.length ? `<p class="balloon__phones">${phones.map(phoneLinkHtml).join('')}</p>` : ''}
      <p class="balloon__links">
        <a href="${routeUrl(routeFrom, branch)}" target="_blank" rel="noopener">Построить маршрут</a>
        <a href="${MYFIN_ORIGIN}${escapeHtml(branch.path)}" target="_blank" rel="noopener">Отделение на myfin.by</a>
      </p>
    </div>`;
}

export function moreItemsHtml(hiddenCount) {
  return `<li class="list__more">Ещё ${hiddenCount} ${plural(hiddenCount, BRANCH_FORMS)} с курсом хуже. Уменьшите радиус, чтобы увидеть их.</li>`;
}

function totalHtml(price, bestPrice, amount, settings) {
  const multiplier = CURRENCIES[settings.currency].multiplier;
  const total = (amount / multiplier) * price;
  const loss = (Math.abs(price - bestPrice) / multiplier) * amount;
  const verb = settings.side === 'buy' ? 'Заплатите' : 'Получите';
  const comparison = loss >= 0.005
    ? `<span class="branch__loss">на ${BYN.format(loss)} ${settings.side === 'buy' ? 'дороже' : 'меньше'} лучшего</span>`
    : '';
  return `<span class="branch__total">${verb} ${BYN.format(total)} BYN ${comparison}</span>`;
}

function currencyUnit(currency) {
  const { label, multiplier } = CURRENCIES[currency];
  return multiplier === 1 ? label : `${multiplier} ${label}`;
}

function phoneLinkHtml(phone) {
  return `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}">${escapeHtml(phone)}</a>`;
}

function formatRate(price) {
  return price ? `${formatPrice(price)} BYN` : 'не меняют';
}

function routeUrl(from, branch) {
  const start = from ? `${from.lat},${from.lon}` : '';
  return `https://yandex.by/maps/?rtext=${start}~${branch.lat},${branch.lon}&rtt=pd`;
}

function plural(count, [one, few, many]) {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
