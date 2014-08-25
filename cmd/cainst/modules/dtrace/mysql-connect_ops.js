/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for mysql connections
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mysql',
    stat: 'connections',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'user', 'client', 'latency' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'mysql*:::connection-start' ],
		gather: {
			user: {
				gather: 'copyinstr(arg1)',
				store: 'thread'
			}, client: {
				gather: 'copyinstr(arg2)',
				store: 'thread'
			}, latency: {
				gather: 'timestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'mysql*:::connection-done' ],
		aggregate: {
			user: 'count()',
			client: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()'
		},
		transforms: {
			user: '$0',
			client: '$0',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			latency: 'timestamp - $0',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			user: '$0',
			client: '$0',
			latency: '$0'
		}
	    },
	    {
		probes: [ 'mysql*:::connection-done' ],
		clean: {
			user: '$0',
			client: '$0',
			latency: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
