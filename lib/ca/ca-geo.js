/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * ca-geo.js: Cloud Analytics routines related to geographic lookup.
 */
var mod_geoip = require('libGeoIP');

var ca_geoip_handle;				/* handle to libGeoIP */

/*
 * Given an IPv4 address, return an object that contains the known physical
 * geography of the specified address -- or undefined if no such geographical
 * information is available.  If an object is returned, it will have the
 * following fields:
 *
 *	longitude	Floating-point longitude
 *
 *	latitude	Floating-point latitude
 *
 * Additionally, it may have the following fields if they are avaialable:
 *
 *	country_code	The two letter country code of the matching country
 *
 *	country_code3	The three letter country code of the matching country
 *
 *	continent_code	The two letter continent code
 *
 *	country		The name of the matching country
 *
 *	region		The name of the matching region. For the US this is
 *			the state name; for Canada this is the province name;
 *			for other countries it is the FIPS 10-4 subcountry code.
 *
 *	postal_code	A string containing the postal code (if US or Canada)
 *
 *	area_code	The telephone area code (if US or Canada)
 *
 *	metro_code	The metro-area code (if US)
 */
exports.caGeoIP = function (addr)
{
	if (!ca_geoip_handle) {
		var database;

		if (!(database = process.env['GEOIP_DATABASE']))
			throw (new Error('GEOIP_DATABASE not specified'));

		ca_geoip_handle = new mod_geoip.libGeoIP(database);
	}

	return (ca_geoip_handle.query(addr));
};
