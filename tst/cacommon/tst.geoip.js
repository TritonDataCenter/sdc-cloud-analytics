var mod_ca = require('../../lib/ca/ca-common');
var sys = require('sys');
var assert = require('assert');

/*
 * If we don't have GEOIP_DATABASE in the enviornment, we will explicitly
 * skip this test.  Set this to be a GeoLite.dat file to get this to
 * operate properly.
 */
if (!process.env['GEOIP_DATABASE']) {
	sys.puts('GEOIP_DATABASE is unset; skipping');
	process.exit(0);
}

sys.puts(sys.inspect(mod_ca.caGeoIP('123.45.67.89')));
