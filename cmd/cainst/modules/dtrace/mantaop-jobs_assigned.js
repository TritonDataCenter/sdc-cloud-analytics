/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * DTrace metric for Manta jobs assigned
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'jobs_assigned',
    fields: [ 'hostname', 'zonename' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::job-assigned' ],
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		zonename: 'count()'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename'
	    }
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
