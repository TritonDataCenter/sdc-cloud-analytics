/*
 * DTrace metric for CPU Thread operations.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'cpu',
    stat: 'thread_executions',
    type: 'ops',
    label: 'thread executions',
    fields: {
	runtime: { label: 'runtime', type: mod_ca.ca_type_latency },
	hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	pid: {
	    label: 'process identifier',
	    type: mod_ca.ca_type_string
	},
	execname: {
	    label: 'application name',
	    type: mod_ca.ca_type_string
	},
	zonename: {
	    label: 'zone name',
	    type: mod_ca.ca_type_string
	},
	leavereason: {
	    label: 'reason leaving cpu',
	    type: mod_ca.ca_type_string
	}
    },
    metad: {
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
	    transforms: {
		runtime: 'timestamp - $0',
		pid: 'lltostr(pid)',
		execname: 'execname',
		hostname:
		    '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		leavereason: '(curlwpsinfo->pr_state == SRUN ? "runnable" : ' +
		    'curlwpsinfo->pr_state == SZOMB ? "exited" : ' +
		    'curlwpsinfo->pr_state == SSTOP ? "stopped" : ' +
		    'curlwpsinfo->pr_state == SIDL ? "in proc creation" : ' +
		    'curlwpsinfo->pr_state == SONPROC ? "on-cpu" : ' +
		    'curlwpsinfo->pr_state == SWAIT ? "waiting to be ' +
		    'runnable" :' +
		    'curlwpsinfo->pr_stype == SOBJ_NONE ? "sleeping" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_MUTEX ? "kernel mutex" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_RWLOCK ? "kernel ' +
		    'read/write lock" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_CV ? "kernel condition ' +
		    'variable" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_SEMA ? "kernel ' +
		    'semaphore" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_USER ? "user synch ' +
		    'object" : ' +
		    'curlwpsinfo->pr_stype == SOBJ_USER_PI ? ' +
		    '"user sync object with priority inheritence" : ' +
		    '"shuttle synchronization object")'
	    },
	    aggregate: {
		runtime: 'llquantize($0, 10, 3, 11, 100)',
		hostname: 'count()',
		pid: 'count()',
		execname: 'count()',
		zonename: 'count()',
		leavereason: 'count()',
		default: 'count()'
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
