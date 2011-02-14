/*
 * geolocate.js: Aggregator transformation for geo-location
 */
var mod_ca = require('../../../lib/ca/ca-common');
var mod_dns = require('dns');

var trans_log;

/*
 * A series of cached dns request entries.
 *
 * The keys will be IP Addresses and the values will be the array returned from
 * dns.reverse. If we get the following errors from dns.reverse we will have a
 * null value in the array to indicate that we will not be getting a valid value
 * any time soon and thus we shouldn't keep trying:
 *
 *	dns.NXDOMAIN: domain does not exists.
 *	dns.NODATA: domain exists but no data of reqd type.
 */
var dns_cache = {};

/*
 * Register the reverse dns agent with the aggregator
 */
exports.agginit = function (agg, log)
{
	agg.registerTransformation({
	    name: 'reversedns',
	    label: 'reverse dns IP addresses lookup',
	    types: [ mod_ca.ca_type_ipaddr ],
	    transform: transReverseDNS
	});

	trans_log = log;
};

/*
 * Transform IP Addresses into the reverse DNS name.
 */
function transReverseDNS(keys)
{
	var ret = {};
	var key, addr, ii;
	var lookup = [];

	for (ii = 0; ii < keys.length; ii++) {
		key = keys[ii];

		if (!(key in dns_cache)) {
			lookup.push(key);
			continue;
		}

		if (dns_cache[key] != null)
			ret[key] = dns_cache[key];
	}

	for (ii = 0; ii < lookup.length; ii++) {
		addr = lookup[ii];
		mod_dns.reverse(addr, function (err, result) {
			var index = addr;
			if (err) {
				switch (err.errno) {
				case mod_dns.NXDOMAIN:
				case mod_dns.NODATA:
					result = null;
					break;
				default:
					return;
				}
			}

			dns_cache[index] = result;
		});
		delete (lookup[key]);
	}

	return (ret);
}
