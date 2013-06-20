/*
 * Restify Server Operations, eg. routes
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'restify',
    stat: 'handler_ops',
    fields: [ 'hostname', 'zonename', 'execname', 'pid', 'ppid',
	'pexecname', 'psargs', 'ppsargs', 'restify_sname', 'restify_rname',
	'restify_hname', 'latency' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'restify*:::handler-start' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'global[pid,arg3]'
			}
		}
	    },
	    {
		probes: [ 'restify*:::handler-done' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			execname: 'count()',
			pid: 'count()',
			ppid: 'count()',
			pexecname: 'count()',
			psargs: 'count()',
			ppsargs: 'count()',
			restify_sname: 'count()',
			restify_rname: 'count()',
			restify_hname: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			execname: 'execname',
			pid: 'lltostr(pid)',
			ppid: 'lltostr(ppid)',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			psargs: 'curpsinfo->pr_psargs',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			restify_sname: 'copyinstr(arg0)',
			restify_rname: 'copyinstr(arg1)',
			restify_hname: 'copyinstr(arg2)',
			latency: 'timestamp - $0[pid, arg3]'
	        },
		verify: {
			latency: '$0[pid, arg3]'
		}
	    },
	    {
		probes: [ 'restify*:::handler-done' ],
		clean: {
			latency: '$0[pid, arg3]'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
