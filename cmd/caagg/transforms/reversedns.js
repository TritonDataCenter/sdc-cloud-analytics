/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

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
	    fields: [ 'raddr' ],
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
	var key, ii;
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

	lookup.forEach(function (addr) {
		mod_dns.reverse(addr, function (err, result) {
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

			dns_cache[addr] = result;
		});
	});

	return (ret);
}
