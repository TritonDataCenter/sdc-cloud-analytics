/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for mysql filesorts
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mysql',
    stat: 'filesort',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'database', 'table', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'mysql*:::filesort-start' ],
		gather: {
			database: {
				gather: 'copyinstr(arg0)',
				store: 'thread'
			}, table: {
				gather: 'copyinstr(arg1)',
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
		probes: [ 'mysql*:::filesort-done' ],
		aggregate: {
			database: 'count()',
			table: 'count()',
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
			database: '$0',
			table: 'strtok($0, "#")',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			latency: 'timestamp - $0',
			cputime: 'vtimestamp - $0',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs'
		},
		verify: {
			database: '$0',
			table: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
		probes: [ 'mysql*:::filesort-done' ],
		clean: {
			database: '$0',
			table: '$0',
			latency: '$0',
			cputime: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
