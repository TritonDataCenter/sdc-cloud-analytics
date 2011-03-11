/*
 * DTrace metric for node.js socket operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
	module: 'node',
	stat: 'socket_ops',
	type: 'ops',
	label: 'socket operations',
	fields: {
	    type: { label: 'type', type: mod_ca.ca_type_string },
	    raddr: { label: 'remote host', type: mod_ca.ca_type_string },
	    rport: { label: 'remote port', type: mod_ca.ca_type_string },
	    size: { label: 'size', type: mod_ca.ca_type_number },
	    buffered: { label: 'buffered data', type: mod_ca.ca_type_number },
	    zonename: { label: 'zone name', type: mod_ca.ca_type_string },
	    hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	    pid: { label: 'process identifier', type: mod_ca.ca_type_string }
	},
	metad: {
	    probedesc: [ {
		probes: [ 'node*:::net-socket-read',
		    'node*:::net-socket-write' ],
		aggregate: {
		    type: 'count()',
		    raddr: 'count()',
		    rport: 'count()',
		    size: 'llquantize($0, 10, 0, 11, 100)',
		    buffered: 'llquantize($0, 10, 0, 11, 100)',
		    default: 'count()',
		    zonename: 'count()',
		    pid: 'count()'
		},
		transforms: {
		    type: '(probename == "net-socket-read" ? "read" : "write")',
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
		    pid: 'lltostr(pid)'
		}
	    } ],
	    usepragmazone: true
	}
};

exports.cadMetricDesc = desc;
