var mod_cageoip = require('../../lib/ca/ca-geo');
var sys = require('sys');
var assert = require('assert');

sys.puts(sys.inspect(mod_cageoip.caGeoIP('138.16.60.2')));
