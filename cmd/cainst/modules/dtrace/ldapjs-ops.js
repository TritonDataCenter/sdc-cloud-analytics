/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for ldap.js operations
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var ops = [
    'add', 'bind', 'compare', 'delete', 'exop', 'modify', 'modifydn', 'search',
    'unbind'
];

var startprobes = ops.map(function (opname) {
	return (caSprintf('ldapjs*:::server-%s-start', opname));
});

var doneprobes = ops.map(function (opname) {
	return (caSprintf('ldapjs*:::server-%s-done', opname));
});

var desc = {
    module: 'ldapjs',
    stat: 'ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'raddr', 'optype', 'ldapbinddn', 'ldaprequestdn', 'status',
	'latency' ],
    metad: {
	locals: [ { rqid: 'int' } ],
	probedesc: [ {
		probes: startprobes,
		local: [ { rqid: 'arg0' } ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'global[pid, this->rqid]'
			}
		}
	}, {
		probes: doneprobes,
		local: [ { rqid: 'arg0' } ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			raddr: 'count()',
			optype: 'count()',
			ldapbinddn: 'count()',
			ldaprequestdn: 'count()',
			status: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			raddr: 'copyinstr(arg1)',
			optype: 'strtok(probename + 7, "-")',
			ldapbinddn: 'copyinstr(arg2)',
			ldaprequestdn: 'copyinstr(arg3)',
			status: 'arg4',
			latency: 'timestamp - $0[pid, this->rqid]'
		},
		verify: {
			latency: '$0[pid, arg0]'
		}
	}, {
		probes: doneprobes,
		local: [ { rqid: 'arg0' } ],
		clean: {
			latency: '$0[pid, this->rqid]'
		}
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
