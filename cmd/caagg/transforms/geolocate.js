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
	    fields: [ 'raddr' ],
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
function transGeoIpProcess(keys)
{
	var ret = {};
	var ii, data;

	for (ii = 0; ii < keys.length; ii++) {
		data = mod_cageoip.caGeoIP(keys[ii]);
		if (data !== undefined)
			ret[keys[ii]] = data;
	}

	return (ret);
}
