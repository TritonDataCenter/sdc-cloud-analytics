/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric node.js garbage collection operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'node',
    stat: 'gc_ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'ppid', 'pexecname', 'ppsargs', 'gctype', 'latency' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'node*:::gc-start' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'node*:::gc-done' ],
		aggregate: {
			default: 'count()',
			execname: 'count()',
			gctype: 'count()',
			hostname: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			pexecname: 'count()',
			pid: 'count()',
			ppid: 'count()',
			ppsargs: 'count()',
			psargs: 'count()',
			zonename: 'count()'
		},
		transforms: {
			execname: 'execname',
			gctype: '(arg0 == 1 ? "scavenge" : (arg0 == 2 ? ' +
			    '"mark and sweep" : "scavenge and mark and ' +
			    'sweep."))',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			latency: 'timestamp - $0',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			pid: 'lltostr(pid)',
			ppid: 'lltostr(ppid)',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			psargs: 'curpsinfo->pr_psargs',
			zonename: 'zonename'
		},
		verify: {
			latency: '$0'
		}
	    },
	    {
		probes: [ 'node*:::gc-done' ],
		clean: {
			latency: '$0'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
