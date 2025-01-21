let map;

function initMap() {
     map = new ol.Map({
        target: 'map',
        layers: [
            new ol.layer.Tile({
                source: new ol.source.OSM()
            })
        ],
        view: new ol.View({
            center: ol.proj.fromLonLat([5.15, 60.1]),
            zoom: 10
        })
    });

    // Fetch data and add markers to the map
    fetchData();
}


async function fetchData() {
    try {
        // Fetch the token from a secure endpoint
        const tokenResponse = await fetch('/', { method: 'HEAD',cache: 'no-store' });
        const token = tokenResponse.headers.get('X-InfluxDB-Token');

        const url = `https://dtracker.no:8086/api/v2/query?org=dtracker`; // Include org in the URL

        const query = `from(bucket: "trackerBucket")
          |> range(start: -1h)
          |> filter(fn: (r) => r["imei"] == "867007069789219")
          |> filter(fn: (r) => r["type"] == "GNSS")
          |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
          |> keep(columns: ["_time", "latitude", "longitude"])
          |> yield(name: "filtered")`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/vnd.flux', // Set Content-Type to application/vnd.flux
                'Accept': 'application/csv' // Set Accept header to CSV
            },
            body: query // Send the query as plain text
        });

        const responseText = await response.text(); // Get the raw response text
        //console.log('Response Text:', responseText); // Log the raw response text

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}, message: ${responseText}`);
        }

        // Process the CSV response
        processData(responseText);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

function processData(data) {
    // Parse the CSV data
    const rows = data.split('\n').slice(1); // Skip the header row

    rows.forEach(row => {
	const columns = row.split(',').map(col => col.replace('\r', '')).filter(col => col.trim() !== '');
	//console.log('Parsed columns:', columns); // Log the parsed columns
	if (columns.length > 4) {
	   //console.log('Parsed columns:', columns); // Log the parsed columns
           const time = columns[2]; // _time column
           const latitude = parseFloat(columns[3]); // latitude column
           const longitude = parseFloat(columns[4]); // longitude column

           if (!isNaN(latitude) && !isNaN(longitude)) {
              addMarker(longitude, latitude);
           }
	}
    });
}

function addMarker(lon, lat) {
    var marker = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat]))
    });

    var vectorSource = new ol.source.Vector({
        features: [marker]
    });

    var markerVectorLayer = new ol.layer.Vector({
        source: vectorSource,
    });

    map.addLayer(markerVectorLayer);
}
