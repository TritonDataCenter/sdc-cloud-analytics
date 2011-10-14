/*
 * DTrace metric to watch thread creations
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'unix',
    stat: 'thr_creates',
    fields: [ 'hostname', 'zonename', 'execname', 'subsecond', 'psargs',
	'ppid', 'ppsargs', 'pexecname', 'pid' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'proc:::lwp-create' ],
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
