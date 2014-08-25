/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric to sample on-CPU VM threads.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'vm',
    stat: 'thread_samples',
    fields: [ 'hostname', 'zonename', 'subsecond', 'vmmmuctx' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'profile:::profile-99hz' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			subsecond: 'lquantize(($0 % 1000000000) / 1000000, ' +
			    '0, 1000, 10)',
			vmmmuctx: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			subsecond: 'timestamp',
			vmmmuctx: 'lltostr(vmregs[VMX_GUEST_CR3], 16)'
		},
		predicate: 'execname == "qemu-system-x86_"'
	    }
	]
    }
};

exports.cadMetricDesc = desc;
