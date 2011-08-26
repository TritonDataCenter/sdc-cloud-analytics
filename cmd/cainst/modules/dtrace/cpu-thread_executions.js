/*
 * DTrace metric for CPU Thread operations.
 *
 * The idle thread is filtered out by checking that t_pri != -1.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'cpu',
    stat: 'thread_executions',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'leavereason', 'runtime', 'subsecond' ],
    metad: {
	locals: [
	    { state: 'int' }
	],
	probedesc: [ {
	    probes: [ 'sched:::on-cpu' ],
	    gather: {
		runtime: {
		    gather: 'timestamp',
		    store: 'thread'
		},
		subsecond: {
		    gather: 'timestamp',
		    store: 'thread'
		}
	    },
	    predicate: 'curthread->t_pri != -1'
	}, {
	    probes: [ 'sched:::off-cpu' ],
	    local: [
	        { state: 'curlwpsinfo->pr_state' }
	    ],
	    transforms: {
		runtime: 'timestamp - $0',
		pid: 'lltostr(pid)',
		ppid: 'lltostr(ppid)',
		execname: 'execname',
		hostname:
		    '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		leavereason: '(this->state == SRUN ? "runnable" : ' +
		    'this->state == SZOMB ? "exited" : ' +
		    'this->state == SSTOP ? "stopped" : ' +
		    'this->state == SIDL ? "in proc creation" : ' +
		    'this->state == SONPROC ? "on-cpu" : ' +
		    'this->state == SWAIT ? "waiting to be ' +
		    'runnable" :' +
		    'this->state == SSLEEP ? "sleeping" : ' +
		    '"unknown")',
		psargs: 'curpsinfo->pr_psargs',
		ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		pexecname: 'curthread->t_procp->p_parent->' +
		    'p_user.u_comm',
		subsecond: '$0'
	    },
	    aggregate: {
		runtime: 'llquantize($0, 10, 3, 11, 100)',
		hostname: 'count()',
		pid: 'count()',
		ppid: 'count()',
		execname: 'count()',
		zonename: 'count()',
		leavereason: 'count()',
		psargs: 'count()',
		default: 'count()',
		ppsargs: 'count()',
		pexecname: 'count()',
		subsecond: 'lquantize(($0 % 1000000000) / 1000000, 0, 1000, 10)'
	    },
	    verify: {
		runtime: '$0',
		subsecond: '$0'
	    },
	    predicate: 'curthread->t_pri != -1'
	}, {
	    probes: [ 'sched:::off-cpu' ],
	    clean: {
		runtime: '$0',
		subsecond: '$0'
	    },
	    predicate: 'curthread->t_pri != -1'
	} ]
    }
};

exports.cadMetricDesc = desc;
