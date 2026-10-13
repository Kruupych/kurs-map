const YANDEX_MAPS_URL = 'https://api-maps.yandex.ru/2.1/';
const LABELS_MIN_ZOOM = 14;
const DESKTOP_QUERY = '(min-width: 860px)';
const PIN_SHAPE = { type: 'Rectangle', coordinates: [[-56, -38], [56, 6]] };
const PIN_BALLOON_OFFSET = [0, -36];
const SAME_POINT_DEGREES = 1e-4;
const TOOLBAR_HEIGHT = 64;

export async function createMapView(container, { center, zoom, apiKey, onMove, onMarkerClick }) {
  const ymaps = await loadYandexMaps(apiKey);
  const map = new ymaps.Map(container, { center, zoom, controls: [] }, { yandexMapDisablePoiInteractivity: true });
  map.margin.addArea({ top: 0, left: 0, width: '100%', height: TOOLBAR_HEIGHT });
  if (window.matchMedia(DESKTOP_QUERY).matches) {
    map.controls.add('zoomControl', { position: { right: 10, top: 80 } });
  }
  const PinLayout = ymaps.templateLayoutFactory.createClass(
    '<div class="pin {{ properties.className }}"><span class="pin__label"><span class="pin__bank">{{ properties.bank }}</span>{{ properties.label }}</span></div>',
  );
  const markers = new ymaps.GeoObjectCollection();
  const location = new ymaps.GeoObjectCollection();
  map.geoObjects.add(markers).add(location);

  const placemarks = new Map();
  let silentTarget = null;
  let balloonOpen = false;

  const syncLabelVisibility = () => {
    container.classList.toggle('is-zoomed-out', map.getZoom() < LABELS_MIN_ZOOM);
  };
  syncLabelVisibility();
  map.events.add('boundschange', () => {
    syncLabelVisibility();
    const center = toPoint(map.getCenter());
    const isBalloonAutoPan = balloonOpen;
    if (isBalloonAutoPan || (silentTarget && isSamePoint(center, silentTarget))) return;
    silentTarget = null;
    onMove(center);
  });
  markers.events.add('balloonopen', () => { balloonOpen = true; });
  markers.events.add('balloonclose', () => { balloonOpen = false; });

  return {
    center: () => toPoint(map.getCenter()),
    isBalloonOpen: () => balloonOpen,
    fitToViewport: () => map.container.fitToViewport(),

    setView(point, nextZoom, { silent = false } = {}) {
      silentTarget = silent ? point : null;
      return map.setCenter([point.lat, point.lon], nextZoom);
    },

    fitPoints(points, maxZoom) {
      const bounds = ymaps.util.bounds.fromPoints(points.map((point) => [point.lat, point.lon]));
      silentTarget = null;
      return map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 24 }).then(() => {
        if (map.getZoom() > maxZoom) return map.setZoom(maxZoom);
      });
    },

    zoomAtLeast(minZoom) {
      return Math.max(map.getZoom(), minZoom);
    },

    setMarkers(items) {
      markers.removeAll();
      placemarks.clear();
      for (const item of items) {
        const placemark = new ymaps.Placemark(
          [item.lat, item.lon],
          { bank: item.bank, label: item.label, className: item.className, balloonContentBody: item.balloonHtml },
          {
            iconLayout: PinLayout,
            iconShape: PIN_SHAPE,
            zIndex: item.zIndex,
            zIndexHover: 2000,
            balloonOffset: PIN_BALLOON_OFFSET,
            balloonPanelMaxMapArea: 0,
            hideIconOnBalloonOpen: false,
          },
        );
        placemark.events.add('click', () => {
          balloonOpen = true;
          onMarkerClick(item.id);
        });
        markers.add(placemark);
        placemarks.set(item.id, { placemark, className: item.className });
      }
    },

    selectMarker(id) {
      for (const [markerId, { placemark, className }] of placemarks) {
        placemark.properties.set('className', markerId === id ? `${className} pin--selected` : className);
      }
    },

    openBalloon(id) {
      const entry = placemarks.get(id);
      if (!entry) return;
      balloonOpen = true;
      entry.placemark.balloon.open();
    },

    markerPoint(id) {
      const coordinates = placemarks.get(id)?.placemark.geometry.getCoordinates();
      return coordinates ? { lat: coordinates[0], lon: coordinates[1] } : null;
    },

    showLocation(point, accuracy) {
      location.removeAll();
      const coordinates = [point.lat, point.lon];
      location.add(new ymaps.Circle([coordinates, accuracy], {}, {
        fillColor: '#2563eb14',
        strokeColor: '#2563eb44',
        strokeWidth: 1,
        interactivityModel: 'default#transparent',
      }));
      location.add(new ymaps.Placemark(coordinates, {}, {
        preset: 'islands#geolocationIcon',
        interactivityModel: 'default#transparent',
        zIndex: 3000,
      }));
    },
  };
}

function loadYandexMaps(apiKey) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ lang: 'ru_RU' });
    if (apiKey) params.set('apikey', apiKey);
    const script = document.createElement('script');
    script.src = `${YANDEX_MAPS_URL}?${params}`;
    script.onload = () => window.ymaps.ready(() => resolve(window.ymaps), reject);
    script.onerror = () => reject(new Error('не загрузились Яндекс Карты'));
    document.head.append(script);
  });
}

function isSamePoint(a, b) {
  return Math.abs(a.lat - b.lat) < SAME_POINT_DEGREES && Math.abs(a.lon - b.lon) < SAME_POINT_DEGREES;
}

function toPoint([lat, lon]) {
  return { lat, lon };
}
