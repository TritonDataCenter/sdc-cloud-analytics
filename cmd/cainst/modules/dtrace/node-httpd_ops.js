/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for node.js http operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'node',
    stat: 'httpd_ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'ppid',
	'pexecname', 'ppsargs', 'http_method', 'http_url', 'raddr', 'rport',
	'http_path', 'http_origin', 'latency' ],
    metad: {
	locals: [
	    { fd: 'int' }
	],
	probedesc: [
	    {
		probes: [ 'node*:::http-server-request' ],
		gather: {
			http_url: {
				gather: '((xlate <node_http_request_t *>' +
				    '((node_dtrace_http_request_t *)arg0))->' +
				    'url)',
				store: 'global[pid,this->fd]'
			}, http_method: {
				gather: '((xlate <node_http_request_t *>' +
				    '((node_dtrace_http_request_t *)arg0))->' +
				    'method)',
				store: 'global[pid,this->fd]'
			}, latency: {
				gather: 'timestamp',
				store: 'global[pid,this->fd]'
			}, http_path: {
				gather: 'strtok((xlate ' +
				    '<node_http_request_t *> (' +
				    '(node_dtrace_http_request_t *)' +
				    'arg0))->url, "?")',
				store: 'global[pid,this->fd]'
			}, http_origin: {
				gather: '((xlate <node_http_request_t *>' +
				    '((node_dtrace_http_request_t *)arg0))->' +
				    'forwardedFor)',
				store: 'global[pid,this->fd]'
			}
		},
		local: [ {
			fd: '(xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg1))->fd'
		} ]
	    },
	    {
		probes: [ 'node*:::http-server-response' ],
		local: [ {
			fd: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)'
		} ],
		aggregate: {
			http_url: 'count()',
			http_method: 'count()',
			raddr: 'count()',
			rport: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)',
			hostname: 'count()',
			default: 'count()',
			zonename: 'count()',
			ppid: 'count()',
			execname: 'count()',
			http_origin: 'count()',
			psargs: 'count()',
			pid: 'count()',
			http_path: 'count()',
			ppsargs: 'count()',
			pexecname: 'count()'
		},
		transforms: {
			http_url: '$0[pid,this->fd]',
			http_method: '$0[pid,this->fd]',
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			raddr: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->' +
			    'remoteAddress)',
			rport: 'lltostr(((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->remotePort))',
			latency: 'timestamp - $0[pid,this->fd]',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			ppid: 'lltostr(ppid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			http_path: '$0[pid,this->fd]',
			ppsargs:
			    'curthread->t_procp->p_parent->p_user.u_psargs',
			pexecname: 'curthread->t_procp->p_parent->' +
			    'p_user.u_comm',
			http_origin: 'strlen($0[pid,this->fd]) == 0 ? ' +
			    '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->' +
			    'remoteAddress) : strtok($0[pid,this->fd], ",")'
		},
		verify: {
			http_url: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]',
			latency: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]',
			http_method: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]',
			/*
			 * The origin that we gather can actually be the empty
			 * string, but we don't want to skip this probe.
			 */
			http_origin: '1',
			http_path: '$0[pid,((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)]'
		}
	    },
	    {
		probes: [ 'node*:::http-server-response' ],
		local: [ {
			fd: '((xlate <node_connection_t *>' +
			    '((node_dtrace_connection_t *)arg0))->fd)'
		} ],
		clean: {
			http_url: '$0[pid,this->fd]',
			http_method: '$0[pid,this->fd]',
			latency: '$0[pid,this->fd]',
			http_origin: '$0[pid,this->fd]',
			http_path: '$0[pid,this->fd]'
		}
	    }
	],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
