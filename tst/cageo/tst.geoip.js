/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var mod_cageoip = require('../../lib/ca/ca-geo');
var sys = require('sys');
var assert = require('assert');

sys.puts(sys.inspect(mod_cageoip.caGeoIP('138.16.60.2')));
