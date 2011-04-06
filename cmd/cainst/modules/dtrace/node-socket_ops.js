/*
 * DTrace metric for node.js socket operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
	module: 'node',
	stat: 'socket_ops',
	fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	    'pexecname', 'ppsargs', 'optype', 'raddr', 'rport', 'size',
	    'buffered' ],
	metad: {
	    probedesc: [ {
		probes: [ 'node*:::net-socket-read',
		    'node*:::net-socket-write' ],
		aggregate: {
		    optype: 'count()',
		    raddr: 'count()',
		    rport: 'count()',
		    size: 'llquantize($0, 10, 0, 11, 100)',
		    buffered: 'llquantize($0, 10, 0, 11, 100)',
		    default: 'count()',
		    zonename: 'count()',
		    hostname: 'count()',
		    ppid: 'count()',
		    execname: 'count()',
		    psargs: 'count()',
		    pid: 'count()',
		    ppsargs: 'count()',
		    pexecname: 'count()'
		},
		transforms: {
		    optype:
			'(probename == "net-socket-read" ? "read" : "write")',
		    hostname:
			'"' + mod_ca.caSysinfo().ca_hostname + '"',
		    raddr: '((xlate <node_connection_t *>' +
			'((node_dtrace_connection_t *)arg0))->remoteAddress)',
		    rport: 'lltostr((xlate <node_connection_t *>' +
			'((node_dtrace_connection_t *)arg0))->bufferSize)',
		    size: 'arg1',
		    buffered: '((xlate <node_connection_t *>' +
			'((node_dtrace_connection_t *)arg0))->bufferSize)',
		    zonename: 'zonename',
		    pid: 'lltostr(pid)',
		    ppid: 'lltostr(ppid)',
		    execname: 'execname',
		    psargs: 'curpsinfo->pr_psargs',
		    ppsargs: 'curthread->t_procp->p_parent->p_user.u_psargs',
		    pexecname: 'curthread->t_procp->p_parent->' +
			'p_user.u_comm'
		}
	    } ],
	    usepragmazone: true
	}
};

exports.cadMetricDesc = desc;
