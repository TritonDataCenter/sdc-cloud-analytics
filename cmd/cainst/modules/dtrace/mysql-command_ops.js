/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for mysql commands
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mysql',
    stat: 'commands',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'command', 'user', 'client', 'status', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'mysql*:::command-start' ],
		gather: {
			command: {
				gather: 'lltostr(arg1)',
				store: 'thread'
			}, user: {
				gather: 'copyinstr(arg2)',
				store: 'thread'
			}, client: {
				gather: 'copyinstr(arg3)',
				store: 'thread'
			}, latency: {
				gather: 'timestamp',
				store: 'thread'
			}, cputime: {
				gather: 'vtimestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'mysql*:::command-done' ],
		aggregate: {
			command: 'count()',
			user: 'count()',
			client: 'count()',
			status: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			cputime: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()'
		},
		transforms: {
			command: '$0',
			user: '$0',
			client: '$0',
			status: 'arg0 == 0 ? "success" : "fail"',
			latency: 'timestamp - $0',
			cputime: 'vtimestamp - $0',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			command: '$0',
			user: '$0',
			client: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
		probes: [ 'mysql*:::command-done' ],
		clean: {
			command: '$0',
			user: '$0',
			client: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
