import { CURRENCIES } from './myfin.js';
import { formatDistance } from './geo.js';

const MYFIN_ORIGIN = 'https://myfin.by';
const BYN = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CITY_PREFIX = /^(?:г\.п\.|аг\.|г\.|д\.|п\.)\s*(?:[^,\s]+(?:\s[^,\s]+)?,\s*|\S+\s+)/;
const BRANCH_FORMS = ['отделение', 'отделения', 'отделений'];
const BRANCH_FORMS_LOCATIVE = ['отделении', 'отделениях', 'отделениях'];

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export function formatPrice(price) {
  return String(price).replace('.', ',');
}

export function summaryHtml({ view, settings, bankName, isLoading, radiusLabel, closedHidden, nextRadius }) {
  const title = `${settings.side === 'buy' ? 'Купить' : 'Сдать'} ${currencyUnit(settings.currency)}`;
  const best = view.eligible.find((item) => item.price === view.bestPrice);
  if (!best) {
    if (isLoading) return `<p class="summary__title">${title}</p><p class="summary__note">Загружаю курсы с myfin.by</p>`;
    const actions = [
      closedHidden > 0 && `<button type="button" data-action="show-closed">Показать закрытые (${closedHidden})</button>`,
      nextRadius && `<button type="button" data-action="widen-radius" data-radius="${nextRadius.value}">Искать ${nextRadius.label}</button>`,
    ].filter(Boolean);
    return `
      <p class="summary__title">${title}</p>
      <p class="summary__note">Нет ${closedHidden > 0 ? 'открытых ' : ''}отделений ${radiusLabel}</p>
      ${actions.length ? `<p class="summary__actions">${actions.join('')}</p>` : ''}`;
  }
  const sameBest = view.eligible.filter((item) => item.price === view.bestPrice).length - 1;
  const sameBestText = sameBest > 0 ? `Такой же курс ещё в ${sameBest} ${plural(sameBest, BRANCH_FORMS_LOCATIVE)}. ` : '';
  return `
    <p class="summary__title">${title} <strong>${formatPrice(best.price)}</strong> <span class="summary__unit">BYN</span></p>
    <p class="summary__best">${escapeHtml(bankName(best.branch.bank))}, ${escapeHtml(shortAddress(best.branch.address))}, ${formatDistance(best.distance)}</p>
    <p class="summary__note">${sameBestText}Всего ${view.eligible.length} ${plural(view.eligible.length, BRANCH_FORMS)} ${radiusLabel}</p>`;
}

export function branchItemHtml({ item, view, settings, bankName, selected, amount, routeFrom }) {
  const { branch } = item;
  const isBest = item.price === view.bestPrice;
  const classes = ['branch', isBest && 'is-best', item.status?.open === false && 'is-closed', selected && 'is-selected'];
  return `
    <li class="${classes.filter(Boolean).join(' ')}" data-path="${escapeHtml(branch.path)}">
      <button type="button" class="branch__main">
        <span class="branch__price">${formatPrice(item.price)}</span>
        <span class="branch__body">
          <span class="branch__bank">${escapeHtml(bankName(branch.bank))}</span>
          <span class="branch__address">${escapeHtml(shortAddress(branch.address))}</span>
          <span class="branch__facts">
            <span>${formatDistance(item.distance)}</span>
            ${statusHtml(item.status)}
          </span>
          ${amount ? totalHtml(item.price, view.bestPrice, amount, settings) : ''}
          ${branch.updatedAt ? `<span class="branch__updated">Курс обновлён в ${escapeHtml(branch.updatedAt)}</span>` : ''}
        </span>
      </button>
      <a class="branch__route" href="${routeUrl(routeFrom, branch)}" target="_blank" rel="noopener">Маршрут</a>
    </li>`;
}

export function balloonHtml({ item, settings, bankName, routeFrom }) {
  const { branch } = item;
  const rates = branch.rates[settings.currency];
  const unit = currencyUnit(settings.currency);
  const phones = item.details?.phones ?? [];
  return `
    <div class="balloon">
      <p class="balloon__bank">${escapeHtml(bankName(branch.bank))}</p>
      <p>${escapeHtml(shortAddress(branch.address))}</p>
      <p class="balloon__rates">Купить ${unit}: ${formatRate(rates.youBuy)}<br>Сдать ${unit}: ${formatRate(rates.youSell)}</p>
      ${item.status ? `<p>${statusHtml(item.status)}</p>` : ''}
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

function statusHtml(status) {
  if (!status) return '';
  return `<span class="${status.open ? 'is-open' : 'is-closed'}">${escapeHtml(status.text)}</span>`;
}

function totalHtml(price, bestPrice, amount, settings) {
  const multiplier = CURRENCIES[settings.currency].multiplier;
  const total = (amount / multiplier) * price;
  const loss = (Math.abs(price - bestPrice) / multiplier) * amount;
  const verb = settings.side === 'buy' ? 'Заплатите' : 'Получите';
  const comparison = loss >= 0.005
    ? `<span class="branch__loss">на ${BYN.format(loss)} ${settings.side === 'buy' ? 'дороже' : 'меньше'}, чем по лучшему курсу</span>`
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

function shortAddress(address) {
  return address.replace(CITY_PREFIX, '') || address;
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
