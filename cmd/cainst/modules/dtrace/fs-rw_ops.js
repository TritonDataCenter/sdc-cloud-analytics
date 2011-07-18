/*
 * Filesystem read/write operations
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var allowedfs = [ 'ufs', 'zfs', 'dev', 'dev fs', 'proc', 'lofs', 'tmpfs',
'nfs' ];
var allowedfs_pred = '(' + allowedfs.map(function (fs) {
    return (caSprintf('this->fstype == "%s"', fs));
}).join(' || ') + ')';

var desc = {
    module: 'fs',
    stat: 'logical_rwops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'fstype', 'optype', 'size', 'offset',
	'latency' ],
    fields_internal: [ 'vnode', 'depth' ],
    metad: {
	locals: [
	    { fstype: 'string' }
	],
	probedesc: [ {
	    probes: [ 'fbt::fop_read:entry', 'fbt::fop_write:entry' ],
	    alwaysgather: {
		vnode: {
		    gather: 'arg0',
		    store: 'thread'
		},
		depth: {
		    gather: 'stackdepth',
		    store: 'thread'
		}
	    },
	    gather: {
		latency: {
		    gather: 'timestamp',
		    store: 'thread'
		},
		size: {
		    gather: 'args[1]->uio_resid',
		    store: 'thread'
		},
		offset: {
		    gather: 'args[1]->_uio_offset._f',
		    store: 'thread'
		}
	    },
	    predicate: '$vnode0 == NULL'
	}, {
	    probes: [ 'fbt::fop_read:return', 'fbt::fop_write:return' ],
	    aggregate: {
		pid: 'count()',
		ppid: 'count()',
		execname: 'count()',
		zonename: 'count()',
		optype: 'count()',
		hostname: 'count()',
		fstype: 'count()',
		psargs: 'count()',
		size: 'llquantize($0, 2, 0, 25, 32)',
		offset: 'llquantize($0, 10, 0, 12, 100)',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		default: 'count()',
		ppsargs: 'count()',
		pexecname: 'count()'
	    },
	    local: [ {  fstype: 'stringof(((vnode_t*)self->vnode0)->' +
		'v_op->vnop_name)' } ],
	    verify: {
		size: '$0',
		offset: '$0',
		latency: '$0',
		vnode: '$0',
		depth: '$0'
	    },
	    transforms: {
		pid: 'lltostr(pid)',
		ppid: 'lltostr(ppid)',
		hostname:
		    '"' + mod_ca.caSysinfo().ca_hostname + '"',
		execname: 'execname',
		zonename: 'zonename',
		optype: '(probefunc + 4)',
		size: '$0',
		offset: '$0',
		latency: 'timestamp - $0',
		psargs: 'curpsinfo->pr_psargs',
		fstype: 'stringof(((vnode_t*)self->vnode0)->' +
		'v_op->vnop_name)',
		ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		pexecname: 'curthread->t_procp->p_parent->' +
		    'p_user.u_comm'
	    },
	    predicate: '$depth0 == stackdepth && $vnode0 != NULL ' +
		'&& ' + allowedfs_pred
	}, {
	    probes: [ 'fbt::fop_read:return', 'fbt::fop_write:return' ],
	    predicate: '$depth0 == stackdepth',
	    clean: {
		vnode: '$0',
		depth: '$0',
		size: '$0',
		offset: '$0',
		latency: '$0'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
