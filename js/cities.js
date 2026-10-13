import { distanceKm } from './geo.js';

const AUTO_SELECT_RADIUS_KM = 25;

export const MAJOR_CITIES = {
  minsk: { name: 'Минск', lat: 53.9023, lon: 27.5619 },
  brest: { name: 'Брест', lat: 52.0976, lon: 23.7341 },
  vitebsk: { name: 'Витебск', lat: 55.1904, lon: 30.2049 },
  gomel: { name: 'Гомель', lat: 52.4345, lon: 30.9754 },
  grodno: { name: 'Гродно', lat: 53.6694, lon: 23.8131 },
  mogilev: { name: 'Могилев', lat: 53.9007, lon: 30.3314 },
  bobrujsk: { name: 'Бобруйск', lat: 53.1384, lon: 29.2214 },
  baranovichi: { name: 'Барановичи', lat: 53.1327, lon: 26.0139 },
  borisov: { name: 'Борисов', lat: 54.2279, lon: 28.505 },
  pinsk: { name: 'Пинск', lat: 52.1153, lon: 26.1031 },
  orsha: { name: 'Орша', lat: 54.5153, lon: 30.4053 },
  mozyr: { name: 'Мозырь', lat: 52.0495, lon: 29.2456 },
  soligorsk: { name: 'Солигорск', lat: 52.7876, lon: 27.5415 },
  novopolotsk: { name: 'Новополоцк', lat: 55.5318, lon: 28.649 },
  polotsk: { name: 'Полоцк', lat: 55.4879, lon: 28.7856 },
  lida: { name: 'Лида', lat: 53.8885, lon: 25.2846 },
  molodechno: { name: 'Молодечно', lat: 54.3104, lon: 26.8389 },
  zhlobin: { name: 'Жлобин', lat: 52.8926, lon: 30.024 },
  svetlogorsk: { name: 'Светлогорск', lat: 52.6329, lon: 29.7389 },
  rechitsa: { name: 'Речица', lat: 52.3617, lon: 30.3916 },
  zhodino: { name: 'Жодино', lat: 54.0985, lon: 28.3331 },
  slutsk: { name: 'Слуцк', lat: 53.0274, lon: 27.5597 },
  kobrin: { name: 'Кобрин', lat: 52.2138, lon: 24.3564 },
  slonim: { name: 'Слоним', lat: 53.0869, lon: 25.3163 },
  volkovisk: { name: 'Волковыск', lat: 53.1561, lon: 24.4513 },
  kalinkovichi: { name: 'Калинковичи', lat: 52.1323, lon: 29.3257 },
  smorgon: { name: 'Сморгонь', lat: 54.4836, lon: 26.3984 },
  rogachev: { name: 'Рогачев', lat: 53.0901, lon: 30.0491 },
  osipovichi: { name: 'Осиповичи', lat: 53.3011, lon: 28.6386 },
  novogrudok: { name: 'Новогрудок', lat: 53.5942, lon: 25.8191 },
};

export const OTHER_CITIES = {
  baran: 'Барань', belynichi: 'Белыничи', beloozyorsk: 'Белоозёрск', bereza: 'Береза',
  berezino: 'Березино', beryozovka: 'Берёзовка', beshenkovichi: 'Бешенковичи',
  'bolshaya-berestovica': 'Большая Берестовица', boroviki: 'Боровики', borovukha: 'Боровуха',
  bragin: 'Брагин', braslav: 'Браслав', 'buda-koshelyovo': 'Буда-Кошелёво', byhov: 'Быхов',
  verhnedvinsk: 'Верхнедвинск', vetka: 'Ветка', vileyka: 'Вилейка', volozhin: 'Воложин',
  voronovo: 'Вороново', vysokoye: 'Высокое', gancevichi: 'Ганцевичи', glubokoe: 'Глубокое',
  glusk: 'Глуск', gorki: 'Горки', gorodok: 'Городок', 'david-gorodok': 'Давид-Городок',
  dzerzhinsk: 'Дзержинск', dobrush: 'Добруш', dokshitsy: 'Докшицы', drogichin: 'Дрогичин',
  dubrovno: 'Дубровно', dyatlovo: 'Дятлово', yelsk: 'Ельск', zhabinka: 'Жабинка',
  zhitkovichi: 'Житковичи', zaslavl: 'Заславль', zelva: 'Зельва', ivanovo: 'Иваново',
  ivacevichi: 'Ивацевичи', ivenets: 'Ивенец', ivye: 'Ивье', kamenets: 'Каменец',
  kirovsk: 'Кировск', klimovichi: 'Климовичи', klichev: 'Кличев', kletsk: 'Клецк',
  kopyl: 'Копыль', korelichi: 'Кореличи', korma: 'Корма', kostyukovichi: 'Костюковичи',
  kostyukovka: 'Костюковка', krasnopolye: 'Краснополье', krasnoselskiy: 'Красносельский',
  krichev: 'Кричев', krugloye: 'Круглое', krupki: 'Крупки', lelchitsy: 'Лельчицы',
  lepel: 'Лепель', liozno: 'Лиозно', logoysk: 'Логойск', loew: 'Лоев', luninec: 'Лунинец',
  lyuban: 'Любань', lyakhovichi: 'Ляховичи', ljaskovichi: 'Лясковичи', malorita: 'Малорита',
  machulishchi: 'Мачулищи', mikashevichi: 'Микашевичи', minchiki: 'Минчики', miory: 'Миоры',
  mir: 'Мир', mosty: 'Мосты', mstislavl: 'Мстиславль', myadel: 'Мядель', naroch: 'Нарочь',
  narovla: 'Наровля', nesvizh: 'Несвиж', novolukoml: 'Новолукомль', oktyabrskii: 'Октябрьский',
  ostrovec: 'Островец', oshmiany: 'Ошмяны', petrikov: 'Петриков', pleschenicy: 'Плещеницы',
  postavy: 'Поставы', pruzhany: 'Пружаны', radoshkovichi: 'Радошковичи', ross: 'Россь',
  rossony: 'Россоны', ruba: 'Руба', svisloch: 'Свислочь', senno: 'Сенно', skidel: 'Скидель',
  slavgorod: 'Славгород', smilovichi: 'Смиловичи', smolevichi: 'Смолевичи',
  starobin: 'Старобин', stolbcy: 'Столбцы', stolin: 'Столин', tolochin: 'Толочин',
  turov: 'Туров', uzda: 'Узда', ushachi: 'Ушачи', fanipol: 'Фаниполь', hojniki: 'Хойники',
  hotimsk: 'Хотимск', chausy: 'Чаусы', chashniki: 'Чашники', cherven: 'Червень',
  chechersk: 'Чечерск', cherikov: 'Чериков', sharkovshchina: 'Шарковщина', shklov: 'Шклов',
  shumilino: 'Шумилино', shchuchin: 'Щучин',
};

export function cityName(slug) {
  return MAJOR_CITIES[slug]?.name ?? OTHER_CITIES[slug] ?? slug;
}

export function nearestMajorCity(point) {
  let nearest = null;
  for (const [slug, city] of Object.entries(MAJOR_CITIES)) {
    const distance = distanceKm(point, city);
    if (distance <= AUTO_SELECT_RADIUS_KM && (!nearest || distance < nearest.distance)) {
      nearest = { slug, distance };
    }
  }
  return nearest?.slug ?? null;
}
