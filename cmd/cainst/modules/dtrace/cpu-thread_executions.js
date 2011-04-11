/*
 * DTrace metric for CPU Thread operations.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'cpu',
    stat: 'thread_executions',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'leavereason', 'runtime' ],
    metad: {
	locals: [
	    { state: 'int' },
	    { stype: 'int' }
	],
	probedesc: [ {
	    probes: [ 'sched:::on-cpu' ],
	    gather: {
		runtime: {
		    gather: 'timestamp',
		    store: 'thread'
		}
	    }
	}, {
	    probes: [ 'sched:::off-cpu' ],
	    local: [
	        { state: 'curlwpsinfo->pr_state' },
		{ stype: '(this->ops = curthread->t_sobj_ops) != NULL ? ' +
		    'this->ops->sobj_type : 0' }

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
		    'this->stype == SOBJ_NONE ? "sleeping" : ' +
		    'this->stype == SOBJ_MUTEX ? "kernel mutex" : ' +
		    'this->stype == SOBJ_RWLOCK ? "kernel ' +
		    'read/write lock" : ' +
		    'this->stype == SOBJ_CV ? "kernel condition ' +
		    'variable" : ' +
		    'this->stype == SOBJ_SEMA ? "kernel ' +
		    'semaphore" : ' +
		    'this->stype == SOBJ_USER ? "user synch ' +
		    'object" : ' +
		    'this->stype == SOBJ_USER_PI ? ' +
		    '"user sync object with priority inheritence" : ' +
		    'this->stype == SOBJ_SHUTTLE ? "shuttle synchronization ' +
		    'object" : "unknown")',
		psargs: 'curpsinfo->pr_psargs',
		ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		pexecname: 'curthread->t_procp->p_parent->' +
		    'p_user.u_comm'
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
		pexecname: 'count()'
	    },
	    verify: {
		runtime: '$0'
	    }
	}, {
	    probes: [ 'sched:::off-cpu' ],
	    clean: {
		runtime: '$0'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
