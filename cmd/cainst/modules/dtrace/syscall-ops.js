/*
 * DTrace metric for system calls by operation.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'syscall',
    stat: 'syscalls',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'syscall', 'latency', 'cputime' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'syscall:::entry' ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'thread'
			},
			cputime: {
				gather: 'vtimestamp',
				store: 'thread'
			}
		}
	    },
	    {
		probes: [ 'syscall:::return' ],
		aggregate: {
			default: 'count()',
			zonename: 'count()',
			syscall: 'count()',
			hostname: 'count()',
			pid: 'count()',
			ppid: 'count()',
			psargs: 'count()',
			execname: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			ppsargs: 'count()',
			pexecname: 'count()',
			cputime: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			execname: 'execname',
			syscall: 'probefunc',
			pid: 'lltostr(pid)',
			ppid: 'lltostr(ppid)',
			psargs: 'curpsinfo->pr_psargs',
			latency: 'timestamp - $0',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			cputime: 'vtimestamp - $0'
		},
		verify: {
			latency: '$0',
			cputime: '$0'
		}
	    },
	    {
		probes: [ 'syscall:::return' ],
		clean: {
			latency: '$0',
			cputime: '$0'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
