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
let popup;                // Popup overlay for speed & route info

// Variables for tracking session functionality:
let isTracking = false;
let trackingPoints = [];
let trackingStartTime = null;

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
 * 1. Initialize OpenLayers Map
 **************************************************/
function initMap() {
  // Create a vector source and layer for the dog marker (current location).
  dogMarkerSource = new ol.source.Vector();
  dogMarkerLayer = new ol.layer.Vector({
    source: dogMarkerSource,
    style: new ol.style.Style({
      image: new ol.style.Icon({
        src: 'dog-icon.png', // Ensure dog-icon.png is in the same folder.
        scale: 0.3          // Smaller dog icon.
      }),
      text: new ol.style.Text({
        text: "prototype 1",  // Updated label
        offsetY: -25,
        fill: new ol.style.Fill({ color: 'black' }),
        stroke: new ol.style.Stroke({ color: 'white', width: 2 })
      })
    })
  });

  // Create a vector source and layer for the route trace (last 10 minutes).
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

  // Initialize the map with an OSM tile layer, the route trace (beneath), and the dog marker (on top).
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
      zoom: 18  // Increased initial zoom level.
    })
  });

  // Create and add the popup overlay.
  popup = new ol.Overlay({
    element: document.getElementById('popup'),
    positioning: 'bottom-center',
    stopEvent: false,
    offset: [0, -20]
  });
  map.addOverlay(popup);

  // Fetch data every second (last 10 minutes of data).
  fetchData();
  setInterval(fetchData, 1000);
}

/**************************************************
 * 2. Fetch Data from InfluxDB and Process It
 **************************************************/
// Query to get GNSS data for the last 10 minutes.
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

// Process the CSV data to combine Latitude and Longitude per timestamp,
// update the current location marker, draw the route trace,
// compute & display speed and total distance (last 10 min) in the popup,
// and, if tracking is active, record points for the tracking session.
function processData(data) {
  const rows = data.split('\n').filter(row => row.trim() !== '');
  let coordinates = {};

  rows.forEach(row => {
    const columns = row.split(',').map(col => col.replace('\r', '').trim()).filter(col => col !== '');
    if (columns.length < 5 || columns[3].trim() === '' || isNaN(columns[3])) return;
    const time = columns[2];
    const field = columns[4];
    const value = parseFloat(columns[3]);

    if (!isNaN(value)) {
      if (!coordinates[time]) {
        coordinates[time] = {};
      }
      if (field === "Latitude" && value >= -90 && value <= 90) {
        coordinates[time].lat = value;
      } else if (field === "Longitude" && value >= -180 && value <= 180) {
        coordinates[time].lon = value;
      }
    }
  });

  // Create an array of valid points (with both lat and lon).
  let points = [];
  for (const time in coordinates) {
    if (coordinates[time].lat !== undefined && coordinates[time].lon !== undefined) {
      points.push({ time: time, coord: ol.proj.fromLonLat([coordinates[time].lon, coordinates[time].lat]) });
    }
  }
  // Sort points by timestamp.
  points.sort((a, b) => a.time.localeCompare(b.time));

  // Clear previous features.
  dogMarkerSource.clear();
  routeVectorSource.clear();

  if (points.length > 0) {
    // The latest point is the current position.
    const latest = points[points.length - 1];
    addDogMarker(latest.coord);
    zoomInToDevice(latest.coord);
    // Create a route trace from all points.
    const routeCoords = points.map(p => p.coord);
    const routeLine = new ol.geom.LineString(routeCoords);
    const routeFeature = new ol.Feature({ geometry: routeLine });
    routeVectorSource.addFeature(routeFeature);
    
    // Compute speed using the last two points (if available).
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
    
    // Compute total distance traveled (last 10 minutes) using the route trace.
    const routeLength = ol.sphere.getLength(routeLine);
    const distanceText = "Distance: " + (routeLength / 1000).toFixed(2) + " km";
    
    // Update the popup content and position it at the latest point.
    document.getElementById('popup-content').innerHTML = speedText + "<br>" + distanceText;
    popup.setPosition(latest.coord);
    
    // If tracking is active, record the latest point (if not duplicate).
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
  const marker = new ol.Feature({
    geometry: new ol.geom.Point(point)
  });
  dogMarkerSource.addFeature(marker);
}

// Improved zooming animation: pan first, then zoom with easing.
function zoomInToDevice(point) {
  let view = map.getView();
  view.animate(
    { center: point, duration: 800, easing: ol.easing.easeOut },
    { zoom: 20, duration: 800, easing: ol.easing.easeOut }
  );
}

/**************************************************
 * 3. Commands Panel and WebSocket Command Handling
 **************************************************/
document.getElementById('commandsButton').addEventListener('click', () => {
  const commandsPanel = document.getElementById('commandsPanel');
  commandsPanel.style.display = (commandsPanel.style.display === 'none' || commandsPanel.style.display === '') ? 'block' : 'none';
});

document.querySelectorAll('#commandsPanel button').forEach(button => {
  button.addEventListener('click', () => {
    const imei = deviceImei;
    const command = button.getAttribute('data-command');
    const payload = JSON.stringify({ imei, message: command });
    socket.send(payload);
    logToOutput(`Sent command: ${payload}`);
  });
});

/**************************************************
 * 4. Tracking Session Functionality (Gå på tur)
 **************************************************/
document.getElementById('toggleTracking').addEventListener('click', function() {
  if (!isTracking) {
    // Start tracking session
    isTracking = true;
    trackingPoints = [];
    trackingStartTime = new Date();
    this.textContent = "Stopp tur";
    document.getElementById('trackingOverview').innerHTML = "Tracking started...";
  } else {
    // Stop tracking session
    isTracking = false;
    this.textContent = "Gå på tur";
    let totalDistance = 0;
    for (let i = 1; i < trackingPoints.length; i++) {
      let lonlat1 = ol.proj.toLonLat(trackingPoints[i - 1].coord);
      let lonlat2 = ol.proj.toLonLat(trackingPoints[i].coord);
      totalDistance += ol.sphere.getDistance(lonlat1, lonlat2);
    }
    totalDistance = totalDistance / 1000; // km
    let totalTime = (trackingPoints.length >= 2 ? (new Date(trackingPoints[trackingPoints.length - 1].time) - new Date(trackingPoints[0].time)) / 3600000 : 0); // hours
    let avgSpeed = (totalTime > 0 ? totalDistance / totalTime : 0);
    let overviewText = "Total Distance: " + totalDistance.toFixed(2) + " km<br>" +
                       "Average Speed: " + avgSpeed.toFixed(2) + " km/h";
    document.getElementById('trackingOverview').innerHTML = overviewText;
  }
});

/**************************************************
 * 5. Initialize Everything
 **************************************************/
initMap();
