/*
 * Restify Server Operations, eg. routes
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'restify',
    stat: 'server_ops',
    fields: [ 'hostname', 'zonename', 'execname', 'pid', 'ppid',
	'pexecname', 'psargs', 'ppsargs', 'restify_sname', 'restify_rname',
	'http_url', 'http_method', 'http_status', 'latency' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'restify*:::route-start' ],
		gather: {
			http_url: {
				gather: 'copyinstr(arg4)',
				store: 'global[pid,arg2]'
			},
			http_method: {
				gather: 'copyinstr(arg3)',
				store: 'global[pid,arg2]'
			},
			latency: {
				gather: 'timestamp',
				store: 'global[pid,arg2]'
			}
		}
	    },
	    {
		probes: [ 'restify*:::route-done' ],
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
			http_url: 'count()',
			http_method: 'count()',
			http_status: 'count()',
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
			http_url: '$0[pid, arg2]',
			http_method: '$0[pid, arg2]',
			http_status: 'lltostr(arg3)',
			latency: 'timestamp - $0[pid, arg2]'
	        },
		verify: {
			http_url: '$0[pid, arg2]',
			http_method: '$0[pid, arg2]',
			latency: '$0[pid, arg2]'
		}
	    },
	    {
		probes: [ 'restify*:::route-done' ],
		clean: {
			http_url: '$0[pid, arg2]',
			http_method: '$0[pid, arg2]',
			latency: '$0[pid, arg2]'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
