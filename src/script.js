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

// WeatherAPI Key (replace with your actual key)
const weatherApiKey = '9a7317d72e8341e799f120847251701'; // Replace with your API key from weatherapi.com

// Create OpenLayers Map
const map = new Map({
    target: 'map',
    layers: [
        new TileLayer({
            source: new OSM(), // OpenStreetMap as the base layer
        }),
    ],
    view: new View({
        center: fromLonLat([10.7522, 59.9139]), // Center on Oslo initially
        zoom: 10,
    }),
});

// Add a vector layer for the user's location marker
const locationSource = new VectorSource();
const locationLayer = new VectorLayer({
    source: locationSource,
});
map.addLayer(locationLayer);

// Function to show the user's location on the map using Geolocation API
function showUserLocationAndWeather() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            (position) => {
                // Get the user's latitude and longitude
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                // Log the position for debugging
                console.log('User position:', latitude, longitude);

                // Convert the coordinates to OpenLayers format
                const coordinates = fromLonLat([longitude, latitude]);

                // Create a feature for the user's location
                const userFeature = new Feature({
                    geometry: new Point(coordinates),
                });

                // Set the style of the feature (user icon)
                userFeature.setStyle(
                    new Style({
                        image: new Icon({
                            src: '/public/icons/pin-icon.png', // Use the user pin icon from the icons folder
                            scale: 0.1, // Adjust the size of the icon
                        }),
                    })
                );

                // Add the feature to the vector source
                locationSource.clear(); // Clear previous markers
                locationSource.addFeature(userFeature);

                // Center the map on the user's location
                map.getView().setCenter(coordinates);
                map.getView().setZoom(14); // Set zoom level when the user location is shown

                // Fetch and display the weather
                fetchWeather(latitude, longitude);
            },
            (error) => {
                console.error('Geolocation error:', error);
                alert('Unable to retrieve your location.');
            },
            {
                enableHighAccuracy: true, // High accuracy for geolocation
                maximumAge: 10000, // Maximum age for cached location
                timeout: 5000, // Timeout for location request
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

// Function to fetch weather based on the user's location (latitude and longitude)
function fetchWeather(latitude, longitude) {
    const weatherUrl = `https://api.weatherapi.com/v1/current.json?key=${weatherApiKey}&q=${latitude},${longitude}&aqi=no`;

    // Fetch weather data from WeatherAPI
    fetch(weatherUrl)
        .then((response) => response.json())
        .then((data) => {
            // Extract weather information
            const weatherDescription = data.current.condition.text;
            const temperature = data.current.temp_c;
            const city = data.location.name;

            // Display weather info in the popup
            document.getElementById('weather-info').innerHTML = `
                <h3>Weather in ${city}:</h3>
                <p>Weather: ${weatherDescription}</p>
                <p>Temperature: ${temperature}°C</p>
            `;
        })
        .catch((error) => {
            console.error('Error fetching weather data:', error);
            alert('Unable to retrieve weather data.');
        });
}

// Call the function to show the user's location and fetch weather
showUserLocationAndWeather();
