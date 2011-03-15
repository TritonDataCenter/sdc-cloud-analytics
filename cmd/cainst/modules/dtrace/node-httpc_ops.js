/*
 * DTrace metric for node.js http operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'node',
    stat: 'httpc_ops',
    label: 'HTTP client operations',
    type: 'ops',
    fields: {
	method: { label: 'method', type: mod_ca.ca_type_string },
	hostname: { label: 'hostname', type: mod_ca.ca_type_string },
	url: { label: 'URL', type: mod_ca.ca_type_string },
	raddr: { label: 'remote IP address',
	    type: mod_ca.ca_type_ipaddr },
	rport: { label: 'remote TCP port',
	    type: mod_ca.ca_type_string },
	latency: { label: 'latency', type: mod_ca.ca_type_latency },
	zonename: { label: 'zone name', type: mod_ca.ca_type_string },
	pid: { label: 'process identifier', type: mod_ca.ca_type_string }
    },
    metad: {
	locals: [
	    { fd: 'int' }
	],
	probedesc: [
	    {
		probes: [ 'node*:::http-client-request' ],
		gather: {
			url: {
				gather: '((xlate <node_http_request_t *>' +
				    '((node_dtrace_http_request_t *)arg0))->' +
				    'url)',
				store: 'global[pid,this->fd]'
			}, method: {
				gather: '((xlate <node_http_request_t *>' +
				    '((node_dtrace_http_request_t *)arg0))->' +
				    'method)',
				store: 'global[pid,this->fd]'
			}, latency: {
				gather: 'timestamp',
				store: 'global[pid,this->fd]'
			}
		},
		local: [ {
			fd: '(xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg1))->fd'
		} ]
	    },
	    {
		probes: [ 'node*:::http-client-response' ],
		local: [ {
			fd: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)'
		} ],
		aggregate: {
			url: 'count()',
			method: 'count()',
			raddr: 'count()',
			rport: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			pid: 'count()'
		},
		transforms: {
			url: '$0[pid,this->fd]',
			method: '$0[pid,this->fd]',
			raddr: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->' +
			    'remoteAddress)',
			rport: 'lltostr(((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->remotePort))',
			latency: 'timestamp - $0[pid,this->fd]',
			zonename: 'zonename',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			pid: 'lltostr(pid)'
		},
		verify: {
			url: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]',
			latency: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]',
			method: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]'
		}
	    },
	    {
		probes: [ 'node*:::http-client-response' ],
		local: [ {
			fd: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)'
		} ],
		clean: {
			url: '$0[pid,this->fd]',
			method: '$0[pid,this->fd]',
			latency: '$0[pid,this->fd]'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
