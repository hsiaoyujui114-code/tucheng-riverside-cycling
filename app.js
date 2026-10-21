/**
 * 土城學府公園・小騎士雙北河濱單車探索地圖
 * 核心應用邏輯
 */

document.addEventListener('DOMContentLoaded', () => {
  // 檢查資料庫是否成功載入
  if (!window.RIVERSIDE_DATA) {
    console.error('無法載入路線資料 (routes-data.js 缺失)');
    return;
  }

  const { startPoint, departureGuide, safetyChecklist, routes } = window.RIVERSIDE_DATA;

  // 狀態管理
  let currentSpeed = 16; // 預設巡航均速 16 km/h
  let isGroupMode = false; // 是否開啟同學結伴模式
  let selectedRouteId = routes[0].id; // 預設選中第一條路線
  let currentFilter = 'all';

  // Leaflet 地圖相關變數
  let map;
  let startMarker;
  const polylineLayers = {};
  let currentPoiMarkers = [];

  // ==========================================
  // 1. 初始化 Leaflet 地圖與多圖層 (解決看不到街道問題)
  // ==========================================
  let currentBaseLayer = null;
  let streetConnectorGroup = null;

  function initMap() {
    // 預設視野中心為土城學府公園與大漢溪河濱交會處
    map = L.map('map', {
      center: [24.995, 121.448],
      zoom: 14, // 初始縮放放大，讓街道清晰可見
      zoomControl: true
    });

    // 1. 定義多種高解析度地圖圖磚（包含超清晰街道圖與臺灣官方電子圖）
    const tileLayers = {
      // Google 街道圖：最熟悉、全中文路名、門牌、小巷、捷運站與地標最清晰！
      google: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps'
      }),
      // 內政部國土測繪中心 臺灣通用電子地圖：台灣官方權威街巷、水門與引道
      nlsc: L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
        maxZoom: 20,
        attribution: '&copy; 內政部國土測繪中心 NLSC'
      }),
      // Google 衛星混合空照圖：空照實景加上街道名稱標註
      hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps 衛星'
      }),
      // OpenStreetMap 標準單車街道圖
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      })
    };

    // 預設採用「Google 街道圖」，確保第一時間就能看清所有土城街道名稱與巷弄！
    currentBaseLayer = tileLayers.google;
    currentBaseLayer.addTo(map);

    // 綁定頂端圖層切換按鈕
    const layerButtons = [
      { id: 'btn-layer-google', layer: tileLayers.google },
      { id: 'btn-layer-nlsc', layer: tileLayers.nlsc },
      { id: 'btn-layer-hybrid', layer: tileLayers.hybrid },
      { id: 'btn-layer-osm', layer: tileLayers.osm }
    ];

    layerButtons.forEach(btnInfo => {
      const btn = document.getElementById(btnInfo.id);
      if (btn) {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.map-layer-pill').forEach(b => {
            b.classList.remove('active-layer-pill', 'bg-blue-600', 'text-white', 'font-bold');
            b.classList.add('text-slate-300', 'hover:bg-slate-800');
          });
          btn.classList.add('active-layer-pill', 'bg-blue-600', 'text-white', 'font-bold');
          btn.classList.remove('text-slate-300', 'hover:bg-slate-800');

          if (currentBaseLayer) {
            map.removeLayer(currentBaseLayer);
          }
          currentBaseLayer = btnInfo.layer;
          currentBaseLayer.addTo(map);
        });
      }
    });

    // 2. 建立學府公園起點標記 (金色光圈脈衝)
    const pulsingIcon = L.divIcon({
      className: 'pulsing-start-marker',
      html: `
        <div class="pulse-ring"></div>
        <div class="marker-core">起</div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    startMarker = L.marker(startPoint, { icon: pulsingIcon }).addTo(map);
    startMarker.bindPopup(`
      <div class="text-xs">
        <div class="font-bold text-amber-600 text-sm mb-1 flex items-center gap-1">
          <span>🚲 土城學府公園 (起點)</span>
        </div>
        <p class="text-slate-600 mb-1">土城區學府路一段 (海山捷運站3號出口旁)</p>
        <p class="text-slate-500 text-[11px] mb-1.5">街道指引：沿學府路、裕民路接中華路，由浮洲橋引道或城林橋引道進入河濱自行車道！</p>
        <div class="p-1.5 bg-amber-50 rounded border border-amber-200 text-amber-800 text-[11px]">
          ⚠️ 提醒：請走引道跨越堤防，嚴禁直接騎上擺接堡路平面（砂石車多）！
        </div>
      </div>
    `);

    // 3. 繪製「市區街道導引路線」圖層（學府公園 ➜ 河濱引道）
    initStreetConnectors();

    // 3.5 繪製「河濱專用道安全防護」圖層（官方服務站、危險警示點、擺接堡路警戒帶）
    initSafetyLayer();

    // 3.6 繪製「分岔路口路牌指引」圖層（指引路牌與轉向決策）
    initJunctionLayer();

    // 4. 繪製所有雙北河濱自行車路線折線 (Polylines)
    routes.forEach(route => {
      const polyline = L.polyline(route.pathPoints, {
        color: route.color,
        weight: 4,
        opacity: 0.45,
        lineCap: 'round',
        lineJoin: 'round',
        smoothFactor: 1.0
      }).addTo(map);

      // 點擊折線切換路線
      polyline.on('click', () => {
        selectRoute(route.id);
      });

      // 滑鼠懸停提示
      polyline.bindTooltip(`<strong>${route.name}</strong><br>來回：${route.roundTripDistanceKm} km`, {
        sticky: true
      });

      polylineLayers[route.id] = polyline;
    });

    // 5. 頂部地圖功能鍵事件
    // 放大看街道按鈕 (直接放大到 Zoom 16 呈現土城市區完整路網)
    const btnZoomStreets = document.getElementById('btn-zoom-streets');
    if (btnZoomStreets) {
      btnZoomStreets.addEventListener('click', () => {
        map.flyTo([24.9880, 121.4450], 16, { duration: 1.0 });
      });
    }

    // 回到學府公園起點
    document.getElementById('btn-zoom-start').addEventListener('click', () => {
      map.flyTo(startPoint, 16, { duration: 1.0 });
      startMarker.openPopup();
    });

    // 全覽雙北自行車路網
    document.getElementById('btn-fit-all').addEventListener('click', () => {
      fitAllRoutes();
    });
  }

  // ==========================================
  // 市區街道導引圖層（清晰標出學府路、裕民路、中華路到水門引道）
  // ==========================================
  function initStreetConnectors() {
    streetConnectorGroup = L.featureGroup().addTo(map);

    // 往北街道路徑 (學府路一段 -> 裕民路 -> 中華路一段 -> 浮洲橋自行車引道)
    const streetNorthPath = [
      startPoint,
      [24.9875, 121.4485], // 學府路一段
      [24.9882, 121.4468], // 學府路一段與裕民路口
      [24.9890, 121.4452], // 裕民路 (海山捷運商圈)
      [24.9898, 121.4435], // 裕民路與中華路一段交叉口
      [24.9928, 121.4428], // 中華路一段往浮洲橋方向
      [24.9965, 121.4425]  // 浮洲橋自行車牽引道
    ];

    // 往南街道路徑 (學府公園 -> 裕民路 -> 中華路二段 -> 城林橋牽引道)
    const streetSouthPath = [
      startPoint,
      [24.9860, 121.4470],
      [24.9850, 121.4425],
      [24.9838, 121.4390],
      [24.9825, 121.4345],
      [24.9812, 121.4312]  // 城林大橋牽引道
    ];

    // 繪製往北街道引導線（亮橙色虛線，辨識度極高）
    const lineNorth = L.polyline(streetNorthPath, {
      color: '#f97316',
      weight: 5,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(streetConnectorGroup);

    lineNorth.bindPopup(`
      <div class="text-xs">
        <h4 class="font-bold text-amber-700 text-sm mb-1">🚦 市區街道導引：往浮洲橋引道</h4>
        <p class="text-slate-700"><strong>路線：</strong>學府路一段 ➜ 裕民路 (經海山站) ➜ 中華路一段 ➜ 浮洲橋自行車牽引道。</p>
        <p class="text-slate-500 mt-1">※ 市區道路紅綠燈多，請小騎士走慢車道或人行牽車，推車上引道進入大漢溪右岸！</p>
      </div>
    `);

    // 繪製往南街道引導線
    const lineSouth = L.polyline(streetSouthPath, {
      color: '#ea580c',
      weight: 5,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(streetConnectorGroup);

    lineSouth.bindPopup(`
      <div class="text-xs">
        <h4 class="font-bold text-amber-700 text-sm mb-1">🚦 市區街道導引：往城林橋引道</h4>
        <p class="text-slate-700"><strong>路線：</strong>學府公園 ➜ 裕民路 ➜ 中華路一段/二段 ➜ 城林橋自行車牽引道。</p>
        <p class="text-slate-500 mt-1">※ 安全跨越堤防往鶯歌三峽的最佳市區通道！</p>
      </div>
    `);

    // 標示街道關鍵地標
    const createStreetPin = (coords, text, color, title, desc) => {
      const pinIcon = L.divIcon({
        className: 'custom-poi-marker',
        html: `<div style="background-color: ${color}; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold;">${text}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      const pin = L.marker(coords, { icon: pinIcon }).addTo(streetConnectorGroup);
      pin.bindPopup(`
        <div class="text-xs">
          <h4 class="font-bold text-slate-900 text-sm mb-1">${title}</h4>
          <p class="text-slate-600">${desc}</p>
        </div>
      `);
      return pin;
    };

    createStreetPin([24.9890, 121.4452], '捷', '#0284c7', '捷運海山站商圈 (裕民路)', '店家與人潮較多，請放慢車速靠右慢行或牽行。');
    createStreetPin([24.9965, 121.4425], '橋', '#10b981', '浮洲橋河濱自行車牽引道入口', '由此牽行上陸橋，即可安全跨進大漢溪右岸自行車專用道（往新月橋、大稻埕、淡水）。');
    createStreetPin([24.9812, 121.4312], '橋', '#10b981', '城林橋河濱自行車牽引道入口', '由此牽行上引道跨越堤防，進入大漢溪右岸自行車道（往鶯歌、三峽）。');
    createStreetPin([24.9910, 121.4395], '✕', '#ef4444', '擺接堡路平面道路 (危險警示)', '⚠️ 砂石車與大型貨車車速極快，國小同學嚴禁直接騎上擺接堡路平面！請走市區引道。');

    // 街道引導開關監聽
    const toggleStreet = document.getElementById('toggle-street-connectors');
    if (toggleStreet) {
      toggleStreet.addEventListener('change', (e) => {
        if (e.target.checked) {
          map.addLayer(streetConnectorGroup);
        } else {
          map.removeLayer(streetConnectorGroup);
        }
      });
    }
  }

  // ==========================================
  // 河濱專用道安全防護圖層 (服務站、警示點、擺接堡路警戒帶)
  // ==========================================
  let safetyLayerGroup = null;

  function initSafetyLayer() {
    safetyLayerGroup = L.featureGroup().addTo(map);

    const { riverServiceStations, safetyHazardPoints, prohibitedZone } = window.RIVERSIDE_DATA;

    // 1. 繪製官方河濱自行車租借站/維修服務站 (打氣/急救/加水)
    if (riverServiceStations) {
      riverServiceStations.forEach(st => {
        const stationIcon = L.divIcon({
          className: 'safety-station-marker',
          html: `<div style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;">🛡️</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const servicesHtml = st.services.map(s => `<li class="flex items-center gap-1 text-[11px] text-blue-900"><span>✓</span> <span>${s}</span></li>`).join('');

        const marker = L.marker(st.coords, { icon: stationIcon }).addTo(safetyLayerGroup);
        marker.bindPopup(`
          <div class="text-xs">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-blue-600 mb-1 inline-block">官方河濱服務站</span>
            <h4 class="font-bold text-slate-900 text-sm mb-1">${st.name}</h4>
            <p class="text-slate-600 mb-2 leading-relaxed">${st.desc}</p>
            <div class="p-2 bg-blue-50 rounded-lg border border-blue-100 text-[11px]">
              <p class="font-bold text-blue-950 mb-1">🛠️ 現場免費安全支援服務：</p>
              <ul class="space-y-0.5">${servicesHtml}</ul>
            </div>
          </div>
        `);
      });
    }

    // 2. 繪製公路車窄胎重點安全警示點 (牽引道坡度/防滑/減速)
    if (safetyHazardPoints) {
      safetyHazardPoints.forEach(hp => {
        const hazardIcon = L.divIcon({
          className: 'safety-hazard-marker',
          html: `<div style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px;">⚠️</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const marker = L.marker(hp.coords, { icon: hazardIcon }).addTo(safetyLayerGroup);
        marker.bindPopup(`
          <div class="text-xs">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold text-amber-900 bg-amber-200 mb-1 inline-block">${hp.title}</span>
            <h4 class="font-bold text-slate-900 text-sm mb-1">${hp.name}</h4>
            <p class="text-slate-700 leading-relaxed">${hp.desc}</p>
          </div>
        `);
      });
    }

    // 3. 繪製土城擺接堡路紅色禁行警戒區 (砂石車主要幹線，小學生絕對禁行)
    if (prohibitedZone) {
      const dangerLine = L.polyline(prohibitedZone.path, {
        color: '#dc2626',
        weight: 8,
        dashArray: '12, 10',
        opacity: 0.7
      }).addTo(safetyLayerGroup);

      dangerLine.bindPopup(`
        <div class="text-xs">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-red-600 mb-1 inline-block">小學生絕對禁行區</span>
          <h4 class="font-bold text-red-700 text-sm mb-1">${prohibitedZone.name}</h4>
          <p class="text-slate-700 leading-relaxed">${prohibitedZone.warning}</p>
        </div>
      `);

      // 在擺接堡路中央放一個警示標籤
      const dangerIcon = L.divIcon({
        className: 'prohibited-warning-marker',
        html: `<div style="width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px;">🚫</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      const dangerMarker = L.marker([24.9860, 121.4380], { icon: dangerIcon }).addTo(safetyLayerGroup);
      dangerMarker.bindPopup(`
        <div class="text-xs">
          <h4 class="font-bold text-red-600 text-sm mb-1">🚫 擺接堡路：砂石車重型幹道</h4>
          <p class="text-slate-700 leading-relaxed">車速極快且無自行車專用道！小學生請一律走市區引道跨越堤防，請勿進入！</p>
        </div>
      `);
    }

    // 安全防護圖層開關監聽
    const toggleSafety = document.getElementById('toggle-safety-layer');
    if (toggleSafety) {
      toggleSafety.addEventListener('change', (e) => {
        if (e.target.checked) {
          map.addLayer(safetyLayerGroup);
        } else {
          map.removeLayer(safetyLayerGroup);
        }
      });
    }
  }

  // ==========================================
  // 重要分岔路口路牌指引圖層 (轉向決策與路牌卡片)
  // ==========================================
  let junctionMarkerGroup = null;
  const junctionMarkers = {};
  let directionArrowGroup = null;

  function initJunctionLayer() {
    junctionMarkerGroup = L.featureGroup().addTo(map);
    directionArrowGroup = L.featureGroup().addTo(map);

    const { criticalJunctions } = window.RIVERSIDE_DATA;
    if (!criticalJunctions) return;

    criticalJunctions.forEach(j => {
      const icon = L.divIcon({
        className: `junction-signpost-marker junction-${j.id}`,
        html: `<div style="width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px;">🔀</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker(j.coords, { icon: icon }).addTo(junctionMarkerGroup);

      const decisionsHtml = j.decisions.map(d => `
        <div class="p-2 rounded-lg bg-sky-50/80 border border-sky-100 mb-1.5 text-[11px]">
          <div class="font-bold text-sky-950 flex items-center gap-1">
            <span>${d.direction}</span>
          </div>
          <p class="text-slate-700 mt-0.5"><strong>通往：</strong>${d.destination}</p>
          <p class="text-slate-500 text-[10px] mt-0.5">${d.action}</p>
        </div>
      `).join('');

      marker.bindPopup(`
        <div class="text-xs max-w-[270px]">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-sky-600 mb-1 inline-block">🔀 ${j.badge}</span>
          <h4 class="font-bold text-slate-900 text-sm mb-1">${j.name}</h4>
          <p class="text-slate-600 mb-2 leading-relaxed">${j.summary}</p>
          
          <div class="mb-2">
            <span class="font-bold text-slate-800 text-[11px] block mb-1">🧭 分岔路口路牌（選哪條走）：</span>
            ${decisionsHtml}
          </div>

          <div class="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[10px]">
            ⚠️ <strong>小騎士提醒：</strong>${j.safetyTip}
          </div>
        </div>
      `);

      junctionMarkers[j.id] = marker;
    });

    // 分岔路口圖層開關監聽
    const toggleJunction = document.getElementById('toggle-junction-layer');
    if (toggleJunction) {
      toggleJunction.addEventListener('change', (e) => {
        if (e.target.checked) {
          map.addLayer(junctionMarkerGroup);
          map.addLayer(directionArrowGroup);
        } else {
          map.removeLayer(junctionMarkerGroup);
          map.removeLayer(directionArrowGroup);
        }
      });
    }
  }

  // 繪製沿線前進方向箭頭 (讓小騎士清楚知道往哪邊前進)
  function updateDirectionArrows(route) {
    if (!directionArrowGroup) return;
    directionArrowGroup.clearLayers();

    const points = route.pathPoints;
    if (!points || points.length < 4) return;

    // 每間隔約 8-10 個點放置一個方向箭頭
    const step = Math.max(6, Math.floor(points.length / 10));

    for (let i = 2; i < points.length - 2; i += step) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // 計算方位角度 (從 p1 指向 p2)
      const latDiff = p2[0] - p1[0];
      const lngDiff = p2[1] - p1[1];
      const angleDeg = Math.atan2(lngDiff, latDiff) * (180 / Math.PI);

      const arrowIcon = L.divIcon({
        className: 'route-direction-arrow',
        html: `<div style="transform: rotate(${angleDeg}deg); color: ${route.color}; font-size: 16px; font-weight: bold; text-shadow: 0 0 3px #ffffff, 0 0 6px #ffffff; line-height: 1; display: flex; align-items: center; justify-content: center;">▲</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      L.marker(p1, { icon: arrowIcon, interactive: false }).addTo(directionArrowGroup);
    }
  }

  // 更新本路線經過的分岔路口標記高亮狀態
  function updateActiveJunctionMarkers(routeId) {
    const { criticalJunctions } = window.RIVERSIDE_DATA;
    if (!criticalJunctions) return;

    criticalJunctions.forEach(j => {
      const marker = junctionMarkers[j.id];
      if (marker) {
        const el = marker.getElement();
        const applies = j.decisions.some(d => d.suitableRoutes.includes(routeId));
        if (el) {
          if (applies) {
            el.classList.add('active-junction');
          } else {
            el.classList.remove('active-junction');
          }
        }
      }
    });
  }

  // 將地圖視野調整到涵蓋全雙北路線
  function fitAllRoutes() {
    const allCoords = [];
    routes.forEach(r => allCoords.push(...r.pathPoints));
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [30, 30] });
  }

  // ==========================================
  // 2. 騎乘時間計算公式
  // ==========================================
  function calculateTimes(distanceKm, speedKmH) {
    // 純騎乘時間 (分鐘)
    const rideMinutes = Math.round((distanceKm / speedKmH) * 60);

    // 建議休息與吃點心時間 (依照距離長短合理分配)
    let baseRestMinutes = 20;
    if (distanceKm <= 15) {
      baseRestMinutes = 25; // 逛新月橋、看羊、吃廟街豆花
    } else if (distanceKm <= 30) {
      baseRestMinutes = 45; // 逛鶯歌老街、吃阿婆壽司
    } else if (distanceKm <= 50) {
      baseRestMinutes = 70; // 碧潭踩天鵝船、大稻埕吃市集
    } else {
      baseRestMinutes = 90; // 八里或淡水長途，吃阿給、看海吹風
    }

    // 若開啟同學團體騎模式，增加 15% 彈性休息時間
    const adjustedRestMinutes = isGroupMode 
      ? Math.round(baseRestMinutes * 1.15) 
      : baseRestMinutes;

    const totalMinutes = rideMinutes + adjustedRestMinutes;

    return {
      rideMinutes,
      restMinutes: adjustedRestMinutes,
      totalMinutes,
      formattedRide: formatMinutesToHours(rideMinutes),
      formattedTotal: formatMinutesToHours(totalMinutes)
    };
  }

  function formatMinutesToHours(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) {
      return `${mins} 分鐘`;
    }
    if (mins === 0) {
      return `${hours} 小時`;
    }
    return `${hours} 小時 ${mins} 分`;
  }

  // ==========================================
  // 3. 渲染路線清單卡片
  // ==========================================
  function renderRouteCards() {
    const container = document.getElementById('routes-container');
    container.innerHTML = '';

    const filteredRoutes = routes.filter(route => {
      if (currentFilter === 'all') return true;
      return route.category === currentFilter;
    });

    if (filteredRoutes.length === 0) {
      container.innerHTML = `<div class="text-xs text-slate-400 text-center py-6">此分類暫無路線</div>`;
      return;
    }

    filteredRoutes.forEach(route => {
      const times = calculateTimes(route.roundTripDistanceKm, currentSpeed);
      const isSelected = route.id === selectedRouteId;

      const card = document.createElement('div');
      card.className = `route-card bg-white p-3.5 rounded-xl border border-slate-200 cursor-pointer shadow-xs ${isSelected ? 'active' : ''}`;
      card.dataset.routeId = route.id;

      card.innerHTML = `
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background-color: ${route.color}15; color: ${route.color}">
            ${route.tag}
          </span>
          <span class="text-xs font-bold text-slate-900 flex items-center gap-1">
            <span class="w-2 h-2 rounded-full inline-block" style="background-color: ${route.color}"></span>
            來回 ${route.roundTripDistanceKm} km
          </span>
        </div>
        
        <h3 class="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition mb-1">
          ${route.name}
        </h3>
        
        <p class="text-xs text-slate-500 line-clamp-1 mb-1.5">
          ${route.highlight}
        </p>

        <div class="flex items-center gap-1.5 mb-2">
          <span class="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
            <i data-lucide="shield-check" class="w-3 h-3 text-emerald-600"></i> 96% 河濱專用道・無汽機車
          </span>
        </div>

        <div class="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 text-slate-600">
          <div class="flex items-center gap-1">
            <i data-lucide="timer" class="w-3.5 h-3.5 text-blue-600"></i>
            <span>騎乘約 <strong>${times.formattedRide}</strong></span>
          </div>
          <div class="flex items-center gap-1 text-emerald-700">
            <i data-lucide="clock" class="w-3.5 h-3.5 text-emerald-600"></i>
            <span>外出總約 <strong>${times.formattedTotal}</strong></span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        selectRoute(route.id);
      });

      container.appendChild(card);
    });

    // 重新更新 Lucide 圖標
    lucide.createIcons();
  }

  // ==========================================
  // 4. 路線選擇與地圖連動
  // ==========================================
  function selectRoute(routeId) {
    selectedRouteId = routeId;
    const route = routes.find(r => r.id === routeId);
    if (!route) return;

    // 1. 更新卡片高亮樣式
    document.querySelectorAll('.route-card').forEach(card => {
      if (card.dataset.routeId === routeId) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('active');
      }
    });

    // 2. 更新地圖上的折線樣式
    Object.keys(polylineLayers).forEach(id => {
      const polyline = polylineLayers[id];
      if (id === routeId) {
        polyline.setStyle({
          weight: 6,
          opacity: 0.95
        });
        polyline.bringToFront();
      } else {
        polyline.setStyle({
          weight: 3,
          opacity: 0.25
        });
      }
    });

    // 3. 移動地圖視野以包含選定路線
    const activePolyline = polylineLayers[routeId];
    if (activePolyline) {
      map.fitBounds(activePolyline.getBounds(), {
        padding: [40, 40],
        maxZoom: 14
      });
    }

    // 4. 更新 POI 地標標記
    updateMapMarkers(route);

    // 4.5 更新路線前進方向箭頭
    updateDirectionArrows(route);

    // 4.6 高亮本路線經過的分岔路口標記
    updateActiveJunctionMarkers(routeId);

    // 5. 更新頂部快速看板與下方詳細面板
    updateQuickStats(route);
    renderDetailPanel(route);
  }

  // 更新地圖標記 (折返點、風景、補水)
  function updateMapMarkers(route) {
    // 清除舊標記
    currentPoiMarkers.forEach(m => map.removeLayer(m));
    currentPoiMarkers = [];

    // 添加折返點標記 (旗幟)
    const lastPoint = route.pathPoints[route.pathPoints.length - 1];
    const destinationIcon = L.divIcon({
      className: 'destination-marker',
      html: `
        <div style="background-color: ${route.color}; width: 100%; height: 100%; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const destMarker = L.marker(lastPoint, { icon: destinationIcon }).addTo(map);
    destMarker.bindPopup(`
      <div class="text-xs">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold text-white mb-1 inline-block" style="background-color: ${route.color}">折返目的地</span>
        <h4 class="font-bold text-slate-900 text-sm">${route.name}</h4>
        <p class="text-slate-600 mt-1">${route.returnTip}</p>
      </div>
    `);
    currentPoiMarkers.push(destMarker);

    // 繪製沿途重要風景與美食點 (POIs)
    route.pois.forEach(poi => {
      let bgColor = '#10b981'; // 綠色風景
      let iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`;

      if (poi.category === 'food') {
        bgColor = '#f59e0b'; // 橙色美食
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"/><path d="M6 2v20"/><path d="M18 14v8"/><path d="M15 2v4"/></svg>`;
      } else if (poi.category === 'water') {
        bgColor = '#3b82f6'; // 藍色補水
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
      }

      const poiIcon = L.divIcon({
        className: 'custom-poi-marker',
        html: `<div style="background-color: ${bgColor}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">${iconSvg}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const poiMarker = L.marker(poi.coords, { icon: poiIcon }).addTo(map);
      poiMarker.bindPopup(`
        <div class="text-xs">
          <h4 class="font-bold text-slate-900 text-sm mb-1">${poi.name}</h4>
          <p class="text-slate-600">${poi.info}</p>
        </div>
      `);
      currentPoiMarkers.push(poiMarker);
    });
  }

  // ==========================================
  // 5. 頂部即時時間看板更新
  // ==========================================
  function updateQuickStats(route) {
    const onewayTimes = calculateTimes(route.oneWayDistanceKm, currentSpeed);
    const roundTimes = calculateTimes(route.roundTripDistanceKm, currentSpeed);

    document.getElementById('quick-oneway-time').textContent = onewayTimes.formattedRide;
    document.getElementById('quick-round-time').textContent = roundTimes.formattedRide;
    document.getElementById('quick-total-time').textContent = roundTimes.formattedTotal;
  }

  // ==========================================
  // 6. 渲染詳細路線儀表板 (Detail Panel)
  // ==========================================
  function renderDetailPanel(route) {
    document.getElementById('detail-empty-state').classList.add('hidden');
    const content = document.getElementById('detail-content');
    content.classList.remove('hidden');

    const onewayTimes = calculateTimes(route.oneWayDistanceKm, currentSpeed);
    const roundTimes = calculateTimes(route.roundTripDistanceKm, currentSpeed);

    // 標題與標籤
    document.getElementById('detail-category-badge').textContent = route.categoryName;
    document.getElementById('detail-category-badge').style.backgroundColor = route.color;
    document.getElementById('detail-tag').textContent = route.tag;
    document.getElementById('detail-title').textContent = route.name;
    document.getElementById('detail-highlight').textContent = route.highlight;

    // 數據統計指標
    document.getElementById('detail-oneway-dist').textContent = `${route.oneWayDistanceKm} km`;
    document.getElementById('detail-oneway-time').textContent = `約 ${onewayTimes.formattedRide}`;
    document.getElementById('detail-round-dist').textContent = `${route.roundTripDistanceKm} km`;
    document.getElementById('detail-round-time').textContent = `純騎乘 ${roundTimes.formattedRide}`;
    document.getElementById('detail-rest-time').textContent = `約 ${roundTimes.restMinutes} 分鐘`;
    document.getElementById('detail-total-outing-time').textContent = `約 ${roundTimes.formattedTotal}`;

    // 安全動線導航文字
    document.getElementById('detail-departure-tip').textContent = route.departureTip;
    document.getElementById('detail-return-tip').textContent = route.returnTip;

    // 安全防護指標更新
    const ratioEl = document.getElementById('detail-riverside-ratio');
    if (ratioEl) {
      ratioEl.textContent = '96% 堤外封閉專用道';
    }
    const stationEl = document.getElementById('detail-safety-station');
    if (stationEl) {
      let stName = "浮洲自行車租借站 (大漢溪右岸服務中心)";
      if (route.id === 'route-yingge') stName = "鶯歌自行車租借站 (三鶯之心水岸)";
      else if (route.id === 'route-bitan') stName = "碧潭自行車租借站 (碧潭水岸)";
      else if (route.id === 'route-dadaocheng') stName = "大稻埕碼頭自行車服務中心";
      else if (route.id === 'route-tamsui') stName = "關渡自行車租借站 / 浮洲站";
      else if (route.id === 'route-metropark') stName = "八里左岸自行車租借站 / 浮洲站";
      stationEl.textContent = stName;
    }

    // 渲染重要轉折點 (Waypoints)
    const waypointsContainer = document.getElementById('detail-waypoints-list');
    waypointsContainer.innerHTML = '';
    route.keyWaypoints.forEach((wp, index) => {
      const item = document.createElement('div');
      item.className = 'flex items-start gap-2 p-2 rounded-lg bg-white border border-slate-200/90';
      item.innerHTML = `
        <span class="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
          ${index + 1}
        </span>
        <div>
          <span class="font-bold text-slate-800 block">${wp.name}</span>
          <span class="text-slate-500 text-[11px]">${wp.desc}</span>
        </div>
      `;
      waypointsContainer.appendChild(item);
    });

    // 渲染風景、美食與補水站 (POIs)
    const poisContainer = document.getElementById('detail-pois-list');
    poisContainer.innerHTML = '';
    route.pois.forEach(poi => {
      const item = document.createElement('div');
      item.className = 'p-2 rounded-lg bg-white border border-slate-200/90 flex flex-col gap-0.5';
      
      let badge = '<span class="text-[10px] text-emerald-700 font-bold">📸 風景打卡</span>';
      if (poi.category === 'food') {
        badge = '<span class="text-[10px] text-amber-700 font-bold">🍜 平價美食</span>';
      } else if (poi.category === 'water') {
        badge = '<span class="text-[10px] text-blue-700 font-bold">🚰 飲水與洗手間</span>';
      }

      item.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="font-bold text-slate-800 text-xs">${poi.name}</span>
          ${badge}
        </div>
        <p class="text-slate-500 text-[11px] leading-relaxed">${poi.info}</p>
      `;
      poisContainer.appendChild(item);
    });

    // 綁定 GPX 下載
    document.getElementById('btn-download-gpx').onclick = () => {
      downloadGPX(route);
    };

    // 綁定產生出遊卡
    document.getElementById('btn-generate-card-for-route').onclick = () => {
      openPlanModal(route);
    };

    // 渲染本路線的分岔路口指引卡片
    renderJunctionsList(route);

    lucide.createIcons();
  }

  // ==========================================
  // 6.5 渲染本路線分岔路口轉向指引卡片清單
  // ==========================================
  function renderJunctionsList(route) {
    const container = document.getElementById('detail-junctions-list');
    if (!container) return;
    container.innerHTML = '';

    const { criticalJunctions, startPoint } = window.RIVERSIDE_DATA;
    if (!criticalJunctions) return;

    // 篩選出適用於該路線的分岔路口
    const applicableJunctions = [];

    criticalJunctions.forEach(j => {
      const matchedDecision = j.decisions.find(d => d.suitableRoutes.includes(route.id));
      if (matchedDecision) {
        // 計算從起點的直線距離以利排序
        const dist = Math.hypot(j.coords[0] - startPoint[0], j.coords[1] - startPoint[1]);
        applicableJunctions.push({
          junction: j,
          decision: matchedDecision,
          dist: dist
        });
      }
    });

    // 依距離由近到遠排序（順著騎行路線推進）
    applicableJunctions.sort((a, b) => a.dist - b.dist);

    if (applicableJunctions.length === 0) {
      container.innerHTML = `<div class="col-span-full p-3 bg-white rounded-xl text-center text-slate-400 text-xs">此路線主線筆直平坦，依河濱標線直行即可。</div>`;
      return;
    }

    applicableJunctions.forEach((item, index) => {
      const j = item.junction;
      const dec = item.decision;

      const card = document.createElement('div');
      card.className = 'p-3 bg-white rounded-xl border border-sky-100 shadow-2xs flex flex-col justify-between gap-2.5 transition hover:shadow-xs';

      card.innerHTML = `
        <div>
          <div class="flex items-center justify-between gap-1 mb-1.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
              第 ${index + 1} 處分岔口
            </span>
            <span class="text-[10px] text-slate-400 font-medium">${j.badge}</span>
          </div>

          <h4 class="font-bold text-slate-900 text-xs mb-1">${j.name}</h4>

          <div class="p-2 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-950 mb-1.5">
            <span class="font-bold text-xs flex items-center gap-1 text-emerald-800">
              ${dec.direction}
            </span>
            <p class="text-[11px] text-emerald-900 mt-0.5 font-medium leading-relaxed">${dec.action}</p>
          </div>

          <p class="text-slate-500 text-[10px]"><strong>通往：</strong>${dec.destination}</p>
        </div>

        <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
          <span class="text-[10px] text-amber-700 truncate" title="${j.safetyTip}">⚠️ ${j.safetyTip.slice(0, 16)}...</span>
          <button class="btn-locate-junction shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold bg-sky-600 hover:bg-sky-700 text-white transition flex items-center gap-1 shadow-2xs">
            <i data-lucide="navigation" class="w-3 h-3"></i>
            <span>地圖定位</span>
          </button>
        </div>
      `;

      card.querySelector('.btn-locate-junction').addEventListener('click', () => {
        map.flyTo(j.coords, 16, { duration: 1.0 });
        const marker = junctionMarkers[j.id];
        if (marker) {
          setTimeout(() => marker.openPopup(), 1100);
        }
      });

      container.appendChild(card);
    });

    lucide.createIcons();
  }

  // ==========================================
  // 7. GPX 軌跡匯出功能
  // ==========================================
  function downloadGPX(route) {
    const trackPoints = route.pathPoints.map(p => `      <trkpt lat="${p[0]}" lon="${p[1]}"><ele>10</ele></trkpt>`).join('\n');
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="土城小騎士單車地圖" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${route.name}</name>
    <desc>起點土城學府公園，來回折返路線，全長 ${route.roundTripDistanceKm} km</desc>
  </metadata>
  <trk>
    <name>${route.name}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `土城學府公園-${route.name}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // 8. 速度控制與同儕模式監聽
  // ==========================================
  const speedSlider = document.getElementById('speed-slider');
  const speedDisplay = document.getElementById('speed-display');
  const speedPresetBtns = document.querySelectorAll('.speed-preset-btn');
  const groupToggle = document.getElementById('group-mode-toggle');

  function updateSpeed(newSpeed) {
    currentSpeed = parseInt(newSpeed, 10);
    speedSlider.value = currentSpeed;
    speedDisplay.textContent = `${currentSpeed} km/h`;

    // 更新按鈕樣式
    speedPresetBtns.forEach(btn => {
      if (parseInt(btn.dataset.speed, 10) === currentSpeed) {
        btn.className = 'speed-preset-btn active-speed px-2.5 py-1 rounded-md text-xs font-bold text-white bg-blue-600 transition shadow-xs';
      } else {
        btn.className = 'speed-preset-btn px-2.5 py-1 rounded-md text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition';
      }
    });

    // 重新計算卡片與詳情
    renderRouteCards();
    const route = routes.find(r => r.id === selectedRouteId);
    if (route) {
      updateQuickStats(route);
      renderDetailPanel(route);
    }
  }

  speedSlider.addEventListener('input', (e) => {
    updateSpeed(e.target.value);
  });

  speedPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      updateSpeed(btn.dataset.speed);
    });
  });

  groupToggle.addEventListener('change', (e) => {
    isGroupMode = e.target.checked;
    renderRouteCards();
    const route = routes.find(r => r.id === selectedRouteId);
    if (route) {
      updateQuickStats(route);
      renderDetailPanel(route);
    }
  });

  // ==========================================
  // 9. 路線分類過濾 (Filter Tabs)
  // ==========================================
  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => {
        t.classList.remove('active-filter', 'bg-slate-900', 'text-white');
        t.classList.add('bg-slate-200', 'text-slate-700');
      });
      tab.classList.add('active-filter', 'bg-slate-900', 'text-white');
      tab.classList.remove('bg-slate-200', 'text-slate-700');

      currentFilter = tab.dataset.filter;
      renderRouteCards();
    });
  });

  // ==========================================
  // 10. 安全檢核清單 (Checklist)
  // ==========================================
  const checklistStorageKey = 'tucheng_bike_checklist_v1';
  let checklistState = JSON.parse(localStorage.getItem(checklistStorageKey) || '{}');

  function renderChecklist() {
    const container = document.getElementById('checklist-items-container');
    container.innerHTML = '';

    safetyChecklist.forEach(item => {
      const isChecked = !!checklistState[item.id];
      const div = document.createElement('label');
      div.className = `flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition ${isChecked ? 'bg-blue-50/70 border-blue-300' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`;
      
      div.innerHTML = `
        <input type="checkbox" data-id="${item.id}" ${isChecked ? 'checked' : ''} class="checklist-checkbox mt-0.5 rounded text-blue-600 focus:ring-0">
        <div>
          <span class="font-bold text-slate-900 text-xs block mb-0.5">${item.title}</span>
          <span class="text-slate-600 text-[11px] leading-relaxed block">${item.desc}</span>
        </div>
      `;

      container.appendChild(div);
    });

    updateChecklistBadge();

    // 綁定勾選事件
    container.querySelectorAll('.checklist-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        checklistState[id] = e.target.checked;
        localStorage.setItem(checklistStorageKey, JSON.stringify(checklistState));
        renderChecklist();

        // 若全數打勾，觸發彩帶特效！
        const total = safetyChecklist.length;
        const checkedCount = Object.values(checklistState).filter(Boolean).length;
        if (checkedCount === total) {
          if (typeof confetti === 'function') {
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 }
            });
          }
        }
      });
    });
  }

  function updateChecklistBadge() {
    const total = safetyChecklist.length;
    const checkedCount = Object.values(checklistState).filter(Boolean).length;
    document.getElementById('checklist-counter-badge').textContent = `${checkedCount}/${total}`;
    document.getElementById('modal-checklist-status').textContent = `${checkedCount} / ${total}`;
  }

  document.getElementById('btn-reset-checklist').addEventListener('click', () => {
    checklistState = {};
    localStorage.removeItem(checklistStorageKey);
    renderChecklist();
  });

  document.getElementById('btn-finish-checklist').addEventListener('click', () => {
    closeAllModals();
  });

  // ==========================================
  // 11. 騎乘計畫單 (Plan Modal)
  // ==========================================
  function openPlanModal(route) {
    if (!route) {
      route = routes.find(r => r.id === selectedRouteId) || routes[0];
    }
    const times = calculateTimes(route.roundTripDistanceKm, currentSpeed);

    document.getElementById('plan-card-route-name').textContent = route.name;
    document.getElementById('plan-card-destination').textContent = route.name.split('＆')[0];
    document.getElementById('plan-card-distance').textContent = `${route.roundTripDistanceKm} km`;
    document.getElementById('plan-card-ride-time').textContent = `約 ${times.formattedRide}`;
    document.getElementById('plan-card-total-time').textContent = `約 ${times.formattedTotal}`;

    openModal('modal-plan');
  }

  // 複製計畫單文字
  document.getElementById('btn-copy-plan-text').addEventListener('click', () => {
    const route = routes.find(r => r.id === selectedRouteId) || routes[0];
    const times = calculateTimes(route.roundTripDistanceKm, currentSpeed);
    const text = `🚴【土城學府公園・小騎士單車出遊計畫】
📍 起點：土城學府公園 (海山站3號出口)
🎯 目的地：${route.name}
📏 往返總里程：${route.roundTripDistanceKm} km
⏱️ 預估騎乘時間：約 ${times.formattedRide} (均速 ${currentSpeed} km/h)
⏳ 預估外出總時間：約 ${times.formattedTotal} (含休息點心)
⚠️ 安全守則：走浮洲橋/城林橋引道進河濱，不騎擺接堡路，配戴安全帽，準時回家！`;

    navigator.clipboard.writeText(text).then(() => {
      alert('✅ 騎乘計畫已複製到剪貼簿！可以貼到班級群組或傳給爸爸媽媽囉！');
    }).catch(() => {
      alert('複製失敗，請手動選取文字複製。');
    });
  });

  // ==========================================
  // 12. 彈窗通關與通用控制
  // ==========================================
  function openModal(modalId) {
    closeAllModals();
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  function closeAllModals() {
    document.querySelectorAll('[id^="modal-"]').forEach(modal => {
      modal.classList.add('hidden');
    });
  }

  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // 點擊彈窗背景關閉
  document.querySelectorAll('[id^="modal-"]').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAllModals();
      }
    });
  });

  // 遊戲實例與事件綁定
  let bikeGameInstance = null;
  const gameModalBtn = document.getElementById('btn-open-game-modal');
  if (gameModalBtn) {
    gameModalBtn.addEventListener('click', () => {
      openModal('modal-game');
      if (!bikeGameInstance && typeof window.initRiversideBikeGame === 'function') {
        bikeGameInstance = window.initRiversideBikeGame('game-canvas');
      }
      if (bikeGameInstance) {
        setTimeout(() => {
          bikeGameInstance.initCanvasSize();
          bikeGameInstance.startGame('xinyue');
        }, 100);
      }
    });
  }

  // 遊戲路線切換按鈕
  document.querySelectorAll('.game-route-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.game-route-btn').forEach(b => {
        b.className = 'game-route-btn px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition';
      });
      btn.className = 'game-route-btn px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold transition shadow-xs';

      const routeKey = btn.dataset.gameRoute;
      if (bikeGameInstance) {
        bikeGameInstance.startGame(routeKey);
      }
    });
  });

  // 綁定各按鈕彈窗事件
  document.getElementById('btn-open-checklist').addEventListener('click', () => {
    openModal('modal-checklist');
  });

  document.getElementById('btn-open-departure-guide').addEventListener('click', () => {
    openModal('modal-departure-guide');
  });

  document.getElementById('btn-read-safety-guide').addEventListener('click', () => {
    openModal('modal-departure-guide');
  });

  document.getElementById('btn-open-plan-modal').addEventListener('click', () => {
    openPlanModal();
  });

  document.getElementById('btn-open-github-modal').addEventListener('click', () => {
    openModal('modal-github');
  });

  // ==========================================
  // 13. 系統初次啟動執行
  // ==========================================
  initMap();
  renderRouteCards();
  renderChecklist();
  selectRoute(selectedRouteId);
  lucide.createIcons();
});
