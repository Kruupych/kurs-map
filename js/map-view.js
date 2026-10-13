const YANDEX_MAPS_URL = 'https://api-maps.yandex.ru/2.1/';
const DESKTOP_QUERY = '(min-width: 860px)';
const FULL_LABEL_MIN_ZOOM = 15;
const PRICE_LABEL_MIN_ZOOM = 13;
const PIN_SHAPE = { type: 'Rectangle', coordinates: [[-48, -36], [48, 6]] };
const PIN_BALLOON_OFFSET = [0, -34];
const KM_PER_LAT_DEGREE = 111.32;
const OVERLAY_GAP = 8;

export async function createMapView(container, { center, zoom, apiKey, overlay, onMove, onMarkerClick }) {
  const ymaps = await loadYandexMaps(apiKey);
  const map = new ymaps.Map(container, { center, zoom, controls: [] }, { yandexMapDisablePoiInteractivity: true });
  reserveSpaceFor(overlay, map.margin.addArea({ top: 0, left: 0, width: '100%', height: 0 }));
  if (window.matchMedia(DESKTOP_QUERY).matches) {
    map.controls.add('zoomControl', { position: { right: 10, top: 120 } });
  }

  const PinLayout = ymaps.templateLayoutFactory.createClass(
    '<div class="pin {{ properties.className }}"><span class="pin__label">'
    + '<span class="pin__bank">{{ properties.bank }}</span>'
    + '<span class="pin__price">{{ properties.label }}</span></span></div>',
  );
  const pins = new ymaps.ObjectManager({ clusterize: false });
  pins.objects.options.set({
    iconLayout: PinLayout,
    iconShape: PIN_SHAPE,
    balloonOffset: PIN_BALLOON_OFFSET,
    balloonPanelMaxMapArea: 0,
    hideIconOnBalloonOpen: false,
    zIndexHover: 2000,
  });
  const searchArea = new ymaps.Circle([center, 0], {}, {
    fillColor: '#1f5fe00f',
    strokeColor: '#1f5fe080',
    strokeWidth: 2,
    strokeStyle: 'shortdash',
    interactivityModel: 'default#transparent',
    visible: false,
  });
  const location = new ymaps.GeoObjectCollection();
  map.geoObjects.add(searchArea).add(pins).add(location);

  const shown = new Map();
  let balloonOpen = false;
  let selectedId = null;

  const syncZoomClasses = () => {
    const currentZoom = map.getZoom();
    container.classList.toggle('is-zoom-far', currentZoom < PRICE_LABEL_MIN_ZOOM);
    container.classList.toggle('is-zoom-mid', currentZoom >= PRICE_LABEL_MIN_ZOOM && currentZoom < FULL_LABEL_MIN_ZOOM);
  };
  syncZoomClasses();
  map.events.add('boundschange', () => {
    syncZoomClasses();
    if (!balloonOpen) onMove(visibleCenter());
  });
  pins.objects.events.add('click', (event) => {
    balloonOpen = true;
    onMarkerClick(event.get('objectId'));
  });
  pins.objects.balloon.events.add('close', () => { balloonOpen = false; });

  const visibleCenter = () => toPoint(map.getCenter({ useMapMargin: true }));
  const setCenter = (point, nextZoom) => map.setCenter([point.lat, point.lon], nextZoom, { useMapMargin: true });

  return {
    isBalloonOpen: () => balloonOpen,
    fitToViewport: () => map.container.fitToViewport(),

    fitPoints(points) {
      const bounds = ymaps.util.bounds.fromPoints(points.map((point) => [point.lat, point.lon]));
      return map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 24, useMapMargin: true });
    },

    fitRadius(point, radiusKm) {
      const latDelta = radiusKm / KM_PER_LAT_DEGREE;
      const lonDelta = radiusKm / (KM_PER_LAT_DEGREE * Math.cos((point.lat * Math.PI) / 180));
      const bounds = [[point.lat - latDelta, point.lon - lonDelta], [point.lat + latDelta, point.lon + lonDelta]];
      return map.setBounds(bounds, { checkZoomRange: true, zoomMargin: 8, useMapMargin: true });
    },

    showSearchArea(point, radiusKm) {
      const visible = Number.isFinite(radiusKm);
      searchArea.options.set('visible', visible);
      if (!visible) return;
      searchArea.geometry.setCoordinates([point.lat, point.lon]);
      searchArea.geometry.setRadius(radiusKm * 1000);
    },

    setMarkers(items) {
      const nextIds = new Set(items.map((item) => item.id));
      const removed = [...shown.keys()].filter((id) => !nextIds.has(id));
      if (removed.length) pins.remove(removed.map((id) => ({ id })));
      removed.forEach((id) => shown.delete(id));
      const added = [];
      for (const item of items) {
        const marker = toMarker(item);
        const previous = shown.get(item.id);
        shown.set(item.id, marker);
        if (!previous) added.push(toFeature(item, marker));
        else updateMarker(item.id, previous, marker);
      }
      if (added.length) pins.add({ type: 'FeatureCollection', features: added });
    },

    async focusMarker(id, minZoom) {
      const object = pins.objects.getById(id);
      if (!object) return;
      const previousId = selectedId;
      selectedId = id;
      restyle(previousId);
      restyle(id);
      const [lat, lon] = object.geometry.coordinates;
      balloonOpen = true;
      await setCenter({ lat, lon }, Math.max(map.getZoom(), minZoom));
      pins.objects.balloon.open(id);
    },

    showLocation(point, accuracy) {
      location.removeAll();
      const coordinates = [point.lat, point.lon];
      location.add(new ymaps.Circle([coordinates, accuracy], {}, {
        fillColor: '#1f5fe014',
        strokeColor: '#1f5fe044',
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

  function toMarker(item) {
    return {
      properties: {
        bank: item.bank,
        label: item.label,
        className: classNameFor(item.id, item.className),
        balloonContentBody: item.balloonHtml,
      },
      baseClassName: item.className,
      zIndex: item.zIndex,
    };
  }

  function toFeature(item, marker) {
    return {
      type: 'Feature',
      id: item.id,
      geometry: { type: 'Point', coordinates: [item.lat, item.lon] },
      properties: marker.properties,
      options: { zIndex: marker.zIndex },
    };
  }

  function updateMarker(id, previous, marker) {
    const changed = Object.keys(marker.properties).some((key) => marker.properties[key] !== previous.properties[key]);
    if (changed) pins.objects.setObjectProperties(id, marker.properties);
    if (marker.zIndex !== previous.zIndex) pins.objects.setObjectOptions(id, { zIndex: marker.zIndex });
  }

  function restyle(id) {
    const marker = id && shown.get(id);
    if (!marker) return;
    const next = { ...marker, properties: { ...marker.properties, className: classNameFor(id, marker.baseClassName) } };
    updateMarker(id, marker, next);
    shown.set(id, next);
  }

  function classNameFor(id, baseClassName) {
    return id === selectedId ? `${baseClassName} pin--selected` : baseClassName;
  }
}

function reserveSpaceFor(overlay, area) {
  const update = () => area.setArea({ top: 0, left: 0, width: '100%', height: overlay.offsetTop + overlay.offsetHeight + OVERLAY_GAP });
  new ResizeObserver(update).observe(overlay);
  update();
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


function toPoint([lat, lon]) {
  return { lat, lon };
}
