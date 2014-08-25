/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric to sample on-CPU threads.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'cpu',
    stat: 'thread_samples',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'subsecond' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'profile:::profile-99hz' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			ppid: 'count()',
			pexecname: 'count()',
			ppsargs: 'count()',
			subsecond: 'lquantize(($0 % 1000000000) / 1000000, ' +
			    '0, 1000, 10)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			ppid: 'lltostr(ppid)',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			subsecond: 'timestamp'
		},
		predicate: 'curthread->t_pri != -1'
	    }
	]
    }
};

exports.cadMetricDesc = desc;
