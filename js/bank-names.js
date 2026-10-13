const SHORT_NAMES = {
  alfabank: 'Альфа',
  'bank-vtb': 'ВТБ',
  belagroprombank: 'Белагропром',
  belarusbank: 'Беларусбанк',
  belgazprombank: 'Белгазпром',
  belinkasgrupp: 'Белинкас',
  belinvestbank: 'Белинвест',
  belswissbank: 'БСБ',
  bnbank: 'БНБ',
  'bps-sberbank': 'Сбер',
  bvebank: 'БелВЭБ',
  dabrabyt: 'Дабрабыт',
  mtbank: 'МТБанк',
  neobank: 'Нео Банк',
  paritetbank: 'Паритет',
  priorbank: 'Приор',
  reshenie: 'Решение',
  'rrb-bank': 'РРБ',
  statusbank: 'Статус',
  technobank: 'Техно',
  tkbank: 'ТК Банк',
  zepterbank: 'Цептер',
};

export function shortBankName(alias, fullName) {
  return SHORT_NAMES[alias] ?? fullName;
}
