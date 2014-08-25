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

var desc = {
    module: 'ldapjs',
    stat: 'search_ops',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs',
	'raddr', 'ldapbinddn', 'ldaprequestdn', 'status', 'ldapfilter',
	'ldapscope', 'latency'
    ],
    metad: {
	locals: [ { rqid: 'int' } ],
	probedesc: [ {
		probes: [ 'ldapjs*:::server-search-start' ],
		local: [ { rqid: 'arg0' } ],
		gather: {
			latency: {
				gather: 'timestamp',
				store: 'global[pid, this->rqid]'
			},
			ldapfilter: {
				gather: 'copyinstr(arg5)',
				store: 'global[pid, this->rqid]'
			},
			ldapscope: {
				gather: 'copyinstr(arg4)',
				store: 'global[pid, this->rqid]'
			}
		}
	}, {
		probes: [ 'ldapjs*:::server-search-done' ],
		local: [ { rqid: 'arg0' } ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			raddr: 'count()',
			ldapbinddn: 'count()',
			ldaprequestdn: 'count()',
			status: 'count()',
			ldapfilter: 'count()',
			ldapscope: 'count()',
			latency: 'llquantize($0, 10, 3, 11, 100)'
		},
		transforms: {
			hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			raddr: 'copyinstr(arg1)',
			ldapbinddn: 'copyinstr(arg2)',
			ldaprequestdn: 'copyinstr(arg3)',
			status: 'arg4',
			ldapfilter: '$0[pid, this->rqid]',
			ldapscope: '$0[pid, this->rqid]',
			latency: 'timestamp - $0[pid, this->rqid]'
		},
		verify: {
			latency: '$0[pid, arg0]',
			ldapfilter: '$0[pid, arg0]',
			ldapscope: '$0[pid, arg0]'
		}
	}, {
		probes: [ 'ldapjs*:::server-search-done' ],
		local: [ { rqid: 'arg0' } ],
		clean: {
			latency: '$0[pid, this->rqid]',
			ldapfilter: '$0[pid, this->rqid]',
			ldapscope: '$0[pid, this->rqid]'
		}
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
