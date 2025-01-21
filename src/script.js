import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Icon from 'ol/style/Icon';
import Style from 'ol/style/Style';

// Configuration
const weatherApiKey = '9a7317d72e8341e799f120847251701';
const serverApiUrl = 'http://dtracker.no:8086'; // InfluxDB API endpoint
const token = 'vrCZtsVXWh8OetRb0s8fNcJ7V1RpnYTkF7mg_SJEXFVfa5VZq0Y__-nmHLjq60zL_Kbmm6dBPwSDrXKLHLMCGA==';
const org = 'dtracker';
const bucket = 'trackerBucket';

let userName = ''; // Store the user name

// OpenLayers Map
const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
  ],
  view: new View({
    center: fromLonLat([10.7522, 59.9139]), // Default center (Oslo)
    zoom: 10,
  }),
});

const locationSource = new VectorSource();
const locationLayer = new VectorLayer({
  source: locationSource,
});
map.addLayer(locationLayer);

// Set User Name
window.setUserName = function () {
  userName = document.getElementById('userName').value.trim();
  document.getElementById('user-name').innerHTML = `Name: ${userName}`;
};

// Fetch User Location Data from the Server
async function fetchUserLocations() {
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -1h) // Fetch data from the last hour
      |> filter(fn: (r) => r._measurement == "device_measurements")
  `;
  const url = `${serverApiUrl}/api/v2/query?org=${org}`;
  const headers = {
    Authorization: `Token ${token}`,
    'Content-Type': 'application/vnd.flux',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: query,
    });

    if (!response.ok) {
      throw new Error('Error fetching data from InfluxDB');
    }

    const data = await response.text();
    const rows = data.split('\n').slice(1, -1); // Skip the first line (headers) and empty line
    rows.forEach((row) => {
      const [time, latitude, longitude, id] = row.split(','); // Adjust based on your schema
      addLocationToMap(parseFloat(latitude), parseFloat(longitude));
    });
  } catch (error) {
    console.error('Error fetching user locations:', error);
  }
}

// Add a Location Marker to the Map
function addLocationToMap(latitude, longitude) {
  const coordinates = fromLonLat([longitude, latitude]);
  const locationFeature = new Feature({
    geometry: new Point(coordinates),
  });

  locationFeature.setStyle(
    new Style({
      image: new Icon({
        src: '/icons/pin-icon.png',
        scale: 0.1,
      }),
    })
  );

  locationSource.clear();
  locationSource.addFeature(locationFeature);
  map.getView().setCenter(coordinates);
  map.getView().setZoom(14);
  fetchWeather(latitude, longitude); // Fetch weather data for this location
}

// Fetch Weather Data
function fetchWeather(latitude, longitude) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${weatherApiKey}&q=${latitude},${longitude}&aqi=no`;

  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      const weatherInfo = `
        <h3>Weather in ${data.location.name}:</h3>
        <p>Condition: ${data.current.condition.text}</p>
        <p>Temperature: ${data.current.temp_c}°C</p>
      `;
      document.getElementById('weather-info').innerHTML = weatherInfo;
    })
    .catch((error) => console.error('Error fetching weather data:', error));
}

// Call the function to fetch user locations
fetchUserLocations();
