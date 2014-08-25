/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric to watch process executions
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'unix',
    stat: 'proc_execs',
    fields: [ 'hostname', 'zonename', 'execname', 'subsecond', 'psargs',
	'ppid', 'ppsargs', 'pexecname', 'pid' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'proc:::exec-success' ],
		aggregate: {
		    default: 'count()',
		    hostname: 'count()',
		    zonename: 'count()',
		    execname: 'count()',
		    subsecond: 'lquantize(($0 % 1000000000) / 1000000, ' +
		        '0, 1000, 10)',
		    psargs: 'count()',
		    ppsargs: 'count()',
		    pexecname: 'count()',
		    ppid: 'count()',
		    pid: 'count()'
		},
		transforms: {
		    hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		    zonename: 'zonename',
		    execname: 'execname',
		    subsecond: 'timestamp',
		    psargs: 'curpsinfo->pr_psargs',
		    ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		    pexecname: 'curthread->t_procp->p_parent->' +
			'p_user.u_comm',
		    ppid: 'lltostr(ppid, 10)',
		    pid: 'lltostr(pid, 10)'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
