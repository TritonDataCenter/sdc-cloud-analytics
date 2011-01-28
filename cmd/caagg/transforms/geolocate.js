/*
 * geolocate.js: Aggregator transformation for geo-location
 */
var mod_ca = require('../../../lib/ca/ca-common');
var mod_cageoip = require('../../../lib/ca/ca-geo');

var tran_log;	/* Log file */

/*
 * Initialize the transformation with the aggregator
 */
exports.agginit = function (agg, log)
{
	agg.registerTransformation({
	    name: 'geolocate',
	    label: 'geolocate IP addresses',
	    types: [ mod_ca.ca_type_ipaddr ],
	    transform: transGeoIpProcess
	});

	tran_log = log;
};

/*
 * Transform raw data into geolocated data.
 *
 * The output format will look like:
 * {
 *     '128.148.32.110': { geoloc data },
 *     '138.16.60.2': { geoloc data },
 *	...
 * }
 *
 * As a friendly reminder several addresses won't show up for geolocation that
 * are defined to be externally non-routable. These include, but are not limited
 * to:
 *	127.0.0.0/8
 *	10.0.0.0/8
 *	192.168.0.0/16
 *	172.16.0.0/12
 *	169.254.0.0/16	(Though if you get something on this, that would be bad)
 */
function transGeoIpProcess(raw)
{
	var ret = {};
	var key, data;

	/*
	 * Assumptions about data format:
	 *
	 * Currently we only support one discrete decomposition and one numeric
	 * decomposition. The discrete decomposition in this case must support
	 * the geolocation transformation. If it does not, we will return an
	 * empty object. Furthermore, because of the nature of the discrete
	 * decomposition, the keys of the raw object should be the keys to feed
	 * into the geoip module. If we end up supporting more than one discrete
	 * decomposition, which would be reasonable, we will need to know how to
	 * get the list of values to post process.
	 */
	for (key in raw) {
		data = mod_cageoip.caGeoIP(key);
		if (data !== undefined)
			ret[key] = data;
	}

	return (ret);
}
