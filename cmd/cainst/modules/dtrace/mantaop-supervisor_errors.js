/*
 * DTrace metric for Manta errors dispatched
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'supervisor_errors',
    fields: [ 'hostname', 'zonename', 'jobid' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::error-dispatched' ],
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		zonename: 'count()',
		jobid: 'count()'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename',
		jobid: 'copyinstr(arg0)'
	    }
	} ],
	usepragmazone: true
    }
};

exports.cadMetricDesc = desc;
