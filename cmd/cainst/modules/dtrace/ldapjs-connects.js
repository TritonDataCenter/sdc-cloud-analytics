/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for ldap.js connections
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'ldapjs',
    stat: 'connections',
    fields: [ 'hostname', 'zonename', 'pid', 'execname', 'psargs', 'raddr' ],
    metad: {
	probedesc: [ {
		probes: [ 'ldapjs*:::server-connection' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			pid: 'count()',
			execname: 'count()',
			psargs: 'count()',
			raddr: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			pid: 'lltostr(pid)',
			execname: 'execname',
			psargs: 'curpsinfo->pr_psargs',
			raddr: 'copyinstr(arg0)'
		}
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
