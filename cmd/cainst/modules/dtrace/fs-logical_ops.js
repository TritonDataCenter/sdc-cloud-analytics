/*
 * Filesystem logical operations
 */

var mod_ca = require('../../../../lib/ca/ca-common');

var probelist = [ 'fop_read', 'fop_write', 'fop_ioctl', 'fop_access',
    'fop_getattr', 'fop_setattr', 'fop_lookup', 'fop_create',
    'fop_remove', 'fop_link', 'fop_rename', 'fop_mkdir', 'fop_rmdir',
    'fop_readdir', 'fop_symlink', 'fop_readlink', 'fop_fsync',
    'fop_getpage', 'fop_putpage', 'fop_map' ];
var allowedfs = [ 'ufs', 'zfs', 'dev', 'dev fs', 'proc', 'lofs', 'tmpfs',
'nfs' ];
var allowedfs_pred = '(' + allowedfs.map(function (fs) {
    return (caSprintf('this->fstype == "%s"', fs));
}).join(' || ') + ')';
var entryprobes = probelist.map(function (x) {
    return (caSprintf('fbt::%s:entry', x));
});
entryprobes.push('fbt::fop_open:entry');
var returnprobes = probelist.map(function (x) {
    return (caSprintf('fbt::%s:return', x));
});
returnprobes.push('fbt::fop_open:entry');

var desc = {
    module: 'fs',
    stat: 'logical_ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'fstype', 'optype', 'latency' ],
    fields_internal: [ 'vnode', 'depth' ],
    metad: {
	locals: [
	    { fstype: 'string' }
	],
	probedesc: [ {
	    probes: entryprobes,
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
		}
	    },
	    predicate: '$vnode0 == NULL'
	}, {
	    probes: [ 'fbt::fop_open:return' ],
	    aggregate: {
		pid: 'count()',
		ppid: 'count()',
		execname: 'count()',
		zonename: 'count()',
		optype: 'count()',
		hostname: 'count()',
		fstype: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		psargs: 'count()',
		default: 'count()',
		ppsargs: 'count()',
		pexecname: 'count()'

	    },
	    local: [
		       { fstype: 'stringof((*((vnode_t**)self->vnode0))->' +
		'v_op->vnop_name)' }
	    ],
	    transforms: {
		pid: 'lltostr(pid)',
		ppid: 'lltostr(ppid)',
		hostname:
		    '"' + mod_ca.caSysinfo().ca_hostname + '"',
		execname: 'execname',
		zonename: 'zonename',
		optype: '(probefunc + 4)',
		latency: 'timestamp - $0',
		psargs: 'curpsinfo->pr_psargs',
		fstype: 'stringof((*((vnode_t**)self->vnode0))->' +
		'v_op->vnop_name)',
		ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		pexecname: 'curthread->t_procp->p_parent->' +
		    'p_user.u_comm'
	    },
	    verify: {
		latency: '$0',
		vnode: '$0',
		depth: '$0'
	    },
	    predicate: '$depth0 == stackdepth && $vnode0 != NULL ' +
		'&& ' + allowedfs_pred
	}, {
	    probes: probelist.map(function (x) {
		return (caSprintf('fbt::%s:return', x));
	    }),
	    aggregate: {
		pid: 'count()',
		ppid: 'count()',
		execname: 'count()',
		zonename: 'count()',
		optype: 'count()',
		hostname: 'count()',
		fstype: 'count()',
		psargs: 'count()',
		latency: 'llquantize($0, 10, 3, 11, 100)',
		default: 'count()',
		ppsargs: 'count()',
		pexecname: 'count()'
	    },
	    local: [ {  fstype: 'stringof(((vnode_t*)self->vnode0)->' +
		'v_op->vnop_name)' } ],
	    verify: {
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
	    probes: returnprobes,
	    predicate: '$depth0 == stackdepth',
	    clean: {
		vnode: '$0',
		depth: '$0',
		latency: '$0'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
