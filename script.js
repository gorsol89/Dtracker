/**************************************************
 * Utility: Get a URL parameter by name.
 **************************************************/
function getUrlParameter(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

/**************************************************
 * Global Variables and IMEI Determination
 **************************************************/
// Use the IMEI from the URL if provided; otherwise, default to "867007069790282".
const deviceImei = getUrlParameter('IMEI') || '867007069790282';
if (!getUrlParameter('IMEI')) {
  console.log("IMEI parameter is missing in the URL, using default IMEI: " + deviceImei);
  document.addEventListener("DOMContentLoaded", () => {
    logToOutput("IMEI parameter is missing in the URL, using default IMEI: " + deviceImei);
  });
}

/**************************************************
 * Global Variables and Token (Hard-coded)
 **************************************************/
const token = "vrCZtsVXWh8OetRb0s8fNcJ7V1RpnYTkF7mg_SJEXFVfa5VZq0Y__-nmHLjq60zL_Kbmm6dBPwSDrXKLHLMCGA==";

/**************************************************
 * Global Variables and WebSocket Initialization
 **************************************************/
let map;
let dogMarkerSource;      // Source for the current dog marker
let dogMarkerLayer;       // Layer for the dog marker
let routeVectorSource;    // Source for the route trace
let routeVectorLayer;     // Layer for the route trace
let isFirstLoad = true;
let popup;                // Popup overlay for route info (speed, distance)
let infoPopup;            // Popup overlay for device info

// Tracking session variables:
let isTracking = false;
let trackingPoints = [];
let trackingStartTime = null;

// Global variable to store the current coordinate from real-time data.
let currentCoordinate = null;

const socketUrl = "wss://dtracker.no/ws/";
const socket = new WebSocket(socketUrl);
socket.onopen = () => logToOutput("WebSocket connection established.");
socket.onmessage = (event) => logToOutput("Server: " + event.data);
socket.onclose = () => logToOutput("WebSocket connection closed.");
socket.onerror = (error) => logToOutput("WebSocket error: " + error.message);

function logToOutput(message) {
  const logDiv = document.getElementById('log');
  const logEntry = document.createElement('div');
  logEntry.textContent = message;
  logDiv.appendChild(logEntry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

/**************************************************
 * Save/Load Last Coordinate for Refresh
 **************************************************/
function loadLastCoordinate() {
  const stored = localStorage.getItem('lastCoordinate');
  if (stored) {
    try {
      const lonlat = JSON.parse(stored); // Expect [lon, lat]
      const projCoord = ol.proj.fromLonLat(lonlat);
      currentCoordinate = projCoord;
      addDogMarker(projCoord);
      map.getView().setCenter(projCoord);
    } catch (e) {
      console.error("Error parsing stored coordinate:", e);
    }
  }
}

/**************************************************
 * 1. Initialize OpenLayers Map
 **************************************************/
function initMap() {
  // Create a vector source and layer for the dog marker.
  dogMarkerSource = new ol.source.Vector();
  dogMarkerLayer = new ol.layer.Vector({
    source: dogMarkerSource,
    style: new ol.style.Style({
      image: new ol.style.Icon({
        src: 'dog-icon.png', // Ensure dog-icon.png is in the same folder.
        scale: 0.3          // Smaller dog icon.
      }),
      text: new ol.style.Text({
        text: "prototype 1",
        offsetY: -25,
        fill: new ol.style.Fill({ color: 'black' }),
        stroke: new ol.style.Stroke({ color: 'white', width: 2 })
      })
    })
  });

  // Create a vector source and layer for the route trace.
  routeVectorSource = new ol.source.Vector();
  routeVectorLayer = new ol.layer.Vector({
    source: routeVectorSource,
    style: new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: 'orange',
        width: 3
      })
    })
  });

  // Initialize the map.
  map = new ol.Map({
    target: 'map',
    layers: [
      new ol.layer.Tile({
        source: new ol.source.XYZ({
          url: 'https://{a-c}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        })
      }),
      routeVectorLayer,
      dogMarkerLayer
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat([5.155, 60.117]),
      zoom: 18
    })
  });

  // Create and add the popup overlay for route info.
  popup = new ol.Overlay({
    element: document.getElementById('popup'),
    positioning: 'bottom-center',
    stopEvent: false,
    offset: [0, -20]
  });
  map.addOverlay(popup);

  // Create and add the info popup overlay for device info (positioned to the right).
  infoPopup = new ol.Overlay({
    element: document.getElementById('info-popup'),
    positioning: 'center-right',
    stopEvent: false,
    offset: [20, 0]
  });
  map.addOverlay(infoPopup);

  // Map click: if dog marker is clicked, show device info.
  map.on('singleclick', function(evt) {
    map.forEachFeatureAtPixel(evt.pixel, function(feature, layer) {
      if (layer === dogMarkerLayer) {
        showDeviceInfo(feature.getGeometry().getCoordinates());
      }
    });
  });

  // Load last stored coordinate on refresh.
  loadLastCoordinate();

  // Fetch real-time data every second.
  fetchData();
  setInterval(fetchData, 1000);
}

/**************************************************
 * 2. Real-Time Data Fetching and Processing
 **************************************************/
async function fetchData() {
  try {
    const imei = deviceImei;
    const url = `https://dtracker.no:8086/api/v2/query?org=dtracker`;
    const query = `from(bucket: "trackerBucket")
  |> range(start: -10m)
  |> filter(fn: (r) => r["_measurement"] == "GNSS")
  |> filter(fn: (r) => r["IMEI"] == "${imei}")
  |> filter(fn: (r) => r["_field"] == "Latitude" or r["_field"] == "Longitude")
  |> keep(columns: ["_time", "_value", "_field"])`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      body: query
    });
    const responseText = await response.text();
    processData(responseText);
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

function processData(data) {
  const rows = data.split('\n').filter(row => row.trim() !== '');
  let coordinates = {};
  rows.forEach(row => {
    const cols = row.split(',').map(col => col.replace('\r', '').trim()).filter(col => col !== '');
    if (cols.length < 5 || cols[3].trim() === '' || isNaN(cols[3])) return;
    const time = cols[2];
    const field = cols[4];
    const value = parseFloat(cols[3]);
    if (!isNaN(value)) {
      if (!coordinates[time]) coordinates[time] = {};
      if (field === "Latitude" && value >= -90 && value <= 90) coordinates[time].lat = value;
      else if (field === "Longitude" && value >= -180 && value <= 180) coordinates[time].lon = value;
    }
  });
  let points = [];
  for (const t in coordinates) {
    if (coordinates[t].lat !== undefined && coordinates[t].lon !== undefined) {
      points.push({ time: t, coord: ol.proj.fromLonLat([coordinates[t].lon, coordinates[t].lat]) });
    }
  }
  points.sort((a, b) => a.time.localeCompare(b.time));
  dogMarkerSource.clear();
  routeVectorSource.clear();
  if (points.length > 0) {
    const latest = points[points.length - 1];
    currentCoordinate = latest.coord;
    localStorage.setItem('lastCoordinate', JSON.stringify(ol.proj.toLonLat(latest.coord)));
    addDogMarker(latest.coord);
    const routeCoords = points.map(p => p.coord);
    const routeLine = new ol.geom.LineString(routeCoords);
    const routeFeature = new ol.Feature({ geometry: routeLine });
    routeVectorSource.addFeature(routeFeature);
    let speedText = "Speed: N/A";
    if (points.length >= 2) {
      const p1 = points[points.length - 2];
      const p2 = points[points.length - 1];
      const lonlat1 = ol.proj.toLonLat(p1.coord);
      const lonlat2 = ol.proj.toLonLat(p2.coord);
      const distance = ol.sphere.getDistance(lonlat1, lonlat2);
      const timeDiff = (new Date(p2.time) - new Date(p1.time)) / 1000;
      const speed = (distance / 1000) * (3600 / timeDiff);
      speedText = "Speed: " + speed.toFixed(2) + " km/h";
    }
    const routeLength = ol.sphere.getLength(routeLine);
    const distanceText = "Distance: " + (routeLength / 1000).toFixed(2) + " km";
    document.getElementById('popup-content').innerHTML = speedText + "<br>" + distanceText;
    popup.setPosition(latest.coord);
    if (isTracking && points.length > 0) {
      const latestPoint = points[points.length - 1];
      if (trackingPoints.length === 0 || trackingPoints[trackingPoints.length - 1].time !== latestPoint.time) {
        trackingPoints.push(latestPoint);
      }
    }
  } else {
    document.getElementById('popup-content').innerHTML = "Speed: N/A<br>Distance: N/A";
    popup.setPosition(undefined);
  }
}

/**************************************************
 * Update Layers Functions
 **************************************************/
function addDogMarker(point) {
  const marker = new ol.Feature({ geometry: new ol.geom.Point(point) });
  dogMarkerSource.addFeature(marker);
}

/**************************************************
 * Route Overview Functions (for 10, 15, 30 min)
 **************************************************/
async function showRouteInfo(timeRange) {
  try {
    const imei = deviceImei;
    const url = `https://dtracker.no:8086/api/v2/query?org=dtracker`;
    const query = `from(bucket: "trackerBucket")
  |> range(start: ${timeRange})
  |> filter(fn: (r) => r["_measurement"] == "GNSS")
  |> filter(fn: (r) => r["IMEI"] == "${imei}")
  |> filter(fn: (r) => r["_field"] == "Latitude" or r["_field"] == "Longitude")
  |> keep(columns: ["_time", "_value", "_field"])`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      body: query
    });
    const responseText = await response.text();
    const rows = responseText.split('\n').filter(row => row.trim() !== '');
    let coordinates = {};
    rows.forEach(row => {
      const cols = row.split(',').map(col => col.replace('\r', '').trim()).filter(col => col !== '');
      if (cols.length < 5 || cols[3].trim() === '' || isNaN(cols[3])) return;
      const time = cols[2];
      const field = cols[4];
      const value = parseFloat(cols[3]);
      if (!coordinates[time]) coordinates[time] = {};
      if (field === "Latitude" && value >= -90 && value <= 90) coordinates[time].lat = value;
      else if (field === "Longitude" && value >= -180 && value <= 180) coordinates[time].lon = value;
    });
    let points = [];
    for (const t in coordinates) {
      if (coordinates[t].lat !== undefined && coordinates[t].lon !== undefined) {
        points.push({ time: t, coord: ol.proj.fromLonLat([coordinates[t].lon, coordinates[t].lat]) });
      }
    }
    points.sort((a, b) => a.time.localeCompare(b.time));
    routeVectorSource.clear();
    if (points.length > 0) {
      const routeCoords = points.map(p => p.coord);
      const routeLine = new ol.geom.LineString(routeCoords);
      const routeFeature = new ol.Feature({ geometry: routeLine });
      routeVectorSource.addFeature(routeFeature);
      let totalDistance = 0;
      for (let i = 1; i < points.length; i++) {
        let p1 = points[i - 1];
        let p2 = points[i];
        const lonlat1 = ol.proj.toLonLat(p1.coord);
        const lonlat2 = ol.proj.toLonLat(p2.coord);
        totalDistance += ol.sphere.getDistance(lonlat1, lonlat2);
      }
      totalDistance = totalDistance / 1000;
      let timeDiff = (new Date(points[points.length - 1].time) - new Date(points[0].time)) / 3600000;
      let avgSpeed = (timeDiff > 0 ? (totalDistance / timeDiff).toFixed(2) + " km/h" : "N/A");
      document.getElementById('popup-content').innerHTML = "Route (" + timeRange + "):<br>" +
                                                             "Total Distance: " + totalDistance.toFixed(2) + " km<br>" +
                                                             "Average Speed: " + avgSpeed;
      popup.setPosition(points[points.length - 1].coord);
    } else {
      document.getElementById('popup-content').innerHTML = "No data for selected period.";
      popup.setPosition(undefined);
    }
  } catch (e) {
    console.error(e);
  }
}

/**************************************************
 * Info Button Functionality
 **************************************************/
async function showDeviceInfoAtCurrentLocation() {
  if (!currentCoordinate) {
    alert("No location data available yet.");
    return;
  }
  popup.setPosition(undefined);
  const imei = deviceImei;
  const sinceMidnight = new Date();
  sinceMidnight.setHours(0,0,0,0);
  const startTimeISO = sinceMidnight.toISOString();
  const totalDistanceToday = await getDistanceSince(startTimeISO, imei);
  const sensorData = await getSensorData(imei);
  const nearestTown = await getNearestTown(currentCoordinate);
  const lonlat = ol.proj.toLonLat(currentCoordinate);
  const locationText = "Location: " + lonlat[1].toFixed(5) + ", " + lonlat[0].toFixed(5);
  let infoHTML = "<strong>Device Info</strong><br>";
  infoHTML += "Nearest Town: " + nearestTown + "<br>";
  infoHTML += locationText + "<br>";
  if (sensorData) {
    infoHTML += "Temperature: " + (sensorData.temperature !== undefined ? sensorData.temperature + " °C" : "N/A") + "<br>";
    infoHTML += "Humidity: " + (sensorData.humidity !== undefined ? sensorData.humidity + " %" : "N/A") + "<br>";
    infoHTML += "Battery: " + (sensorData.battery !== undefined ? sensorData.battery + " %" : "N/A") + "<br>";
  } else {
    infoHTML += "Temperature: N/A<br>Humidity: N/A<br>Battery: N/A<br>";
  }
  infoHTML += "Distance Today (since 00:00): " + totalDistanceToday.toFixed(2) + " km";
  document.getElementById('info-popup-content').innerHTML = infoHTML;
  infoPopup.setPosition(currentCoordinate);
  document.getElementById('info-popup').style.display = "block";
}

// Hide info popup when closer is clicked.
document.getElementById('info-popup-closer').addEventListener('click', function(evt) {
  evt.preventDefault();
  document.getElementById('info-popup').style.display = "none";
  return false;
});

/**************************************************
 * Query Functions for Historical Data
 **************************************************/
async function getDistanceSince(startTimeISO, imei) {
  const url = `https://dtracker.no:8086/api/v2/query?org=dtracker`;
  const query = `from(bucket: "trackerBucket")
    |> range(start: ${startTimeISO})
    |> filter(fn: (r) => r["_measurement"] == "GNSS")
    |> filter(fn: (r) => r["IMEI"] == "${imei}")
    |> filter(fn: (r) => r["_field"] == "Latitude" or r["_field"] == "Longitude")
    |> keep(columns: ["_time", "_value", "_field"])`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
         'Authorization': `Token ${token}`,
         'Content-Type': 'application/vnd.flux',
         'Accept': 'application/csv'
      },
      body: query
    });
    const text = await response.text();
    const rows = text.split('\n').filter(row => row.trim() !== '');
    let coords = {};
    rows.forEach(row => {
      const cols = row.split(',').map(col => col.replace('\r', '').trim()).filter(col => col !== '');
      if (cols.length < 5 || cols[3] === '' || isNaN(cols[3])) return;
      const time = cols[2];
      const field = cols[4];
      const value = parseFloat(cols[3]);
      if (!coords[time]) coords[time] = {};
      if (field === "Latitude") coords[time].lat = value;
      if (field === "Longitude") coords[time].lon = value;
    });
    let points = [];
    for (const t in coords) {
      if (coords[t].lat !== undefined && coords[t].lon !== undefined) {
        points.push({ time: t, coord: ol.proj.fromLonLat([coords[t].lon, coords[t].lat]) });
      }
    }
    points.sort((a, b) => a.time.localeCompare(b.time));
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const lonlat1 = ol.proj.toLonLat(p1.coord);
      const lonlat2 = ol.proj.toLonLat(p2.coord);
      totalDist += ol.sphere.getDistance(lonlat1, lonlat2);
    }
    return totalDist / 1000;
  } catch (e) {
    console.error(e);
    return 0;
  }
}

async function getSensorData(imei) {
  const url = `https://dtracker.no:8086/api/v2/query?org=dtracker`;
  const query = `from(bucket: "trackerBucket")
    |> range(start: -1h)
    |> filter(fn: (r) => r["_measurement"] == "SENSOR")
    |> filter(fn: (r) => r["IMEI"] == "${imei}")
    |> filter(fn: (r) => r["_field"] == "Temperature" or r["_field"] == "Humidity" or r["_field"] == "Battery")
    |> last()
    |> keep(columns: ["_field", "_value"])`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
         'Authorization': `Token ${token}`,
         'Content-Type': 'application/vnd.flux',
         'Accept': 'application/csv'
      },
      body: query
    });
    const text = await response.text();
    let sensorData = {};
    const rows = text.split('\n').filter(row => row.trim() !== '');
    rows.slice(1).forEach(row => {
      const cols = row.split(',').map(col => col.replace('\r', '').trim());
      if (cols.length >= 5) {
        let field = cols[4].toLowerCase();
        let value = parseFloat(cols[3]);
        sensorData[field] = value;
      }
    });
    return sensorData;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**************************************************
 * 7. Route Selection Buttons Event Handling
 **************************************************/
document.getElementById('route10').addEventListener('click', () => {
  showRouteInfo("-10m");
});
document.getElementById('route15').addEventListener('click', () => {
  showRouteInfo("-15m");
});
document.getElementById('route30').addEventListener('click', () => {
  showRouteInfo("-30m");
});

/**************************************************
 * 8. Info Button Event Handling
 **************************************************/
document.getElementById('infoButton').addEventListener('click', () => {
  showDeviceInfoAtCurrentLocation();
});

/**************************************************
 * 9. Tracking Session Functionality (Gå på tur)
 **************************************************/
document.getElementById('toggleTracking').addEventListener('click', function() {
  if (!isTracking) {
    isTracking = true;
    trackingPoints = [];
    trackingStartTime = new Date();
    this.textContent = "Stopp tur";
    document.getElementById('trackingOverview').innerHTML = "Tracking started...";
  } else {
    isTracking = false;
    this.textContent = "Gå på tur";
    let totalDistance = 0;
    for (let i = 1; i < trackingPoints.length; i++) {
      let lonlat1 = ol.proj.toLonLat(trackingPoints[i - 1].coord);
      let lonlat2 = ol.proj.toLonLat(trackingPoints[i].coord);
      totalDistance += ol.sphere.getDistance(lonlat1, lonlat2);
    }
    totalDistance = totalDistance / 1000;
    let totalTime = (trackingPoints.length >= 2 ? (new Date(trackingPoints[trackingPoints.length - 1].time) - new Date(trackingPoints[0].time)) / 3600000 : 0);
    let avgSpeed = (totalTime > 0 ? (totalDistance / totalTime).toFixed(2) + " km/h" : "N/A");
    let overviewText = "Tracking Overview:<br>" +
                       "Total Distance: " + totalDistance.toFixed(2) + " km<br>" +
                       "Average Speed: " + avgSpeed;
    document.getElementById('trackingOverview').innerHTML = overviewText;
  }
});

/**************************************************
 * 10. Device Info Functionality (on Dog Marker Click)
 **************************************************/
async function showDeviceInfo(coordinate) {
  // Hide the main popup.
  popup.setPosition(undefined);
  const imei = deviceImei;
  let totalDistance = await getTotalDistance(imei);
  const sensorData = await getSensorData(imei);
  const nearestTown = await getNearestTown(coordinate);
  const lonlat = ol.proj.toLonLat(coordinate);
  const locationText = "Location: " + lonlat[1].toFixed(5) + ", " + lonlat[0].toFixed(5);
  let infoHTML = "<strong>Device Info</strong><br>";
  infoHTML += "Total Distance Since Start: " + totalDistance.toFixed(2) + " km<br>";
  infoHTML += "Nearest Town: " + nearestTown + "<br>";
  infoHTML += locationText + "<br>";
  if (sensorData) {
    infoHTML += "Temperature: " + (sensorData.temperature !== undefined ? sensorData.temperature + " °C" : "N/A") + "<br>";
    infoHTML += "Humidity: " + (sensorData.humidity !== undefined ? sensorData.humidity + " %" : "N/A") + "<br>";
    infoHTML += "Battery: " + (sensorData.battery !== undefined ? sensorData.battery + " %" : "N/A") + "<br>";
  } else {
    infoHTML += "Temperature: N/A<br>Humidity: N/A<br>Battery: N/A<br>";
  }
  let sinceMidnight = new Date();
  sinceMidnight.setHours(0,0,0,0);
  let startTimeISO = sinceMidnight.toISOString();
  let distanceToday = await getDistanceSince(startTimeISO, imei);
  infoHTML += "Distance Today (since 00:00): " + distanceToday.toFixed(2) + " km";
  document.getElementById('info-popup-content').innerHTML = infoHTML;
  infoPopup.setPosition(currentCoordinate);
  document.getElementById('info-popup').style.display = "block";
}

// Hide the info popup when its closer is clicked.
document.getElementById('info-popup-closer').addEventListener('click', function(evt) {
  evt.preventDefault();
  document.getElementById('info-popup').style.display = "none";
  return false;
});

/**************************************************
 * 11. Reverse Geocoding: Get Nearest Town using Nominatim.
 **************************************************/
async function getNearestTown(coordinate) {
  const lonlat = ol.proj.toLonLat(coordinate);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lonlat[1]}&lon=${lonlat[0]}`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'DTrackerApp/1.0' }
    });
    const data = await response.json();
    if(data.address) {
      return data.address.town || data.address.city || data.address.village || data.display_name || "Unknown";
    }
    return "Unknown";
  } catch(e) {
    console.error(e);
    return "Unknown";
  }
}

/**************************************************
 * 12. Initialize Everything
 **************************************************/
initMap();
