/*
 * DTrace metric for Manta tasks committed
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'tasks_committed',
    fields: [ 'hostname', 'zonename', 'jobid' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-supervisor*:::task-committed' ],
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
