/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace implementation of zfs.arc_ops metric.
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'zfs',
    stat: 'arc_ops',
    fields: [ 'hostname', 'zonename', 'execname', 'psargs', 'pid',
	'pexecname', 'ppsargs', 'ppid', 'optype' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'sdt:::arc-hit', 'sdt:::arc-miss' ],
		aggregate: {
		    default: 'count()',
		    hostname: 'count()',
		    zonename: 'count()',
		    execname: 'count()',
		    psargs: 'count()',
		    pid: 'count()',
		    pexecname: 'count()',
		    ppsargs: 'count()',
		    ppid: 'count()',
		    optype: 'count()'
		},
		transforms: {
		    hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		    zonename: 'zonename',
		    execname: 'execname',
		    psargs: 'curpsinfo->pr_psargs',
		    ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		    pexecname: 'curthread->t_procp->p_parent->' +
			'p_user.u_comm',
		    ppid: 'lltostr(ppid, 10)',
		    pid: 'lltostr(pid, 10)',
		    optype: 'probename + sizeof ("arc-") - 1'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
