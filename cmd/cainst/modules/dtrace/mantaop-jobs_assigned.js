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
